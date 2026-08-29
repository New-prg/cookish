import assert from "node:assert/strict";
import test from "node:test";

import {
  executeRationCommand,
  migrateRationState,
  readRationDayNutrition,
  validateRationProfile,
} from "../mobile-shell/ration-domain.js";
import { memoryStorage, openLocalData } from "../mobile-shell/local-data.js";

function historyState() {
  return migrateRationState({
    schemaVersion: 11,
    user: { email: "a@example.com" },
    products: [
      { id: "product_water", name: "Вода", unit: "л", updatedAt: "2026-08-01T00:00:00.000Z", updatedBy: "a@example.com" },
      { id: "product_bread", name: "Хлеб", unit: "шт.", updatedAt: "2026-08-01T00:00:00.000Z", updatedBy: "a@example.com" },
    ],
    requests: [],
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
    },
    rationTemplates: [],
  });
}

const HISTORY_CTX = { now: "2026-08-04T12:00:00.000Z", today: "2026-08-04", actor: "a@example.com" };

test("ration profile stores fields and validates separately", () => {
  const state = historyState();
  const result = executeRationCommand(state, {
    type: "setRationProfile",
    fields: { ageGroup: "adult", heightCm: 180, weightKg: 80, goal: "keep", mealsPerDay: 3 },
  }, HISTORY_CTX);

  assert.equal(result.ok, true);
  assert.equal(result.profile.ageGroup, "adult");
  assert.equal(result.validation.ok, false);
  assert.deepEqual(result.validation.missing, ["targetCalories"]);
  assert.deepEqual(result.validation.violations, []);
  assert.equal(result.state.ration.profile.weightKg, 80);
  assert.equal(result.state.ration.profile.updatedBy, "a@example.com");

  const migrated = migrateRationState(structuredClone(result.state));
  assert.equal(migrated.ration.profile.ageGroup, "adult");
});

test("profile validation reports violations for impossible constraints", () => {
  const empty = validateRationProfile({});
  assert.equal(empty.ok, false);
  assert.ok(empty.missing.includes("ageGroup"));
  assert.ok(empty.missing.includes("targetCalories"));

  const impossible = validateRationProfile({
    ageGroup: "adult", goal: "lose", heightCm: 400, weightKg: -5, mealsPerDay: 0,
    targetCalories: 2000, targetProtein: 100, targetFat: 500, targetCarbs: 100,
  });
  assert.equal(impossible.ok, false);
  assert.deepEqual(impossible.missing, []);
  assert.ok(impossible.violations.includes("heightCm"));
  assert.ok(impossible.violations.includes("weightKg"));
  assert.ok(impossible.violations.includes("mealsPerDay"));
  assert.ok(impossible.violations.includes("macroMismatch"));

  const valid = validateRationProfile({
    ageGroup: "adult", goal: "keep", heightCm: 180, weightKg: 80, mealsPerDay: 3,
    targetCalories: 2000, targetProtein: 100, targetFat: 70, targetCarbs: 220,
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.violations, []);
});

test("nutrition computes grams, milliliters and liters deterministically", () => {
  const data = openLocalData(memoryStorage());
  data.load();
  const meal = data.addRationMeal("2026-08-05");
  const rice = data.addRationFood("2026-08-05", meal.mealId);
  const milk = data.addRationFood("2026-08-05", meal.mealId);
  data.saveRationFood("2026-08-05", meal.mealId, rice.itemId, { name: "Рис" });
  data.saveRationFood("2026-08-05", meal.mealId, milk.itemId, { name: "Молоко" });
  data.setRationPortion("2026-08-05", meal.mealId, rice.itemId, { portionSize: 200, packageSize: 1000, measureUnit: "г" });
  data.setRationPortion("2026-08-05", meal.mealId, milk.itemId, { portionSize: 0.5, packageSize: 1, measureUnit: "л" });
  const riceId = data.snapshot().products.find((product) => product.name === "Рис").id;
  const milkId = data.snapshot().products.find((product) => product.name === "Молоко").id;

  data.saveProduct({ id: riceId, name: "Рис", unit: "г", nutrition: { calories: 350, protein: 7, fat: 1, carbs: 78, fiber: 1.3 } });
  data.saveProduct({ id: milkId, name: "Молоко", unit: "л", nutrition: { calories: 60, protein: 3, fat: 3.2, carbs: 4.8, fiber: null } });

  const first = readRationDayNutrition(data.snapshot(), "2026-08-05");
  const second = readRationDayNutrition(data.snapshot(), "2026-08-05");
  assert.deepEqual(first, second);
  assert.equal(first.perMeal.length, 1);
  assert.equal(first.totals.calories, 1000);
  assert.equal(first.totals.protein, 29);
  assert.equal(first.totals.fat, 18);
  assert.equal(first.totals.carbs, 180);
  assert.equal(first.totals.fiber, 2.6);
  const missingFields = first.missing.filter((entry) => entry.reason === "nutrient_unknown").map((entry) => entry.field);
  assert.deepEqual(missingFields, ["fiber"]);
});

test("nutrition marks piece portions and unknown products as missing", () => {
  const data = openLocalData(memoryStorage());
  data.load();
  const meal = data.addRationMeal("2026-08-05");
  const eggs = data.addRationFood("2026-08-05", meal.mealId);
  const mystery = data.addRationFood("2026-08-05", meal.mealId);
  data.setRationPortion("2026-08-05", meal.mealId, eggs.itemId, { portionSize: 2, packageSize: 10, measureUnit: "шт." });
  data.saveRationFood("2026-08-05", meal.mealId, eggs.itemId, { name: "Яйца" });
  data.saveRationFood("2026-08-05", meal.mealId, mystery.itemId, { name: "Неизвестный деликатес" });
  data.setRationPortion("2026-08-05", meal.mealId, mystery.itemId, { portionSize: 50, packageSize: 100, measureUnit: "г" });

  const result = readRationDayNutrition(data.snapshot(), "2026-08-05");
  assert.equal(result.totals.calories, 0);
  const reasons = result.missing.map((entry) => entry.reason);
  assert.ok(reasons.includes("piece_weight_unknown"));
  assert.ok(reasons.includes("no_nutrition"));
  assert.equal(result.perMeal.length, 1);
});

test("nutrition recalculates after the product card is corrected", () => {
  const data = openLocalData(memoryStorage());
  data.load();
  const meal = data.addRationMeal("2026-08-05");
  const item = data.addRationFood("2026-08-05", meal.mealId);
  data.saveRationFood("2026-08-05", meal.mealId, item.itemId, { name: "Творог" });
  data.setRationPortion("2026-08-05", meal.mealId, item.itemId, { portionSize: 100, packageSize: 200, measureUnit: "г" });
  const productId = data.snapshot().products.find((product) => product.name === "Творог").id;
  data.saveProduct({ id: productId, name: "Творог", unit: "г", nutrition: { calories: 100, protein: 15, fat: 5, carbs: 3, fiber: 0 } });

  const before = readRationDayNutrition(data.snapshot(), "2026-08-05");
  assert.equal(before.totals.calories, 100);
  assert.equal(before.totals.protein, 15);

  data.saveProduct({ id: productId, name: "Творог", unit: "г", nutrition: { calories: 120, protein: 18, fat: 5, carbs: 3, fiber: 0 } });
  const after = readRationDayNutrition(data.snapshot(), "2026-08-05");
  assert.equal(after.totals.calories, 120);
  assert.equal(after.totals.protein, 18);
});

test("nutrition projection flags unknown cards on past and future days", () => {
  const state = historyState();
  const past = readRationDayNutrition(state, "2026-08-03");
  const future = readRationDayNutrition(state, "2026-08-10");
  assert.ok(past.perMeal.length >= 1);
  assert.ok(future.perMeal.length >= 1);
  assert.ok(future.missing.some((entry) => entry.reason === "no_nutrition"));
  assert.ok(future.totals.calories === 0);
});
