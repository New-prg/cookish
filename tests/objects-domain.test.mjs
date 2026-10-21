import assert from "node:assert/strict";
import { test } from "node:test";
import { makeState, TODAY as FIXTURE_TODAY } from "../scripts/ai-lab/fixture.mjs";
import { plannedRationRequestItems, readRationDay, readRationDayActual, readRationDayNutrition } from "../mobile-shell/core/ration-domain.js";
import { readSportDay, readSportDayEnergy } from "../mobile-shell/core/sport-domain.js";
import { memoryStorage as legacyStorage, openLocalData, prepareState, responseItemTotal } from "../mobile-shell/core/local-data.js";
import { KBJU_GATE as LEGACY_GATE } from "../mobile-shell/core/proposals.js";
import { record } from "../mobile-shell/core/replay.js";
import { openObjectStore } from "../mobile-shell/objects/core/store.js";
import { valueOf } from "../mobile-shell/objects/core/values.js";
import { runQuery } from "../mobile-shell/objects/core/query.js";
import {
  KBJU_GATE, dayActual, discrepancyOps, editableDayOps, markBoughtOps, markFor, markMealOps, markSessionOps,
  newWeekOps, planDay, requestFromPlanOps, shiftDate, sportDay,
} from "../mobile-shell/objects/core/domain.js";
import { LEGACY_KEY, demoLegacyState, importLegacy, legacyToObjects } from "../mobile-shell/objects/core/migrate.js";

const TODAY = "2026-10-19";
const NOW = "2026-10-19T09:00:00.000Z";

const memoryStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  const writes = [];
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { writes.push(k); map.set(k, String(v)); }, map, writes };
};

function openStore(objectState, today = TODAY) {
  let n = 0;
  const store = openObjectStore({ storage: memoryStorage(), clock: () => new Date(NOW), today: () => today, idFactory: (p) => `${p}_${++n}` });
  assert.equal(store.replaceAll(objectState).ok, true);
  return store;
}

const kbju = ({ calories, protein, fat, carbs }) => ({ kcal: calories, protein, fat, carbs });
const datesFrom = (from, count) => Array.from({ length: count }, (_, index) => shiftDate(from, index));

// The legacy state built with the real commands of the current app on top of
// the ai-lab fixture: marks, every discrepancy kind, a transfer, an Особый
// день from a removal, a repeat into a new version, a sport plan with its
// Учёт and a Запрос from the plan with partial purchases.
function commandState() {
  const data = openLocalData(legacyStorage(makeState()));
  data.load();
  const at = (date, run) => {
    const { value } = record(run, { now: new Date(`${date}T09:00:00.000Z`), today: FIXTURE_TODAY });
    assert.equal(value.ok, true, `${date}: ${value.reason}`);
    return value;
  };
  const itemOf = (date, mealId, productId) => readRationDay(data.snapshot(), date).meals.find((meal) => meal.id === mealId).items.find((item) => item.productId === productId).id;
  at("2026-09-28", () => data.markRationMeal("2026-09-28", "m_breakfast_mon", "eaten"));
  at("2026-09-28", () => data.recordRationDiscrepancy("2026-09-28", "m_lunch_mon", { kind: "amount", productId: "product_chicken", amount: 150 }));
  at("2026-09-29", () => data.markRationMeal("2026-09-29", "m_lunch_tue", "skipped"));
  at("2026-09-29", () => data.recordRationDiscrepancy("2026-09-29", "m_dinner_tue", { kind: "excluded", productId: "product_cheese", name: "Сыр" }));
  at("2026-09-30", () => data.recordRationDiscrepancy("2026-09-30", "m_lunch_wed", { kind: "replaced", productId: "product_chicken", replacedProductId: "product_tofu" }));
  at("2026-09-30", () => data.recordRationDiscrepancy("2026-09-30", "m_lunch_wed", { kind: "added", productId: "product_yogurt", name: "Йогурт греческий", amount: 150, measureUnit: "г" }));
  at("2026-09-30", () => data.transferRationMeals("2026-09-30", "m_snack_wed", 30));
  at("2026-10-01", () => data.removeRationFood("2026-10-01", "m_lunch_thu", itemOf("2026-10-01", "m_lunch_thu", "product_salad")));
  at("2026-10-01", () => data.markRationMeal("2026-10-01", "m_lunch_thu", "eaten"));
  at("2026-10-01", () => data.setRationPortion("2026-10-03", "m_breakfast_sat", itemOf("2026-10-03", "m_breakfast_sat", "product_oats"), { portionSize: 900, packageSize: 500, measureUnit: "г" }));
  at("2026-10-01", () => data.repeatRationDays("2026-10-05", 1));
  const session = (id, type, time, durationMin, intensity) => ({ id, type, time, durationMin, intensity, note: "" });
  at("2026-09-28", () => data.releaseSportVersion({
    effectiveFrom: "2026-09-28",
    days: [[session("s_mon", "strength", "19:00", 60, "medium")], [], [session("s_wed", "run", "07:30", 40, "high")], [], [session("s_fri", "bike", "10:00", 90, "low")], [], []].map((sessions, index) => ({ id: `d${index}`, sessions })),
  }));
  at("2026-09-28", () => data.markSportSession("2026-09-28", "s_mon", "done"));
  at("2026-09-30", () => data.markSportSession("2026-09-30", "s_wed", "changed", { actualDurationMin: 25, actualIntensity: "medium" }));
  at("2026-10-01", () => data.addUnplannedSport("2026-10-01", session("", "walk", "12:00", 30, "medium")));
  at("2026-10-01", () => data.setSportSpecialDay("2026-10-02", [session("s_swim", "swim", "08:00", 45, "high")]));
  const dates = ["2026-10-02", "2026-10-03"];
  const itemIds = dates.flatMap((date) => readRationDay(data.snapshot(), date).meals.flatMap((meal) => meal.items.map((item) => item.id)));
  const { requestId } = at("2026-10-01", () => data.createRequestFromRation({ dates, itemIds }));
  at("2026-10-01", () => data.markBought(requestId, "product_oats", { quantity: 1, price: 120 }));
  at("2026-10-01", () => data.markBought(requestId, "product_milk", { quantity: 1, price: 90 }));
  return data.snapshot();
}

// Compares the legacy readers with the object model day by day and returns
// the number of days compared.
function assertParity(legacy, today, from, count) {
  const space = legacyToObjects(legacy, { today, now: NOW });
  const ctx = { today };
  for (const date of datesFrom(from, count)) {
    const legacyDay = readRationDay(legacy, date);
    const day = planDay(space, "ration", date);
    assert.equal(day.source, legacyDay?.source ?? "empty", `${date}: source of the Рацион`);
    const meals = day.items.map((id) => space.objects[id]);
    assert.deepEqual(
      meals.map((meal) => ({ slot: meal.props.slot, name: meal.name, products: meal.props.items.map((id) => space.objects[id].props.product ?? "") })).sort((a, b) => a.slot.localeCompare(b.slot)),
      (legacyDay?.meals || []).map((meal) => ({ slot: meal.id, name: meal.name, products: meal.items.map((item) => item.productId || "") })).sort((a, b) => a.slot.localeCompare(b.slot)),
      `${date}: meals of the Рацион`,
    );
    assert.deepEqual(meals.map((meal) => meal.props.time), meals.map((meal) => meal.props.time).sort(), `${date}: meals by time`);

    const nutrition = readRationDayNutrition(legacy, date);
    const actual = readRationDayActual(legacy, date);
    const mine = dayActual(space, date, ctx);
    assert.deepEqual(mine.planned, kbju(nutrition.totals), `${date}: planned КБЖУ`);
    assert.deepEqual(mine.eaten, kbju(actual.eaten), `${date}: eaten КБЖУ`);
    const bySlot = (rows, key) => Object.fromEntries(rows.map((row) => [row[key], row]));
    const legacyMeals = bySlot(actual.meals, "mealId");
    for (const meal of mine.meals) {
      const expected = legacyMeals[meal.slot];
      assert.ok(expected, `${date}: meal ${meal.slot} exists in the legacy Учёт`);
      assert.equal(meal.state, expected.state, `${date} ${meal.slot}: state`);
      assert.deepEqual(meal.planned, kbju(expected.planned), `${date} ${meal.slot}: planned`);
      assert.deepEqual(meal.actual, kbju(expected.actual), `${date} ${meal.slot}: actual`);
      assert.equal(meal.discrepancies.length, expected.discrepancies, `${date} ${meal.slot}: discrepancies`);
    }

    const history = legacy.ration?.history?.[`local|${date}`]?.meals || {};
    for (const [slot, entry] of Object.entries(history)) {
      assert.equal(markFor(space, "ration", date, slot)?.props.mealState, entry.state, `${date} ${slot}: mark`);
    }

    const energy = readSportDayEnergy(legacy, date);
    const sport = sportDay(space, date, ctx);
    assert.equal(planDay(space, "sport", date).source, readSportDay(legacy, date)?.source ?? "empty", `${date}: source of the sport plan`);
    assert.equal(sport.planned, energy.planned, `${date}: planned energy`);
    assert.equal(sport.actual, energy.actual, `${date}: actual energy`);
    assert.equal(sport.weightKnown, energy.weightKnown);
    assert.deepEqual(
      sport.sessions.map(({ slot, state, planned, actual: done }) => ({ id: slot, state, planned, actual: done })).sort((a, b) => a.id.localeCompare(b.id)),
      energy.sessions.slice().sort((a, b) => a.id.localeCompare(b.id)),
      `${date}: sessions`,
    );
    assert.equal(sport.activities.length, energy.unplanned.length, `${date}: activities`);
  }

  for (const request of legacy.requests || []) {
    if (request.deletedAt) {
      assert.ok(space.objects[request.id].archivedAt, "a deleted Запрос is archived");
      continue;
    }
    const items = request.items.map((item) => [item, Object.values(space.objects).find((obj) => obj.type === "request_item" && obj.props.request === request.id && obj.props.product === item.productId)]);
    for (const [item, obj] of items) {
      assert.equal(valueOf(space, obj, "bought", ctx), responseItemTotal(request, item.productId).quantity, `${request.id} ${item.productId}: bought`);
      assert.equal(obj.props.quantity, Number(item.quantity));
    }
    const spent = request.items.reduce((total, item) => total + responseItemTotal(request, item.productId).price, 0);
    assert.equal(valueOf(space, request.id, "total", ctx), spent, `${request.id}: spent`);
    assert.equal(valueOf(space, request.id, "status", ctx), prepareState({ requests: [request] }).requests[0].status, `${request.id}: status`);
  }
  return count;
}

function assertRequestParity(legacy, today, dates) {
  const space = legacyToObjects(legacy, { today, now: NOW });
  const itemIds = dates.flatMap((date) => (readRationDay(legacy, date)?.meals || []).flatMap((meal) => meal.items.map((item) => item.id)));
  const expected = plannedRationRequestItems(legacy, dates, itemIds);
  const ops = requestFromPlanOps(space, { dates, name: "Неделя", today });
  assert.deepEqual(
    ops.filter((op) => op.type === "request_item").map((op) => ({ productId: op.props.product, quantity: op.props.quantity, unit: op.props.unit })),
    expected.map(({ productId, quantity, unit }) => ({ productId, quantity, unit })),
  );
  const store = openStore(space, today);
  const applied = store.apply(ops);
  assert.equal(applied.ok, true, applied.reason);
  return expected.length;
}

test("the КБЖУ gate uses the thresholds of the current app", () => {
  assert.deepEqual(KBJU_GATE, LEGACY_GATE);
});

test("parity: the ai-lab fixture, 29 days around its plan start", () => {
  assert.equal(assertParity(prepareState(makeState()), FIXTURE_TODAY, "2026-09-17", 29), 29);
  assert.ok(assertRequestParity(prepareState(makeState()), FIXTURE_TODAY, datesFrom("2026-10-02", 7)) > 5);
});

test("parity: the fixture changed through the current app's commands", () => {
  const legacy = commandState();
  assert.equal(Object.keys(legacy.ration.history).length, 4, "the commands wrote История");
  assert.equal(legacy.requests.length, 1);
  assert.equal(assertParity(legacy, FIXTURE_TODAY, "2026-09-17", 29), 29);
  assertRequestParity(legacy, FIXTURE_TODAY, datesFrom("2026-10-02", 7));
  assert.equal(assertRequestParity(legacy, FIXTURE_TODAY, ["2026-10-02", "2026-10-03"]) > 5, true, "the last package size of a product wins");
});

test("parity: the demo state, raw and as the app stores it, on two different todays", () => {
  for (const today of [TODAY, "2026-03-04"]) {
    const demo = demoLegacyState(today);
    // Another account's plan on the same device is not this person's.
    const foreign = structuredClone(demo.ration.versions[0]);
    demo.ration.versions.push({ ...foreign, id: "ration_version_other", owner: "other@example.com", effectiveFrom: shiftDate(today, -1), cycle: { ...foreign.cycle, days: [{ id: "x", meals: [] }] } });
    demo.ration.specialDays[`other@example.com|${today}`] = { date: today, owner: "other@example.com", meals: [] };
    assert.equal(assertParity(demo, today, shiftDate(today, -14), 29), 29);
    assert.equal(assertParity(prepareState(demo), today, shiftDate(today, -14), 29), 29);
    assertRequestParity(demo, today, datesFrom(shiftDate(today, 1), 7));
  }
});

test("the demo covers what parity has to prove", () => {
  const demo = demoLegacyState(TODAY);
  const space = legacyToObjects(demo, { today: TODAY, now: NOW });
  const facts = (type) => Object.values(space.objects).filter((obj) => obj.type === type);
  assert.deepEqual([...new Set(facts("discrepancy").map((obj) => obj.props.discrepancyKind))].sort(), ["added", "amount", "excluded", "replaced"]);
  assert.deepEqual([...new Set(facts("session_mark").map((obj) => obj.props.sessionState))].sort(), ["changed", "done", "skipped", "unmarked"]);
  assert.ok(facts("activity").length >= 4);
  assert.deepEqual(new Set(datesFrom(shiftDate(TODAY, -14), 29).map((date) => planDay(space, "ration", date).source)), new Set(["cycle", "special"]));
  assert.equal(space.objects.ration_version_demo_2.props.effectiveFrom, shiftDate(TODAY, 6));
  assert.equal(planDay(space, "ration", shiftDate(TODAY, 6)).weekId, "ration_version_demo_2", "the later release wins a tie of start dates");
  assert.equal(space.objects.request_demo_1.props.status, "open");
  assert.equal(space.objects.request_demo_2.props.status, "done");
  assert.deepEqual(space.objects.profile.props.excluded, ["product_tofu"]);
  assert.match(space.objects.profile.props.preferences, /Не ест: кинза/);
  assert.ok(space.objects.product_kefir.archivedAt, "a deleted product is archived");
  assert.deepEqual(space.meta.importIssues, []);
});

test("rule: the past plan and the week in force do not change; future marks are refused", () => {
  const store = openStore(legacyToObjects(demoLegacyState(TODAY), { today: TODAY, now: NOW }));
  const state = store.state();
  const cycleMeal = planDay(state, "ration", TODAY).items[0];
  const blocked = store.apply({ op: "update", id: cycleMeal, props: { time: "07:00" } });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /план прошедших дней и действующей недели не меняется/);
  const pastSpecial = planDay(state, "ration", shiftDate(TODAY, -3));
  assert.equal(pastSpecial.source, "special");
  const portion = state.objects[pastSpecial.items[0]].props.items[0];
  assert.equal(store.apply({ op: "update", id: portion, props: { amount: 10 } }).ok, false, "a past Особый день is history");
  assert.equal(store.apply({ op: "archive", id: pastSpecial.dayId }).ok, false);
  assert.equal(store.apply({ op: "update", id: planDay(state, "ration", TODAY).weekId, props: { anchor: TODAY } }).ok, false, "the week in force is closed");
  const future = planDay(state, "ration", shiftDate(TODAY, 2));
  assert.equal(future.source, "special");
  const edit = store.apply({ op: "update", id: future.items[0], props: { time: "10:30" } });
  assert.equal(edit.ok, true, edit.reason);

  const futureMark = store.apply(markMealOps(state, shiftDate(TODAY, 1), planDay(state, "ration", shiftDate(TODAY, 1)).items[0], "eaten"));
  assert.match(futureMark.reason, /нельзя отмечать будущий день/);
  const todayMark = store.apply(markMealOps(state, TODAY, cycleMeal, "skipped"));
  assert.equal(todayMark.ok, true, todayMark.reason);
  assert.equal(markFor(store.state(), "ration", TODAY, state.objects[cycleMeal].props.slot).props.mealState, "skipped");
});

test("rule: the assistant cannot leave a day under the КБЖУ gate, a person can", () => {
  const store = openStore(legacyToObjects(demoLegacyState(TODAY), { today: TODAY, now: NOW }));
  const date = shiftDate(TODAY, 3);
  const copy = editableDayOps(store.state(), "ration", date);
  assert.equal(store.apply(copy.ops).ok, true);
  const state = store.state();
  const before = dayActual(state, date, { today: TODAY }).planned.kcal;
  assert.ok(before >= 2040 && before <= 2760, `the copied day passes the gate (${before})`);
  const portions = planDay(state, "ration", date).items.flatMap((id) => state.objects[id].props.items);
  const starve = portions.map((id) => ({ op: "update", id, props: { amount: 10 } }));
  const byAi = store.apply(starve, { actor: "ai" });
  assert.equal(byAi.ok, false);
  assert.match(byAi.reason, /ниже безопасного минимума 1200/);
  assert.match(byAi.reason, /белок/);
  assert.equal(dayActual(store.state(), date, { today: TODAY }).planned.kcal, before, "a refused batch writes nothing");
  const small = store.apply({ op: "update", id: portions[0], props: { amount: Number(state.objects[portions[0]].props.amount) + 10 } }, { actor: "ai" });
  assert.equal(small.ok, true, small.reason);
  const byPerson = store.apply(starve, { actor: "human" });
  assert.equal(byPerson.ok, true, byPerson.reason);
  assert.ok(dayActual(store.state(), date, { today: TODAY }).planned.kcal < 1200);
});

test("rule: the assistant cannot drop an Особый день back onto a failing cycle or add an excluded product", () => {
  const store = openStore(legacyToObjects(demoLegacyState(TODAY), { today: TODAY, now: NOW }));
  const date = shiftDate(TODAY, 4);
  assert.equal(store.apply(editableDayOps(store.state(), "ration", date).ops).ok, true);
  const state = store.state();
  const portion = state.objects[planDay(state, "ration", date).items[1]].props.items[0];
  const excluded = store.apply({ op: "update", id: portion, props: { product: "product_tofu" } }, { actor: "ai" });
  assert.match(excluded.reason, /исключённый продукт «Тофу»/);

  // A person thins the cycle day of a future week under an Особый день; the
  // assistant may not take the Особый день away and expose the thin day.
  const later = shiftDate(TODAY, 6);
  assert.equal(store.apply(editableDayOps(store.state(), "ration", later).ops).ok, true);
  const week = store.state().objects[planDay(store.state(), "ration", later).weekId];
  const thin = store.state().objects[week.props.days[0]].props.meals.flatMap((id) => store.state().objects[id].props.items)
    .map((id) => ({ op: "update", id, props: { amount: 1 } }));
  assert.equal(store.apply(thin).ok, true, "a future week is open to a person");
  const special = planDay(store.state(), "ration", later).dayId;
  const dropped = store.apply({ op: "archive", id: special }, { actor: "ai" });
  assert.match(dropped.reason, /ниже безопасного минимума/);
  assert.equal(store.apply({ op: "archive", id: special }).ok, true);
});

test("editableDayOps copies a cycle day into an Особый день and the marks of the date survive", () => {
  const store = openStore(legacyToObjects(demoLegacyState(TODAY), { today: TODAY, now: NOW }));
  const state = store.state();
  const before = dayActual(state, TODAY, { today: TODAY });
  const cycle = planDay(state, "ration", TODAY);
  assert.equal(cycle.source, "cycle");
  assert.ok(before.meals.some((meal) => meal.state !== "unmarked"), "today has marks");
  const { ops, dayId, idMap } = editableDayOps(state, "ration", TODAY);
  assert.equal(store.apply(ops).ok, true);
  const after = store.state();
  const special = planDay(after, "ration", TODAY);
  assert.equal(special.source, "special");
  assert.equal(special.dayId, dayId);
  assert.deepEqual(special.items, cycle.items.map((id) => idMap[id]));
  assert.ok(special.items.every((id) => !cycle.items.includes(id)), "new objects");
  const copied = dayActual(after, TODAY, { today: TODAY });
  assert.deepEqual(copied.meals.map(({ mealId, ...rest }) => rest), before.meals.map(({ mealId, ...rest }) => rest), "same slots, same marks, same numbers");
  assert.deepEqual(copied.meals.map((meal) => meal.mealId), special.items);
  const again = editableDayOps(after, "ration", TODAY);
  assert.deepEqual(again, { ops: [], dayId, idMap: {} });
  const portion = after.objects[special.items[0]].props.items[0];
  assert.equal(store.apply({ op: "update", id: portion, props: { amount: 70 } }).ok, true, "today's Особый день is editable");
  assert.equal(after.objects[cycle.items[0]].props.items.length > 0, true, "the cycle day stays as it was");
  const sport = editableDayOps(after, "sport", shiftDate(TODAY, 3));
  assert.equal(store.apply(sport.ops).ok, true);
  assert.equal(planDay(store.state(), "sport", shiftDate(TODAY, 3)).source, "special");
});

test("newWeekOps repeats the plan from a future date and refuses today", () => {
  const store = openStore(legacyToObjects(demoLegacyState(TODAY), { today: TODAY, now: NOW }));
  const state = store.state();
  const from = shiftDate(TODAY, 1);
  const dates = datesFrom(from, 7);
  const before = dates.map((date) => dayActual(state, date, { today: TODAY }).planned);
  assert.equal(planDay(state, "ration", shiftDate(TODAY, 2)).source, "special");
  const applied = store.apply(newWeekOps(state, "ration", { fromDate: from, days: 7 }));
  assert.equal(applied.ok, true, applied.reason);
  let after = store.state();
  const week = planDay(after, "ration", from).weekId;
  assert.deepEqual(dates.map((date) => planDay(after, "ration", date).source), dates.map(() => "cycle"), "the Особый день inside the range is now the cycle");
  assert.deepEqual(dates.map((date) => dayActual(after, date, { today: TODAY }).planned), before);
  assert.deepEqual(dates.map((date) => planDay(after, "ration", date).weekId), [...dates.slice(0, 5).map(() => week), "ration_version_demo_2", "ration_version_demo_2"], "a week released later from an earlier date does not take the dates of a later week");
  assert.equal(store.apply([{ op: "archive", id: "ration_version_demo_2" }, { op: "archive", id: "ration_version_demo_9" }]).ok, true, "a future week can be withdrawn");
  after = store.state();
  assert.deepEqual(dates.map((date) => dayActual(after, shiftDate(date, 7), { today: TODAY }).planned), dates.map((date) => dayActual(after, date, { today: TODAY }).planned), "the week repeats by weekday");
  assert.match(store.apply(newWeekOps(after, "ration", { fromDate: TODAY, days: 1 })).reason, /действующей недели не меняется/);
  assert.equal(store.apply(newWeekOps(after, "sport", { fromDate: shiftDate(TODAY, 5), days: 7 })).ok, true);
});

test("marks, discrepancies and sessions through ops", () => {
  const store = openStore(legacyToObjects(demoLegacyState(TODAY), { today: TODAY, now: NOW }));
  let state = store.state();
  const date = shiftDate(TODAY, -1);
  const [mealId] = planDay(state, "ration", date).items;
  const slot = state.objects[mealId].props.slot;
  const product = state.objects[state.objects[mealId].props.items[0]].props.product;
  assert.equal(store.apply(markMealOps(state, date, mealId, "eaten")).ok, true);
  state = store.state();
  const eaten = dayActual(state, date, { today: TODAY }).meals.find((meal) => meal.mealId === mealId).actual.kcal;
  assert.equal(store.apply(discrepancyOps(state, date, mealId, { kind: "excluded", product })).ok, true);
  state = store.state();
  const meal = dayActual(state, date, { today: TODAY }).meals.find((entry) => entry.mealId === mealId);
  assert.ok(meal.actual.kcal < eaten, "the excluded product is not eaten");
  assert.equal(markFor(state, "ration", date, slot).props.mealState, "eaten", "a marked meal keeps its state");
  assert.match(store.apply(markMealOps(state, date, mealId, "eaten"), { actor: "ai" }).reason, /записывает только человек/);

  const sportDate = planDay(state, "sport", date).items.length ? date : shiftDate(date, -1);
  const [sessionId] = planDay(state, "sport", sportDate).items;
  assert.equal(store.apply(markSessionOps(state, sportDate, sessionId, "changed", { actualDuration: 15 })).ok, true);
  state = store.state();
  const session = sportDay(state, sportDate, { today: TODAY }).sessions.find((entry) => entry.sessionId === sessionId);
  assert.equal(session.state, "changed");
  assert.equal(markFor(state, "sport", sportDate, state.objects[sessionId].props.slot).props.actualDuration, 15);
  assert.equal(store.apply(markSessionOps(state, sportDate, sessionId, "done")).ok, true);
  assert.equal(markFor(store.state(), "sport", sportDate, state.objects[sessionId].props.slot).props.actualDuration, undefined, "done without actual values drops them");
});

test("a Запрос from the plan closes when everything is bought", () => {
  const store = openStore(legacyToObjects(demoLegacyState(TODAY), { today: TODAY, now: NOW }));
  const ops = requestFromPlanOps(store.state(), { dates: [shiftDate(TODAY, 1)], today: TODAY });
  assert.equal(store.apply(ops).ok, true);
  const requestId = ops[0].id;
  const items = store.state().objects[requestId].props.items;
  const [first, ...rest] = items;
  const quantity = store.state().objects[first].props.quantity;
  assert.equal(store.apply(markBoughtOps(store.state(), first, { quantity: quantity / 2, price: 50, date: TODAY })).ok, true);
  assert.equal(valueOf(store.state(), first, "isBought", { today: TODAY }), quantity / 2 >= quantity);
  for (const id of [first, ...rest]) assert.equal(store.apply(markBoughtOps(store.state(), id, { price: 100, date: TODAY })).ok, true);
  const done = store.state();
  assert.equal(done.objects[requestId].props.status, "done");
  assert.equal(valueOf(done, requestId, "total", { today: TODAY }), 50 + 100 * items.length);
  assert.equal(valueOf(done, first, "bought", { today: TODAY }), quantity, "without a quantity the rest is bought");
  assert.match(store.apply(markBoughtOps(done, first, { date: TODAY }), { actor: "ai" }).reason, /записывает только человек/);
});

test("importLegacy reads the current app's data and leaves its key byte-identical", () => {
  const raw = JSON.stringify(prepareState(demoLegacyState(TODAY)));
  const storage = memoryStorage({ [LEGACY_KEY]: raw });
  const store = openObjectStore({ storage, clock: () => new Date(NOW), today: () => TODAY });
  const result = importLegacy(store, storage);
  assert.equal(result.ok, true, result.reason);
  assert.equal(storage.getItem(LEGACY_KEY), raw);
  assert.ok(!storage.writes.includes(LEGACY_KEY), "the legacy key is never written");
  const state = store.state();
  assert.equal(state.meta.source, LEGACY_KEY);
  assert.ok(state.meta.importedAt);
  assert.equal(state.objects[state.meta.home].type, "dashboard");
  assert.ok(result.counts.product > 20 && result.counts.meal_mark > 20 && result.counts.purchase >= 5);
  const reopened = openObjectStore({ storage, today: () => TODAY });
  assert.deepEqual(dayActual(reopened.state(), TODAY, { today: TODAY }), dayActual(state, TODAY, { today: TODAY }), "the space survives a reload");
  assert.equal(importLegacy(openObjectStore({ storage: memoryStorage() }), memoryStorage()).ok, false);
});

test("the home dashboard and its sets run", () => {
  const state = openStore(legacyToObjects(demoLegacyState(TODAY), { today: TODAY, now: NOW })).state();
  const ctx = { today: TODAY };
  const widgets = state.objects[state.meta.home].props.widgets;
  assert.deepEqual(widgets.map((widget) => widget.kind), ["ration-today", "sport-today", "requests", "set", "set", "set", "set"]);
  for (const widget of widgets.filter((entry) => entry.kind === "set")) {
    const set = state.objects[widget.setId];
    assert.equal(set.type, "set");
    assert.ok(Array.isArray(set.props.view.relations));
    runQuery(state, set.props.query, ctx);
  }
  assert.deepEqual(runQuery(state, state.objects.set_sessions.props.query, ctx).rows.map((obj) => obj.id), planDay(state, "sport", TODAY).items);
  assert.equal(runQuery(state, state.objects.set_purchases.props.query, ctx).totals["sum:price"], 120 + 90 + 420 + 150 + 75, "purchases of the last 7 days");
  const grouped = runQuery(state, state.objects.set_requests.props.query, ctx).groups;
  assert.deepEqual(grouped.map((group) => group.key), ["open", "done"]);
});
