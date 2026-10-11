import { addDays, cacheSlice, windowDates } from "./cache-window.js";
import { CORE_READS } from "./full-core.js";
import { openLocalData } from "./local-data.js";
import { createId, currentDay, record, replay } from "./replay.js";

// The phone side of the Core (ADR-0002): a Cache of the full Core's windows
// and an Outbox of commands. It has the API of local data: a command runs at
// once on the Cache, so the UI sees it, and waits in the Outbox until the full
// Core takes it. The full Core wins: after a delivery the Cache takes its
// windows again and replays the commands still waiting on top; a command the
// full Core rejects is gone from the Cache and reported to `onConflict`.

export const CACHE_STORAGE_KEY = "cookish.cache.v1";
export const OUTBOX_STORAGE_KEY = "cookish.outbox.v1";
export const OUTBOX_FLUSH_MS = 800;
export const OUTBOX_RETRY_MS = 30_000;

export function openCache({
  storage,
  outbox,
  transport,
  guestId = "",
  today = () => currentDay(),
  // Wrapped: a browser rejects setTimeout called on another object.
  timers = { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (id) => clearTimeout(id) },
  onChange = () => {},
  onConflict = () => {},
}) {
  const local = openLocalData(storage);
  const stored = outbox.read();
  let pending = Array.isArray(stored) ? stored : [];
  let empty = false;
  let flushing = null;
  // Counts deliveries the full Core answered: windows pulled before the last
  // one may miss commands that already left the Outbox.
  let delivered = 0;
  let timer = null;
  let timerDue = 0;
  // Widened windows of this session: days loaded past the window, every
  // closed Запрос.
  let loadedFrom = "";
  let allRequests = false;
  let olderRequests = 0;

  function windowOptions() {
    return { today: today(), from: loadedFrom, allRequests };
  }

  function schedule(delay) {
    const due = Date.now() + delay;
    if (timer && timerDue <= due) return;
    if (timer) timers.clearTimeout(timer);
    timerDue = due;
    timer = timers.setTimeout(() => {
      timer = null;
      flush();
    }, delay);
  }

  function command(name) {
    return (...args) => {
      // The arguments travel to the full Core: copy them before the run.
      const sent = structuredClone(args);
      const { value, trace } = record(() => local[name](...args));
      if (value && value.ok !== false && value.changed !== false) {
        pending.push({ id: createId("command"), name, args: sent, trace });
        outbox.write(pending);
        schedule(OUTBOX_FLUSH_MS);
      }
      return value;
    };
  }

  // The full Core's windows become the Cache; waiting commands run again on
  // top of them with their own ids and clock.
  function rebase(base) {
    storage.write(base);
    local.load();
    pending.forEach((entry) => replay(entry.trace, () => local[entry.name](...entry.args)));
  }

  async function pullWindows() {
    const seen = delivered;
    let answer;
    try {
      answer = await transport.request("core", "pull", { ...windowOptions(), guestId });
    } catch {
      return { ok: false, offline: true };
    }
    // The delivery pulls newer windows itself.
    if (seen !== delivered) return { ok: true, changed: false };
    const before = JSON.stringify(cacheSlice(local.snapshot(), windowOptions()));
    try {
      rebase(answer.state);
    } catch {
      return { ok: false, reason: "Не удалось обновить данные на телефоне." };
    }
    empty = false;
    olderRequests = Number(answer.olderRequests) || 0;
    return { ok: true, changed: JSON.stringify(cacheSlice(local.snapshot(), windowOptions())) !== before };
  }

  async function refresh() {
    const result = await pullWindows();
    if (result.changed) onChange();
    return result;
  }

  async function deliver() {
    const batch = pending.slice();
    let answer;
    try {
      answer = await transport.request("core", "apply", { guestId, commands: batch });
    } catch {
      schedule(OUTBOX_RETRY_MS);
      return { ok: false, offline: true, waiting: pending.length };
    }
    delivered += 1;
    const results = new Map((answer?.results || []).map((result) => [result.id, result]));
    const done = new Set(batch.filter((entry) => results.has(entry.id) && !results.get(entry.id).retry).map((entry) => entry.id));
    const rejected = batch
      .filter((entry) => done.has(entry.id) && results.get(entry.id).ok === false)
      .map((entry) => ({ id: entry.id, name: entry.name, reason: results.get(entry.id).reason }));
    pending = pending.filter((entry) => !done.has(entry.id));
    outbox.write(pending);
    await refresh();
    if (rejected.length) onConflict(rejected);
    if (pending.length) schedule(done.size < batch.length ? OUTBOX_RETRY_MS : OUTBOX_FLUSH_MS);
    return { ok: true, sent: done.size, rejected, waiting: pending.length };
  }

  // Sends the Outbox; with nothing waiting it only refreshes the windows.
  async function flush() {
    if (flushing) return flushing;
    if (!pending.length) return { ok: true, sent: 0, rejected: [], waiting: 0 };
    flushing = deliver();
    try {
      return await flushing;
    } finally {
      flushing = null;
    }
  }

  // Adds dated parts the Cache does not hold; it never overwrites what is
  // there, so optimistic changes stay.
  function absorb(part) {
    const current = local.snapshot();
    const fill = (have, extra) => ({ ...extra, ...have });
    storage.write({
      ...current,
      ration: { ...current.ration, specialDays: fill(current.ration?.specialDays, part.ration?.specialDays), history: fill(current.ration?.history, part.ration?.history) },
      sport: { ...current.sport, specialDays: fill(current.sport?.specialDays, part.sport?.specialDays), log: fill(current.sport?.log, part.sport?.log) },
    });
    local.load();
  }

  const api = {
    load() {
      empty = storage.read() == null;
      return local.load();
    },
    snapshot: local.snapshot,
    changeSets: local.changeSets,

    // True when the Cache has never been filled: the first start after the
    // update builds it from the full Core.
    isEmpty: () => empty,
    pendingCount: () => pending.length,
    get olderRequests() {
      return olderRequests;
    },

    // The first start after the update builds the Cache from the full Core;
    // the caller renders after it, so it is no change.
    async build() {
      return empty ? pullWindows() : { ok: true, changed: false };
    },
    flush,
    refresh,
    // Delivers the Outbox, or refreshes the windows when nothing waits.
    async sync() {
      return pending.length ? flush() : refresh();
    },

    // Loads days from `from` up to the window's start for the feeds.
    async ensureRange(from) {
      const start = windowDates(today(), loadedFrom).from;
      if (!from || from >= start) return { ok: true };
      let part;
      try {
        part = await transport.request("core", "range", { from, to: addDays(start, -1) });
      } catch {
        return { ok: false, offline: true };
      }
      loadedFrom = from;
      absorb(part);
      return { ok: true };
    },

    async loadOlderRequests() {
      allRequests = true;
      const result = await refresh();
      if (!result.ok) allRequests = false;
      return result;
    },

    // The whole Закладка: the Cache keeps headers, the thread loads on open.
    async bookmark(id) {
      const own = (local.snapshot().assistant?.bookmarks || []).find((bookmark) => bookmark.id === id);
      if (own && !own.header) return own;
      try {
        return (await transport.request("core", "bookmark", { id })).bookmark;
      } catch {
        return null;
      }
    },
  };

  Object.keys(local).forEach((name) => {
    if (!CORE_READS.includes(name) && typeof local[name] === "function") api[name] = command(name);
  });
  return api;
}
