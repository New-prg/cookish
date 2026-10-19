// Sets: a query over objects and how to show the result. The source is a
// type, a fixed list of objects, or a named source from a domain module
// (the plan of a date). Filters, sorts, groups and totals work on relation
// values, so they work the same for built-in and person-made types.
import { objectsOfType, valueOf } from "./values.js";

const SOURCES = new Map();

export function registerSource(name, fn) { SOURCES.set(name, fn); }
export const sourceNames = () => [...SOURCES.keys()];

export const FILTER_OPS = Object.freeze(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "empty", "notEmpty", "in", "within"]);
export const AGG_FNS = Object.freeze(["sum", "avg", "min", "max", "count", "countTrue"]);
export const VIEW_LAYOUTS = Object.freeze(["list", "table", "kanban", "calendar", "gallery", "checklist", "number", "ring", "bars", "line"]);

const DAY = 86400000;
const shift = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// Date tokens keep saved sets relative: «@today» stays today tomorrow.
export function resolveDate(token, today) {
  if (typeof token !== "string" || !token.startsWith("@")) return token;
  const m = /^@(today|yesterday|tomorrow)$/.exec(token);
  if (m) return shift(today, { today: 0, yesterday: -1, tomorrow: 1 }[m[1]]);
  const rel = /^@([+-]\d+)d$/.exec(token);
  if (rel) return shift(today, Number(rel[1]));
  return token;
}

export function resolveRange(token, today) {
  const last = /^@last(\d+)d$/.exec(token || "");
  if (last) return { from: shift(today, -(Number(last[1]) - 1)), to: today };
  const next = /^@next(\d+)d$/.exec(token || "");
  if (next) return { from: today, to: shift(today, Number(next[1]) - 1) };
  if (token === "@thisWeek") {
    const wd = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    return { from: shift(today, -wd), to: shift(today, 6 - wd) };
  }
  if (token === "@thisMonth") return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-31` };
  if (token && typeof token === "object" && token.from) return { from: resolveDate(token.from, today), to: resolveDate(token.to, today) };
  const day = resolveDate(token, today);
  return { from: day, to: day };
}

const asComparable = (v) => (v == null ? null : typeof v === "boolean" ? Number(v) : v);

function matches(state, obj, filter, ctx) {
  const actual = valueOf(state, obj, filter.rel, ctx);
  const expected = resolveDate(filter.value, ctx.today);
  const dayOf = (v) => (typeof v === "string" ? v.slice(0, 10) : v);
  switch (filter.op) {
    case "eq": return dayOf(actual) === expected || actual === expected;
    case "neq": return !(dayOf(actual) === expected || actual === expected);
    case "gt": return asComparable(actual) != null && asComparable(actual) > asComparable(expected);
    case "gte": return asComparable(actual) != null && asComparable(actual) >= asComparable(expected);
    case "lt": return asComparable(actual) != null && asComparable(actual) < asComparable(expected);
    case "lte": return asComparable(actual) != null && asComparable(actual) <= asComparable(expected);
    case "contains":
      if (Array.isArray(actual)) return actual.includes(expected);
      return String(actual ?? "").toLocaleLowerCase("ru-RU").includes(String(expected ?? "").toLocaleLowerCase("ru-RU"));
    case "empty": return actual == null || actual === "" || (Array.isArray(actual) && !actual.length);
    case "notEmpty": return !(actual == null || actual === "" || (Array.isArray(actual) && !actual.length));
    case "in": return Array.isArray(filter.value) && filter.value.includes(actual);
    case "within": {
      const { from, to } = resolveRange(filter.value, ctx.today);
      const day = dayOf(actual);
      return typeof day === "string" && day >= from && day <= to;
    }
  }
  throw new Error(`неизвестный фильтр ${filter.op}`);
}

export function aggregate(state, objs, agg, ctx) {
  const values = objs.map((obj) => valueOf(state, obj, agg.rel, ctx));
  const nums = values.map(Number).filter((v, i) => values[i] != null && values[i] !== "" && Number.isFinite(v));
  switch (agg.fn) {
    case "count": return objs.length;
    case "countTrue": return values.filter(Boolean).length;
    case "sum": return nums.reduce((a, b) => a + b, 0);
    case "avg": return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    case "min": return nums.length ? Math.min(...nums) : null;
    case "max": return nums.length ? Math.max(...nums) : null;
  }
  throw new Error(`неизвестная функция итога ${agg.fn}`);
}

function bucket(value, by) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) return value[0] ?? "";
  const day = String(value).slice(0, 10);
  if (by === "day") return day;
  if (by === "month") return day.slice(0, 7);
  if (by === "week") {
    const wd = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
    return shift(day, -wd);
  }
  return value;
}

export function sourceObjects(state, source = {}, ctx = {}) {
  if (source.type) return objectsOfType(state, source.type);
  if (Array.isArray(source.ids)) return source.ids.map((id) => state.objects[id]).filter((o) => o && !o.archivedAt);
  if (source.builtin) {
    const fn = SOURCES.get(source.builtin);
    if (!fn) throw new Error(`нет источника ${source.builtin}`);
    return fn(state, source.args || {}, ctx).map((id) => state.objects[id]).filter(Boolean);
  }
  return [];
}

// Runs a query: { source, filters, sorts, group: {rel, by}, aggregates }.
export function runQuery(state, query = {}, ctx = {}) {
  let objs = sourceObjects(state, query.source, ctx);
  for (const filter of query.filters || []) objs = objs.filter((obj) => matches(state, obj, filter, ctx));
  const sorts = query.sorts || [];
  if (sorts.length) {
    objs = objs.slice().sort((a, b) => {
      for (const { rel, dir } of sorts) {
        const x = asComparable(valueOf(state, a, rel, ctx)), y = asComparable(valueOf(state, b, rel, ctx));
        if (x === y) continue;
        if (x == null) return 1;
        if (y == null) return -1;
        const order = typeof x === "string" ? x.localeCompare(String(y), "ru") : x - y;
        if (order) return dir === "desc" ? -order : order;
      }
      return 0;
    });
  }
  if (query.limit) objs = objs.slice(0, query.limit);
  const aggregates = query.aggregates || [];
  const totals = Object.fromEntries(aggregates.map((agg) => [`${agg.fn}:${agg.rel}`, aggregate(state, objs, agg, ctx)]));
  let groups = null;
  if (query.group?.rel) {
    const map = new Map();
    for (const obj of objs) {
      const key = bucket(valueOf(state, obj, query.group.rel, ctx), query.group.by);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(obj);
    }
    const rel = state.relations[query.group.rel];
    const order = rel?.format === "select" ? (rel.options || []).map((o) => o.id) : null;
    groups = [...map.entries()]
      .sort(([a], [b]) => (order ? order.indexOf(a) - order.indexOf(b) : String(a).localeCompare(String(b))))
      .map(([key, rows]) => ({
        key,
        label: rel?.format === "select" ? rel.options?.find((o) => o.id === key)?.name ?? key : key,
        rows,
        totals: Object.fromEntries(aggregates.map((agg) => [`${agg.fn}:${agg.rel}`, aggregate(state, rows, agg, ctx)])),
      }));
  }
  return { rows: objs, groups, totals };
}

// A daily series for charts: every day of the range gets a value, empty days
// get null, so a chart shows gaps honestly.
export function runSeries(state, query, { dateRel = "date", valueRel, fn = "sum", range = "@last7d" }, ctx = {}) {
  const { from, to } = resolveRange(range, ctx.today);
  const rows = runQuery(state, { ...query, filters: [...(query.filters || []), { rel: dateRel, op: "within", value: { from, to } }] }, ctx).rows;
  const byDay = new Map();
  for (const obj of rows) {
    const day = String(valueOf(state, obj, dateRel, ctx) || "").slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(obj);
  }
  const out = [];
  for (let day = from; day <= to; day = shift(day, 1)) {
    const objs = byDay.get(day) || [];
    out.push({ date: day, value: objs.length ? aggregate(state, objs, { rel: valueRel, fn }, ctx) : null });
  }
  return out;
}
