import assert from "node:assert/strict";
import test from "node:test";

import { hasNutrition } from "../mobile-shell/core/filler.js";
import { NUTRITION_SOURCES } from "../mobile-shell/core/nutrition-source.js";
import { memoryStorage, openLocalData } from "../mobile-shell/core/local-data.js";

const FULL = { calories: 380, protein: 10, fat: 3, carbs: 78, fiber: null, source: NUTRITION_SOURCES.user };

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

// Cards as the Заполнитель Service sends them (#65).
const MILLET = { label: "Справочник", sourceRef: "millet", unit: "г", nutrition: { calories: 378, protein: 11, fat: 4.2, carbs: 64.4, fiber: 8.5 } };
const MILK = { label: "Open Food Facts", sourceRef: "4607050690021", barcode: "4607050690021", brand: "Простоквашино", unit: "л", nutrition: { calories: 54, protein: 3, fat: 2.5, carbs: 4.7, fiber: null } };
const MILK_FAT = { ...MILK, sourceRef: "4607050690038", barcode: "4607050690038", nutrition: { calories: 64, protein: 3, fat: 3.5, carbs: 4.7, fiber: null } };
const PIE = { label: "Оценка ИИ", sourceRef: "", nutrition: { calories: 250, protein: 5, fat: 10, carbs: 33 } };

function threeProducts() {
  const { data, storage, queued } = open();
  const millet = data.saveProduct({ name: "Пшено", unit: "г" }).productId;
  const milk = data.saveProduct({ name: "Молоко", unit: "л" }).productId;
  const pie = data.saveProduct({ name: "Пирог с визигой", unit: "г" }).productId;
  return { data, storage, queued, millet, milk, pie, product: (id) => data.snapshot().products.find((item) => item.id === id) };
}

test("filler: a batch writes cards as one change set, keeps the question, the estimate and the miss", () => {
  const { data, storage, queued, millet, milk, pie, product } = threeProducts();
  const result = data.applyFillerBatch({
    productIds: [millet, milk, pie],
    filled: [{ productId: millet, card: MILLET }],
    questions: [{ productId: milk, kind: "choose", candidates: [{ ...MILK, name: "Молоко 2,5%" }, { ...MILK_FAT, name: "Молоко 3,5%" }] }],
    proposals: [{ productId: pie, card: PIE }],
    misses: ["Пирог с визигой"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.filled, 1);
  assert.deepEqual([product(millet).nutrition.calories, product(millet).nutrition.source, product(millet).nutrition.sourceRef], [378, "Справочник", "millet"]);
  assert.deepEqual(queued(), [], "every product of the batch has an outcome");
  const { filler } = data.snapshot();
  assert.equal(filler.questions.length, 1);
  assert.equal(filler.questions[0].productId, milk);
  assert.deepEqual(filler.questions[0].candidates.map((card) => card.nutrition.calories), [54, 64]);
  assert.equal(filler.proposals.length, 1);
  assert.equal(filler.proposals[0].ops[0].product.nutrition.source, "Оценка ИИ");
  assert.equal(product(pie).nutrition, null, "an estimate waits for the person");
  assert.deepEqual(filler.misses.map((miss) => miss.name), ["Пирог с визигой"]);

  // «Отменить» undoes the written cards.
  assert.equal(data.revertChangeSet(result.changeSetId).ok, true);
  assert.equal(product(millet).nutrition, null);

  // Questions and estimates survive a restart.
  const reopened = openLocalData(storage).load();
  assert.equal(reopened.filler.questions.length, 1);
  assert.equal(reopened.filler.proposals.length, 1);
});

test("filler: the Core checks cards again and never overwrites КБЖУ the person typed", () => {
  const { data, millet, milk, product } = threeProducts();
  data.saveProduct({ id: milk, name: "Молоко", unit: "л", nutrition: { calories: 60, protein: 3, fat: 3.2, carbs: 4.7, source: "Вы" } });
  const result = data.applyFillerBatch({
    productIds: [millet, milk],
    filled: [
      { productId: millet, card: { ...MILLET, nutrition: { ...MILLET.nutrition, calories: 120 } } },
      { productId: milk, card: MILK },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(product(millet).nutrition, null, "a card that does not add up is not written");
  assert.equal(product(milk).nutrition.calories, 60);
  const [question] = data.snapshot().filler.questions;
  assert.equal(question.kind, "replace");
  assert.match(question.text, /Заменить/);
});

test("filler: a product without an outcome gets one more try, then waits for «Заполнить ИИ»", () => {
  const { data, queued, millet } = threeProducts();
  const all = queued();
  data.applyFillerBatch({ productIds: [millet] });
  assert.deepEqual(queued(), all, "one more try");
  assert.equal(data.snapshot().filler.queue.find((entry) => entry.productId === millet).attempts, 1);
  data.applyFillerBatch({ productIds: [millet] });
  assert.equal(queued().includes(millet), false);
  assert.equal(data.requestFilling(millet).ok, true);
  assert.equal(data.snapshot().filler.queue.find((entry) => entry.productId === millet).manual, true);
});

test("filler: the person answers with a variant, own words, a scan or a dismissal", () => {
  const { data, queued, milk, pie, product } = threeProducts();
  const ask = (productId) => data.applyFillerBatch({ productIds: [productId], questions: [{ productId, kind: "choose", candidates: [MILK, MILK_FAT] }] });
  const question = () => data.snapshot().filler.questions[0];

  ask(milk);
  assert.equal(data.answerFillerQuestion(question().id, { candidate: 1 }).ok, true);
  assert.equal(product(milk).nutrition.calories, 64);
  assert.deepEqual(data.snapshot().filler.questions, []);

  ask(pie);
  const words = data.answerFillerQuestion(question().id, { text: "без марки, домашний" });
  assert.equal(words.queued, true);
  assert.deepEqual(data.snapshot().filler.queue.filter((entry) => entry.productId === pie).map((entry) => [entry.manual, entry.hint]), [[true, "без марки, домашний"]]);

  ask(pie);
  assert.equal(data.answerFillerQuestion(question().id, { card: MILK }).ok, true, "a scanned card");
  assert.equal(product(pie).nutrition.source, "Open Food Facts");
  assert.equal(product(pie).barcode, MILK.barcode);

  const bread = data.saveProduct({ name: "Хлеб", unit: "г" }).productId;
  ask(bread);
  assert.equal(data.answerFillerQuestion(question().id, { dismiss: true }).ok, true);
  assert.equal(product(bread).nutrition, null);
  assert.deepEqual(data.snapshot().filler.questions, []);
  assert.equal(queued().includes(bread), false, "a dismissed product waits for «Заполнить ИИ»");
});

test("filler: a deleted product takes its question along; the switch keeps the queue", () => {
  const { data, milk, millet } = threeProducts();
  data.applyFillerBatch({ productIds: [milk], questions: [{ productId: milk, kind: "choose", candidates: [MILK, MILK_FAT] }] });
  data.removeProduct(milk);
  assert.deepEqual(data.snapshot().filler.questions, []);

  assert.equal(data.setFillerEnabled(false).ok, true);
  const { filler } = data.snapshot();
  assert.equal(filler.enabled, false);
  assert.ok(filler.queue.some((entry) => entry.productId === millet), "the queue keeps the products");
});
