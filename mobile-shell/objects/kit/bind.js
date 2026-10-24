// The data of a bound element. resolveBinding(state, el, ctx) returns exactly
// what the element takes as its `data` property: the shapes of stat, meter,
// bars, line, spark, heatmap, table and list from viz/kit.js and viz/data.js,
// and the shapes of marks, streak, form and quick for the input elements.
//
// `el` is an element of the bundle IR ({ el: "meter", of, value, ... }) or the
// spec an element reads from its attributes ({ tag: "c-meter", of, ... }).
import { resolveDate, resolveRange } from "../core/query.js";
import { BY } from "./catalogue.js";
import {
  asksField, courseRange, defaultGoalRange, describeField, dueTotal, entriesOf, fieldOf, itemRows, itemsOf, labelOf, lastEntryOf,
  MARK_STATES, metaOf, numeric, paceOf, requireTrack, resolveDay, startOf, streakFor, valueSeries, valueTotal, weekQuota, whereOf,
} from "./ledger.js";
import { isSource } from "./sources.js";
import { dateLabel, fmtNum, fmtValue, isDateKey, periodName, previousRange, shiftDate } from "../viz/util.js";

const DEFAULT_RANGE = { stat: "@last7d", bars: "@last7d", line: "@last30d", spark: "@last30d", heatmap: "@last12w" };
const truthy = (v) => v === true || ["yes", "да", "true", "1"].includes(String(v ?? "").trim().toLowerCase());
const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => String(s).trim()).filter(Boolean);

function pairs(text) {
  if (text && typeof text === "object" && !Array.isArray(text)) return { ...text };
  const out = {};
  for (const part of list(text)) {
    const at = part.indexOf("=");
    if (at < 1) throw new Error(`значения «${part}»: нужно поле=число, например ml=250`);
    const raw = part.slice(at + 1).trim();
    out[part.slice(0, at).trim()] = numeric(raw) ?? raw;
  }
  return out;
}

function attrsOf(el) {
  const tag = String(el.el || el.tag || "").replace(/^c-/, "");
  const a = { ...el, tag };
  delete a.el;
  return a;
}

function dateOf(a, ctx) {
  const date = a.date ? resolveDate(a.date, ctx.today) : ctx.today;
  if (!isDateKey(date)) throw new Error("date: нужна дата ГГГГ-ММ-ДД, @today или @yesterday");
  return date;
}

// A period token as {from, to}. «@all» starts where the track does.
function rangeOf(state, a, token, ctx) {
  if (token && typeof token === "object") return token;
  if (token === "@all" && a.of && !isSource(a.of)) return resolveRange(token, ctx.today, { since: startOf(state, requireTrack(state, a.of), ctx) });
  return resolveRange(token, ctx.today);
}

const wantsItems = (track, a) => track.kind === "catalog" || a.rows === "items";

// -- displays ------------------------------------------------------------------------
function bindStat(state, a, ctx) {
  const track = isSource(a.of) ? null : requireTrack(state, a.of);
  const items = track ? wantsItems(track, a) : false;
  // Rows of items have no period of their own: without a range every item counts.
  const token = a.range || (items ? null : DEFAULT_RANGE.stat);
  const range = token ? rangeOf(state, a, token, ctx) : null;
  const cur = valueTotal(state, { ...a, range }, ctx);
  const out = {
    value: cur.value, unit: cur.fn === "count" ? "" : cur.meta.unit, label: cur.meta.label, rows: cur.rows,
    previous: null, periodLabel: periodName(token), good: a.good || "up", fn: cur.fn,
  };
  if (cur.meta.goal != null) Object.assign(out, { goal: Number(cur.meta.goal), goalType: cur.meta.goalType });
  if (truthy(a.compare) && token && token !== "@all" && !items) out.previous = valueTotal(state, { ...a, range: previousRange(token, ctx.today) }, ctx).value;
  if (truthy(a.spark) && range && !items) {
    const days = valueSeries(state, { ...a, by: "day", category: null, range: token === "@today" ? rangeOf(state, a, "@last7d", ctx) : range }, ctx);
    out.spark = days.series[0].values;
  }
  if (a.pace === "left" && track) out.pace = paceOf(state, track, fieldOf(track, a.value), a, ctx);
  return out;
}

// The goal of a course is its schedule: «3 из 14» done of what falls due in the period.
function bindDueMeter(state, a, ctx) {
  const track = requireTrack(state, a.of);
  const range = courseRange(state, track, a.range, ctx);
  const done = valueTotal(state, { ...a, value: "done", fn: "sum", category: null, range }, ctx);
  const goal = dueTotal(state, track, range, whereOf(state, track, a.where, ctx.today));
  return { value: done.value ?? 0, goal: goal || null, unit: "", label: done.meta.label, rows: done.rows, goalType: "min", segments: null };
}

function bindMeter(state, a, ctx) {
  if (a.goal === "due") return bindDueMeter(state, a, ctx);
  const meta = metaOf(state, a.of, a.value);
  const track = isSource(a.of) ? null : requireTrack(state, a.of);
  const quota = track?.quota && meta.key === "done" ? track.quota : null;
  const token = a.range || (quota ? (quota.per === "week" ? "@thisWeek" : "@today") : defaultGoalRange(meta));
  const cur = valueTotal(state, { ...a, range: rangeOf(state, a, token, ctx) }, ctx);
  const goal = meta.goal != null ? Number(meta.goal) : quota ? quota.times : null;
  // A meter with a goal and nothing yet reads «0 из …», not an empty box.
  const value = cur.value ?? (goal != null && cur.fn === "sum" ? 0 : null);
  const out = { value, goal, unit: cur.fn === "count" ? "" : meta.unit, label: meta.label, rows: cur.rows, goalType: meta.goalType, segments: cur.segments ?? null };
  if (a.pace === "left" && track) out.pace = paceOf(state, track, fieldOf(track, a.value), a, ctx);
  return out;
}

// A new track has nothing before the day it was made, so its charts start there: a
// week at least, a heatmap four weeks, never more than the range asked for.
function clipToStart(state, a, tag, range, ctx) {
  if (isSource(a.of) || (tag === "bars" && !Object.hasOwn(BY, a.by || "day"))) return range;
  const track = requireTrack(state, a.of);
  if (track.kind === "catalog" || a.rows === "items") return range;
  const start = startOf(state, track, ctx);
  if (!start || start <= range.from || start > range.to) return range;
  const floor = shiftDate(range.to, -((tag === "heatmap" ? 28 : 7) - 1));
  const from = start < floor ? start : floor;
  return { from: from > range.from ? from : range.from, to: range.to };
}

const bindSeries = (tag) => (state, a, ctx) => {
  const by = tag === "heatmap" || tag === "spark" ? "day" : a.by || "day";
  const range = clipToStart(state, a, tag, rangeOf(state, a, a.range || DEFAULT_RANGE[tag], ctx), ctx);
  return valueSeries(state, { ...a, by, range }, ctx);
};

// -- rows ------------------------------------------------------------------------------
function cellText(state, track, token, entry, itemsById, ctx) {
  if (token === "date") return entry.date ? dateLabel(entry.date) : "";
  if (token === "state") return entry.state ? labelOf(track, entry.state) : "";
  if (token === "item" || token === "name") return itemsById.get(entry.item)?.name || (entry.slot ? entry.name : "");
  if (token === "slot") return entry.slot ? entry.name : "";
  const field = fieldOf(track, token);
  if (!field) return "";
  const raw = entry.values[token];
  if (raw == null || raw === "") return "";
  switch (field.type) {
    case "number":
    case "calc": return typeof raw === "number" ? fmtValue(raw, field.unit) : String(raw);
    case "scale": return field.labels?.[raw - 1] ? `${raw} · ${field.labels[raw - 1]}` : fmtNum(raw);
    case "choice": return field.options?.find((o) => o.id === raw)?.name ?? String(raw);
    case "yesno": return raw ? "да" : "нет";
    case "date": return dateLabel(raw);
    case "link": return state.objects[raw]?.name || "";
    default: return String(raw);
  }
}

const RECORD_COLUMNS = { date: "Дата", item: "Позиция", state: "Статус", slot: "Приём", name: "Название" };

function columnsOf(track, a, items) {
  const own = track.fields.map((f) => f.key);
  const planned = track.fields.filter((f) => f.planned).map((f) => f.key);
  const fallback = track.kind === "catalog" ? own.slice(0, 3) : items ? ["state", ...planned.slice(0, 2)] : ["date", ...own.slice(0, 2)];
  const tokens = a.columns ? list(a.columns).slice(0, 5) : fallback;
  return tokens.map((key) => {
    const field = fieldOf(track, key);
    if (!field && !RECORD_COLUMNS[key]) throw new Error(`columns: в разделе «${track.name}» нет колонки «${key}». Есть: ${Object.keys(RECORD_COLUMNS).join(", ")}, ${track.fields.map((f) => f.key).join(", ")}`);
    const label = field ? field.name : RECORD_COLUMNS[key];
    return { key, label, numeric: field ? ["number", "calc", "scale"].includes(field.type) : false };
  });
}

// Rows are the entries of the track (a record or a mark each) or, for a catalog and
// with rows: items, its items with their planned values and state. Each row carries
// the id and the kind of what it stands for, so a screen can edit it.
const rowsOf = (tag) => (state, a, ctx) => {
  const track = requireTrack(state, a.of);
  const items = itemsOf(state, track.key);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const asItems = wantsItems(track, a);
  const columns = columnsOf(track, a, asItems);
  const limit = Math.min(Number(a.limit) || (tag === "list" ? 6 : 8), 50);
  // The habit items of a list that names no period are today's: open, done or skipped today.
  const token = a.range || (asItems && track.kind === "habit" ? "@today" : null);
  const range = token ? rangeOf(state, a, token, ctx) : null;
  let rows;
  if (asItems) {
    rows = itemRows(state, track, range, ctx).map((row) => ({ id: row.id, date: row.date, item: row.id, slot: null, state: track.kind === "catalog" ? null : row.state, values: row.values, name: row.name }));
  } else {
    rows = entriesOf(state, track.key, ctx).filter((e) => !range || (e.date >= range.from && e.date <= range.to));
  }
  const keep = whereOf(state, track, a.where, ctx.today);
  rows = rows.filter((entry) => keep({ values: entry.values, state: entry.state, date: entry.date, slot: entry.slot, item: itemsById.get(entry.item)?.key, itemName: itemsById.get(entry.item)?.name }));
  const sortKey = a.sort || (asItems ? null : "date");
  const order = a.order || (a.sort ? "asc" : "desc");
  if (sortKey === "date" && !asItems) {
    if (order === "desc") rows = rows.slice().reverse();
  } else if (sortKey) {
    const read = (entry) => (sortKey === "state" ? entry.state ?? "" : sortKey === "date" ? entry.date : sortKey === "name" ? entry.name : numeric(entry.values[sortKey]) ?? entry.values[sortKey] ?? "");
    rows = rows.slice().sort((x, y) => {
      const p = read(x);
      const q = read(y);
      const diff = typeof p === "number" && typeof q === "number" ? p - q : String(p).localeCompare(String(q), "ru");
      return order === "desc" ? -diff : diff;
    });
  }
  return {
    track: track.key, mode: asItems ? "items" : "entries",
    columns,
    rows: rows.slice(0, limit).map((entry) => ({
      id: entry.id, kind: asItems ? "item" : "entry", href: null, icon: "",
      ...(asItems && track.kind !== "catalog" ? { state: entry.state === "changed" ? "done" : entry.state, stateLabel: labelOf(track, entry.state) } : {}),
      title: itemsById.get(entry.item)?.name || (entry.slot ? entry.name : track.name),
      cells: columns.map((c) => ({ text: cellText(state, track, c.key, entry, itemsById, ctx), numeric: c.numeric })),
    })),
    total: rows.length,
  };
};

// -- input elements ---------------------------------------------------------------------
const MARKABLE = ["habit", "list", "follow"];

function bindMarks(state, a, ctx) {
  const track = requireTrack(state, a.of);
  if (!MARKABLE.includes(track.kind)) throw new Error(`в разделе «${track.name}» отметок нет (вид «${track.kind}»); отметки ведут habit, list и follow`);
  const date = dateOf(a, ctx);
  const day = resolveDay(state, track.key, date, ctx);
  const states = track.states.filter((s) => MARK_STATES.includes(s)).map((id) => ({ id, label: labelOf(track, id) }));
  const askedAt = (markState) => track.fields.filter((f) => asksField(f, markState)).map((f) => describeField(state, track, f));
  const ask = Object.fromEntries(states.map((s) => [s.id, askedAt(s.id)]));
  const rows = day.rows.map((row) => {
    const item = row.occurrence.item;
    return {
      key: row.key, itemId: row.itemId, slot: row.slot, name: row.name, at: row.at, time: /^\d{2}:\d{2}$/.test(row.at || "") ? row.at : "",
      state: row.state, via: row.via, label: MARK_STATES.includes(row.state) ? labelOf(track, row.state) : "", markId: row.markId,
      planned: item.plan || {}, values: row.mark?.values ? Object.fromEntries(Object.entries(row.mark.values).filter(([, v]) => v != null)) : {}, actual: row.actual, ask,
    };
  });
  const empty = track.kind === "list" ? "В списке пока ничего нет" : track.follows === "shopping" ? "В этот день ничего не куплено" : track.follows ? "В плане на этот день нет приёмов" : "На этот день ничего не запланировано";
  return {
    track: track.key, name: track.name, kind: track.kind, date, canMark: date <= ctx.today, states, rows,
    extras: day.extras.map((p) => ({ id: p.id, state: p.state, values: p.values })),
    add: truthy(a.add) && !track.follows, addEvery: track.kind === "list" ? "open" : "day",
    progress: { done: day.counts.done, of: day.counts.due }, quota: quotaOf(state, track, date, day, ctx),
    status: day.status, empty,
  };
}

// A quota as the marks card shows it: marks so far against the need, for the week of the date or for the day.
function quotaOf(state, track, date, day, ctx) {
  if (!track.quota) return null;
  if (track.quota.per === "week") {
    const week = weekQuota(state, track.key, date, ctx);
    return { per: "week", need: week.need, done: week.done, status: week.status };
  }
  return { per: "day", need: Math.min(track.quota.times, day.counts.due), done: day.counts.done, status: day.status };
}

function bindStreak(state, a, ctx) {
  const track = requireTrack(state, a.of);
  return { track: track.key, name: track.name, kind: track.kind, avoid: track.avoid, ...streakFor(state, track.key, ctx) };
}

function formFields(state, track, keys) {
  const wanted = keys.length ? keys : track.fields.filter((f) => f.type !== "calc").map((f) => f.key);
  return wanted.map((key) => {
    const field = fieldOf(track, key);
    if (!field) throw new Error(`fields: в разделе «${track.name}» нет поля «${key}». Есть: ${track.fields.map((f) => f.key).join(", ")}`);
    if (field.type === "calc") throw new Error(`fields: поле «${key}» считается само, его не вводят`);
    return field;
  });
}

function bindForm(state, a, ctx) {
  const track = requireTrack(state, a.of);
  if (!["log", "habit", "list"].includes(track.kind)) throw new Error(`в разделе «${track.name}» записи вводят не формой (вид «${track.kind}»)`);
  const last = lastEntryOf(state, track.key, ctx);
  const fields = formFields(state, track, list(a.fields)).map((field) => {
    const remembered = ["number", "scale", "choice", "link", "yesno", "time"].includes(field.type);
    return { ...describeField(state, track, field), default: remembered ? last?.values[field.key] ?? null : null };
  });
  return { track: track.key, name: track.name, kind: track.kind, date: dateOf(a, ctx), maxDate: ctx.today, fields, lastEntry: last ? { id: last.id, date: last.date } : null };
}

function bindQuick(state, a, ctx) {
  const track = requireTrack(state, a.of);
  if (!["log", "habit", "list"].includes(track.kind)) throw new Error(`в разделе «${track.name}» записи вводят не кнопкой (вид «${track.kind}»)`);
  const values = pairs(a.values);
  const fields = formFields(state, track, Object.keys(values)).map((f) => describeField(state, track, f));
  const [first] = fields;
  const sign = typeof values[first?.key] === "number" && values[first.key] > 0 ? "+" : "";
  const label = a.label || (first ? `${sign}${fmtNum(values[first.key])}${first.unit ? ` ${first.unit}` : ""}` : track.name);
  return { track: track.key, name: track.name, values, label, fields, date: ctx.today };
}

// The form under a list with add: a name and the fields a row of the track can carry.
// A catalog row holds all of them; an item of a list holds the planned ones.
function bindAdd(state, a, ctx) {
  const track = requireTrack(state, a.of);
  if (!["catalog", "list"].includes(track.kind)) throw new Error(`в разделе «${track.name}» строки не добавляют (вид «${track.kind}»); добавляют справочник и список`);
  const carried = track.fields.filter((f) => f.type !== "calc" && (track.kind === "catalog" || f.planned));
  return { track: track.key, name: track.name, kind: track.kind, date: ctx.today, fields: carried.map((field) => describeField(state, track, field)) };
}

const HANDLERS = {
  stat: bindStat, meter: bindMeter, bars: bindSeries("bars"), line: bindSeries("line"), spark: bindSeries("spark"), heatmap: bindSeries("heatmap"),
  table: rowsOf("table"), list: rowsOf("list"), marks: bindMarks, streak: bindStreak, form: bindForm, quick: bindQuick, add: bindAdd,
};

export const BOUND_ELEMENTS = Object.freeze(Object.keys(HANDLERS));

export function resolveBinding(state, el, ctx) {
  if (!ctx?.today) throw new Error("нужна сегодняшняя дата");
  const a = attrsOf(el);
  const handler = HANDLERS[a.tag];
  if (!handler) throw new Error(`элемент «${a.tag}» не берёт данные из разделов; привязываются: ${BOUND_ELEMENTS.join(", ")}`);
  if (!a.of) throw new Error(`у элемента «${a.tag}» не указан of (ключ раздела)`);
  return handler(state, a, ctx);
}
