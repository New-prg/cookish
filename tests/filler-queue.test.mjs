import assert from "node:assert/strict";
import test from "node:test";

import { USER_NUTRITION_SOURCE, hasNutrition } from "../mobile-shell/core/filler.js";
import { memoryStorage, openLocalData } from "../mobile-shell/core/local-data.js";

const FULL = { calories: 380, protein: 10, fat: 3, carbs: 78, fiber: null, source: USER_NUTRITION_SOURCE };

function open(initial = null) {
  const storage = memoryStorage(initial);
  const data = openLocalData(storage);
  data.load();
  return { data, storage, queued: () => data.snapshot().filler.queue.map((entry) => entry.productId) };
}

test("filler: a product saved without КБЖУ joins the queue, one with КБЖУ does not", () => {
  const { data, queued } = open();
  const bare = data.saveProduct({ name: "Хлебцы", unit: "шт." });
  assert.equal(bare.product.nutrition, null);
  const typed = data.saveProduct({ name: "Гречка", unit: "г", nutrition: FULL });
  assert.equal(typed.product.nutrition.source, "Вы");
  assert.deepEqual(queued(), [bare.productId]);
});

test("filler: partly known КБЖУ wait for the rest", () => {
  const { data, queued } = open();
  const partly = data.saveProduct({ name: "Сырники", unit: "г", nutrition: { ...FULL, fat: null } });
  assert.equal(hasNutrition(partly.product), false);
  assert.deepEqual(queued(), [partly.productId]);
});

test("filler: a product named in Рацион without КБЖУ is queued too", () => {
  const { data, queued } = open();
  const meal = data.addRationMeal("2026-10-20");
  const row = data.addRationFood("2026-10-20", meal.mealId);
  assert.equal(data.saveRationFood("2026-10-20", meal.mealId, row.itemId, { name: "Киноа" }).ok, true);
  const product = data.snapshot().products.find((item) => item.name === "Киноа");
  assert.deepEqual(queued(), [product.id]);
});

test("filler: a product leaves the queue once it has КБЖУ or is deleted, and the queue survives a restart", () => {
  const { data, storage, queued } = open();
  const bread = data.saveProduct({ name: "Хлебцы", unit: "шт." });
  const cheese = data.saveProduct({ name: "Сыр", unit: "г" });
  assert.equal(data.saveProduct({ id: cheese.productId, name: "Сыр твёрдый", unit: "г" }).ok, true, "a second save does not queue it twice");
  assert.deepEqual(queued(), [bread.productId, cheese.productId]);

  const reopened = openLocalData(storage);
  assert.deepEqual(reopened.load().filler.queue.map((entry) => entry.productId), [bread.productId, cheese.productId]);

  data.saveProduct({ id: bread.productId, name: "Хлебцы", unit: "шт.", nutrition: FULL });
  data.removeProduct(cheese.productId);
  assert.deepEqual(queued(), []);
});
