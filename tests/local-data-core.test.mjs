import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUEST_HISTORY_LIMIT,
  browserStorage,
  memoryStorage,
  openLocalData,
  prepareState,
  rationDayFor,
  readRationHistoryDay,
  todayDateKey,
} from "../mobile-shell/local-data.js";

function openData(initial = null) {
  const data = openLocalData(memoryStorage(initial));
  data.load();
  return data;
}

function failingStorage(error) {
  const inner = memoryStorage();
  let broken = false;
  return {
    storage: {
      read: () => inner.read(),
      write(state) {
        if (broken) throw error;
        inner.write(state);
      },
    },
    breakWrites() {
      broken = true;
    },
    stored: () => inner.read(),
  };
}

function cycleBlob(dateKey) {
  return {
    schemaVersion: 12,
    products: [],
    requests: [],
    ration: {
      versions: [{
        id: "version_1",
        owner: "local",
        effectiveFrom: dateKey,
        cycle: {
          anchor: dateKey,
          weekdayBinding: false,
          days: [{
            id: "cycle_1",
            meals: [{
              id: "meal_1",
              name: "Завтрак",
              time: "08:00",
              items: [{ id: "item_1", productId: "", name: "Каша" }, { id: "item_2", productId: "", name: "Чай" }],
            }],
          }],
        },
      }],
      specialDays: {},
      history: {},
    },
  };
}

test("every command leaves state that normalization would not change", () => {
  const data = openData();
  const today = todayDateKey();

  const water = data.saveProduct({ name: "Вода", unit: "л" });
  data.saveProduct({ id: water.productId, name: "Вода питьевая", unit: "л", category: "Напитки" });
  const bread = data.saveProduct({ name: "Хлеб", unit: "шт.", barcode: "4600000000002" });
  data.removeProduct(bread.productId);
  data.restoreProduct(bread.productId);

  const request = data.createRequest();
  data.saveRequestItems(request.requestId, [
    { productId: water.productId, quantity: 3, unit: "л" },
    { name: "Сыр", quantity: 1 },
  ]);
  data.saveRequestItems(request.requestId, [
    { productId: water.productId, quantity: 4, unit: "л", note: "без газа" },
    { name: "Сыр", quantity: 1 },
  ]);
  data.markBought(request.requestId, water.productId, { quantity: 2, price: 90 });
  const cheese = data.snapshot().products.find((item) => item.name === "Сыр");
  data.markBought(request.requestId, cheese.id, {
    quantity: 1,
    purchasedProduct: { name: "Сыр Российский", barcode: "4600000000003", unit: "кг", catalogSource: "Open Food Facts" },
  });
  data.unmarkBought(request.requestId, water.productId);
  data.saveReceipt(request.requestId, [{ productId: water.productId, quantity: 4, price: 120 }]);
  const history = data.snapshot().requests.find((item) => item.id === request.requestId).history;
  data.restoreVersion(request.requestId, history[1].id);

  const meal = data.addRationMeal(today);
  const item = data.addRationFood(today, meal.mealId);
  data.saveRationFood(today, meal.mealId, item.itemId, { name: "Гречка", addNext: true });
  data.setRationPortion(today, meal.mealId, item.itemId, { portionSize: 80, packageSize: 900, measureUnit: "г" });
  data.markRationMeal(today, meal.mealId, "changed");
  data.recordRationDiscrepancy(today, meal.mealId, { kind: "excluded", productId: water.productId });
  data.transferRationMeals(today, meal.mealId, 15);
  data.setRationProfile({ goal: "Поддержание", targetCalories: 2000 });
  const removedItem = data.removeRationFood(today, meal.mealId, item.itemId);
  data.undoRationRemoval(removedItem.undo);
  const removedMeal = data.removeRationMeal(today, meal.mealId);
  data.undoRationRemoval(removedMeal.undo);
  const fromRation = data.createRequestFromRation({ dates: [today], itemIds: [item.itemId] });
  assert.equal(fromRation.ok, true);
  const other = data.createRequest();
  data.removeRequest(other.requestId);

  const state = data.snapshot();
  assert.deepEqual(prepareState(state), state);
});

test("state shared with callers is frozen and survives later commands", () => {
  const data = openData();
  const before = data.snapshot();
  assert.ok(Object.isFrozen(before));
  assert.ok(Object.isFrozen(before.products));
  assert.throws(() => before.products.push({ id: "x" }), TypeError);

  const saved = data.saveProduct({ name: "Вода", unit: "л" });
  assert.equal(before.products.length, 0);
  assert.equal(saved.state, data.snapshot());
  assert.ok(Object.isFrozen(saved.product));
});

test("a failed storage write keeps the previous state and reports why", () => {
  const quota = Object.assign(new Error("full"), { name: "QuotaExceededError" });
  const harness = failingStorage(quota);
  const data = openLocalData(harness.storage);
  data.load();
  data.saveProduct({ name: "Вода", unit: "л" });
  harness.breakWrites();

  const result = data.saveProduct({ name: "Хлеб", unit: "шт." });
  assert.equal(result.ok, false);
  assert.equal(result.storageFailed, true);
  assert.match(result.reason, /Память приложения заполнена/);
  assert.deepEqual(data.snapshot().products.map((item) => item.name), ["Вода"]);
  assert.deepEqual(harness.stored().products.map((item) => item.name), ["Вода"]);

  const other = failingStorage(new Error("disk"));
  const second = openLocalData(other.storage);
  second.load();
  other.breakWrites();
  assert.match(second.createRequest().reason, /Не удалось сохранить данные/);
  assert.throws(() => second.clear(), /Не удалось сохранить данные/);
});

test("request autosave edits merge into one history entry", () => {
  const data = openData();
  const request = data.createRequest();
  for (let quantity = 1; quantity <= 12; quantity += 1) {
    data.saveRequestItems(request.requestId, [{ name: "Вода", quantity }]);
  }
  const history = data.snapshot().requests[0].history;
  assert.deepEqual(history.map((entry) => entry.action), ["Запрос создан", "Запрос изменён"]);
  assert.equal(history[1].snapshot.items[0].quantity, 12);
});

test("request history keeps only the newest entries", () => {
  const data = openData();
  const request = data.createRequest();
  data.saveRequestItems(request.requestId, [{ name: "Вода", quantity: 100 }]);
  const waterId = data.snapshot().products[0].id;
  for (let index = 0; index < REQUEST_HISTORY_LIMIT + 10; index += 1) {
    if (index % 2) data.unmarkBought(request.requestId, waterId);
    else data.markBought(request.requestId, waterId, { quantity: 1 });
  }
  const history = data.snapshot().requests[0].history;
  assert.equal(history.length, REQUEST_HISTORY_LIMIT);
  assert.notEqual(history[0].action, "Запрос создан");
});

test("loading trims an oversized stored request history", () => {
  const entries = Array.from({ length: REQUEST_HISTORY_LIMIT + 25 }, (_, index) => ({
    id: `transaction_${index}`,
    action: "Запрос изменён",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    snapshot: { items: [], responses: [] },
  }));
  const state = prepareState({
    requests: [{ id: "request_1", createdAt: "2026-01-01T00:00:00.000Z", items: [], responses: [], history: entries }],
  });
  const history = state.requests[0].history;
  assert.equal(history.length, REQUEST_HISTORY_LIMIT);
  assert.equal(history.at(-1).id, `transaction_${REQUEST_HISTORY_LIMIT + 24}`);
});

test("undoing a removal on a computed day returns the date to the cycle", () => {
  const today = todayDateKey();
  const data = openData(cycleBlob(today));
  const removed = data.removeRationFood(today, "meal_1", "item_2");
  assert.equal(removed.ok, true);
  assert.equal(rationDayFor(data.snapshot(), today).source, "special");

  const undone = data.undoRationRemoval(removed.undo);
  assert.equal(undone.ok, true);
  const day = rationDayFor(data.snapshot(), today);
  assert.equal(day.source, "cycle");
  assert.deepEqual(day.meals[0].items.map((item) => item.id), ["item_1", "item_2"]);
});

test("undoing a removal keeps later edits of the same day", () => {
  const today = todayDateKey();
  const data = openData(cycleBlob(today));
  const removed = data.removeRationMeal(today, "meal_1");
  const added = data.addRationMeal(today);
  data.markRationMeal(today, added.mealId, "eaten");

  assert.equal(data.undoRationRemoval(removed.undo).ok, true);
  const day = rationDayFor(data.snapshot(), today);
  assert.equal(day.source, "special");
  assert.deepEqual(day.meals.map((meal) => meal.id), ["meal_1", added.mealId]);
  assert.equal(readRationHistoryDay(data.snapshot(), today).meals[added.mealId].state, "eaten");
});

test("undoing an item removal fails clearly when its meal is gone", () => {
  const today = todayDateKey();
  const data = openData(cycleBlob(today));
  const removedItem = data.removeRationFood(today, "meal_1", "item_1");
  data.removeRationMeal(today, "meal_1");
  const undone = data.undoRationRemoval(removedItem.undo);
  assert.equal(undone.ok, false);
  assert.match(undone.reason, /Приём пищи удалён/);
  assert.equal(data.undoRationRemoval({ type: "markMeal" }).ok, false);
});

test("a command copies only the part of the state it changes", () => {
  const data = openData();
  const water = data.saveProduct({ name: "Вода", unit: "л" });
  const first = data.createRequest();
  const second = data.createRequest();
  const before = data.snapshot();

  data.addRationMeal(todayDateKey());
  assert.equal(data.snapshot().requests, before.requests);

  data.markBought(first.requestId, water.productId, { quantity: 1 });
  const after = data.snapshot();
  assert.notEqual(after.requests, before.requests);
  assert.equal(after.requests.find((item) => item.id === second.requestId), before.requests.find((item) => item.id === second.requestId));
  assert.notEqual(after.requests.find((item) => item.id === first.requestId), before.requests.find((item) => item.id === first.requestId));
});

test("loading an older schema keeps a one-time backup of the original data", () => {
  const legacy = { schemaVersion: 11, products: [{ id: "product_1", name: "Вода" }], requests: [], rationDays: {} };
  const storage = memoryStorage(legacy);
  const data = openLocalData(storage);
  data.load();
  data.saveProduct({ name: "Хлеб", unit: "шт." });
  data.load();
  assert.deepEqual(storage.backups(), { v11: legacy });

  const current = memoryStorage(data.snapshot());
  openLocalData(current).load();
  assert.deepEqual(current.backups(), {});
});

test("browser storage backs up an unreadable blob instead of silently dropping it", () => {
  const values = new Map([["cookish.android.data.v1", "{broken"]]);
  const localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const data = openLocalData(browserStorage(localStorage));
  assert.equal(data.load().products.length, 0);
  assert.equal(values.get("cookish.android.data.v1.backup.unreadable"), "{broken");

  values.set("cookish.android.data.v1", JSON.stringify({ schemaVersion: 11, products: [], requests: [] }));
  openLocalData(browserStorage(localStorage)).load();
  assert.deepEqual(JSON.parse(values.get("cookish.android.data.v1.backup.v11")).schemaVersion, 11);
});
