import assert from "node:assert/strict";
import { test } from "node:test";
import { openObjectStore } from "../mobile-shell/objects/core/store.js";
import {
  cardOps, createOp, fillProducts, findProductByName, legacyProduct, needsNutrition, nutritionLine,
  offCards, planFill, productsToFill, referenceCards,
} from "../mobile-shell/objects/core/catalog.js";
import { resolveOrCreateProduct } from "../mobile-shell/core/ration-domain.js";
import { createMockProvider } from "../mobile-shell/services/assistant/ai-provider.js";
import { createCatalogService } from "../mobile-shell/services/catalog/catalog.js";
import { createFillerService } from "../mobile-shell/services/filler/filler-service.js";

const TODAY = "2026-10-19";
const open = () => {
  let n = 0;
  return openObjectStore({ storage: null, today: () => TODAY, idFactory: (p) => `${p}_${++n}` });
};
const product = (store, id, name, props = {}) => {
  const result = store.apply({ op: "create", type: "product", id, name, props });
  assert.equal(result.ok, true, result.reason);
};
const props = (store, id) => store.state().objects[id].props;

const MILK = {
  code: "4607050690021",
  product_name_ru: "Молоко питьевое 2,5%",
  brands: "Простоквашино",
  quantity: "930 мл",
  nutriments: { "energy-kcal_100g": 54, proteins_100g: 3, fat_100g: 2.5, carbohydrates_100g: 4.7, fiber_100g: 0 },
};
const fakeFetch = (products = [MILK]) => async (url) => {
  const body = String(url).includes("/api/v2/product/")
    ? { status: products.length ? 1 : 0, product: products[0] }
    : { products };
  return { ok: true, status: 200, json: async () => body };
};
const catalogOf = (products) => createCatalogService({ fetchImpl: fakeFetch(products) });

let sequence = 0;
const call = (name, args) => ({ id: `call_${sequence += 1}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const fillerOf = (turns, products) => {
  const provider = createMockProvider((request, index) => turns[index] ?? { role: "assistant", content: "" });
  return { provider, filler: createFillerService({ providerFor: () => provider, catalog: catalogOf(products) }) };
};

test("findProductByName uses the name rule of resolveOrCreateProduct and skips archived products", () => {
  const store = open();
  product(store, "buck", "Гречка ядрица");
  product(store, "gone", "Рис");
  store.archive("gone");
  const legacy = { products: [{ id: "buck", name: "Гречка ядрица" }] };
  for (const name of ["Гречка ядрица", "  гречка   ядрица ", "ГРЕЧКА ЯДРИЦА", "Гречка", "Гречка ядрицa 2", "", "   "]) {
    const hit = findProductByName(store.state(), name);
    const legacyHit = name.trim() ? resolveOrCreateProduct(structuredClone(legacy), { name }, "t", "a").id === "buck" : false;
    assert.equal(Boolean(hit), legacyHit, `«${name}»`);
  }
  assert.equal(findProductByName(store.state(), "рис"), null, "an archived product is not a duplicate");
});

test("a reference card fills the product: kcal100…fiber100, source, confirmed; the brand is kept", () => {
  const store = open();
  product(store, "p", "Гречка", { brand: "Мистраль", fiber100: 99, kcal100: 1 });
  const [card] = referenceCards("гречка");
  assert.equal(card.name, "Гречка ядрица");
  const result = store.apply(cardOps(store.state(), "p", { ...card, brand: "Другой" }, { confirmed: true }), { actor: "human" });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(props(store, "p"), { brand: "Мистраль", kcal100: 346, protein100: 11.7, fat100: 2.7, carbs100: 64.7, fiber100: 10.3, nutritionSource: "reference", confirmed: true });
});

test("an Open Food Facts card brings brand and barcode; a nutrient it lacks is cleared, not mixed", async () => {
  const store = open();
  product(store, "m", "Молоко", { fiber100: 5 });
  const { cards, problem } = await offCards(catalogOf(), "молоко простоквашино");
  assert.equal(problem, "");
  assert.equal(cards[0].label, "Open Food Facts");
  assert.equal(cards[0].barcode, MILK.code);
  const result = store.apply(cardOps(store.state(), "m", { ...cards[0], nutrition: { ...cards[0].nutrition, fiber: null } }, { confirmed: true }), { actor: "human" });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(props(store, "m"), { kcal100: 54, protein100: 3, fat100: 2.5, carbs100: 4.7, brand: "Простоквашино", barcode: MILK.code, nutritionSource: "off", confirmed: true });
});

test("a barcode of 8-14 digits is looked up as a barcode; a miss and a failure come back as a problem, not a throw", async () => {
  const found = await offCards(catalogOf(), MILK.code);
  assert.equal(found.cards.length, 1);
  assert.equal(found.cards[0].name, "Молоко питьевое 2,5%");
  const none = await offCards(catalogOf([]), MILK.code);
  assert.deepEqual([none.cards.length, none.problem], [0, "В Open Food Facts нет товара с таким штрихкодом."]);
  const down = await offCards(createCatalogService({ fetchImpl: async () => { throw new Error("offline"); } }), "молоко");
  assert.deepEqual(down.cards, []);
  assert.match(down.problem, /Нет связи с Open Food Facts/);
});

test("a new product from a card carries unit, category and brand, and the store accepts it", () => {
  const store = open();
  const [water] = referenceCards("вода");
  const card = water || referenceCards("кефир")[0];
  const made = store.apply(createOp(store.state(), { ...card, brand: "Х" }), { actor: "human" });
  assert.equal(made.ok, true, made.reason);
  const created = store.state().objects[made.ids[0]];
  assert.equal(created.name, card.name);
  assert.equal(created.props.confirmed, true);
  assert.equal(created.props.nutritionSource, "reference");
  assert.ok(["г", "л"].includes(created.props.unit));
  assert.equal(findProductByName(store.state(), card.name.toUpperCase())?.id, created.id, "the next pick of this name finds the product instead of a duplicate");
});

test("the legacy shape: КБЖУ typed by the person are labelled «Вы», empty ones are null", () => {
  const store = open();
  product(store, "own", "Пшено", { kcal100: 300, protein100: 10, fat100: 3, carbs100: 60 });
  product(store, "off", "Молоко", { kcal100: 54, protein100: 3, fat100: 2.5, carbs100: 4.7, nutritionSource: "off", unit: "мл" });
  product(store, "none", "Соль");
  const state = store.state();
  assert.equal(legacyProduct(state.objects.own).nutrition.source, "Вы");
  assert.equal(legacyProduct(state.objects.off).nutrition.source, "Open Food Facts");
  assert.equal(legacyProduct(state.objects.off).unit, "мл");
  assert.equal(legacyProduct(state.objects.none).nutrition, null);
  assert.equal(legacyProduct(state.objects.none, "соль поваренная").hint, "соль поваренная");
  assert.deepEqual([needsNutrition(state.objects.own), needsNutrition(state.objects.none)], [false, true]);
  assert.equal(nutritionLine(legacyProduct(state.objects.off).nutrition), "54 ккал · Б 3 · Ж 2,5 · У 4,7");
  assert.equal(nutritionLine(null), "нет КБЖУ");
});

test("productsToFill: products with an empty kcal100, one per name, no archived", () => {
  const store = open();
  product(store, "a", "Соль");
  product(store, "b", "соль ");
  product(store, "c", "Перец");
  product(store, "d", "Мука");
  product(store, "e", "Сахар", { kcal100: 400 });
  store.archive("d");
  assert.deepEqual(productsToFill(store.state()).map((obj) => obj.id), ["c", "a"]);
});

test("the Заполнитель over product objects: cards are written, estimates and questions wait and write nothing", async () => {
  const store = open();
  product(store, "millet", "Пшено");
  product(store, "milk", "Молоко Простоквашино 2,5%");
  product(store, "plain", "Молоко");
  product(store, "odd", "Эликсир бодрости");
  const { provider, filler } = fillerOf([
    { role: "assistant", content: "", tool_calls: [
      call("find_reference", { query: "пшено" }),
      call("search_food", { query: "Простоквашино молоко 2,5%" }),
      call("find_reference", { query: "молоко" }),
    ] },
    { role: "assistant", content: "", tool_calls: [
      call("upsert_product", { name: "Пшено", source: "reference", source_ref: "millet" }),
      call("upsert_product", { name: "Молоко Простоквашино 2,5%", source: "off", source_ref: MILK.code }),
      call("upsert_product", { name: "Молоко", source: "reference", source_ref: "milk-2" }),
      call("upsert_product", { name: "Эликсир бодрости", source: "estimate", calories: 250, protein: 5, fat: 10, carbs: 33 }),
    ] },
  ], [MILK]);
  const before = store.state();
  const out = await fillProducts({ filler, state: before, ids: ["millet", "milk", "plain", "odd"] });
  assert.equal(out.ok, true);
  assert.equal(store.state(), before, "planning writes nothing");
  assert.deepEqual(out.filled.map((entry) => [entry.productId, entry.card.label, entry.card.nutrition.calories]), [["millet", "Справочник", 378], ["milk", "Open Food Facts", 54]]);
  assert.deepEqual(out.cards.map((entry) => [entry.productId, entry.card.label]), [["odd", "Оценка ИИ"]]);
  assert.equal(out.questions.length, 1);
  assert.equal(out.questions[0].productId, "plain");
  assert.equal(out.questions[0].kind, "choose");
  assert.ok(out.questions[0].candidates.length >= 2 && out.questions[0].candidates.length <= 3);
  assert.deepEqual(provider.requests[0].messages.at(-1).content.match(/"hint"/), null, "no hint unless the person gave one");

  const wrote = store.apply(out.filled.map(({ productId, card }) => cardOps(store.state(), productId, card)), { actor: "ai", summary: "КБЖУ" });
  assert.equal(wrote.ok, true, wrote.reason);
  assert.deepEqual(props(store, "millet"), { kcal100: 378, protein100: 11, fat100: 4.2, carbs100: 64.4, fiber100: 8.5, nutritionSource: "reference" });
  assert.equal(props(store, "milk").barcode, MILK.code);
  assert.equal(props(store, "milk").brand, "Простоквашино");
  assert.equal(props(store, "odd").kcal100, undefined, "an estimate waits for the person");

  const [estimate] = out.cards;
  store.apply(cardOps(store.state(), estimate.productId, estimate.card, { confirmed: false }), { actor: "human" });
  assert.equal(props(store, "odd").nutritionSource, "estimate");
  assert.equal(props(store, "odd").confirmed, false);

  const picked = out.questions[0].candidates[0];
  store.apply(cardOps(store.state(), "plain", picked), { actor: "human" });
  assert.equal(props(store, "plain").kcal100, picked.nutrition.calories);
  assert.equal(props(store, "plain").confirmed, undefined, "an answer of the Заполнитель leaves the flag alone, as legacy does");
});

test("a hint of the person reaches the Заполнитель", async () => {
  const store = open();
  product(store, "t", "Творог");
  const { provider, filler } = fillerOf([{ role: "assistant", content: "" }], []);
  await fillProducts({ filler, state: store.state(), ids: ["t"], hints: { t: "5%" } });
  assert.match(provider.requests[0].messages.at(-1).content, /"hint":"5%"/);
});

test("КБЖУ typed by the person are never replaced silently: the card becomes a question", async () => {
  const store = open();
  product(store, "millet", "Пшено", { kcal100: 300, protein100: 10, fat100: 3, carbs100: 60 });
  product(store, "free", "Греча");
  const { filler } = fillerOf([
    { role: "assistant", content: "", tool_calls: [call("find_reference", { query: "пшено" })] },
    { role: "assistant", content: "", tool_calls: [call("upsert_product", { name: "Пшено", source: "reference", source_ref: "millet" })] },
  ], []);
  const out = await fillProducts({ filler, state: store.state(), ids: ["millet"] });
  assert.deepEqual(out.filled, []);
  assert.equal(out.questions[0].kind, "replace");
  assert.equal(out.questions[0].candidates[0].nutrition.calories, 378);
  assert.equal(props(store, "millet").kcal100, 300);

  // The Core looks again: a card from a service that skipped the question is a question here too.
  const plan = planFill(store.state(), { filled: [{ productId: "millet", card: { label: "Справочник", sourceRef: "millet", nutrition: { calories: 378, protein: 11, fat: 4.2, carbs: 64.4, fiber: null } } }] });
  assert.deepEqual([plan.filled.length, plan.questions[0].kind], [0, "replace"]);
});

test("planFill drops cards that fail the check, unknown labels and dead products", () => {
  const store = open();
  product(store, "a", "Соль");
  product(store, "b", "Перец");
  product(store, "c", "Мука");
  store.archive("c");
  const good = { label: "Справочник", sourceRef: "x", nutrition: { calories: 100, protein: 10, fat: 1, carbs: 12, fiber: null } };
  const plan = planFill(store.state(), {
    filled: [
      { productId: "a", card: { ...good, nutrition: { ...good.nutrition, calories: 5000 } } },
      { productId: "b", card: { ...good, label: "Из головы" } },
      { productId: "c", card: good },
      { productId: "nobody", card: good },
    ],
    proposals: [{ productId: "a", card: { ...good, label: "Оценка ИИ" } }],
    questions: [],
  });
  assert.deepEqual(plan.filled, []);
  assert.deepEqual(plan.cards.map((entry) => entry.productId), ["a"], "the broken card of «a» is gone, its estimate stays");
});
