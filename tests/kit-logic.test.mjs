import assert from "node:assert/strict";
import { test } from "node:test";
import { demoLegacyState, legacyToObjects } from "../mobile-shell/objects/core/migrate.js";
import { dayActual, sportDay } from "../mobile-shell/objects/core/domain.js";
import { hasFunction } from "../mobile-shell/objects/core/formula.js";
import { openObjectStore } from "../mobile-shell/objects/core/store.js";
import { objectsOfType } from "../mobile-shell/objects/core/values.js";
import { addItemOps, entryOps, formOps, markOps, quickOps, unmarkOps } from "../mobile-shell/objects/kit/actions.js";
import { resolveBinding } from "../mobile-shell/objects/kit/bind.js";
import {
  dayStatus, entriesOf, itemsOf, labelOf, points, rateOf, requireTrack, resolveDay, streakFor, streakOf, valueSeries, valueTotal, weekQuota,
} from "../mobile-shell/objects/kit/ledger.js";
import { dueOn, everyProblem, occurrences, parseEvery } from "../mobile-shell/objects/kit/schedule.js";
import { EXAMPLES, exampleById } from "../mobile-shell/objects/kit/examples/index.js";
import { priorState } from "../mobile-shell/objects/kit/manual.js";
import { applyBundle, checkBundle } from "../mobile-shell/objects/kit/pipeline.js";
import { slotsOf, sourceDay } from "../mobile-shell/objects/kit/sources.js";
import { buildDemoState } from "../mobile-shell/objects/viz/demo.js";
import { stateDataSource, stateProbe } from "../mobile-shell/objects/viz/data.js";

const TODAY = "2026-10-24"; // a Saturday
const CTX = { today: TODAY };
const FORMAT = { number: "number", scale: "number", text: "text", choice: "select", yesno: "checkbox", date: "date", time: "time", calc: "formula", link: "object" };
const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

function openSpace(initial = null) {
  let n = 0;
  let tick = 0;
  const store = openObjectStore({
    today: () => TODAY,
    clock: () => new Date(Date.UTC(2026, 9, 24, 9, 0, 0) + ++tick * 1000),
    idFactory: (prefix) => `${prefix}_${String(++n).padStart(4, "0")}`,
  });
  if (initial) assert.equal(store.replaceAll(initial).ok, true);
  return store;
}

// The storage mapping of synthesis.md §2, written by hand: what kit/lower.js produces from a bundle.
function defineTrack(store, key, { name = key, kind = "log", fields = [], ...kit } = {}) {
  const keys = fields.map((f) => f.key);
  const ops = [];
  const relations = ["date"];
  if (kind !== "log" && kind !== "catalog") relations.push("kit_item", "kit_slot", "kit_state");
  for (const f of fields) {
    const type = f.type || "number";
    const calc = f.calc ? f.calc.replace(new RegExp(`\\b(${keys.join("|")})\\b`, "g"), (m) => `tr_${key}__${m}`) : undefined;
    const relation = clean({
      key: `tr_${key}__${f.key}`, name: f.name ?? f.key, format: FORMAT[type], hidden: true, unit: f.unit, min: f.min, max: f.max,
      options: f.options?.map((label, i) => ({ id: `o${i + 1}`, name: label })), formula: calc, types: type === "link" ? ["track_item"] : undefined,
      kit: clean({ track: key, field: f.key, type, goal: f.goal, goalType: f.goalType, goalPer: f.goalPer, planned: f.planned, on: f.on, labels: f.labels, required: f.required, hint: f.hint, to: f.to }),
    });
    ops.push({ op: "defineRelation", relation });
    relations.push(relation.key);
  }
  ops.push({ op: "defineType", type: { key: `tr_${key}`, name, plural: name, icon: "▫", fact: kind !== "catalog", layout: "entry", relations, kit: { track: key, kind, ...kit } } });
  const result = store.apply(ops, { actor: "human" });
  assert.equal(result.ok, true, result.reason);
}

function addItem(store, track, { key, name, every = "day", at, from = "2026-10-01", until, plan }) {
  const props = clean({ kit_track: track, kit_key: key, kit_every: every, kit_at: at, kit_from: from, kit_until: until, kit_plan: plan });
  const result = store.apply({ op: "create", type: "track_item", id: `ti_${track}_${key}`, name, props }, { actor: "human" });
  assert.equal(result.ok, true, result.reason);
}

function entry(store, track, date, values = {}, { item, state, slot } = {}) {
  const props = { date };
  for (const [k, v] of Object.entries(values)) props[`tr_${track}__${k}`] = v;
  if (item) props.kit_item = `ti_${track}_${item}`;
  if (slot) props.kit_slot = slot;
  if (state) props.kit_state = state;
  const result = store.apply({ op: "create", type: `tr_${track}`, name: track, props }, { actor: "human" });
  assert.equal(result.ok, true, result.reason);
  return result.ids[0];
}

const bind = (state, el) => resolveBinding(state, el, CTX);
const range = (from, to) => ({ from, to });
const dates = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)) out.push(d);
  return out;
};

// -- schedule ------------------------------------------------------------------------------
test("schedule: every value, from and until decide which days an item is due", () => {
  const item = (every, extra = {}) => ({ key: "x", name: "X", every, from: "2026-10-19", ...extra });
  const due = (it, from, to) => occurrences("t", [it], { from, to }).map((o) => o.date);
  const week = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];

  assert.deepEqual(due(item("day"), week[0], week[6]), week);
  assert.deepEqual(due(item("weekdays"), week[0], week[6]), week.slice(0, 5));
  assert.deepEqual(due(item("weekends"), week[0], week[6]), ["2026-10-24", "2026-10-25"]);
  assert.deepEqual(due(item("mon,wed,fri"), week[0], week[6]), ["2026-10-19", "2026-10-21", "2026-10-23"]);
  assert.deepEqual(due(item("sun, sat"), week[0], week[6]), ["2026-10-24", "2026-10-25"], "a weekday list ignores order and spaces");
  assert.deepEqual(due(item("3d", { from: "2026-10-20" }), "2026-10-19", "2026-10-27"), ["2026-10-20", "2026-10-23", "2026-10-26"], "every 3 days counts from the start date");
  assert.deepEqual(due(item("2d", { from: "2026-10-01" }), week[0], week[6]), ["2026-10-19", "2026-10-21", "2026-10-23", "2026-10-25"], "the step runs over month borders");
  assert.deepEqual(due(item("day", { until: "2026-10-22" }), week[0], week[6]), week.slice(0, 4), "nothing is due after until");
  assert.deepEqual(due(item("day", { from: "2026-10-22" }), week[0], week[6]), week.slice(3), "nothing is due before from, the day the item was made");
  assert.deepEqual(due(item("2026-10-30"), "2026-10-26", "2026-11-02"), ["2026-10-30"]);
  assert.deepEqual(due(item("2026-10-20", { from: "2026-10-22" }), week[0], week[6]), [], "a single date before from never comes");

  const open = occurrences("t", [item("open", { until: "2026-10-21" })], { from: week[0], to: week[6] });
  assert.equal(open.length, 1, "an open item is one occurrence, not one a day");
  assert.deepEqual(open[0].window, { from: "2026-10-19", to: "2026-10-21" });
  assert.deepEqual(occurrences("t", [item("open", { until: "2026-10-21" })], { from: "2026-10-22", to: "2026-10-25" }), [], "an open item that ended is not in a later range");
  assert.deepEqual(occurrences("t", [item("open")], { from: "2026-10-22", to: "2026-10-25" })[0].window, { from: "2026-10-19", to: null });

  assert.equal(dueOn(item("weekdays"), TODAY), false, "2026-10-24 is a Saturday");
  assert.equal(dueOn(item("weekends"), TODAY), true);
  assert.equal(parseEvery("often"), null);
  assert.equal(parseEvery("31d"), null);
  assert.equal(parseEvery("mon,xyz"), null);
  assert.deepEqual(parseEvery("1d"), { type: "day" });
  assert.equal(dueOn(item("often"), TODAY), false, "an unknown rule is never due");
  assert.match(everyProblem("often"), /повтор/);
  assert.equal(everyProblem("2d"), null);

  const ordered = occurrences("t", [
    { key: "c", name: "В", every: "day", from: "2026-10-19", at: "evening" },
    { key: "a", name: "А", every: "day", from: "2026-10-19", at: "07:30" },
    { key: "b", name: "Б", every: "day", from: "2026-10-19", at: "morning" },
  ], { from: TODAY, to: TODAY });
  assert.deepEqual(ordered.map((o) => o.item.key), ["a", "b", "c"], "07:30 comes before the morning, the evening last");
});

// -- outcomes and policies ----------------------------------------------------------------
function policySpace() {
  const store = openSpace();
  for (const policy of ["ignore", "missed", "assumed"]) {
    const key = `p_${policy}`;
    defineTrack(store, key, { kind: "habit", unmarked: policy, fields: [{ key: "dose", name: "Доза", unit: "таб.", min: 0, max: 10, planned: true }] });
    addItem(store, key, { key: "vit_d", name: "Витамин D", at: "morning", plan: { dose: 2 } });
    entry(store, key, "2026-10-20", {}, { item: "vit_d", state: "done" });
    entry(store, key, "2026-10-21", { dose: 1 }, { item: "vit_d", state: "changed" });
    entry(store, key, "2026-10-22", {}, { item: "vit_d", state: "skipped" });
  }
  return store.state();
}

test("a mark decides the outcome: done takes the planned value, changed its own, skipped zero", () => {
  const state = policySpace();
  const row = (date) => resolveDay(state, "p_ignore", date, CTX).rows[0];
  assert.deepEqual([row("2026-10-20").state, row("2026-10-20").via, row("2026-10-20").actual], ["done", "mark", { dose: 2 }]);
  assert.deepEqual([row("2026-10-21").state, row("2026-10-21").via, row("2026-10-21").actual], ["changed", "mark", { dose: 1 }], "a changed mark overrides the planned dose of 2");
  assert.deepEqual([row("2026-10-22").state, row("2026-10-22").via, row("2026-10-22").actual], ["skipped", "mark", { dose: 0 }]);
  assert.equal(row("2026-10-21").mark.values.dose, 1);
});

test("an unmarked past occurrence follows the policy: ignore counts nothing, missed is skipped, assumed is done", () => {
  const state = policySpace();
  const at = (policy, date) => resolveDay(state, `p_${policy}`, date, CTX);
  const past = (policy) => {
    const r = at(policy, "2026-10-23").rows[0];
    return [r.state, r.via, r.actual, at(policy, "2026-10-23").status];
  };
  assert.deepEqual(past("ignore"), ["none", "none", {}, "none"]);
  assert.deepEqual(past("missed"), ["skipped", "policy", { dose: 0 }, "missed"]);
  assert.deepEqual(past("assumed"), ["done", "policy", { dose: 2 }, "ok"], "an assumed day carries the planned dose");
  for (const policy of ["ignore", "missed", "assumed"]) {
    const today = at(policy, TODAY);
    assert.deepEqual([today.rows[0].state, today.rows[0].actual, today.status], ["pending", {}, "open"], `today unmarked is pending under ${policy}`);
  }
  const range3 = range("2026-10-20", TODAY);
  assert.deepEqual(points(state, "p_ignore", range3, CTX).map((p) => [p.date, p.state, p.values.dose]), [["2026-10-20", "done", 2], ["2026-10-21", "changed", 1], ["2026-10-22", "skipped", 0]]);
  assert.equal(points(state, "p_missed", range3, CTX).length, 4);
  assert.deepEqual(points(state, "p_assumed", range3, CTX).at(-1), { date: "2026-10-23", values: { dose: 2 }, slot: null, item: "vit_d", name: "Витамин D", state: "done", via: "policy", id: null });
  const series = (fn) => valueSeries(state, { of: "p_ignore", value: "dose", fn, by: "day", range: range3 }, CTX).series[0].values;
  assert.deepEqual(series("sum"), [2, 1, 0, null, null], "a skipped occurrence adds zero to a sum");
  assert.deepEqual(series("avg").slice(0, 3), [2, 1, null], "and takes no part in an average");
  assert.equal(valueTotal(state, { of: "p_ignore", value: "dose", fn: "avg", range: range("2026-10-20", "2026-10-22") }, CTX).value, 1.5);
});

// -- streaks -------------------------------------------------------------------------------
function sweetsSpace() {
  const store = openSpace();
  defineTrack(store, "sweets", { name: "Без сладкого", kind: "habit", unmarked: "assumed", grace: 1, labels: { done: "Держусь", skipped: "Сорвался" } });
  addItem(store, "sweets", { key: "no_sweets", name: "Не ем сладкое", from: "2026-10-10" });
  for (const date of ["2026-10-15", "2026-10-19", "2026-10-20"]) entry(store, "sweets", date, {}, { item: "no_sweets", state: "skipped" });
  return store;
}

test("an avoid habit: unmarked days hold, slips are bridged by the grace, today pending never breaks", () => {
  const store = sweetsSpace();
  const state = store.state();
  const days = dates("2026-10-10", TODAY);
  const statuses = days.map((d) => dayStatus(state, "sweets", d, CTX));
  const o = "ok";
  const m = "missed";
  assert.deepEqual(statuses, [o, o, o, o, o, m, o, o, o, m, m, o, o, o, "open"]);
  assert.equal(dayStatus(state, "sweets", "2026-10-09", CTX), "none", "before the habit began nothing is judged");
  assert.equal(labelOf(requireTrack(state, "sweets"), "done"), "Держусь");
  assert.equal(labelOf(requireTrack(state, "sweets"), "skipped"), "Сорвался");

  const streak = streakFor(state, "sweets", CTX);
  assert.deepEqual({ current: streak.current, best: streak.best, last30: streak.last30, grace: streak.grace, unit: streak.unit, today: streak.today }, {
    current: 3, best: 8, last30: { ok: 11, of: 14 }, grace: 1, unit: "дн.", today: "open",
  }, "run of 5, one bridged slip, 3 more = 8; two slips in a row break it; then 3; today open adds nothing");
  assert.equal(streak.rate, 79);
  assert.equal(rateOf(statuses), 79);
  assert.deepEqual(streakOf(statuses, 0), { current: 3, best: 5, last30: { ok: 11, of: 14 } }, "without grace the first slip ends the run of 5");
  assert.deepEqual(streakOf(statuses, 2).current, 11, "with grace 2 two slips in a row are bridged, and a bridged slip adds nothing");

  entry(store, "sweets", TODAY, {}, { item: "no_sweets", state: "skipped" });
  const slipToday = streakFor(store.state(), "sweets", CTX);
  assert.deepEqual([slipToday.current, slipToday.best, slipToday.today], [3, 8, "missed"], "a slip today is bridged: the run stays and does not grow");
  assert.deepEqual(streakOf(["open", "none"], 1), { current: 0, best: 0, last30: { ok: 0, of: 0 } });
});

test("a week quota of 3: the week is ok at 3 marks, open while it runs, missed when it ends short", () => {
  const store = openSpace();
  defineTrack(store, "train", { name: "Тренировки", kind: "habit", times: 3, per: "week" });
  addItem(store, "train", { key: "gym", name: "Тренировка", from: "2026-10-05" });
  for (const date of ["2026-10-06", "2026-10-10", "2026-10-12", "2026-10-14", "2026-10-16", "2026-10-19", "2026-10-22"]) entry(store, "train", date, {}, { item: "gym", state: "done" });
  const state = store.state();
  const week = (date) => { const q = weekQuota(state, "train", date, CTX); return [q.from, q.done, q.need, q.status]; };
  assert.deepEqual(week("2026-10-08"), ["2026-10-05", 2, 3, "missed"]);
  assert.deepEqual(week("2026-10-14"), ["2026-10-12", 3, 3, "ok"]);
  assert.deepEqual(week("2026-10-22"), ["2026-10-19", 2, 3, "open"], "2 of 3 while the week still runs");
  assert.deepEqual(dates("2026-10-05", "2026-10-07").map((d) => dayStatus(state, "train", d, CTX)), ["none", "ok", "none"], "days of a quota week are judged by the week, a marked day is ok");
  assert.equal(dayStatus(state, "train", TODAY, CTX), "open");

  const streak = streakFor(state, "train", CTX);
  assert.deepEqual([streak.unit, streak.periods, streak.current, streak.best, streak.today], ["нед.", 3, 1, 1, "open"], "a quota streak counts weeks");
  assert.deepEqual(valueSeries(state, { of: "train", value: "done", by: "week", range: range("2026-10-05", TODAY) }, CTX).series[0].values, [2, 3, 2]);
  const meter = bind(state, { el: "meter", of: "train", value: "done" });
  assert.deepEqual([meter.value, meter.goal, meter.goalType], [2, 3, "min"], "the meter reads the quota as its goal and this week as its range");

  entry(store, "train", "2026-10-23", {}, { item: "gym", state: "done" });
  assert.deepEqual(weekQuota(store.state(), "train", TODAY, CTX).status, "ok", "the third mark closes the week");

  // a week with no mark at all follows the unmarked policy; the week a track began in is never missed
  const quiet = openSpace();
  defineTrack(quiet, "q_missed", { kind: "habit", times: 3, per: "week", unmarked: "missed" });
  defineTrack(quiet, "q_ignore", { kind: "habit", times: 3, per: "week" });
  for (const key of ["q_missed", "q_ignore"]) addItem(quiet, key, { key: "a", name: "A", from: "2026-10-07" });
  const quarter = (key, date) => weekQuota(quiet.state(), key, date, CTX).status;
  assert.deepEqual([quarter("q_missed", "2026-10-12"), quarter("q_ignore", "2026-10-12")], ["missed", "none"]);
  assert.equal(quarter("q_missed", "2026-10-07"), "none", "a week the item began in the middle of is not held against it");
});

// -- logs with goals ----------------------------------------------------------------------
function waterSpace() {
  const store = openSpace();
  defineTrack(store, "water", { name: "Вода", fields: [{ key: "ml", name: "Выпито", unit: "мл", min: 1, max: 5000, goal: 2000 }] });
  for (const [date, ml] of [["2026-10-22", 250], ["2026-10-22", 500], ["2026-10-22", 1500], ["2026-10-23", 1800], [TODAY, 1200]]) entry(store, "water", date, { ml });
  defineTrack(store, "sugar", { name: "Сахар", fields: [{ key: "g", name: "Сахар", unit: "г", goal: 50, goalType: "max" }] });
  for (const [date, g] of [["2026-10-22", 40], ["2026-10-23", 60], [TODAY, 20]]) entry(store, "sugar", date, { g });
  return store;
}

test("a log with a goal: per-day sums, the goal read from the field, and the verdict of each day", () => {
  const state = waterSpace().state();
  const bars = valueSeries(state, { of: "water", value: "ml", fn: "sum", by: "day", range: range("2026-10-21", TODAY) }, CTX);
  assert.deepEqual(bars.buckets, ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
  assert.deepEqual(bars.series[0].values, [null, 2250, 1800, 1200]);
  assert.deepEqual([bars.goal, bars.unit, bars.label, bars.goalType], [2000, "мл", "Выпито", "min"]);
  assert.equal(valueSeries(state, { of: "water", value: "ml", by: "week", range: range("2026-10-19", TODAY) }, CTX).goal, null, "a daily goal is not drawn on weekly bars");
  assert.deepEqual(dates("2026-10-21", TODAY).map((d) => dayStatus(state, "water", d, CTX)), ["none", "ok", "missed", "open"]);
  assert.deepEqual(dates("2026-10-21", TODAY).map((d) => dayStatus(state, "sugar", d, CTX)), ["none", "ok", "missed", "open"], "a limit holds until the day ends and is broken as soon as it is passed");
  assert.deepEqual(streakFor(state, "water", CTX).current, 1);

  const meter = bind(state, { el: "meter", of: "water", value: "ml" });
  assert.deepEqual({ value: meter.value, goal: meter.goal, unit: meter.unit, goalType: meter.goalType, rows: meter.rows, segments: meter.segments }, { value: 1200, goal: 2000, unit: "мл", goalType: "min", rows: 1, segments: null });
  const empty = bind(openSpaceWithWater(), { el: "meter", of: "water", value: "ml" });
  assert.deepEqual([empty.value, empty.goal], [0, 2000], "a goal meter with no entries yet reads 0 of 2000, not an empty box");
});

test("a log with a goal does not judge the days before the track was made", () => {
  const store = openSpace();
  defineTrack(store, "steps", { name: "Шаги", unmarked: "missed", since: "2026-10-22", fields: [{ key: "n", name: "Шаги", unit: "шагов", goal: 8000 }] });
  defineTrack(store, "steps_old", { name: "Шаги без даты", unmarked: "missed", fields: [{ key: "n", name: "Шаги", unit: "шагов", goal: 8000 }] });
  for (const key of ["steps", "steps_old"]) entry(store, key, "2026-10-23", { n: 9000 });
  const state = store.state();
  const days = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", TODAY];
  assert.deepEqual(days.map((d) => dayStatus(state, "steps", d, CTX)), ["none", "none", "missed", "ok", "open"], "the 22nd, the day it began, is judged; the 20th and 21st are not");
  assert.deepEqual(days.map((d) => dayStatus(state, "steps_old", d, CTX)), ["none", "none", "none", "ok", "open"], "without a start day the first entry opens the history");
  assert.equal(streakFor(state, "steps", CTX).periods, 3, "the streak counts from the start day");
});

// -- fn=avg|min|max over a range -----------------------------------------------------------
function dailySpace() {
  const store = openSpace();
  defineTrack(store, "water", { name: "Вода", fields: [{ key: "ml", name: "Выпито", unit: "мл" }] });
  for (const [date, ml] of [["2026-10-21", 250], ["2026-10-21", 250], ["2026-10-21", 500], ["2026-10-21", 900], ["2026-10-22", 300], ["2026-10-22", 300], ["2026-10-22", 200], ["2026-10-23", 1800]]) entry(store, "water", date, { ml });
  defineTrack(store, "weight", { name: "Вес", fields: [{ key: "kg", name: "Вес", unit: "кг" }, { key: "score", name: "Оценка", type: "scale", min: 1, max: 5 }] });
  for (const [date, kg, score] of [["2026-10-20", 80, 2], ["2026-10-20", 81, 4], ["2026-10-20", 82, 4], ["2026-10-21", 79, 5]]) entry(store, "weight", date, { kg, score });
  return store.state();
}

test("avg, min and max of an additive field run over daily totals, not over single entries", () => {
  const state = dailySpace();
  const total = (fn) => valueTotal(state, { of: "water", value: "ml", fn, range: range("2026-10-19", TODAY) }, CTX).value;
  assert.deepEqual([total("avg"), total("min"), total("max"), total("sum"), total("count")], [1500, 800, 1900, 4500, 8], "days 1900, 800, 1800; sum and count stay as they were");
  assert.equal(bind(state, { el: "stat", of: "water", value: "ml", fn: "avg", range: "@last7d" }).value, 1500, "«среднее за день» is the mean of the days that have data");
  const week = valueSeries(state, { of: "water", value: "ml", fn: "avg", by: "week", range: range("2026-10-19", TODAY) }, CTX);
  assert.deepEqual(week.series[0].values, [1500]);
  assert.equal(bind(state, { el: "meter", of: "water", value: "ml", fn: "max", range: "@last7d" }).value, 1900);
});

test("avg of a measurement averages the entries of a day first, so a double weigh-in counts once", () => {
  const state = dailySpace();
  const total = (value, fn) => valueTotal(state, { of: "weight", value, fn, range: range("2026-10-19", TODAY) }, CTX).value;
  assert.equal(total("kg", "avg"), 80, "day 1 is (80+81+82)/3 = 81, day 2 is 79: the mean of days is 80, not 80.5");
  assert.ok(Math.abs(total("score", "avg") - (10 / 3 + 5) / 2) < 1e-9, "a scale is a measurement too: days 3.33 and 5, not 3.75");
  assert.deepEqual([total("kg", "max"), total("kg", "min")], [82, 79], "extremes are taken over the entries");
  assert.equal(total("kg", "sum"), 322, "sum is untouched");
});

function openSpaceWithWater() {
  const store = openSpace();
  defineTrack(store, "water", { name: "Вода", fields: [{ key: "ml", name: "Выпито", unit: "мл", min: 1, max: 5000, goal: 2000 }] });
  return store.state();
}

test("max weight per week over one row per set, filtered by where, with a link and a calc", () => {
  const store = openSpace();
  defineTrack(store, "exercises", { name: "Упражнения", kind: "catalog" });
  addItem(store, "exercises", { key: "bench", name: "Жим лёжа", every: "open" });
  addItem(store, "exercises", { key: "squat", name: "Присед", every: "open" });
  defineTrack(store, "gym", {
    name: "Силовая",
    fields: [
      { key: "exercise", name: "Упражнение", type: "link", to: "exercises" },
      { key: "weight", name: "Вес", unit: "кг" },
      { key: "reps", name: "Повторы" },
      { key: "volume", name: "Тоннаж", type: "calc", calc: "weight * reps", unit: "кг" },
    ],
  });
  const set = (date, ex, weight, reps) => entry(store, "gym", date, { exercise: `ti_exercises_${ex}`, weight, reps });
  set("2026-10-13", "bench", 60, 8);
  set("2026-10-13", "bench", 70, 5);
  set("2026-10-14", "squat", 100, 5);
  set("2026-10-20", "bench", 72.5, 5);
  set("2026-10-21", "squat", 110, 5);
  set("2026-10-22", "bench", 75, 3);
  const state = store.state();
  const weekly = (extra) => valueSeries(state, { of: "gym", value: "weight", fn: "max", by: "week", range: range("2026-10-05", TODAY), ...extra }, CTX);

  assert.deepEqual(weekly({}).buckets, ["2026-10-05", "2026-10-12", "2026-10-19"]);
  assert.deepEqual(weekly({}).series[0].values, [null, 100, 110], "without a filter squat wins");
  assert.deepEqual(weekly({ where: "exercise=bench" }).series[0].values, [null, 70, 75], "where by the key of the catalog row");
  assert.deepEqual(weekly({ where: "exercise=жим лёжа" }).series[0].values, [null, 70, 75], "where by its name, any case");
  assert.deepEqual(weekly({ where: "exercise=squat" }).series[0].values, [null, 100, 110]);
  assert.deepEqual(weekly({ where: "exercise=deadlift" }).series[0].values, [null, null, null]);
  assert.deepEqual(valueSeries(state, { of: "gym", value: "volume", fn: "sum", by: "week", where: "exercise=bench", range: range("2026-10-05", TODAY) }, CTX).series[0].values, [null, 830, 587.5], "tonnage is the calc over each row: 60·8 + 70·5, then 72.5·5 + 75·3");
  const split = weekly({ category: "exercise" });
  assert.deepEqual(split.series.map((s) => [s.label, s.values]), [["Жим лёжа", [null, 70, 75]], ["Присед", [null, 100, 110]]]);
  const stat = bind(state, { el: "stat", of: "gym", value: "weight", fn: "max", range: "@last30d", compare: "yes", where: "exercise=bench" });
  assert.deepEqual([stat.value, stat.unit, stat.label, stat.previous, stat.fn], [75, "кг", "Вес", null, "max"], "nothing before the 30 days to compare with");
  const october = (fn) => valueSeries(state, { of: "gym", value: "weight", fn, by: "month", where: "exercise=bench", range: range("2026-09-01", TODAY) }, CTX).series[0].values;
  assert.deepEqual(valueSeries(state, { of: "gym", value: "weight", by: "month", range: range("2026-09-01", TODAY) }, CTX).buckets, ["2026-09", "2026-10"]);
  assert.deepEqual([october("last"), october("count"), october("min"), october("avg"), october("sum")], [[null, 75], [null, 4], [null, 60], [null, (65 + 72.5 + 75) / 3], [null, 277.5]], "month buckets: the latest set, how many, the lightest set, the mean of the daily means (13th: 65, 20th: 72.5, 22nd: 75) and the total of the bench");
  assert.equal(bind(state, { el: "stat", of: "gym", value: "count", range: "@last30d" }).value, 6, "count of entries needs no field");
  assert.throws(() => weekly({ fn: "median" }), /неизвестная функция «median»/);
  assert.throws(() => weekly({ where: "exercize=bench" }), /нет поля «exercize»/);
  assert.throws(() => weekly({ where: "bench" }), /поле=значение/);

  const table = bind(state, { el: "table", of: "gym", columns: "date,exercise,weight,reps", limit: 3, where: "exercise=bench" });
  assert.deepEqual(table.columns.map((c) => [c.label, c.numeric]), [["Дата", false], ["Упражнение", false], ["Вес", true], ["Повторы", true]]);
  assert.deepEqual(table.rows.map((r) => r.cells.map((c) => c.text)), [["22 окт", "Жим лёжа", "75 кг", "3"], ["20 окт", "Жим лёжа", "72,5 кг", "5"], ["13 окт", "Жим лёжа", "70 кг", "5"]], "newest first, links shown by name");
  assert.equal(table.total, 4);
  assert.equal(table.rows[0].title, "Силовая");
  assert.deepEqual(bind(state, { el: "list", of: "exercises" }).rows.map((r) => r.title), ["Жим лёжа", "Присед"], "the rows of a catalog are its items");

  const form = bind(state, { el: "form", of: "gym", fields: "exercise,weight,reps" });
  assert.deepEqual(form.fields.map((f) => [f.key, f.type, f.default]), [["exercise", "link", "ti_exercises_bench"], ["weight", "number", 75], ["reps", "number", 3]], "a form starts from the last entry");
  assert.deepEqual(form.fields[0].options.map((o) => o.key), ["bench", "squat"]);
  assert.equal(form.maxDate, TODAY);
  assert.throws(() => bind(state, { el: "form", of: "gym", fields: "volume" }), /считается само/);
});

test("more than six categories keep the five biggest and gather the rest under «Другое»", () => {
  const store = openSpace();
  const kinds = ["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => `Вид ${k}`);
  defineTrack(store, "spend", { name: "Траты", fields: [{ key: "kind", name: "Вид", type: "choice", options: kinds }, { key: "sum", name: "Сумма", unit: "₽" }] });
  kinds.forEach((_, i) => { for (let n = 0; n <= 7 - i; n += 1) entry(store, "spend", `2026-10-${String(20 + (n % 4)).padStart(2, "0")}`, { kind: `o${i + 1}`, sum: 10 }); });
  entry(store, "spend", TODAY, { sum: 5 });
  const bars = valueSeries(store.state(), { of: "spend", value: "sum", category: "kind", by: "week", range: range("2026-10-19", TODAY) }, CTX);
  assert.deepEqual(bars.series.map((s) => s.label), ["Вид a", "Вид b", "Вид c", "Вид d", "Вид e", "Другое"].map((l) => l), "the eight kinds by size: a..e stay, f g h merge");
  assert.deepEqual(bars.series.map((s) => s.values[0]), [80, 70, 60, 50, 40, 5 + 30 + 20 + 10], "an entry with no kind is «Без категории» and joins the tail");
  assert.equal(bars.series.at(-1).color, 6);
  const total = bind(store.state(), { el: "meter", of: "spend", value: "sum", range: "@thisWeek", category: "kind" });
  assert.deepEqual(total.segments.map((s) => [s.label, s.value, s.color]), [["Вид a", 80, 0], ["Вид b", 70, 1], ["Вид c", 60, 2], ["Вид d", 50, 3], ["Вид e", 40, 4], ["Другое", 65, 6]], "a meter's segments group the same way as the bars");
});

test("spanHours: a sleep log across midnight and its average", { todo: hasFunction("spanHours") ? false : "ждёт spanHours от K1 в core/functions.js" }, () => {
  const store = openSpace();
  defineTrack(store, "sleep", {
    name: "Сон",
    fields: [{ key: "lay", name: "Лёг", type: "time", required: true }, { key: "woke", name: "Встал", type: "time", required: true }, { key: "hours", name: "Спал", type: "calc", calc: "spanHours(lay, woke)", unit: "ч" }],
  });
  entry(store, "sleep", "2026-10-21", { lay: "23:30", woke: "07:15" });
  entry(store, "sleep", "2026-10-22", { lay: "00:15", woke: "07:45" });
  entry(store, "sleep", "2026-10-23", { lay: "22:45", woke: "06:15" });
  const state = store.state();
  const stat = bind(state, { el: "stat", of: "sleep", value: "hours", fn: "avg", range: "@last7d" });
  assert.equal(Math.round(stat.value * 100) / 100, 7.58, "(7.75 + 7.5 + 7.5) / 3");
  assert.deepEqual(valueSeries(state, { of: "sleep", value: "hours", fn: "avg", by: "day", range: range("2026-10-21", "2026-10-23") }, CTX).series[0].values, [7.75, 7.5, 7.5]);
  assert.throws(() => formOps(state, "sleep", { lay: "23:30" }, { date: TODAY, today: TODAY }), /Заполните «Встал»/);
});

// -- classic sources -----------------------------------------------------------------------
test("the classic sources equal what domain.js computes, and an unmarked day is a gap, not a zero", () => {
  const state = legacyToObjects(demoLegacyState(TODAY), { today: TODAY });
  for (const [date, kcal, planned, skipped] of [["2026-10-11", 1690.5, 2190.3, 1], ["2026-10-20", 830.4, 2351.6, 2], ["2026-10-23", 1667.4, 2310.5, 1]]) {
    const day = sourceDay(state, "ration", date, CTX);
    assert.equal(day.kcal, dayActual(state, date, CTX).eaten.kcal, `ration.kcal on ${date}`);
    assert.deepEqual([day.kcal, day.kcal_planned, day.skipped], [kcal, planned, skipped]);
    assert.equal(day.protein, dayActual(state, date, CTX).eaten.protein);
    assert.equal(day.protein_planned, dayActual(state, date, CTX).planned.protein);
  }
  assert.equal(sourceDay(state, "ration", "2026-10-10", CTX).kcal, null, "four unmarked meals eat nothing known");
  assert.equal(sourceDay(state, "ration", "2026-10-25", CTX).kcal, null);
  assert.equal(sourceDay(state, "ration", "2026-10-25", CTX).kcal_planned, 2190.3, "the plan of a future day is still known");

  assert.deepEqual([sourceDay(state, "sport", "2026-10-11", CTX).burned, sourceDay(state, "sport", "2026-10-11", CTX).burned_planned], [sportDay(state, "2026-10-11").actual, sportDay(state, "2026-10-11").planned]);
  assert.deepEqual([sourceDay(state, "sport", "2026-10-11", CTX).burned, sourceDay(state, "sport", "2026-10-11", CTX).burned_planned], [887, 580]);
  assert.equal(sourceDay(state, "sport", "2026-10-14", CTX).burned, 0, "a skipped session is a real zero");
  assert.equal(sourceDay(state, "sport", "2026-10-19", CTX).burned, 140, "an activity outside the plan counts");
  assert.equal(sourceDay(state, "sport", "2026-10-19", CTX).burned_planned, null, "no session planned that day");
  assert.equal(sourceDay(state, "sport", "2026-10-12", CTX).minutes, sourceDay(state, "sport", "2026-10-12", CTX).minutes);
  assert.equal(sourceDay(state, "sport", "2026-10-22", CTX).burned, null);
  assert.deepEqual(sourceDay(state, "shopping", "2026-10-23", CTX), { spent: 630, bought: 3 });
  assert.deepEqual(sourceDay(state, "shopping", "2026-10-19", CTX), { spent: 225, bought: 2 });
  assert.deepEqual(sourceDay(state, "shopping", "2026-10-22", CTX), { spent: null, bought: null });

  const week = valueSeries(state, { of: "ration", value: "kcal", by: "day", range: range("2026-10-10", "2026-10-12") }, CTX);
  assert.deepEqual(week.series[0].values, [null, 1690.5, 1166.8]);
  assert.deepEqual([week.unit, week.goal, week.goalType], ["ккал", 2400, "max"], "the goal is the Profile's, read-only");
  const protein = bind(state, { el: "meter", of: "ration", value: "protein", range: "@today" });
  assert.deepEqual([protein.goal, protein.goalType, protein.unit], [140, "min", "г"]);
  assert.equal(valueTotal(state, { of: "shopping", value: "spent", fn: "sum", range: range("2026-10-17", TODAY) }, CTX).value, 855);
  assert.throws(() => valueSeries(state, { of: "ration", value: "burned", by: "day", range: range("2026-10-10", "2026-10-12") }, CTX), /нет значения «burned»/);
  assert.throws(() => valueSeries(state, { of: "ration", value: "kcal", where: "x=1", by: "day", range: range("2026-10-10", "2026-10-12") }, CTX), /нет полей для условия/);
});

// -- follow tracks and the classic slots ----------------------------------------------------
test("a follow track asks about the classic slots of each date, from the day it began", () => {
  const store = openSpace(legacyToObjects(demoLegacyState(TODAY), { today: TODAY }));
  defineTrack(store, "satiety", { name: "Сытость", kind: "follow", follows: "ration", since: "2026-10-20", fields: [{ key: "level", name: "Насколько сыт", type: "scale", min: 1, max: 5, labels: ["голоден", "", "норма", "", "переел"] }] });
  const slots = slotsOf(store.state(), "ration", TODAY);
  assert.deepEqual(slots.map((s) => [s.slot, s.name, s.time]), [["m_breakfast_sat", "Завтрак", "08:00"], ["m_lunch_sat", "Обед", "13:00"], ["m_snack_sat", "Перекус", "16:30"], ["m_dinner_sat", "Ужин", "19:30"]]);
  assert.equal(resolveDay(store.state(), "satiety", "2026-10-19", CTX).rows.length, 0, "before the track began nothing was asked");
  assert.deepEqual(resolveDay(store.state(), "satiety", "2026-10-23", CTX).rows.map((r) => r.state), ["none", "none", "none", "none"]);

  const ops = markOps(store.state(), "satiety", { slot: "m_breakfast_sat", state: "done", values: { level: 4 }, today: TODAY });
  assert.equal(store.apply(ops, { actor: "human" }).ok, true);
  assert.equal(store.apply(markOps(store.state(), "satiety", { slot: "m_breakfast_sat", state: "done", values: { level: 3 }, today: TODAY }), { actor: "human" }).ok, true);
  assert.equal(entriesOf(store.state(), "satiety", CTX).length, 1, "a second mark of the same slot and date updates the first");
  assert.equal(entriesOf(store.state(), "satiety", CTX)[0].values.level, 3);
  assert.deepEqual(resolveDay(store.state(), "satiety", TODAY, CTX).rows.map((r) => [r.slot, r.state]), [["m_breakfast_sat", "done"], ["m_lunch_sat", "pending"], ["m_snack_sat", "pending"], ["m_dinner_sat", "pending"]]);
  assert.equal(valueTotal(store.state(), { of: "satiety", value: "level", fn: "avg", range: range("2026-10-20", TODAY) }, CTX).value, 3);

  const marks = bind(store.state(), { el: "marks", of: "satiety" });
  assert.deepEqual(marks.rows.map((r) => [r.name, r.time, r.state]), [["Завтрак", "08:00", "done"], ["Обед", "13:00", "pending"], ["Перекус", "16:30", "pending"], ["Ужин", "19:30", "pending"]]);
  assert.deepEqual(marks.rows[0].ask.done.map((f) => [f.key, f.type, f.min, f.max, f.labels?.[2]]), [["level", "scale", 1, 5, "норма"]]);
  assert.equal(marks.add, false);
  assert.throws(() => markOps(store.state(), "satiety", { slot: "m_lunch_mon", state: "done", values: { level: 3 }, today: TODAY }), /в плане нет «m_lunch_mon»/);
  assert.throws(() => markOps(store.state(), "satiety", { slot: "m_lunch_sat", state: "done", values: { level: 6 }, today: TODAY }), /«Насколько сыт»: не больше 5/);
  assert.throws(() => markOps(store.state(), "satiety", { slot: "m_lunch_sat", state: "done", values: { level: 3.5 }, today: TODAY }), /целая оценка/);
});

// -- actions: ops applied as human create facts, as ai they are refused ----------------------
function actionSpace() {
  const store = openSpace();
  defineTrack(store, "water", { name: "Вода", fields: [{ key: "ml", name: "Выпито", unit: "мл", min: 1, max: 5000, goal: 2000 }] });
  defineTrack(store, "vitamins", { name: "Витамины", kind: "habit", states: ["done", "changed", "skipped"], fields: [{ key: "dose", name: "Доза", unit: "таб.", min: 0, max: 10, planned: true }] });
  addItem(store, "vitamins", { key: "vit_d", name: "Витамин D", at: "morning", plan: { dose: 2 }, from: "2026-10-20" });
  addItem(store, "vitamins", { key: "mg", name: "Магний", at: "evening", every: "weekdays", from: "2026-10-20" });
  defineTrack(store, "shop", { name: "Покупки", kind: "list", fields: [{ key: "price", name: "Сумма", unit: "₽", min: 0, max: 1000000 }] });
  return store;
}

const human = (store, ops) => store.apply(ops, { actor: "human" });
const asAi = (store, ops) => store.apply(ops, { actor: "ai" });

test("quick and form records: bounds and required fields checked here, a human writes the fact, an ai is refused", () => {
  const store = actionSpace();
  const ops = quickOps(store.state(), "water", { ml: 250 }, { date: TODAY, today: TODAY });
  assert.deepEqual(ops, [{ op: "create", type: "tr_water", name: "Вода", props: { date: TODAY, tr_water__ml: 250 } }]);
  const refused = asAi(store, ops);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /записывает только человек/);
  assert.equal(entriesOf(store.state(), "water", CTX).length, 0, "the refused batch left nothing behind");
  const applied = human(store, ops);
  assert.equal(applied.ok, true);
  assert.equal(applied.changeSetId, null, "a fact alone is not journaled");
  assert.deepEqual(entriesOf(store.state(), "water", CTX).map((e) => [e.date, e.values.ml, e.state, e.item]), [[TODAY, 250, null, null]]);

  const past = quickOps(store.state(), "water", { ml: "500" }, { date: "2026-10-22", today: TODAY });
  assert.equal(past[0].props.tr_water__ml, 500, "a number typed as text is read as a number");
  assert.throws(() => quickOps(store.state(), "water", { ml: 0 }, { today: TODAY }), /«Выпито»: не меньше 1 мл/);
  assert.throws(() => quickOps(store.state(), "water", { ml: 6000 }, { today: TODAY }), /«Выпито»: не больше 5000 мл/);
  assert.throws(() => quickOps(store.state(), "water", { ml: "много" }, { today: TODAY }), /нужно число/);
  assert.throws(() => quickOps(store.state(), "water", { ml: 250 }, { date: "2026-10-25", today: TODAY }), /будущие дни/);
  assert.throws(() => quickOps(store.state(), "water", { ml: 250 }, { date: "24.10.2026", today: TODAY }), /ГГГГ-ММ-ДД/);
  assert.throws(() => quickOps(store.state(), "water", { liters: 1 }, { today: TODAY }), /нет поля «liters». Есть: ml/);
  assert.throws(() => quickOps(store.state(), "water", {}, { today: TODAY }), /Нечего записывать/);
  assert.throws(() => quickOps(store.state(), "nope", { ml: 1 }, { today: TODAY }), /нет раздела «nope». Есть: water, vitamins, shop/);

  const edited = entryOps(store.state(), applied.ids[0], { values: { ml: 300 } }, { today: TODAY });
  assert.deepEqual(edited, [{ op: "update", id: applied.ids[0], props: { tr_water__ml: 300 } }]);
  assert.equal(asAi(store, edited).ok, false);
  assert.equal(human(store, edited).ok, true);
  assert.equal(entriesOf(store.state(), "water", CTX)[0].values.ml, 300);
  assert.throws(() => entryOps(store.state(), applied.ids[0], { values: { ml: 9000 } }, { today: TODAY }), /не больше 5000/);
  assert.throws(() => entryOps(store.state(), applied.ids[0], { date: "2026-12-01" }, { today: TODAY }), /будущие дни/);
  assert.throws(() => entryOps(store.state(), applied.ids[0], {}, { today: TODAY }), /Нечего менять/);
  assert.throws(() => entryOps(store.state(), "ti_vitamins_vit_d", { values: { dose: 1 } }, { today: TODAY }), /Запись не найдена/);
  const removal = entryOps(store.state(), applied.ids[0], { remove: true });
  assert.equal(asAi(store, removal).ok, false);
  assert.equal(human(store, removal).ok, true);
  assert.equal(entriesOf(store.state(), "water", CTX).length, 0, "a deleted entry is gone from the ledger");
});

test("a mark is one per item and date: a second tap updates it, unmark takes it back, every refusal has a reason", () => {
  const store = actionSpace();
  const done = markOps(store.state(), "vitamins", { item: "vit_d", date: "2026-10-22", state: "done", today: TODAY });
  assert.deepEqual(done, [{ op: "create", type: "tr_vitamins", name: "Витамин D", props: { date: "2026-10-22", kit_state: "done", kit_item: "ti_vitamins_vit_d" } }]);
  assert.equal(asAi(store, done).ok, false);
  assert.equal(human(store, done).ok, true);

  const changed = markOps(store.state(), "vitamins", { item: "vit_d", date: "2026-10-22", state: "changed", values: { dose: 1 }, today: TODAY });
  assert.equal(changed[0].op, "update", "the second mark updates the first");
  assert.equal(asAi(store, changed).ok, false);
  assert.equal(human(store, changed).ok, true);
  const marks = entriesOf(store.state(), "vitamins", CTX);
  assert.equal(marks.length, 1);
  assert.deepEqual([marks[0].state, marks[0].values.dose], ["changed", 1]);
  assert.equal(resolveDay(store.state(), "vitamins", "2026-10-22", CTX).rows[0].actual.dose, 1);

  const back = markOps(store.state(), "vitamins", { item: "ti_vitamins_vit_d", date: "2026-10-22", state: "done", today: TODAY });
  human(store, back);
  assert.deepEqual([entriesOf(store.state(), "vitamins", CTX)[0].state, entriesOf(store.state(), "vitamins", CTX)[0].values.dose], ["done", null], "going back to done clears the dose of the changed mark, the plan's 2 shows again");
  assert.equal(resolveDay(store.state(), "vitamins", "2026-10-22", CTX).rows[0].actual.dose, 2);
  assert.deepEqual(markOps(store.state(), "vitamins", { item: "vit_d", date: "2026-10-22", state: "done", today: TODAY })[0].op, "update", "the same tap twice is one mark");

  const removed = unmarkOps(store.state(), "vitamins", { item: "vit_d", date: "2026-10-22", today: TODAY });
  assert.equal(removed.length, 1);
  assert.equal(asAi(store, removed).ok, false);
  assert.equal(human(store, removed).ok, true);
  assert.equal(entriesOf(store.state(), "vitamins", CTX).length, 0);
  assert.deepEqual(unmarkOps(store.state(), "vitamins", { item: "vit_d", date: "2026-10-22", today: TODAY }), [], "nothing to take back is no op");

  assert.throws(() => markOps(store.state(), "vitamins", { item: "mg", date: TODAY, state: "done", today: TODAY }), /«Магний» не запланировано на 2026-10-24/);
  assert.throws(() => markOps(store.state(), "vitamins", { item: "vit_d", date: "2026-10-19", state: "done", today: TODAY }), /появилось 2026-10-20/);
  assert.throws(() => markOps(store.state(), "vitamins", { item: "vit_d", date: "2026-10-25", state: "done", today: TODAY }), /будущие дни/);
  assert.throws(() => markOps(store.state(), "vitamins", { item: "iron", state: "done", today: TODAY }), /нет позиции «iron»/);
  assert.throws(() => markOps(store.state(), "vitamins", { state: "done", today: TODAY }), /Укажите позицию/);
  assert.throws(() => markOps(store.state(), "vitamins", { item: "vit_d", state: "pending", today: TODAY }), /Не указано состояние/);
  assert.throws(() => markOps(store.state(), "vitamins", { item: "vit_d", state: "changed", values: { dose: 11 }, today: TODAY }), /«Доза»: не больше 10 таб\./);
  assert.throws(() => markOps(store.state(), "vitamins", { item: "vit_d", state: "done", values: { size: 1 }, today: TODAY }), /нет поля «size»/);
  assert.throws(() => markOps(store.state(), "water", { item: "x", state: "done", today: TODAY }), /нет раздела «water»|отметок нет/);
  const narrow = openSpace();
  defineTrack(narrow, "pills", { kind: "habit" });
  addItem(narrow, "pills", { key: "a", name: "A" });
  assert.throws(() => markOps(narrow.state(), "pills", { item: "a", state: "changed", today: TODAY }), /нет состояния «changed». Есть: done, skipped/);
});

test("a planned field is asked at «changed» only, a required field blocks the mark that asks for it", () => {
  const store = openSpace();
  defineTrack(store, "meds", { kind: "habit", states: ["done", "changed", "skipped"], fields: [{ key: "dose", name: "Доза", min: 0, max: 10, planned: true }, { key: "note", name: "Заметка", type: "text", required: true, on: ["changed"] }] });
  addItem(store, "meds", { key: "a", name: "A", plan: { dose: 1 } });
  const marks = bind(store.state(), { el: "marks", of: "meds" });
  const ask = marks.rows[0].ask;
  assert.deepEqual(ask.done.map((f) => f.key), [], "done asks nothing: the plan carries the dose");
  assert.deepEqual(ask.changed.map((f) => f.key), ["dose", "note"]);
  assert.deepEqual(ask.skipped, []);
  assert.equal(markOps(store.state(), "meds", { item: "a", state: "done", today: TODAY }).length, 1);
  assert.throws(() => markOps(store.state(), "meds", { item: "a", state: "changed", values: { dose: 2 }, today: TODAY }), /Заполните «Заметка»/);
  assert.equal(markOps(store.state(), "meds", { item: "a", state: "changed", values: { dose: 2, note: "после еды" }, today: TODAY })[0].props.tr_meds__note, "после еды");
  assert.equal(markOps(store.state(), "meds", { item: "a", state: "skipped", values: { note: "забыл" }, today: TODAY })[0].props.tr_meds__note, undefined, "a value for a field the state does not ask is dropped");
});

test("a person adds items: a list row and a habit row are plan objects, journaled, with ids that never clash", () => {
  const store = actionSpace();
  const ops = addItemOps(store.state(), "shop", { name: "Молоко" }, { today: TODAY });
  assert.deepEqual(ops, [{ op: "create", type: "track_item", id: "ti_shop_moloko", name: "Молоко", props: { kit_track: "shop", kit_key: "moloko", kit_every: "open", kit_from: TODAY } }]);
  const applied = human(store, ops);
  assert.equal(applied.ok, true);
  assert.notEqual(applied.changeSetId, null, "an item is plan, so the change can be undone");
  assert.throws(() => addItemOps(store.state(), "shop", { name: "молоко" }, { today: TODAY }), /уже есть/);
  assert.throws(() => addItemOps(store.state(), "shop", { name: "" }, { today: TODAY }), /от 1 до 60/);
  assert.throws(() => addItemOps(store.state(), "shop", { name: "Хлеб", every: "sometimes" }, { today: TODAY }), /повтор/);
  assert.throws(() => addItemOps(store.state(), "water", { name: "Стакан" }, { today: TODAY }), /позиции не добавляют/);
  assert.throws(() => addItemOps(store.state(), "shop", { name: "Хлеб", plan: { price: 5 } }, { today: TODAY }), /не плановое/);

  const habit = addItemOps(store.state(), "vitamins", { name: "Омега-3", every: "mon,wed", at: "evening", plan: { dose: 2 } }, { today: TODAY });
  assert.deepEqual(habit[0].props, { kit_track: "vitamins", kit_key: "omega_3", kit_every: "mon,wed", kit_at: "evening", kit_from: TODAY, kit_plan: { dose: 2 } });
  human(store, habit);
  assert.equal(human(store, habit).ok, false, "the same op twice is refused by the store, not applied twice");

  // open list item: bought once, with a price, taken back, bought on another day
  const buy = markOps(store.state(), "shop", { item: "moloko", state: "done", values: { price: 89 }, today: TODAY });
  assert.equal(human(store, buy).ok, true);
  let rows = bind(store.state(), { el: "marks", of: "shop", add: "yes" });
  assert.deepEqual(rows.rows.map((r) => [r.name, r.state, r.values.price]), [["Молоко", "done", 89]]);
  assert.deepEqual([rows.add, rows.addEvery, rows.progress], [true, "open", { done: 1, of: 1 }]);
  assert.equal(valueTotal(store.state(), { of: "shop", value: "price", fn: "sum", range: range(TODAY, TODAY) }, CTX).value, 89);
  human(store, unmarkOps(store.state(), "shop", { item: "moloko", today: TODAY }));
  rows = bind(store.state(), { el: "marks", of: "shop", add: "yes" });
  assert.deepEqual(rows.rows.map((r) => [r.name, r.state]), [["Молоко", "pending"]]);
  assert.equal(valueTotal(store.state(), { of: "shop", value: "open", range: range(TODAY, TODAY) }, CTX).value, 1, "the open count is what is still to buy");
  assert.throws(() => markOps(store.state(), "shop", { item: "moloko", date: "2026-10-23", state: "done", today: TODAY }), /появилось 2026-10-24/, "a row made today was not on the list yesterday");

  addItem(store, "shop", { key: "bread", name: "Хлеб", every: "open", from: "2026-10-20" });
  human(store, markOps(store.state(), "shop", { item: "bread", date: "2026-10-23", state: "done", today: TODAY }));
  assert.deepEqual(bind(store.state(), { el: "marks", of: "shop" }).rows.map((r) => [r.name, r.state]), [["Молоко", "pending"]], "an item bought yesterday is not open today");
  assert.deepEqual(bind(store.state(), { el: "marks", of: "shop", date: "@yesterday" }).rows.map((r) => [r.name, r.state]), [["Хлеб", "done"]]);
  human(store, markOps(store.state(), "shop", { item: "bread", date: TODAY, state: "done", today: TODAY }));
  assert.equal(entriesOf(store.state(), "shop", CTX).length, 1, "a list item has one mark in all; the new tap moves its date");
  assert.equal(entriesOf(store.state(), "shop", CTX)[0].date, TODAY);
});

test("a removed item keeps its past marks in the charts and leaves today's list", () => {
  const store = actionSpace();
  human(store, markOps(store.state(), "vitamins", { item: "vit_d", date: "2026-10-21", state: "done", today: TODAY }));
  human(store, markOps(store.state(), "vitamins", { item: "vit_d", date: TODAY, state: "done", today: TODAY }));
  human(store, markOps(store.state(), "vitamins", { item: "mg", date: "2026-10-22", state: "done", today: TODAY }));
  assert.equal(store.archive("ti_vitamins_vit_d", { actor: "human" }).ok, true);
  const state = store.state();
  assert.deepEqual(resolveDay(state, "vitamins", TODAY, CTX).rows.map((r) => r.key), [], "nothing is due today: Магний is weekdays, the archived item ended yesterday");
  assert.deepEqual(resolveDay(state, "vitamins", TODAY, CTX).extras.map((p) => p.state), ["done"], "a mark made today for the removed item is not lost");
  assert.deepEqual(points(state, "vitamins", range("2026-10-20", TODAY), CTX).map((p) => [p.date, p.item, p.state]), [["2026-10-21", "vit_d", "done"], ["2026-10-22", "mg", "done"], [TODAY, null, "done"]]);
  assert.equal(valueTotal(state, { of: "vitamins", value: "count", fn: "sum", range: range("2026-10-20", TODAY) }, CTX).value, 3);
});

// -- binding shapes and viz/data.js ---------------------------------------------------------
test("resolveBinding gives each display the shape its element draws", () => {
  const store = waterSpace();
  defineTrack(store, "vitamins", { name: "Витамины", kind: "habit", states: ["done", "changed", "skipped"], fields: [{ key: "dose", name: "Доза", planned: true }] });
  addItem(store, "vitamins", { key: "mg", name: "Магний", at: "evening", from: "2026-10-18" });
  addItem(store, "vitamins", { key: "vit_d", name: "Витамин D", at: "morning", plan: { dose: 1 }, from: "2026-10-18" });
  for (const date of ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]) entry(store, "vitamins", date, {}, { item: "vit_d", state: "done" });
  entry(store, "vitamins", "2026-10-23", {}, { item: "mg", state: "done" });
  entry(store, "vitamins", "2026-10-22", {}, { item: "mg", state: "skipped" });
  const state = store.state();

  const bars = bind(state, { el: "bars", of: "water", value: "ml", range: "@last3d" });
  assert.deepEqual(Object.keys(bars).sort(), ["buckets", "by", "fn", "goal", "goalType", "label", "range", "rows", "series", "unit"]);
  assert.deepEqual([bars.by, bars.fn, bars.series.length, bars.series[0].key, bars.series[0].color], ["day", "sum", 1, "value", 0]);
  const line = bind(state, { el: "line", of: "water", value: "ml", by: "week", range: "@last2w" });
  assert.deepEqual([line.by, line.buckets, line.series[0].values], ["week", ["2026-10-12", "2026-10-19"], [null, 5250]]);
  const heat = bind(state, { el: "heatmap", of: "vitamins", value: "rate", range: "@last7d" });
  assert.deepEqual(heat.series[0].values, [null, 100, 100, 100, 50, 100, 0], "the unmarked Магний of the 19th to 21st counts nothing (ignore); the 22nd is one of two; the 24th has both pending");
  assert.equal(heat.unit, "%");
  assert.deepEqual(bind(state, { el: "spark", of: "water", value: "ml", range: "@last7d" }).buckets.length, 7);
  const stat = bind(state, { el: "stat", of: "water", value: "ml", range: "@last3d", compare: "yes", spark: "yes" });
  assert.deepEqual([stat.value, stat.unit, stat.label, stat.goal, stat.good, stat.periodLabel, stat.previous, stat.spark], [5250, "мл", "Выпито", 2000, "up", "предыдущим 3 дням", null, [2250, 1800, 1200]]);
  assert.equal(bind(state, { el: "stat", of: "vitamins", value: "done", range: "@last7d" }).value, 6, "five of Витамин D and one of Магний");
  assert.equal(bind(state, { el: "stat", of: "vitamins", value: "skipped", range: "@last7d" }).value, 1);
  assert.equal(bind(state, { el: "stat", of: "vitamins", range: "@last7d" }).label, "Выполнено", "a habit's stat defaults to done");

  const marks = bind(state, { el: "marks", of: "vitamins" });
  assert.deepEqual(marks.states, [{ id: "done", label: "Сделано" }, { id: "changed", label: "Изменено" }, { id: "skipped", label: "Пропущено" }]);
  assert.deepEqual(marks.rows.map((r) => [r.name, r.at, r.state, r.planned]), [["Витамин D", "morning", "pending", { dose: 1 }], ["Магний", "evening", "pending", {}]]);
  assert.deepEqual([marks.date, marks.canMark, marks.progress, marks.status, marks.quota], [TODAY, true, { done: 0, of: 2 }, "open", null]);
  const yesterday = bind(state, { el: "marks", of: "vitamins", date: "@yesterday" });
  assert.deepEqual(yesterday.rows.map((r) => [r.name, r.state, r.via, r.label]), [["Витамин D", "done", "mark", "Сделано"], ["Магний", "done", "mark", "Сделано"]]);
  assert.equal(bind(state, { el: "marks", of: "vitamins", date: "2026-10-25" }).canMark, false, "a future day is shown but cannot be marked");

  const streak = bind(state, { el: "streak", of: "vitamins" });
  assert.deepEqual([streak.current, streak.best, streak.unit, streak.name], [4, 4, "дн.", "Витамины"], "3 ok days, the 22nd missed and bridged by the default grace of 1, the 23rd ok, today open");

  const quick = bind(state, { el: "quick", of: "water", values: "ml=250" });
  assert.deepEqual([quick.label, quick.values, quick.fields[0].key, quick.fields[0].max], ["+250 мл", { ml: 250 }, "ml", 5000]);
  assert.equal(bind(state, { el: "quick", of: "water", values: "ml=250", label: "Стакан" }).label, "Стакан");
  assert.deepEqual(bind(state, { el: "form", of: "water" }).fields.map((f) => [f.key, f.default]), [["ml", 1200]]);

  assert.throws(() => bind(state, { el: "bars", of: "nope", value: "x", range: "@last7d" }), /нет раздела «nope». Есть: water, sugar, vitamins/);
  assert.throws(() => bind(state, { el: "bars", of: "water", value: "liters", range: "@last7d" }), /нет значения «liters». Есть: ml, count/);
  assert.throws(() => bind(state, { el: "stat", of: "water", value: "done", range: "@last7d" }), /нет значения «done»/);
  assert.throws(() => bind(state, { el: "bars", of: "water", value: "ml", range: "@last99y" }), /неизвестный период/);
  assert.throws(() => bind(state, { el: "marks", of: "water" }), /отметок нет/);
  assert.throws(() => bind(state, { el: "p", of: "water" }), /не берёт данные/);
  assert.throws(() => bind(state, { el: "bars", value: "ml" }), /не указан of/);
});

test("viz/data.js sends a bound element with `of` to the binding and keeps the `set` path", () => {
  const store = waterSpace();
  const state = store.state();
  const source = stateDataSource(() => state, () => CTX);
  const spec = { tag: "c-meter", of: "water", value: "ml" };
  assert.deepEqual(source(spec), resolveBinding(state, { el: "meter", of: "water", value: "ml" }, CTX));
  assert.equal(source({ tag: "c-meter", of: "water", value: "ml" }).value, 1200);
  assert.equal(source({ tag: "c-bars", of: "water", value: "ml", range: "@last3d" }).series[0].values.length, 3);

  const probe = stateProbe(() => state, () => CTX);
  assert.equal(probe("c-bars", { of: "water", value: "ml", range: "@last3d" }), true);
  assert.equal(probe("c-bars", { of: "water", value: "ml", range: "@last3d", where: "ml=999999" }), false, "a chart with nothing to draw is reported empty");
  assert.equal(probe("c-bars", { of: "nope", value: "ml", range: "@last3d" }), false);
  assert.equal(probe("c-quick", { of: "water", values: "ml=250" }), true, "an input always has something to show");

  const demo = buildDemoState(TODAY);
  const classic = stateDataSource(() => demo, () => CTX);
  const old = classic({ tag: "c-meter", set: "set_water", value: "drunk", range: "@today", goal: "2000" });
  assert.equal(typeof old.value, "number", "the set path still answers");
  assert.equal(old.goal, 2000);
  assert.ok(objectsOfType(demo, "set").length > 0);
});

// -- the storage K1's pipeline writes is what the ledger reads ----------------------------------
function buildExample(id) {
  const example = exampleById(id);
  const base = example.space === "demo" ? buildDemoState(TODAY) : openSpace().state();
  const state = priorState(example, { state: base });
  const store = openSpace(state);
  const checked = checkBundle(example.bundle, state, { today: TODAY });
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
  const applied = applyBundle(store, checked);
  assert.equal(applied.ok, true, applied.reason);
  return { store, checked };
}

test("every bound element of every example bundle resolves on the space the pipeline builds", () => {
  let resolved = 0;
  for (const example of EXAMPLES.filter((candidate) => candidate.bundle)) {
    const { store, checked } = buildExample(example.id);
    const elements = Object.values(checked.spec.cards).flatMap((card) => card.body || []).filter((el) => el.of && el.el !== "embed");
    for (const el of elements) {
      assert.doesNotThrow(() => resolveBinding(store.state(), el, CTX), `${example.id}: ${JSON.stringify(el)}`);
      resolved += 1;
    }
  }
  assert.ok(resolved >= 40, `${resolved} elements resolved`);
});

test("a quota habit with a scale field, from the meditation example: mark, rate, quota, line", () => {
  const { store } = buildExample("meditation");
  const [item] = itemsOf(store.state(), "meditate");
  const asked = bind(store.state(), { el: "marks", of: "meditate" });
  assert.deepEqual(asked.rows[0].ask.done.map((f) => [f.key, f.type, f.min, f.max]), [["calm", "scale", 1, 5]], "the scale is asked at done: the example says on=[done]");
  assert.equal(human(store, markOps(store.state(), "meditate", { item: item.key, state: "done", values: { calm: 4 }, today: TODAY })).ok, true);
  const state = store.state();
  const marks = bind(state, { el: "marks", of: "meditate" });
  assert.deepEqual(marks.rows.map((r) => [r.state, r.values]), [["done", { calm: 4 }]]);
  assert.deepEqual(marks.quota, { per: "week", need: 5, done: 1, status: "open" });
  assert.equal(bind(state, { el: "line", of: "meditate", value: "calm", fn: "avg", range: "@last30d" }).series[0].values.at(-1), 4);
  assert.throws(() => markOps(state, "meditate", { item: item.key, state: "done", values: { calm: 6 }, today: TODAY }), /«Спокойствие»: не больше 5/);
});

test("a follow track on the demo plan, a catalog with a link, a list: the examples' marks and records read back", () => {
  const veg = buildExample("veg").store;
  assert.equal(human(veg, markOps(veg.state(), "veg", { slot: "m_lunch_sat", state: "done", values: { has: true }, today: TODAY })).ok, true);
  const table = bind(veg.state(), { el: "table", of: "veg", columns: ["date", "slot", "has"] });
  assert.deepEqual(table.rows.map((r) => r.cells.map((c) => c.text)), [["24 окт", "Обед", "да"]]);
  assert.equal(bind(veg.state(), { el: "stat", of: "veg", value: "has", fn: "count", range: "@last7d", where: { has: true } }).value, 1);
  assert.equal(bind(veg.state(), { el: "stat", of: "veg", value: "has", fn: "count", range: "@last7d", where: { has: false } }).value, 0);

  const rides = buildExample("rides").store;
  assert.throws(() => formOps(rides.state(), "rides", { mins: 30 }, { today: TODAY }), /Заполните «Маршрут»/);
  human(rides, formOps(rides.state(), "rides", { route: "damba", mins: 95 }, { today: TODAY }));
  human(rides, formOps(rides.state(), "rides", { route: "Лесной круг", mins: 50 }, { today: TODAY }));
  assert.throws(() => formOps(rides.state(), "rides", { route: "kanal", mins: 50 }, { today: TODAY }), /нет «kanal»/);
  const long = bind(rides.state(), { el: "stat", of: "rides", value: "mins", fn: "sum", range: "@last30d", where: { route: "damba" } });
  assert.deepEqual([long.value, long.unit], [95, "мин"]);
  const routes = bind(rides.state(), { el: "list", of: "routes", columns: ["name", "km"] });
  assert.deepEqual(routes.rows.map((r) => r.cells.map((c) => c.text)), [["Дамба", "40 км"], ["Лесной круг", "27 км"], ["Набережная", "18 км"]]);

  const bag = buildExample("gymbag").store;
  const open = () => bind(bag.state(), { el: "stat", of: "gymbag", value: "open", range: "@today" }).value;
  assert.equal(open(), 4);
  human(bag, markOps(bag.state(), "gymbag", { item: itemsOf(bag.state(), "gymbag")[0].key, state: "done", today: TODAY }));
  assert.equal(open(), 3);
  human(bag, addItemOps(bag.state(), "gymbag", { name: "Бутылка" }, { today: TODAY }));
  assert.equal(open(), 4, "a row the person adds joins the open items");
});
