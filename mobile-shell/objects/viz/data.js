// Data for the chart kit, resolved from the object space. A bound element names
// a set, a relation and a range; this module runs the set's query, cuts it to the
// range and buckets it by day, week (Monday first) or month. Day, week and month
// buckets are made here on top of runQuery, so query.js stays as it is.
// An element that names a track (`of`) goes through kit/bind.js instead; the
// `set` path is the one the classic dashboards keep using.
//
//   setDataSource(stateDataSource(() => store.state(), () => ({ today: store.today() }), { hrefFor, iconOf }))
import { aggregate, runQuery } from "../core/query.js";
import { valueOf } from "../core/values.js";
import { dateLabel, dateRelationOf, fmtValue, isDateKey, isEmptyData, periodName, previousRange, resolveRange, bucketKey, bucketsOf, shiftDate } from "./util.js";
import { setDataSource, getDataSource } from "./source.js";
import { resolveBinding } from "../kit/bind.js";
import { validateMarkup } from "./validate.js";

export { setDataSource, getDataSource };

const DEFAULTS = { "c-stat": "@last7d", "c-meter": "@today", "c-bars": "@last7d", "c-line": "@last30d", "c-spark": "@last30d", "c-heatmap": "@last12w", "c-table": null, "c-list": null };
const MAX_SERIES = 6;

function setOf(state, id) {
  const set = state.objects[id];
  if (!set || set.type !== "set" || set.archivedAt) throw new Error(`нет набора ${id}`);
  return set;
}

// The query of a set without what would cut a chart short: its own limit and groups.
function baseQuery(set) {
  const q = set.props?.query || {};
  return { source: q.source, filters: [...(q.filters || [])], sorts: q.sorts || [] };
}

export function rowsInRange(state, set, dateRel, range, ctx) {
  const q = baseQuery(set);
  if (dateRel && range) q.filters.push({ rel: dateRel, op: "within", value: { from: range.from, to: range.to } });
  return runQuery(state, q, ctx).rows;
}

function dateRelOf(state, set, override) {
  if (override) return override;
  const type = set.props?.query?.source?.type;
  const key = type ? dateRelationOf(state, type) : null;
  if (!key) throw new Error(`в наборе «${set.name}» нет связи с датой`);
  return key;
}

const dayOf = (state, obj, dateRel, ctx) => String(valueOf(state, obj, dateRel, ctx) || "").slice(0, 10);

function categoryOf(state, obj, key, ctx) {
  const rel = state.relations[key];
  const raw = valueOf(state, obj, key, ctx);
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (id == null || id === "") return { id: "", label: "Без категории", order: 1e9 };
  if (rel?.format === "select") {
    const at = (rel.options || []).findIndex((o) => o.id === id);
    return { id, label: (rel.options || [])[at]?.name ?? String(id), order: at < 0 ? 1e6 : at };
  }
  return { id, label: state.objects[id]?.name || String(id), order: 1e6 };
}

// Series by bucket (and by category): the data of bars, lines, sparks and the heatmap.
export function resolveSeries(state, spec, ctx) {
  const set = setOf(state, spec.set);
  const dateRel = dateRelOf(state, set, spec.date);
  const range = resolveRange(spec.range || DEFAULTS[spec.tag] || "@last7d", ctx.today);
  const by = spec.tag === "c-heatmap" || spec.tag === "c-spark" ? "day" : spec.by || "day";
  const fn = spec.fn || "sum";
  const valueRel = spec.value || "name";
  const rel = state.relations[spec.value];
  const rows = rowsInRange(state, set, dateRel, range, ctx);
  const buckets = bucketsOf(range, by);
  const index = new Map(buckets.map((key, i) => [key, i]));
  const cell = (list) => (list.length ? aggregate(state, list, { rel: valueRel, fn }, ctx) : null);

  const groups = new Map();
  for (const obj of rows) {
    const b = bucketKey(dayOf(state, obj, dateRel, ctx), by);
    if (!index.has(b)) continue;
    const cat = spec.category ? categoryOf(state, obj, spec.category, ctx) : { id: "value", label: rel?.name || "Записи", order: 0 };
    if (!groups.has(cat.id)) groups.set(cat.id, { cat, byBucket: new Map(), count: 0 });
    const g = groups.get(cat.id);
    if (!g.byBucket.has(b)) g.byBucket.set(b, []);
    g.byBucket.get(b).push(obj);
    g.count += 1;
  }

  let ordered = [...groups.values()].sort((x, y) => x.cat.order - y.cat.order || x.cat.label.localeCompare(y.cat.label, "ru"));
  let tail = null;
  if (ordered.length > MAX_SERIES) {
    const keep = new Set([...ordered].sort((x, y) => y.count - x.count).slice(0, MAX_SERIES - 1).map((g) => g.cat.id));
    const rest = ordered.filter((g) => !keep.has(g.cat.id));
    ordered = ordered.filter((g) => keep.has(g.cat.id));
    tail = { cat: { id: "__other", label: "Другое" }, byBucket: new Map() };
    for (const g of rest) for (const [b, list] of g.byBucket) tail.byBucket.set(b, [...(tail.byBucket.get(b) || []), ...list]);
  }
  const series = ordered.map((g, i) => ({ key: g.cat.id, label: g.cat.label, color: i, values: buckets.map((b) => cell(g.byBucket.get(b) || [])) }));
  if (tail) series.push({ key: tail.cat.id, label: tail.cat.label, color: 6, values: buckets.map((b) => cell(tail.byBucket.get(b) || [])) });
  if (!series.length) series.push({ key: "value", label: rel?.name || "Записи", color: 0, values: buckets.map(() => null) });
  return {
    by, fn, buckets, series, range,
    unit: spec.unit ?? rel?.unit ?? "",
    label: rel?.name || "Записи",
    goal: spec.goal != null && spec.goal !== "" ? Number(spec.goal) : null,
    rows: rows.length,
  };
}

function total(state, spec, ctx, range) {
  const set = setOf(state, spec.set);
  const dateRel = spec.range || DEFAULTS[spec.tag] ? dateRelOf(state, set, spec.date) : null;
  const rows = rowsInRange(state, set, dateRel, range, ctx);
  return { rows, value: rows.length ? aggregate(state, rows, { rel: spec.value || "name", fn: spec.fn || "sum" }, ctx) : null };
}

export function resolveStat(state, spec, ctx) {
  const token = spec.range || DEFAULTS["c-stat"];
  const range = resolveRange(token, ctx.today);
  const cur = total(state, spec, ctx, range);
  const rel = state.relations[spec.value];
  const out = { value: cur.value, unit: spec.unit ?? (spec.fn === "count" ? "" : rel?.unit ?? ""), label: rel?.name || "Записи", rows: cur.rows.length, previous: null, periodLabel: periodName(token), good: spec.good || "up", fn: spec.fn || "sum" };
  if (spec.compare) out.previous = total(state, spec, ctx, previousRange(token, ctx.today)).value;
  if (spec.spark) {
    const days = resolveSeries(state, { ...spec, tag: "c-spark", by: "day", range: token === "@today" ? "@last7d" : token }, ctx);
    out.spark = days.series[0].values;
  }
  return out;
}

export function resolveMeter(state, spec, ctx) {
  const token = spec.range || DEFAULTS["c-meter"];
  const range = resolveRange(token, ctx.today);
  const cur = total(state, spec, ctx, range);
  const rel = state.relations[spec.value];
  const out = { value: cur.value, goal: spec.goal != null ? Number(spec.goal) : null, unit: spec.unit ?? (spec.fn === "count" ? "" : rel?.unit ?? ""), label: rel?.name || "Записи", rows: cur.rows.length, goalType: spec["goal-type"] || "min", segments: null };
  if (spec.category && cur.rows.length) {
    const seg = resolveSeries(state, { ...spec, tag: "c-bars", by: "month", range: token }, ctx);
    out.segments = seg.series.map((s) => ({ key: s.key, label: s.label, color: s.color, value: s.values.reduce((a, b) => a + (b || 0), 0) })).filter((s) => s.value > 0);
  }
  return out;
}

// How a person sees a value in a table cell.
export function displayValue(state, obj, key, ctx) {
  const rel = state.relations[key];
  const v = valueOf(state, obj, key, ctx);
  if (v == null || v === "") return "";
  switch (rel?.format) {
    case "number": return fmtValue(v, rel.unit || "");
    case "formula": return typeof v === "number" ? fmtValue(v, rel.unit || "") : String(v);
    case "date": return isDateKey(v) ? dateLabel(v) : String(v);
    case "datetime": return isDateKey(String(v).slice(0, 10)) ? `${dateLabel(String(v).slice(0, 10))}, ${String(v).slice(11, 16)}` : String(v);
    case "select": return (rel.options || []).find((o) => o.id === v)?.name ?? String(v);
    case "multiselect": return (v || []).map((id) => (rel.options || []).find((o) => o.id === id)?.name ?? id).join(", ");
    case "checkbox": return v ? "да" : "нет";
    case "object": return state.objects[v]?.name || "";
    case "objects": return (v || []).map((id) => state.objects[id]?.name).filter(Boolean).join(", ");
    default: return String(v);
  }
}

export function resolveRows(state, spec, ctx, { hrefFor = () => null, iconOf = () => "" } = {}) {
  const set = setOf(state, spec.set);
  const q = baseQuery(set);
  const type = set.props?.query?.source?.type;
  const dateRel = spec.range ? dateRelOf(state, set, spec.date) : (spec.date || (type ? dateRelationOf(state, type) : null));
  if (spec.range) q.filters.push({ rel: dateRel, op: "within", value: resolveRange(spec.range, ctx.today) });
  if (spec.sort) q.sorts = [{ rel: spec.sort, dir: spec.order || "asc" }];
  else if (!q.sorts.length && dateRel) q.sorts = [{ rel: dateRel, dir: "desc" }];
  const all = runQuery(state, q, ctx).rows;
  const limit = Math.min(Number(spec.limit) || (spec.tag === "c-list" ? 6 : 8), 50);
  const viewKeys = set.props?.view?.relations;
  const keys = (spec.columns ? spec.columns.split(",").map((s) => s.trim()) : viewKeys || (state.types[type]?.relations || []).filter((k) => !state.relations[k]?.hidden)).slice(0, spec.columns ? 5 : 3);
  const columns = keys.map((key) => ({ key, label: state.relations[key]?.name || key, numeric: ["number", "formula"].includes(state.relations[key]?.format) }));
  const rows = all.slice(0, limit).map((obj) => ({
    id: obj.id, href: hrefFor(obj), icon: iconOf(obj), title: obj.name || "Без названия",
    cells: columns.map((c) => ({ text: displayValue(state, obj, c.key, ctx), numeric: c.numeric })),
  }));
  return { columns, rows, total: all.length };
}

// The data source the app registers: spec in, data out.
export function stateDataSource(getState, getCtx, helpers = {}) {
  return (spec) => {
    const state = getState();
    const ctx = getCtx();
    if (spec.of) return resolveBinding(state, spec, ctx);
    switch (spec.tag) {
      case "c-stat": return resolveStat(state, spec, ctx);
      case "c-meter": return resolveMeter(state, spec, ctx);
      case "c-table":
      case "c-list": return resolveRows(state, spec, ctx, helpers);
      default: return resolveSeries(state, spec, ctx);
    }
  };
}

// Inputs always have something to show: buttons, a form, today's marks.
const INPUTS = new Set(["c-marks", "c-streak", "c-form", "c-quick"]);

// For the validator: does a bound element have anything to draw?
export function stateProbe(getState, getCtx, helpers = {}) {
  const source = stateDataSource(getState, getCtx, helpers);
  return (tag, attrs) => {
    try {
      const data = source({ tag, ...attrs });
      return INPUTS.has(tag) || !isEmptyData(tag, data);
    } catch { return false; }
  };
}

// validateMarkup with the object space behind it: sets, relations, safety rules
// and the «nothing to show» check.
export function checkDashboard(markup, state, ctx) {
  const probe = stateProbe(() => state, () => ctx);
  return validateMarkup(markup, { state, today: ctx.today, probe });
}

export { shiftDate };
