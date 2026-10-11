import assert from "node:assert/strict";
import test from "node:test";

import { checkNutritionCard } from "../mobile-shell/core/nutrition-check.js";
import { NUTRITION_SOURCES, nutritionSourceLabel, openFoodFactsUrl } from "../mobile-shell/core/nutrition-source.js";
import { memoryStorage, normalizeProductName, openLocalData } from "../mobile-shell/core/local-data.js";
import { REFERENCE_FOODS, REFERENCE_SOURCE } from "../mobile-shell/services/catalog/reference-foods.js";
import { findReference } from "../mobile-shell/services/catalog/reference.js";

test("reference: every card passes the check, ids and names are unique", () => {
  assert.ok(REFERENCE_FOODS.length >= 300, `about 300 common products, got ${REFERENCE_FOODS.length}`);
  assert.equal(REFERENCE_SOURCE.license, "CC0 1.0");
  const failed = REFERENCE_FOODS.map((food) => [food.id, checkNutritionCard(food.nutrition)]).filter(([, check]) => !check.ok);
  assert.deepEqual(failed, []);
  assert.equal(new Set(REFERENCE_FOODS.map((food) => food.id)).size, REFERENCE_FOODS.length);
  assert.equal(new Set(REFERENCE_FOODS.map((food) => normalizeProductName(food.name))).size, REFERENCE_FOODS.length);
  REFERENCE_FOODS.forEach((food) => {
    assert.match(food.id, /^[a-z0-9-]+$/);
    assert.ok(food.category, `${food.id} has a category`);
    assert.ok(["г", "л"].includes(food.unit), `${food.id}: КБЖУ need a weight or a volume, not pieces`);
  });
});

test("reference search: words match up to their endings, other forms wait until asked", () => {
  const names = (query) => findReference(query).candidates.map((food) => food.name);
  assert.ok(names("огурцы").includes("Огурец"), "огурец / огурцы");
  assert.ok(names("гречку").includes("Гречка ядрица"));
  assert.equal(names("рис").includes("Рисовое молоко"), false);
  assert.equal(names("сыр").some((name) => /сыр(ые|ая)/i.test(name)), false);
  assert.equal(findReference("гречка").ambiguous, false, "boiled buckwheat waits until asked");
  assert.equal(findReference("огурцы").ambiguous, false, "pickles wait until asked, and 3 ккал mean nothing");
  assert.equal(findReference("молоко").ambiguous, true, "1%, 2% and 3,2% are far apart");
  assert.deepEqual(names("молоко 3,2%"), ["Молоко 3,2%"]);
  assert.deepEqual(names("картошка"), [], "the model asks with the usual name");
});

test("card check: a consistent card passes, a gap or a mismatch does not", () => {
  assert.equal(checkNutritionCard({ calories: 346, protein: 11.7, fat: 2.7, carbs: 64.7, fiber: 10.3 }).ok, true);
  assert.deepEqual(checkNutritionCard({ calories: 346, protein: 11.7, fat: null, carbs: 64.7 }).problems, ["нет жиров"]);
  const mismatch = checkNutritionCard({ calories: 120, protein: 20, fat: 10, carbs: 30 });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.problems[0], /выходит 290 ккал, а указано 120/);
});

test("card check: implausible numbers are rejected, tiny ones and fiber get room", () => {
  assert.match(checkNutritionCard({ calories: 950, protein: 0, fat: 105, carbs: 0 }).problems.join(), /больше 900[\s\S]*больше 100 г/);
  assert.equal(checkNutritionCard({ calories: 1, protein: 0, fat: 0, carbs: 0.3 }).ok, true, "tea");
  assert.equal(checkNutritionCard({ calories: 0, protein: 0, fat: 0, carbs: 0 }).ok, true, "salt");
  // Chia: without the fiber energy the estimate is 23% short.
  assert.equal(checkNutritionCard({ calories: 486, protein: 16.5, fat: 30.7, carbs: 7.7, fiber: 34.4 }).ok, true);
  assert.equal(checkNutritionCard({ calories: 486, protein: 16.5, fat: 30.7, carbs: 7.7 }).ok, false);
});

test("sources: the four labels, and older names keep their source", () => {
  const product = (source, catalogSource = "") => ({ nutrition: { calories: 1, source }, catalogSource });
  assert.equal(nutritionSourceLabel(product("Вы")), NUTRITION_SOURCES.user);
  assert.equal(nutritionSourceLabel(product("Введено пользователем")), "Вы");
  assert.equal(nutritionSourceLabel(product("Open Food Facts")), "Open Food Facts");
  assert.equal(nutritionSourceLabel(product("Встроенный справочник")), "Справочник");
  assert.equal(nutritionSourceLabel(product("Ассистент")), "Оценка ИИ");
  assert.equal(nutritionSourceLabel(product("", "Встроенный справочник")), "Справочник");
  assert.equal(nutritionSourceLabel({ nutrition: null }), "");
  assert.equal(openFoodFactsUrl("4600000000001"), "https://world.openfoodfacts.org/product/4600000000001");
  assert.equal(openFoodFactsUrl(""), "");
});

test("sources: a product from the old built-in list keeps its КБЖУ after loading", () => {
  const nutrition = { calories: 52, protein: 2.8, fat: 2.5, carbs: 4.7, fiber: 0, basis: "100 г/мл", source: "Встроенный справочник" };
  const data = openLocalData(memoryStorage({ schemaVersion: 12, products: [{ id: "product_milk", name: "Молоко 2,5%", unit: "л", catalogSource: "Встроенный справочник", nutrition }] }));
  const [milk] = data.load().products;
  assert.deepEqual({ ...milk.nutrition }, nutrition);
  assert.equal(nutritionSourceLabel(milk), "Справочник");
});
