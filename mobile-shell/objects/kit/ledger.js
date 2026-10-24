// The ledger of the kit: reads tracks, items and entries out of the object
// space (storage mapping in synthesis.md §2), turns marks into states and
// actual values, and answers every question a screen asks: what happened on a
// day, which points a chart draws, whether a streak holds, how far a goal got.
//
// Nothing here writes. A mark is a fact; what it means (the unmarked policy,
// the planned value a changed mark overrides, a week quota) is decided on read.
import { valueOf } from "../core/values.js";
import { isAdditiveUnit } from "./catalogue.js";
import { atMinutes, dueOn } from "./schedule.js";
import { isSource, SOURCES, slotsOf, sourceDay, sourceGoal } from "./sources.js";
import { bucketKey, bucketsOf, daysBetween, monthEnd, monthStart, shiftDate, weekStart } from "../viz/util.js";

export const MARK_STATES = Object.freeze(["done", "changed", "skipped"]);
export const VIRTUAL = Object.freeze({
  done: { label: "Выполнено", unit: "" },
  skipped: { label: "Пропущено", unit: "" },
  due: { label: "Запланировано", unit: "" },
  rate: { label: "Доля выполненного", unit: "%" },
  open: { label: "Осталось", unit: "" },
  count: { label: "Записей", unit: "" },
});
const VIRTUAL_OF_KIND = Object.freeze({
  habit: ["done", "skipped", "due", "rate", "open", "count"],
  follow: ["done", "skipped", "due", "rate", "open", "count"],
  list: ["done", "skipped", "due", "rate", "open", "count"],
  log: ["count"],
  catalog: ["count"],
});
const KIND_STATES = Object.freeze({ habit: ["done", "skipped"], list: ["done"], follow: ["done"], log: [], catalog: [] });
const POLICY_STATE = Object.freeze({ ignore: "none", missed: "skipped", assumed: "done" });
const MAX_SERIES = 6;
const MAX_HISTORY_DAYS = 730;

const isCounted = (state) => state === "done" || state === "changed";
const dateOf = (iso) => (iso ? String(iso).slice(0, 10) : null);

export function numeric(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// -- reading the space -----------------------------------------------------------
const caches = new WeakMap();
function cacheOf(state) {
  let cache = caches.get(state);
  if (!cache) {
    cache = { tracks: null, items: null, itemsOf: new Map(), entries: new Map(), indexes: new Map() };
    caches.set(state, cache);
  }
  return cache;
}

function inferType(rel) {
  switch (rel.format) {
    case "formula": return "calc";
    case "select": return "choice";
    case "checkbox": return "yesno";
    case "date": return "date";
    case "time": return "time";
    case "object": return "link";
    case "number": return rel.kit?.labels ? "scale" : "number";
    default: return "text";
  }
}

function readField(rel) {
  const kit = rel.kit;
  return {
    key: kit.field, rel: rel.key, name: rel.name, type: kit.type || inferType(rel), format: rel.format,
    unit: rel.unit || "", min: rel.min ?? null, max: rel.max ?? null, step: kit.step ?? rel.step ?? null,
    options: rel.format === "select" ? (rel.options || []).map((o) => ({ id: o.id, name: o.name })) : null,
    labels: kit.labels ?? null, to: kit.to ?? null,
    goal: kit.goal ?? null, goalType: kit.goalType || "min", goalPer: kit.goalPer || "day",
    planned: Boolean(kit.planned), on: Array.isArray(kit.on) ? kit.on : null,
    required: Boolean(kit.required ?? rel.required), hint: kit.hint || "",
  };
}

function readTrack(state, type) {
  const kit = type.kit;
  const kind = kit.kind || "log";
  const fields = [];
  for (const relKey of type.relations || []) {
    const rel = state.relations[relKey];
    if (rel?.kit?.track === kit.track && rel.kit.field) fields.push(readField(rel));
  }
  const avoid = kit.avoid === true;
  const times = Number(kit.times) > 0 ? Number(kit.times) : null;
  return Object.freeze({
    key: kit.track, typeKey: type.key, name: type.name, icon: type.icon || "", kind,
    states: kit.states?.length ? kit.states : KIND_STATES[kind] || [],
    labels: { done: avoid ? "Держусь" : "Сделано", changed: "Изменено", skipped: avoid ? "Сорвался" : "Пропущено", ...(kit.labels || {}) },
    unmarked: kit.unmarked || (avoid ? "assumed" : "ignore"),
    grace: Number.isInteger(kit.grace) ? kit.grace : 1,
    quota: times ? { times, per: kit.per === "day" ? "day" : "week" } : null,
    follows: kit.follows ?? null, app: kit.app ?? null, archived: Boolean(kit.archived), avoid, since: kit.since ?? null, fields,
  });
}

function tracksOf(state) {
  const cache = cacheOf(state);
  if (!cache.tracks) {
    cache.tracks = new Map();
    for (const type of Object.values(state.types)) {
      if (!type.system && type.kit?.track) cache.tracks.set(type.kit.track, readTrack(state, type));
    }
  }
  return cache.tracks;
}

export function listTracks(state, { archived = false } = {}) {
  return [...tracksOf(state).values()].filter((track) => archived || !track.archived);
}

export const trackOf = (state, key) => tracksOf(state).get(key) || null;

export function requireTrack(state, key) {
  const track = trackOf(state, key);
  if (!track) {
    const known = listTracks(state).map((t) => t.key);
    throw new Error(`нет раздела «${key}»${known.length ? `. Есть: ${known.join(", ")}` : ""}`);
  }
  if (track.archived) throw new Error(`раздел «${track.name}» удалён`);
  return track;
}

export const fieldOf = (track, key) => track.fields.find((f) => f.key === key) || null;

export const labelOf = (track, state) => track.labels[state] || state;

/** Does a mark state ask for the field? Planned fields ask at «changed» only unless `on` says otherwise; nothing asks at «skipped». */
export function asksField(field, markState) {
  if (field.type === "calc") return false;
  if (field.on) return field.on.includes(markState);
  if (markState === "skipped") return false;
  return field.planned ? markState === "changed" : true;
}

/** A field as an input needs it: type, bounds, choices (a link lists the rows of its catalog), labels of a scale. */
export function describeField(state, track, field) {
  let options = field.options;
  if (field.type === "link" && field.to && trackOf(state, field.to)) {
    options = itemsOf(state, field.to).filter((item) => !item.archived).map((item) => ({ id: item.id, key: item.key, name: item.name }));
  }
  const scale = field.type === "scale";
  return {
    key: field.key, name: field.name, type: field.type, unit: field.unit, required: field.required, hint: field.hint,
    min: field.min ?? (scale ? 1 : null), max: field.max ?? (scale ? 5 : null), step: field.step,
    options, labels: field.labels, to: field.to, goal: field.goal, goalType: field.goalType, goalPer: field.goalPer, planned: field.planned,
  };
}

// A plan keyed by relation keys (tr_water__dose) is read as local keys (dose).
function localPlan(track, plan) {
  const out = {};
  for (const [key, value] of Object.entries(plan && typeof plan === "object" ? plan : {})) {
    out[key.startsWith(`tr_${track.key}__`) ? key.slice(`tr_${track.key}__`.length) : key] = value;
  }
  return out;
}

function readItem(track, obj) {
  const props = obj.props;
  const plan = localPlan(track, props.kit_plan);
  const values = { ...plan };
  for (const field of track.fields) if (props[field.rel] != null) values[field.key] = props[field.rel];
  return {
    id: obj.id, key: props.kit_key || obj.id, name: obj.name, track: track.key,
    every: props.kit_every || (track.kind === "list" ? "open" : "day"),
    at: props.kit_at || null,
    from: props.kit_from || dateOf(obj.createdAt),
    // A removed item stops being due the day before; its past marks still count.
    until: props.kit_until || (obj.archivedAt ? shiftDate(dateOf(obj.archivedAt), -1) : null),
    plan, values, archived: Boolean(obj.archivedAt),
  };
}

// The items of a track in the order a list shows them, ended ones included.
export function itemsOf(state, trackKey) {
  const cache = cacheOf(state);
  if (!cache.items) {
    cache.items = new Map();
    for (const obj of Object.values(state.objects)) {
      if (obj.type !== "track_item" || !obj.props.kit_track) continue;
      if (!cache.items.has(obj.props.kit_track)) cache.items.set(obj.props.kit_track, []);
      cache.items.get(obj.props.kit_track).push(obj);
    }
  }
  if (!cache.itemsOf.has(trackKey)) {
    const track = trackOf(state, trackKey);
    const list = track ? (cache.items.get(trackKey) || []).map((obj) => readItem(track, obj)) : [];
    list.sort((a, b) => atMinutes(a.at) - atMinutes(b.at) || a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id));
    cache.itemsOf.set(trackKey, list);
  }
  return cache.itemsOf.get(trackKey);
}

const itemRef = (id) => `i:${id}`;
const slotRef = (slot) => `s:${slot}`;

// One entry of a track: a record or a mark, with its field values under local keys.
function readEntry(state, track, obj, ctx) {
  const values = {};
  for (const field of track.fields) {
    values[field.key] = field.type === "calc" ? valueOf(state, obj, field.rel, ctx) : obj.props[field.rel] ?? null;
  }
  const item = obj.props.kit_item || null;
  const slot = obj.props.kit_slot || null;
  return {
    id: obj.id, date: obj.props.date || "", item, slot, ref: item ? itemRef(item) : slot ? slotRef(slot) : null,
    state: obj.props.kit_state || (item || slot ? "done" : null), values, createdAt: obj.createdAt || "", name: obj.name,
  };
}

export function entriesOf(state, trackKey, ctx) {
  const cache = cacheOf(state);
  const key = `${trackKey}|${ctx.today}`;
  if (!cache.entries.has(key)) {
    const track = trackOf(state, trackKey);
    const list = track
      ? Object.values(state.objects).filter((obj) => obj.type === track.typeKey && !obj.archivedAt && obj.props.date).map((obj) => readEntry(state, track, obj, ctx))
      : [];
    list.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    cache.entries.set(key, list);
  }
  return cache.entries.get(key);
}

function indexOf(state, track, ctx) {
  const cache = cacheOf(state);
  const key = `${track.key}|${ctx.today}`;
  if (!cache.indexes.has(key)) {
    const index = { byRefDate: new Map(), byRef: new Map(), byDate: new Map() };
    const push = (map, k, entry) => { if (!map.has(k)) map.set(k, []); map.get(k).push(entry); };
    for (const entry of entriesOf(state, track.key, ctx)) {
      push(index.byDate, entry.date, entry);
      if (entry.ref) { push(index.byRef, entry.ref, entry); push(index.byRefDate, `${entry.ref}|${entry.date}`, entry); }
    }
    cache.indexes.set(key, index);
  }
  return cache.indexes.get(key);
}

export const lastEntryOf = (state, trackKey, ctx) => entriesOf(state, trackKey, ctx).at(-1) || null;

// The first day the track has anything to judge: the day it was made (`kit.since`),
// its first entry, or the first day an item is due.
export function startOf(state, track, ctx) {
  const days = [track.since, entriesOf(state, track.key, ctx)[0]?.date, ...(track.follows ? [] : itemsOf(state, track.key).map((item) => item.from))].filter(Boolean);
  return days.length ? days.sort()[0] : null;
}

// -- occurrences and their states --------------------------------------------------
function slotItem(slot) {
  return { id: null, key: slot.slot, name: slot.name, at: slot.time || null, plan: {}, values: {}, every: "day", from: null, until: null };
}

function occurrencesOn(state, track, date, ctx, index) {
  const day = { from: date, to: date };
  if (track.follows) {
    // The slots of the days before the track began were never asked about.
    if (date < (startOf(state, track, ctx) || ctx.today) && date < ctx.today) return [];
    return slotsOf(state, track.follows, date).map((slot) => ({ track: track.key, item: slotItem(slot), slot: slot.slot, ref: slotRef(slot.slot), date, window: day, open: false }));
  }
  const out = [];
  for (const item of itemsOf(state, track.key)) {
    if (parseOpen(item)) {
      const marks = index.byRef.get(itemRef(item.id)) || [];
      const here = marks.some((m) => m.date === date);
      if (here || (!marks.length && date === ctx.today && dueOn(item, date))) {
        out.push({ track: track.key, item, slot: null, ref: itemRef(item.id), date, window: { from: item.from || date, to: item.until ?? null }, open: true });
      }
    } else if (dueOn(item, date)) {
      out.push({ track: track.key, item, slot: null, ref: itemRef(item.id), date, window: day, open: false });
    }
  }
  return out;
}

const parseOpen = (item) => String(item.every).trim().toLowerCase() === "open";

const policyOf = (track) => (track.quota?.per === "week" ? "ignore" : track.unmarked);

// What an occurrence is worth in numbers: the mark's values, else the planned
// ones; a skipped occurrence is zero for numbers; pending and none count nothing.
export function actualOf(track, item, mark, state) {
  if (state === "pending" || state === "none") return {};
  const out = {};
  for (const field of track.fields) {
    if (state === "skipped") out[field.key] = field.type === "number" ? 0 : null;
    else if (field.type === "calc") out[field.key] = mark?.values[field.key] ?? null;
    else out[field.key] = mark?.values[field.key] ?? item?.plan?.[field.key] ?? null;
  }
  return out;
}

/**
 * One occurrence against its marks, the unmarked policy and the date.
 * state: done | changed | skipped (a mark or a policy), pending (still can be
 * marked), none (past, unmarked, policy ignore: counts for nothing).
 */
export function resolveOccurrence(occ, marks, track, today) {
  const mark = marks.length ? marks[marks.length - 1] : null;
  let state;
  let via;
  if (mark) {
    state = MARK_STATES.includes(mark.state) ? mark.state : "done";
    via = "mark";
  } else if (occ.window.to != null && occ.window.to < today) {
    state = POLICY_STATE[policyOf(track)];
    via = state === "none" ? "none" : "policy";
  } else {
    state = "pending";
    via = "none";
  }
  return {
    occurrence: occ, ref: occ.ref, key: occ.item.key, itemId: occ.item.id, slot: occ.slot ?? null, name: occ.item.name, at: occ.item.at,
    date: occ.date, state, via, mark, markId: mark?.id ?? null, actual: actualOf(track, occ.item, mark, state),
  };
}

const marksOf = (index, occ, date) => (occ.open
  ? (index.byRef.get(occ.ref) || []).filter((m) => m.date === date)
  : index.byRefDate.get(`${occ.ref}|${date}`) || []);

function pointOfEntry(entry) {
  return { date: entry.date, values: entry.values, slot: entry.slot, item: null, name: entry.name, state: entry.state, via: "entry", id: entry.id };
}

function dayRows(state, track, date, ctx) {
  const index = indexOf(state, track, ctx);
  const rows = [];
  const used = new Set();
  if (track.kind !== "log" && track.kind !== "catalog") {
    for (const occ of occurrencesOn(state, track, date, ctx, index)) {
      const marks = marksOf(index, occ, date);
      for (const m of marks) used.add(m.id);
      rows.push(resolveOccurrence(occ, marks, track, ctx.today));
    }
  }
  const extras = (index.byDate.get(date) || []).filter((entry) => !used.has(entry.id)).map(pointOfEntry);
  return { rows, extras };
}

const countsOf = (rows) => {
  const counts = { due: rows.length, done: 0, skipped: 0, pending: 0, none: 0 };
  for (const row of rows) counts[isCounted(row.state) ? "done" : row.state] += 1;
  return counts;
};

// -- goals and day statuses ----------------------------------------------------------
const goalFieldOf = (track) => track.fields.find((f) => f.goal != null && ["number", "calc", "scale"].includes(f.type)) || null;

function windowAround(per, date) {
  if (per === "week") return { from: weekStart(date), to: shiftDate(weekStart(date), 6) };
  if (per === "month") return { from: monthStart(date), to: monthEnd(date) };
  return { from: date, to: date };
}

// A goal against a window: ok once a minimum is reached or a maximum held to the
// end, missed once a maximum is passed or a minimum fell short at the end.
function judgeGoal(value, goal, goalType, windowEnd, today) {
  const over = windowEnd < today;
  if (goalType === "max") return value > goal ? "missed" : over ? "ok" : "open";
  return value >= goal ? "ok" : over ? "missed" : "open";
}

function sumOfField(entries, field, from, to) {
  let total = 0;
  for (const entry of entries) {
    if (entry.date < from || entry.date > to || entry.state === "skipped") continue;
    total += numeric(entry.values[field.key]) ?? 0;
  }
  return total;
}

function logStatus(state, track, date, ctx) {
  const start = startOf(state, track, ctx);
  if (!start || date < start) return "none";
  const entries = entriesOf(state, track.key, ctx);
  const field = goalFieldOf(track);
  if (!field) {
    const any = entries.some((entry) => entry.date === date && entry.state !== "skipped");
    return any ? "ok" : date >= ctx.today ? "open" : "missed";
  }
  const window = windowAround(field.goalPer, date);
  return judgeGoal(sumOfField(entries, field, window.from, window.to), field.goal, field.goalType, window.to, ctx.today);
}

function statusOfDay(state, track, date, rows, extras, ctx) {
  if (track.kind === "catalog" || date > ctx.today) return "none";
  if (track.kind === "log") return logStatus(state, track, date, ctx);
  const counted = rows.filter((row) => isCounted(row.state)).length;
  if (track.quota?.per === "week") {
    return counted || extras.some((p) => p.state !== "skipped") ? "ok" : date === ctx.today ? "open" : "none";
  }
  if (!rows.length) return "none";
  if (track.quota?.per === "day") {
    const need = Math.min(track.quota.times, rows.length);
    if (counted >= need) return "ok";
    if (date >= ctx.today) return "open";
    return counted || rows.some((row) => row.state === "skipped") ? "missed" : "none";
  }
  if (rows.some((row) => row.state === "skipped")) return "missed";
  if (rows.some((row) => row.state === "pending")) return "open";
  return counted ? "ok" : "none";
}

/**
 * The day of a track: the occurrences due on the date as resolved rows, the
 * entries nobody planned as extras, the counts and the verdict.
 * @returns {{ date, track, rows, extras, counts, quota, status }}
 */
export function resolveDay(state, trackKey, date, ctx) {
  const track = requireTrack(state, trackKey);
  const { rows, extras } = dayRows(state, track, date, ctx);
  return { date, track: trackKey, rows, extras, counts: countsOf(rows), quota: track.quota, status: statusOfDay(state, track, date, rows, extras, ctx) };
}

/** ok | missed | open | none for one day of a track. */
export function dayStatus(state, trackKey, date, ctx) {
  return resolveDay(state, trackKey, date, ctx).status;
}

/** A week quota (`times` per week): marks so far against the need, and the verdict for the week of `date`. */
export function weekQuota(state, trackKey, date, ctx) {
  const track = requireTrack(state, trackKey);
  if (track.quota?.per !== "week") return null;
  const from = weekStart(date);
  const to = shiftDate(from, 6);
  const last = to < ctx.today ? to : ctx.today;
  let done = 0;
  let marked = false;
  for (let d = from; d <= last; d = shiftDate(d, 1)) {
    const { rows, extras } = dayRows(state, track, d, ctx);
    done += rows.filter((row) => isCounted(row.state)).length + extras.filter((p) => p.state !== "skipped").length;
    marked ||= rows.some((row) => row.via === "mark") || extras.length > 0;
  }
  const need = track.quota.times;
  const start = startOf(state, track, ctx);
  let status;
  if (!start || to < start) status = "none";
  else if (done >= need) status = "ok";
  else if (to >= ctx.today) status = "open";
  else if (start > from) status = "none";
  else if (!marked) status = { ignore: "none", missed: "missed", assumed: "ok" }[track.unmarked];
  else status = "missed";
  return { from, to, done, need, status };
}

// -- points ----------------------------------------------------------------------------
/**
 * What the charts of a track draw: a point per counted or skipped occurrence
 * (its actual values) and per entry nobody planned. Never raw marks of items.
 * @returns {Array<{ date, values, slot, item, state, via, id }>}
 */
export function points(state, trackKey, range, ctx) {
  const track = requireTrack(state, trackKey);
  const out = [];
  const last = range.to < ctx.today ? range.to : ctx.today;
  if (track.kind === "catalog") return out;
  if (track.kind === "log") {
    for (const entry of entriesOf(state, track.key, ctx)) if (entry.date >= range.from && entry.date <= last) out.push(pointOfEntry(entry));
    return out;
  }
  for (let date = range.from; date <= last; date = shiftDate(date, 1)) {
    const { rows, extras } = dayRows(state, track, date, ctx);
    for (const row of rows) {
      if (row.state === "done" || row.state === "changed" || row.state === "skipped") {
        out.push({ date, values: row.actual, slot: row.slot, item: row.key, name: row.name, state: row.state, via: row.via, id: row.markId });
      }
    }
    out.push(...extras);
  }
  return out;
}

// -- streaks ---------------------------------------------------------------------------
/**
 * Streak over statuses, oldest first, the last one is today. A missed day is
 * bridged while the run of misses stays within `grace`; none and open (today
 * unmarked) neither add nor break.
 */
export function streakOf(statuses, grace = 1) {
  let run = 0;
  let gap = 0;
  let best = 0;
  for (const status of statuses) {
    if (status === "ok") { run += 1; gap = 0; } else if (status === "missed") {
      gap += 1;
      if (gap > grace) { run = 0; gap = 0; }
    }
    if (run > best) best = run;
  }
  const last = statuses.slice(-30);
  return { current: run, best, last30: { ok: last.filter((s) => s === "ok").length, of: last.filter((s) => s === "ok" || s === "missed").length } };
}

/** ok / (ok + missed) in percent, null when nothing was judged. */
export function rateOf(statuses) {
  const ok = statuses.filter((s) => s === "ok").length;
  const missed = statuses.filter((s) => s === "missed").length;
  return ok + missed ? Math.round((100 * ok) / (ok + missed)) : null;
}

/** The streak of a track as a screen shows it. A week quota counts weeks. */
export function streakFor(state, trackKey, ctx) {
  const track = requireTrack(state, trackKey);
  const start = startOf(state, track, ctx);
  const weekly = track.quota?.per === "week";
  const statuses = [];
  if (start && track.kind !== "catalog") {
    if (weekly) {
      for (let d = weekStart(start); d <= ctx.today; d = shiftDate(d, 7)) statuses.push(weekQuota(state, trackKey, d, ctx).status);
    } else {
      const from = daysBetween(start, ctx.today) > MAX_HISTORY_DAYS ? shiftDate(ctx.today, -MAX_HISTORY_DAYS) : start;
      for (let d = from; d <= ctx.today; d = shiftDate(d, 1)) statuses.push(dayStatus(state, trackKey, d, ctx));
    }
  }
  return { ...streakOf(statuses, track.grace), rate: rateOf(statuses.slice(-30)), grace: track.grace, unit: weekly ? "нед." : "дн.", today: statuses.at(-1) ?? "none", periods: statuses.length };
}

// -- where ---------------------------------------------------------------------------------
/** "exercise=bench,state=done" or { exercise: "bench" } -> [{ field, is }] */
export function parseWhere(text) {
  if (!text) return [];
  if (Array.isArray(text)) return text;
  if (typeof text === "object") return Object.entries(text).map(([field, is]) => ({ field, is }));
  return String(text).split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const at = part.indexOf("=");
    if (at < 1) throw new Error(`условие «${part}»: нужно поле=значение, например exercise=bench`);
    return { field: part.slice(0, at).trim(), is: part.slice(at + 1).trim() };
  });
}

const norm = (value) => String(value ?? "").trim().toLocaleLowerCase("ru-RU");

function checkWhere(track, conds) {
  const known = new Set([...track.fields.map((f) => f.key), "state", "item", "date", "slot"]);
  for (const cond of conds) if (!known.has(cond.field)) throw new Error(`where: в разделе «${track.name}» нет поля «${cond.field}». Есть: ${[...known].join(", ")}`);
}

// A link matches the item by key, name or id; a choice by option id or name.
function matchValue(state, track, cond, record) {
  const field = fieldOf(track, cond.field);
  const wanted = norm(cond.is);
  if (cond.field === "item") return norm(record.item) === wanted || norm(record.itemName) === wanted;
  if (!field) return norm(record[cond.field]) === wanted;
  const raw = record.values[field.key];
  if (raw == null) return wanted === "";
  if (field.type === "link") {
    const target = state.objects[raw];
    return norm(raw) === wanted || norm(target?.props.kit_key) === wanted || norm(target?.name) === wanted;
  }
  if (field.type === "choice") return norm(raw) === wanted || norm(field.options?.find((o) => o.id === raw)?.name) === wanted;
  if (field.type === "yesno") return String(raw) === (["yes", "да", "true", "1"].includes(wanted) ? "true" : "false");
  const n = numeric(raw);
  return n != null && numeric(cond.is) != null ? n === numeric(cond.is) : norm(raw) === wanted;
}

/**
 * A predicate for `where="exercise=bench,state=done"` over records
 * { values, state, date, slot, item, itemName }. Throws on a field the track lacks.
 */
export function whereOf(state, track, text) {
  const conds = parseWhere(text);
  checkWhere(track, conds);
  return (record) => conds.every((cond) => matchValue(state, track, cond, record));
}

const pointRecord = (point) => ({ values: point.values, state: point.state, date: point.date, slot: point.slot, item: point.item, itemName: point.name });
const rowRecord = (row) => ({ values: row.actual, state: row.state, date: row.date, slot: row.slot, item: row.key, itemName: row.name });

// -- values over time -----------------------------------------------------------------
function categoryOf(state, track, key, point) {
  const field = fieldOf(track, key);
  if (!field) throw new Error(`category: в разделе «${track.name}» нет поля «${key}»`);
  const raw = point.values[key];
  if (raw == null || raw === "") return { id: "", label: "Без категории", order: 1e9 };
  if (field.type === "choice") {
    const at = field.options.findIndex((o) => o.id === raw);
    return { id: raw, label: field.options[at]?.name ?? String(raw), order: at < 0 ? 1e6 : at };
  }
  if (field.type === "link") return { id: raw, label: state.objects[raw]?.name || String(raw), order: 1e6 };
  if (field.type === "yesno") return { id: String(raw), label: raw ? "да" : "нет", order: raw ? 0 : 1 };
  return { id: String(raw), label: String(raw), order: 1e6 };
}

function valueMeta(track, value) {
  const wanted = value || (["habit", "follow", "list"].includes(track.kind) ? "done" : track.fields.find((f) => f.type === "number")?.key || "count");
  const field = fieldOf(track, wanted);
  if (field) {
    return { kind: "field", key: field.key, field, label: field.name, unit: field.unit, additive: isAdditiveUnit(field.unit), defaultFn: "sum", goal: field.goal, goalType: field.goalType, goalPer: field.goalPer };
  }
  const allowed = VIRTUAL_OF_KIND[track.kind] || ["count"];
  if (!allowed.includes(wanted)) {
    const have = [...track.fields.filter((f) => f.type !== "text").map((f) => f.key), ...allowed];
    throw new Error(`в разделе «${track.name}» нет значения «${wanted}». Есть: ${have.join(", ")}`);
  }
  const v = VIRTUAL[wanted];
  return { kind: "virtual", key: wanted, label: v.label, unit: v.unit, additive: wanted === "count", defaultFn: wanted === "rate" ? "avg" : "sum", goal: null, goalType: "min", goalPer: "day" };
}

function sourceMeta(state, source, value) {
  const key = value || Object.keys(SOURCES[source].values)[0];
  const meta = SOURCES[source].values[key];
  if (!meta) throw new Error(`в источнике «${source}» нет значения «${value}». Есть: ${Object.keys(SOURCES[source].values).join(", ")}`);
  const goal = sourceGoal(state, source, key);
  return { kind: "source", key, label: meta.label, unit: meta.unit, defaultFn: "sum", goal: goal?.goal ?? null, goalType: goal?.goalType || "min", goalPer: "day" };
}

/** What a bound display shows: label, unit, default fn and the goal read from the field (or the Profile). */
export function metaOf(state, of, value) {
  if (isSource(of)) return sourceMeta(state, of, value);
  return valueMeta(requireTrack(state, of), value);
}

function eachDay(range, today, fn) {
  const last = range.to < today ? range.to : today;
  for (let date = range.from; date <= last; date = shiftDate(date, 1)) fn(date);
}

// Samples behind a bound display: { date, value, raw, state, cat, parts }.
function collect(state, spec, ctx) {
  const range = spec.range;
  if (isSource(spec.of)) {
    if (parseWhere(spec.where).length) throw new Error(`where: у источника «${spec.of}» нет полей для условия`);
    const meta = sourceMeta(state, spec.of, spec.value);
    const samples = [];
    eachDay(range, ctx.today, (date) => {
      const v = sourceDay(state, spec.of, date, ctx)[meta.key];
      if (v != null) samples.push({ date, value: v, raw: v, state: null, cat: null });
    });
    return { samples, meta };
  }
  const track = requireTrack(state, spec.of);
  const keep = whereOf(state, track, spec.where);
  const meta = valueMeta(track, spec.value);
  const samples = [];
  if (meta.kind === "field" || meta.key === "count") {
    const pts = points(state, track.key, range, ctx).filter((point) => keep(pointRecord(point)));
    for (const point of pts) {
      const cat = spec.category ? categoryOf(state, track, spec.category, point) : null;
      if (meta.key === "count") {
        if (point.state !== "skipped") samples.push({ date: point.date, value: 1, raw: 1, state: point.state, cat });
        continue;
      }
      const raw = point.values[meta.key];
      samples.push({ date: point.date, value: numeric(raw), raw, state: point.state, cat });
    }
  } else {
    eachDay(range, ctx.today, (date) => {
      const { rows } = dayRows(state, track, date, ctx);
      const kept = rows.filter((row) => keep(rowRecord(row)));
      if (!kept.length) return;
      const c = countsOf(kept);
      const den = c.done + c.skipped + c.pending;
      const value = { done: c.done, skipped: c.skipped, due: c.due, open: c.pending, rate: den ? Math.round((100 * c.done) / den) : null }[meta.key];
      samples.push({ date, value, raw: value, state: null, cat: null, parts: { num: c.done, den } });
    });
  }
  return { samples, meta };
}

// avg, min and max of what adds up in a day (a glass of water) run over the day's
// total; the average of a measurement (weight, a scale) runs over the day's mean, so
// a second weigh-in does not count twice. Min and max of a measurement stay with the
// entries: the heaviest set is a set, not a day. sum and count never come here.
function numbersOf(live, fn, meta) {
  const nums = live.filter((s) => s.value != null && Number.isFinite(s.value));
  const perEntry = meta.kind !== "field" && meta.key !== "count";
  if (perEntry || !["avg", "min", "max"].includes(fn) || (!meta.additive && fn !== "avg")) return nums.map((s) => s.value);
  const days = new Map();
  for (const s of nums) {
    const day = days.get(s.date) || { sum: 0, n: 0 };
    day.sum += s.value;
    day.n += 1;
    days.set(s.date, day);
  }
  return [...days.values()].map((day) => (meta.additive ? day.sum : day.sum / day.n));
}

// One number out of samples. A skipped occurrence adds zero to a sum and takes
// no part in the other functions, so an average weight ignores a skipped set.
function reduceSamples(list, fn, meta = {}) {
  const live = list.filter((s) => s.state !== "skipped" || fn === "sum");
  if (fn === "count") return list.filter((s) => s.state !== "skipped" && s.raw != null && s.raw !== "").length;
  if (meta.key === "rate" && meta.kind === "virtual" && (fn === "avg" || fn === meta.defaultFn)) {
    const num = live.reduce((total, s) => total + (s.parts?.num ?? 0), 0);
    const den = live.reduce((total, s) => total + (s.parts?.den ?? 0), 0);
    return den ? Math.round((100 * num) / den) : null;
  }
  const nums = numbersOf(live, fn, meta);
  if (!nums.length) return null;
  switch (fn) {
    case "sum": return nums.reduce((a, b) => a + b, 0);
    case "avg": return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min": return Math.min(...nums);
    case "max": return Math.max(...nums);
    case "last": return live.filter((s) => s.value != null && Number.isFinite(s.value)).sort((a, b) => a.date.localeCompare(b.date)).at(-1).value;
  }
  throw new Error(`неизвестная функция «${fn}»: sum, avg, min, max, count или last`);
}

const FNS = ["sum", "avg", "min", "max", "count", "last"];
function fnOf(spec, meta) {
  const fn = spec.fn || meta.defaultFn;
  if (!FNS.includes(fn)) throw new Error(`неизвестная функция «${fn}»: ${FNS.join(", ")}`);
  return fn;
}

// Samples grouped by category in the order of the choices. Past MAX_SERIES the
// smallest groups merge into one «Другое».
function byCategory(samples, label) {
  const map = new Map();
  for (const sample of samples) {
    const cat = sample.cat || { id: "value", label, order: 0 };
    if (!map.has(cat.id)) map.set(cat.id, { cat, samples: [] });
    map.get(cat.id).samples.push(sample);
  }
  const groups = [...map.values()].sort((x, y) => x.cat.order - y.cat.order || x.cat.label.localeCompare(y.cat.label, "ru"));
  if (groups.length <= MAX_SERIES) return groups;
  const keep = new Set([...groups].sort((x, y) => y.samples.length - x.samples.length).slice(0, MAX_SERIES - 1).map((g) => g.cat.id));
  const rest = groups.filter((g) => !keep.has(g.cat.id));
  return [...groups.filter((g) => keep.has(g.cat.id)), { cat: { id: "__other", label: "Другое" }, samples: rest.flatMap((g) => g.samples), other: true }];
}

/**
 * The series behind bars, line, spark and heatmap, in the shape the chart kit
 * draws: buckets by day, week (Monday first) or month, one series per category.
 * `value` is a field key, a virtual value (done, skipped, due, rate, open, count)
 * or, for a classic source, one of its values. A goal is read from the field and
 * shown when the bucket is the goal's period.
 */
export function valueSeries(state, spec, ctx) {
  const by = spec.by || "day";
  const { samples, meta } = collect(state, spec, ctx);
  const fn = fnOf(spec, meta);
  const buckets = bucketsOf(spec.range, by);
  const series = byCategory(samples, meta.label).map((group, i) => {
    const cells = new Map();
    for (const sample of group.samples) {
      const key = bucketKey(sample.date, by);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(sample);
    }
    return { key: group.cat.id, label: group.cat.label, color: group.other ? 6 : i, values: buckets.map((key) => (cells.has(key) ? reduceSamples(cells.get(key), fn, meta) : null)) };
  });
  if (!series.length) series.push({ key: "value", label: meta.label, color: 0, values: buckets.map(() => null) });
  const goalHere = meta.goal != null && by === meta.goalPer;
  return { by, fn, buckets, series, range: spec.range, unit: meta.unit, label: meta.label, goal: goalHere ? Number(meta.goal) : null, goalType: meta.goalType, rows: samples.length };
}

/** One number over the whole range, for stat and meter; `segments` per category when asked. */
export function valueTotal(state, spec, ctx) {
  const { samples, meta } = collect(state, spec, ctx);
  const fn = fnOf(spec, meta);
  const out = { value: reduceSamples(samples, fn, meta), rows: samples.length, fn, meta };
  if (spec.category && samples.length) {
    out.segments = byCategory(samples, meta.label)
      .map((group, i) => ({ key: group.cat.id, label: group.cat.label, color: group.other ? 6 : i, value: reduceSamples(group.samples, fn, meta) ?? 0 }))
      .filter((segment) => segment.value > 0);
  }
  return out;
}

export function defaultGoalRange(meta) {
  return { day: "@today", week: "@thisWeek", month: "@thisMonth" }[meta.goalPer] || "@today";
}

