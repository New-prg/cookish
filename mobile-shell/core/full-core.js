import { cacheSlice, olderRequestCount, rangeSlice } from "./cache-window.js";
import { openLocalData } from "./local-data.js";
import { replay } from "./replay.js";

// The full Core behind the transport (ADR-0002): the primary copy of the data.
// In the app it is today the local data over localStorage; on a server it
// will be the same module over a database. It replays the commands of the
// phone's Outbox, each once by its id, and hands out the Cache windows. The
// transport sees `endpoint`; the Services read the data through `read()`.
//
//   apply({ guestId, commands })        → { results: [{ id, ok, reason, retry? }] }
//   pull({ today, from, allRequests, guestId }) → { state, olderRequests }
//   range({ from, to })                 → dated parts past the window
//   bookmark({ id })                    → { bookmark | null }

export const LEDGER_STORAGE_KEY = "cookish.core.ledger.v1";
export const CORE_READS = Object.freeze(["load", "snapshot", "changeSets"]);
export const APPLIED_LIMIT = 1000;

export function isCoreCommand(data, name) {
  return typeof data[name] === "function" && !CORE_READS.includes(name);
}

// `storage` holds the data; `ledger` remembers the guest and the results of
// applied commands, so a repeated delivery changes nothing.
export function createFullCore({ storage, ledger }) {
  let data = null;
  let book = null;

  // Opened on first use: the app shows its Cache before the full Core loads.
  function open() {
    if (!data) {
      data = openLocalData(storage);
      data.load();
      const stored = ledger.read();
      book = {
        guestId: String(stored?.guestId || ""),
        registeredAt: String(stored?.registeredAt || ""),
        applied: Array.isArray(stored?.applied) ? stored.applied : [],
      };
    }
    return data;
  }

  // The first guest seen here owns the data (local phase of #29).
  function register(guestId) {
    if (!guestId || book.guestId) return;
    book.guestId = String(guestId);
    book.registeredAt = new Date().toISOString();
  }

  function applyOne(command) {
    const known = book.applied.find((entry) => entry.id === command?.id);
    if (known) return { ...known, duplicate: true };
    const id = String(command?.id || "");
    if (!id || !isCoreCommand(data, command.name)) return { id, ok: false, reason: "Неизвестная команда." };
    let value;
    try {
      value = replay(command.trace, () => data[command.name](...(Array.isArray(command.args) ? command.args : [])));
    } catch {
      return { id, ok: false, reason: "Изменение не применилось." };
    }
    // A failed write is not a rejection: the command waits for another try.
    if (value?.storageFailed) return { id, ok: false, retry: true, reason: String(value.reason || "") };
    const result = value?.ok === false
      ? { id, ok: false, reason: String(value.reason || "Изменение больше не применимо.") }
      : { id, ok: true, reason: "" };
    book.applied.push(result);
    if (book.applied.length > APPLIED_LIMIT) book.applied.splice(0, book.applied.length - APPLIED_LIMIT);
    return result;
  }

  const endpoint = {
    apply({ guestId = "", commands = [] } = {}) {
      open();
      register(guestId);
      const results = (commands || []).map(applyOne);
      ledger.write(book);
      return { results };
    },

    pull({ today, from = "", allRequests = false, guestId = "" } = {}) {
      const state = open().snapshot();
      if (guestId && !book.guestId) {
        register(guestId);
        ledger.write(book);
      }
      return { state: cacheSlice(state, { today, from, allRequests }), olderRequests: allRequests ? 0 : olderRequestCount(state) };
    },

    range({ from, to } = {}) {
      return rangeSlice(open().snapshot(), { from: String(from || ""), to: String(to || "") });
    },

    bookmark({ id } = {}) {
      return { bookmark: (open().snapshot().assistant?.bookmarks || []).find((bookmark) => bookmark.id === id) || null };
    },
  };

  return {
    endpoint,
    read: () => open().snapshot(),
  };
}
