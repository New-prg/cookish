// The bridge between the legacy catalog and Заполнитель services and product
// objects. The services speak the legacy product shape (`nutrition.calories`,
// a source label); product objects keep kcal100…fiber100 and a source key.
// Everything here is plain data in, data or ops out, so it runs in node.
import { REQUIRED_NUTRITION_FIELDS, changesPersonValues, checkedCard, hasNutrition } from "../../core/filler.js";
import { NUTRITION_SOURCES } from "../../core/nutrition-source.js";
import { normalizeProductName } from "../../core/ration-domain.js";
import { findReference } from "../../services/catalog/reference.js";
import { objectsOfType } from "./values.js";

// Legacy nutrition fields and the relations that hold them.
const NUTRIENTS = Object.freeze({ calories: "kcal100", protein: "protein100", fat: "fat100", carbs: "carbs100", fiber: "fiber100" });

const KEY_BY_LABEL = Object.freeze({
  [NUTRITION_SOURCES.user]: "person",
  [NUTRITION_SOURCES.off]: "off",
  [NUTRITION_SOURCES.reference]: "reference",
  [NUTRITION_SOURCES.estimate]: "estimate",
});
const LABEL_BY_KEY = Object.freeze(Object.fromEntries(Object.entries(KEY_BY_LABEL).map(([label, key]) => [key, label])));

const finite = (value) => (value === "" || value == null || !Number.isFinite(Number(value)) ? null : Number(value));

// The same name rule as resolveOrCreateProduct in the legacy Рацион: trimmed,
// lower case, inner spaces collapsed. An archived product is not a match.
export function findProductByName(state, name) {
  const key = normalizeProductName(name);
  if (!key) return null;
  return objectsOfType(state, "product").find((product) => normalizeProductName(product.name) === key) || null;
}

// Cards: what a person picks from. One shape for the reference, Open Food
// Facts and the Заполнитель; `label` is the legacy source name, which
// checkedCard() of the legacy Core accepts.
function nutritionOf(nutrition) {
  if (!nutrition) return null;
  return Object.fromEntries(Object.keys(NUTRIENTS).map((field) => [field, finite(nutrition[field])]));
}

export function referenceCard(food) {
  return { source: "reference", label: NUTRITION_SOURCES.reference, sourceRef: food.id, name: food.name, brand: "", barcode: "", unit: food.unit || "г", category: food.category || "", nutrition: nutritionOf(food.nutrition) };
}

// A card of the catalog Service (Open Food Facts).
export function offCard(product) {
  return { source: "off", label: NUTRITION_SOURCES.off, sourceRef: product.barcode || "", name: product.name || "", brand: product.brand || "", barcode: product.barcode || "", unit: product.unit || "г", category: product.category || "", nutrition: nutritionOf(product.nutrition) };
}

export function referenceCards(query) {
  return findReference(String(query || "")).candidates.map(referenceCard);
}

// Open Food Facts by name, or by barcode when the query is 8-14 digits.
// { cards, problem }: a failed search keeps the reference results alive.
export async function offCards(catalog, query) {
  const text = String(query || "").trim();
  try {
    if (/^\d{8,14}$/.test(text)) {
      const { product } = await catalog.productByBarcode({ barcode: text });
      return { cards: product ? [offCard(product)] : [], problem: product ? "" : "В Open Food Facts нет товара с таким штрихкодом." };
    }
    const { products } = await catalog.search({ query: text });
    return { cards: products.map(offCard), problem: "" };
  } catch (error) {
    return { cards: [], problem: error?.message || "Open Food Facts не ответил." };
  }
}

export const isBarcode = (text) => /^\d{8,14}$/.test(String(text || "").trim());
export const cardIsFull = (card) => hasNutrition(card);

// Values of a card as the relations that hold them. A nutrient the card does
// not know is cleared (null): numbers of two sources are never mixed.
export function cardProps(card) {
  const props = {};
  for (const [field, key] of Object.entries(NUTRIENTS)) props[key] = finite(card.nutrition?.[field]);
  const source = KEY_BY_LABEL[card.label];
  if (source) props.nutritionSource = source;
  if (card.barcode) props.barcode = card.barcode;
  return props;
}

// Writes a card into an existing product. The brand of the card fills an
// empty brand only, as withCard() of the legacy Core does. `confirmed`:
// true when the person picked the card, false for an estimate, left out when
// the Заполнитель filled it (legacy leaves the flag alone).
export function cardOps(state, productId, card, { confirmed } = {}) {
  const props = cardProps(card);
  if (card.brand && !state.objects[productId]?.props?.brand) props.brand = card.brand;
  if (confirmed !== undefined) props.confirmed = confirmed;
  return { op: "update", id: productId, props };
}

// A new product from a card, with the unit and category the card names.
export function createOp(state, card) {
  const unit = (state.relations.unit?.options || []).some((option) => option.id === card.unit) ? card.unit : "г";
  const props = { ...cardProps(card), unit, confirmed: true };
  if (card.category) props.category = String(card.category).slice(0, 60);
  if (card.brand) props.brand = card.brand;
  const clean = Object.fromEntries(Object.entries(props).filter(([, value]) => value != null));
  return { op: "create", type: "product", name: card.name, props: clean };
}

// A product object in the shape the Заполнитель takes: { id, name, unit,
// nutrition, hint }. КБЖУ typed by the person carry the label «Вы», which
// the Заполнитель never overwrites without a question.
export function legacyProduct(obj, hint = "") {
  const props = obj.props || {};
  const values = Object.fromEntries(Object.entries(NUTRIENTS).map(([field, key]) => [field, finite(props[key])]));
  const known = Object.values(values).some((value) => value != null);
  return {
    id: obj.id,
    name: obj.name,
    unit: props.unit || "г",
    nutrition: known ? { ...values, vitamins: "", minerals: "", basis: "100 г/мл", source: LABEL_BY_KEY[props.nutritionSource] || NUTRITION_SOURCES.user } : null,
    hint,
  };
}

export const needsNutrition = (obj) => finite(obj.props?.kcal100) == null;

// Live products without КБЖУ, one per name: the Заполнитель matches by name,
// so a second product of the same name would take the first one's answer.
export function productsToFill(state) {
  const seen = new Set();
  return objectsOfType(state, "product")
    .filter(needsNutrition)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .filter((obj) => {
      const key = normalizeProductName(obj.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// The Core's second look at an answer of the Заполнитель, as applyFillerBatch
// does in the legacy Core: every card is checked again, a card that would
// change КБЖУ the person typed becomes a question, and a dead product gets
// nothing. Returns
//   filled     [{ productId, card }]  reference and Open Food Facts cards to write
//   cards      [{ productId, card }]  estimates for the person to apply
//   questions  [{ productId, kind: "choose" | "replace", candidates: [card] }]
export function planFill(state, result) {
  const alive = (id) => {
    const obj = state.objects[id];
    return obj && obj.type === "product" && !obj.archivedAt ? obj : null;
  };
  const plan = { filled: [], cards: [], questions: [] };
  const settled = new Set();
  const take = (productId) => {
    const obj = alive(productId);
    if (!obj || settled.has(productId)) return null;
    settled.add(productId);
    return obj;
  };
  for (const entry of result.filled || []) {
    const card = checkedCard(entry.card);
    const obj = card && card.label !== NUTRITION_SOURCES.estimate ? take(entry.productId) : null;
    if (!obj) continue;
    if (changesPersonValues(legacyProduct(obj), card.nutrition)) plan.questions.push({ productId: obj.id, kind: "replace", candidates: [{ ...card, name: obj.name }] });
    else plan.filled.push({ productId: obj.id, card: { ...card, name: obj.name } });
  }
  for (const entry of result.proposals || []) {
    const card = checkedCard(entry.card);
    const obj = card ? take(entry.productId) : null;
    if (obj) plan.cards.push({ productId: obj.id, card: { ...card, name: obj.name } });
  }
  for (const entry of result.questions || []) {
    const obj = alive(entry.productId);
    const candidates = (entry.candidates || []).flatMap((candidate) => {
      const card = checkedCard(candidate);
      return card ? [{ ...card, name: String(candidate.name || obj?.name || "") }] : [];
    }).slice(0, 3);
    if (obj && candidates.length && take(entry.productId)) plan.questions.push({ productId: obj.id, kind: entry.kind === "replace" ? "replace" : "choose", candidates });
  }
  return plan;
}

// One Заполнитель call for products of the space: { ok: true, ...plan,
// tried: [id] } or { ok: false, reason }. `filler` is the filler Service.
export async function fillProducts({ filler, state, ids, hints = {} }) {
  const products = ids.flatMap((id) => (state.objects[id] ? [legacyProduct(state.objects[id], hints[id] || "")] : []));
  if (!products.length) return { ok: true, filled: [], cards: [], questions: [], tried: [] };
  const result = await filler.fill({ products });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, ...planFill(state, result), tried: products.map((product) => product.id) };
}

// «120 ккал · Б 3 · Ж 2,5 · У 4,7» for a card or a product's relations.
const amount = (value) => Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
export function nutritionLine(nutrition) {
  if (!nutrition || REQUIRED_NUTRITION_FIELDS.every((field) => finite(nutrition[field]) == null)) return "нет КБЖУ";
  const part = (prefix, value) => (finite(value) == null ? `${prefix} —` : `${prefix} ${amount(value)}`);
  return `${finite(nutrition.calories) == null ? "— ккал" : `${amount(nutrition.calories)} ккал`} · ${part("Б", nutrition.protein)} · ${part("Ж", nutrition.fat)} · ${part("У", nutrition.carbs)}`;
}

export const nutritionOfProduct = (obj) => legacyProduct(obj).nutrition;
