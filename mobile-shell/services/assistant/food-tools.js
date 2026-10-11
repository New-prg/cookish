import { hasNutrition } from "../../core/filler.js";
import { checkNutritionCard } from "../../core/nutrition-check.js";
import { NUTRITION_SOURCES, nutritionSourceLabel } from "../../core/nutrition-source.js";
import { caloriesSpread, findReference, matchesQuery } from "../catalog/reference.js";
import { REFERENCE_FOODS } from "../catalog/reference-foods.js";

// The КБЖУ tools of the assistant and the Заполнитель (#64, #65): the model
// decides which product it is, the code carries the numbers of the card the
// model named and checks them, so the model cannot distort them.

const FIELDS = ["calories", "protein", "fat", "carbs", "fiber"];
const PERSON_FIELDS = ["calories", "protein", "fat", "carbs"];
const SOURCE_LABELS = Object.freeze({
  reference: NUTRITION_SOURCES.reference,
  off: NUTRITION_SOURCES.off,
  estimate: NUTRITION_SOURCES.estimate,
});
export const FOOD_SOURCES = Object.freeze(Object.keys(SOURCE_LABELS));

const AMBIGUOUS = "Кандидаты заметно расходятся по калориям. Не выбирай сам: спроси человека, какой именно продукт (вид, жирность, марка), или предложи отсканировать штрихкод.";

const queryParameters = { type: "object", properties: { query: { type: "string" } }, required: ["query"] };

export const FOOD_TOOLS = [
  { name: "find_reference", description: "Найти общий продукт без марки во встроенном справочнике: гречка, огурец, куриная грудка. До 5 кандидатов с id и КБЖУ на 100 г/мл. Ищи обычным названием (картофель, а не картошка).", parameters: queryParameters },
  { name: "search_food", description: "Найти товар с маркой в Open Food Facts. До 5 кандидатов: штрихкод, название, марка, КБЖУ на 100 г/мл и полнота карточки. Не чаще 10 поисков в минуту.", parameters: queryParameters },
  {
    name: "upsert_product",
    description: "Занести продукт в каталог или заполнить его КБЖУ (на 100 г/мл). source=reference — запись справочника по id из find_reference; source=off — товар Open Food Facts по штрихкоду из search_food; для них цифры берёт код. source=estimate — твоя оценка, только если ничего не нашлось: передай calories, protein, fat, carbs.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Название продукта, как в каталоге" },
        source: { type: "string", enum: FOOD_SOURCES },
        source_ref: { type: "string", description: "id справочника или штрихкод" },
        unit: { type: "string", enum: ["г", "мл", "шт."] },
        calories: { type: "number" },
        protein: { type: "number" },
        fat: { type: "number" },
        carbs: { type: "number" },
        fiber: { type: "number" },
      },
      required: ["name", "source"],
    },
  },
].map((tool) => ({ type: "function", function: tool }));

// What one run of the model has seen: Open Food Facts cards by barcode and
// the candidates of ambiguous searches. `catalog` is the catalog Service.
export function createFoodSession(catalog) {
  return { catalog, cards: new Map(), ambiguous: new Set() };
}

function per100(nutrition) {
  return Object.fromEntries(FIELDS.map((field) => {
    const value = nutrition?.[field];
    return [field, value === null || value === undefined || value === "" ? null : Number(value)];
  }));
}

export function findReferenceTool(args, session) {
  const { candidates, ambiguous } = findReference(String(args.query || ""));
  if (!candidates.length) return { ok: true, candidates: [], note: "В справочнике нет. Если у продукта есть марка, ищи search_food." };
  if (ambiguous) candidates.forEach((food) => session.ambiguous.add(`reference:${food.id}`));
  return {
    ok: true,
    ambiguous,
    candidates: candidates.map((food) => ({ id: food.id, name: food.name, unit: food.unit, per100: per100(food.nutrition) })),
    ...(ambiguous ? { note: AMBIGUOUS } : {}),
  };
}

export async function searchFoodTool(args, session) {
  const query = String(args.query || "").trim();
  let products;
  try {
    ({ products } = await session.catalog.search({ query }));
  } catch (error) {
    return { ok: false, error: error.message || "Open Food Facts не ответил." };
  }
  const cards = products.filter((card) => card.barcode).slice(0, 5);
  if (!cards.length) return { ok: true, candidates: [], note: "В Open Food Facts не нашлось. Уточни название или оцени КБЖУ сам (source=estimate)." };
  cards.forEach((card) => session.cards.set(card.barcode, card));
  // Cards that name every word of the query are the same product for the
  // person; if their calories differ, the person decides.
  const fitting = cards.filter((card) => hasNutrition(card) && matchesQuery(`${card.brand} ${card.name}`, query));
  const ambiguous = caloriesSpread(fitting.map((card) => card.nutrition.calories));
  if (ambiguous) fitting.forEach((card) => session.ambiguous.add(`off:${card.barcode}`));
  return {
    ok: true,
    ambiguous,
    candidates: cards.map((card) => ({ barcode: card.barcode, name: card.name, brand: card.brand, unit: card.unit, per100: per100(card.nutrition), complete: hasNutrition(card) })),
    ...(ambiguous ? { note: AMBIGUOUS } : {}),
  };
}

function checkedCard({ nutrition, ...rest }) {
  const values = per100(nutrition);
  const check = checkNutritionCard(values);
  if (!check.ok) return { ok: false, error: `Карточка не прошла проверку: ${check.problems.join("; ")}.`, hint: "Возьми следующего кандидата или другой источник." };
  return { ok: true, nutrition: values, ...rest };
}

// The card upsert_product puts into the catalog: { ok: true, nutrition,
// label, sourceRef, unit, barcode?, brand? } or { ok: false, error }.
export async function resolveCard(args, session) {
  const source = String(args.source || "");
  if (!FOOD_SOURCES.includes(source)) {
    return { ok: false, error: "Укажи source: reference (id из find_reference), off (штрихкод из search_food) или estimate (своя оценка)." };
  }
  const ref = String(args.source_ref || "").trim();
  if (session.ambiguous.has(`${source}:${ref}`)) return { ok: false, ambiguous: true, error: AMBIGUOUS };
  const label = SOURCE_LABELS[source];
  if (source === "reference") {
    const food = REFERENCE_FOODS.find((entry) => entry.id === ref);
    if (!food) return { ok: false, error: "В справочнике нет записи с таким id: возьми id из find_reference." };
    return checkedCard({ nutrition: food.nutrition, label, sourceRef: food.id, unit: food.unit });
  }
  if (source === "off") {
    if (!/^\d{8,14}$/.test(ref)) return { ok: false, error: "Для source=off нужен штрихкод из search_food." };
    let card = session.cards.get(ref);
    if (!card) {
      try {
        card = (await session.catalog.productByBarcode({ barcode: ref })).product;
      } catch (error) {
        return { ok: false, error: error.message || "Open Food Facts не ответил." };
      }
    }
    if (!card?.nutrition) return { ok: false, error: "В Open Food Facts нет КБЖУ для этого штрихкода." };
    return checkedCard({ nutrition: card.nutrition, label, sourceRef: ref, unit: card.unit, barcode: ref, brand: card.brand });
  }
  return checkedCard({ nutrition: Object.fromEntries(FIELDS.map((field) => [field, args[field]])), label, sourceRef: "", unit: "" });
}

// The new card changes КБЖУ the person typed: that takes the person's answer,
// never a silent write. Empty fields are filled without a question.
export function changesPersonValues(product, nutrition) {
  if (!product?.nutrition || nutritionSourceLabel(product) !== NUTRITION_SOURCES.user) return false;
  return PERSON_FIELDS.some((field) => {
    const own = product.nutrition[field];
    return own !== null && own !== undefined && own !== "" && Math.abs(Number(own) - Number(nutrition[field])) > 0.05;
  });
}
