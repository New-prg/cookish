import assert from "node:assert/strict";
import test from "node:test";

import {
  activeRationVersion,
  cycleDayFor,
  executeRationCommand,
  migrateRationState,
  readRationDay,
  readRationRange,
} from "../mobile-shell/ration-domain.js";
import {
  memoryStorage,
  openLocalData,
  prepareState,
  rationDayFor,
} from "../mobile-shell/local-data.js";

function v11Blob() {
  return {
    schemaVersion: 11,
    user: { email: "a@example.com" },
    products: [
      { id: "product_water", name: "Вода", unit: "л", updatedAt: "2026-08-01T00:00:00.000Z", updatedBy: "a@example.com" },
      { id: "product_bread", name: "Хлеб", unit: "шт.", updatedAt: "2026-08-01T00:00:00.000Z", updatedBy: "a@example.com" },
    ],
    requests: [{
      id: "request_1",
      createdAt: "2026-08-01T00:00:00.000Z",
      status: "open",
      items: [{ productId: "product_water", quantity: 2, unit: "л" }],
      responses: [{
        id: "response_1",
        requestId: "request_1",
        items: [{ productId: "product_water", purchasedProductId: "product_water", quantity: 1, price: 80, completionMode: "filled" }],
        createdAt: "2026-08-01T01:00:00.000Z",
        createdBy: "a@example.com",
        updatedAt: "2026-08-01T01:00:00.000Z",
        updatedBy: "a@example.com",
      }],
      createdBy: "a@example.com",
      updatedBy: "a@example.com",
      updatedAt: "2026-08-01T01:00:00.000Z",
      history: [],
    }],
    rationDays: {
      "a@example.com|2026-08-03": {
        date: "2026-08-03",
        owner: "a@example.com",
        meals: [{
          id: "meal_1",
          name: "Обед",
          time: "13:00",
          items: [{ id: "item_1", productId: "product_water", name: "Вода", portionSize: 250, packageSize: 1000, measureUnit: "мл" }],
        }],
        updatedAt: "2026-08-03T08:00:00.000Z",
        updatedBy: "a@example.com",
      },
      "a@example.com|2026-08-04": {
        date: "2026-08-04",
        owner: "a@example.com",
        meals: [{
          id: "meal_2",
          name: "Завтрак",
          time: "08:00",
          items: [{ id: "item_2", productId: "product_bread", name: "Хлеб", portionSize: 2, packageSize: 1, measureUnit: "шт." }],
        }],
        updatedAt: "2026-08-04T08:00:00.000Z",
        updatedBy: "a@example.com",
      },
    },
    rationTemplates: [],
    rationView: "week",
    rationAnchor: "2026-08-04",
  };
}

test("old v11 blob opens after migration without losing data", () => {
  const state = openLocalData(memoryStorage(v11Blob())).load();

  assert.equal(state.schemaVersion, 12);
  assert.equal(state.products.length, 2);
  const request = state.requests.find((item) => item.id === "request_1");
  assert.equal(request.responses[0].items[0].quantity, 1);
  assert.equal(request.responses[0].items[0].price, 80);

  const day = rationDayFor(state, "2026-08-03");
  assert.equal(day.source, "special");
  assert.equal(day.meals[0].id, "meal_1");
  assert.equal(day.meals[0].items[0].id, "item_1");
  assert.equal(day.meals[0].items[0].productId, "product_water");

  const secondDay = rationDayFor(state, "2026-08-04");
  assert.equal(secondDay.meals[0].id, "meal_2");

  assert.equal(state.ration.specialDays["a@example.com|2026-08-03"].meals[0].id, "meal_1");
  assert.equal(state.ration.versions.length, 1);
  assert.equal(state.ration.versions[0].cycle.days.length, 2);
  assert.equal(state.ration.versions[0].cycle.days[0].meals[0].id, "meal_1");
  assert.equal(state.ration.versions[0].effectiveFrom, "2026-08-03");
});

test("migration is idempotent", () => {
  const once = migrateRationState(v11Blob());
  const twice = migrateRationState(structuredClone(once));
  assert.deepEqual(twice, once);

  const prepared = prepareState(structuredClone(once));
  assert.deepEqual(prepared.ration, once.ration);
  assert.deepEqual(migrateRationState(structuredClone(prepared)), prepared);
});

test("seven consecutive stored days bind the cycle to weekdays", () => {
  const blob = v11Blob();
  const base = { date: "2026-08-03", owner: "a@example.com", meals: [], updatedAt: "2026-08-03T08:00:00.000Z", updatedBy: "a@example.com" };
  blob.rationDays = {};
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(2026, 7, 3 + index, 12);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    blob.rationDays[`a@example.com|${key}`] = {
      ...base,
      date: key,
      meals: [{ id: `meal_${index}`, name: `День ${index}`, time: "12:00", items: [] }],
    };
  }
  const state = migrateRationState(blob);

  assert.equal(state.ration.versions[0].cycle.weekdayBinding, true);
  const farMonday = rationDayFor(state, "2026-11-02");
  assert.equal(farMonday.source, "cycle");
  assert.equal(farMonday.meals[0].id, "meal_0");
  const farTuesday = rationDayFor(state, "2026-11-03");
  assert.equal(farTuesday.meals[0].id, "meal_1");
});

test("non-weekly cycle repeats by anchor distance", () => {
  const state = migrateRationState(v11Blob());
  const evenOffset = rationDayFor(state, "2026-09-04");
  assert.equal(evenOffset.source, "cycle");
  assert.equal(evenOffset.meals[0].id, "meal_1");
  const oddOffset = rationDayFor(state, "2026-09-03");
  assert.equal(oddOffset.meals[0].id, "meal_2");
  const beforePlan = readRationDay(state, "2026-08-01");
  assert.equal(beforePlan, null);
});

test("editing a cycle-derived date materializes a special day", () => {
  const data = openLocalData(memoryStorage(v11Blob()));
  data.load();
  const state = data.snapshot();
  const cycleDay = rationDayFor(state, "2026-08-05");
  assert.equal(cycleDay.source, "cycle");
  const mealId = cycleDay.meals[0].id;

  const updated = data.updateRationMeal("2026-08-05", mealId, { name: "Перекус" });
  assert.equal(updated.ok, true);

  const after = data.snapshot();
  const special = after.ration.specialDays["a@example.com|2026-08-05"];
  assert.ok(special);
  assert.equal(special.meals[0].id, mealId);
  assert.equal(special.meals[0].name, "Перекус");
  assert.equal(rationDayFor(after, "2026-08-06").meals[0].name, "Завтрак");
});

test("commands return new state without touching the input", () => {
  const state = migrateRationState(v11Blob());
  const before = structuredClone(state);
  const result = executeRationCommand(state, { type: "addMeal", date: "2026-08-10" }, { now: "2026-08-10T10:00:00.000Z", actor: "a@example.com" });

  assert.equal(result.ok, true);
  assert.ok(result.mealId);
  assert.deepEqual(state, before);
  const special = result.state.ration.specialDays["a@example.com|2026-08-10"];
  assert.equal(special.meals.length, 2);
  assert.equal(special.updatedAt, "2026-08-10T10:00:00.000Z");
});

test("ration history storage is reserved by migration", () => {
  const state = migrateRationState(v11Blob());
  assert.deepEqual(state.ration.history, {});
});

test("readRationRange mixes special days and cycle days", () => {
  const state = migrateRationState(v11Blob());
  const range = readRationRange(state, "2026-08-03", "2026-08-05");
  assert.deepEqual(range.map((day) => [day.date, day.source]), [
    ["2026-08-03", "special"],
    ["2026-08-04", "special"],
    ["2026-08-05", "cycle"],
  ]);
});

test("cycle day computation is stable across long distances", () => {
  const state = migrateRationState(v11Blob());
  const version = activeRationVersion(state.ration, "a@example.com", "2027-08-03");
  assert.equal(version.cycle.days[1].meals[0].id, "meal_2");
  assert.equal(cycleDayFor(version.cycle, "2027-08-03").meals[0].id, "meal_2");
});

test("deleteSelection removes cycle content when no special day holds it", () => {
  const data = openLocalData(memoryStorage(v11Blob()));
  data.load();
  const state = data.snapshot();
  const specialItemId = rationDayFor(state, "2026-08-03").meals[0].items[0].id;
  const cycleItemId = rationDayFor(state, "2026-08-05").meals[0].items[0].id;
  assert.equal(cycleItemId, specialItemId);

  const first = data.deleteRationSelection({ itemIds: [specialItemId] });
  assert.equal(first.ok, true);
  const afterFirst = data.snapshot();
  assert.equal(rationDayFor(afterFirst, "2026-08-03").meals[0].items.length, 0);
  assert.equal(rationDayFor(afterFirst, "2026-08-05").meals[0].items.length, 1);

  const second = data.deleteRationSelection({ itemIds: [specialItemId] });
  assert.equal(second.ok, true);
  const afterSecond = data.snapshot();
  assert.equal(rationDayFor(afterSecond, "2026-08-05").meals[0].items.length, 0);
  assert.equal(rationDayFor(afterSecond, "2026-08-07").meals[0].items.length, 0);
  assert.equal(rationDayFor(afterSecond, "2026-08-06").meals[0].items.length, 1);
  assert.equal(rationDayFor(afterSecond, "2026-08-04").meals[0].items.length, 1);
});

test("template fallback seeds the initial version when only templates exist", () => {
  const blob = v11Blob();
  delete blob.rationDays;
  blob.rationTemplates = [{
    id: "ration_template_1",
    name: "Будний день",
    owner: "a@example.com",
    meals: [{ id: "meal_t1", name: "Завтрак", time: "08:00", items: [{ id: "item_t1", productId: "product_bread", name: "Хлеб" }] }],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    updatedBy: "a@example.com",
  }];
  const state = migrateRationState(blob);

  assert.equal(state.ration.versions.length, 1);
  assert.equal(state.ration.versions[0].cycle.days.length, 1);
  assert.ok(state.ration.versions[0].cycle.days[0].meals[0].id !== "meal_t1");
  assert.deepEqual(state.ration.specialDays, {});
});
