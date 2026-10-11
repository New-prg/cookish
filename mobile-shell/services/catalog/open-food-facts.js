import { genericKeyFromParts, normalizeProductName } from "../../core/ration-domain.js";
import { ServiceError } from "../service-error.js";

// Open Food Facts: product cards by barcode and a search by name. The client
// gets normalized cards; the raw Open Food Facts product never leaves the
// Service. `fetchImpl` is the platform fetch: the WebView's in the app,
// Node's on a server.

export const OPEN_FOOD_FACTS_ORIGIN = "https://world.openfoodfacts.org";
export const OPEN_FOOD_FACTS_SEARCH_LIMIT = 3;

const FIELDS = [
  "code", "product_name", "product_name_ru", "generic_name_ru", "brands", "quantity",
  "categories", "categories_tags", "nutriments", "ingredients_text_ru", "ingredients_text",
].join(",");

export function createOpenFoodFacts({ fetchImpl }) {
  async function getJson(url) {
    let response;
    try {
      response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    } catch {
      throw new ServiceError("network", "Нет связи с Open Food Facts. Проверьте интернет.");
    }
    if (!response.ok) throw new ServiceError("unavailable", `Open Food Facts не ответил (${response.status}). Попробуйте позже.`);
    try {
      return await response.json();
    } catch {
      throw new ServiceError("bad_response", "Open Food Facts прислал непонятный ответ.");
    }
  }

  return {
    async search(query) {
      const params = new URLSearchParams({
        search_terms: query, search_simple: "1", action: "process", json: "1",
        page_size: String(OPEN_FOOD_FACTS_SEARCH_LIMIT), fields: FIELDS,
      });
      const body = await getJson(`${OPEN_FOOD_FACTS_ORIGIN}/cgi/search.pl?${params}`);
      return (body.products || []).map(openFoodFactsSuggestion).filter(Boolean);
    },
    // The card for a barcode, or null when Open Food Facts has no such product.
    async product(barcode) {
      const body = await getJson(`${OPEN_FOOD_FACTS_ORIGIN}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`);
      return body.status === 1 && body.product ? openFoodFactsCard(body.product) : null;
    },
  };
}

// A card keeps what Open Food Facts knows even without a name: the product
// form still takes the unit, the category and the nutrition from it.
export function openFoodFactsCard(product) {
  const name = String(product.product_name_ru || product.product_name || product.generic_name_ru || "").trim();
  const brand = Array.isArray(product.brands) ? product.brands.join(", ") : String(product.brands || "").trim();
  const category = openFoodFactsCategory(product);
  const genericName = String(product.generic_name_ru || product.generic_name || "").trim();
  return {
    id: `off_${product.code || normalizeProductName(name)}`,
    name,
    brand,
    category,
    genericKey: genericKeyFromParts(category, genericName || name),
    kind: product.code ? "sku" : "generic",
    unit: openFoodFactsUnit(product),
    barcode: String(product.code || ""),
    ingredients: String(product.ingredients_text_ru || product.ingredients_text || "").trim(),
    nutrition: openFoodFactsNutrition(product),
    catalogSource: "Open Food Facts",
    confirmed: false,
  };
}

export function openFoodFactsSuggestion(product) {
  const card = openFoodFactsCard(product);
  return card.name ? card : null;
}

function formatAmount(value) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

function finiteNutrient(value) {
  const result = Number(value);
  return value === "" || value == null || !Number.isFinite(result) ? null : result;
}

export function openFoodFactsUnit(product) {
  const water = (product.categories_tags || []).some((tag) => /water/i.test(tag));
  const quantity = String(product.quantity || "").toLowerCase();
  // `\b` treats Cyrillic letters as non-word characters, so match unit tokens explicitly.
  const hasUnit = (units) => new RegExp(`(^|[^a-zа-яё])(${units})($|[^a-zа-яё])`).test(quantity);
  if (water || hasUnit("ml|мл|l|л")) return "л";
  if (hasUnit("kg|кг")) return "кг";
  if (hasUnit("g|г")) return "г";
  return "шт.";
}

export function openFoodFactsCategory(product) {
  const tags = (product.categories_tags || []).join(" ").toLowerCase();
  const categories = String(product.categories || "").toLowerCase();
  const value = `${tags} ${categories}`;
  if (/water|beverage|drink/.test(value)) return "Напитки";
  if (/milk|dairy|cheese|yogurt|кефир|молоч/.test(value)) return "Молочные продукты";
  if (/fruit/.test(value)) return "Фрукты";
  if (/vegetable/.test(value)) return "Овощи";
  if (/meat|poultry/.test(value)) return "Мясо и птица";
  if (/fish|seafood/.test(value)) return "Рыба и морепродукты";
  if (/bread|bakery/.test(value)) return "Хлеб и выпечка";
  return product.categories ? String(product.categories).split(",")[0].trim() : "";
}

function openFoodFactsNutrientText(nutriments, definitions) {
  return Object.entries(definitions).flatMap(([key, [label, multiplier, unit]]) => {
    const value = finiteNutrient(nutriments[key]);
    return value == null ? [] : [`${label}: ${formatAmount(value * multiplier)} ${unit}`];
  }).join("; ");
}

export function openFoodFactsNutrition(product) {
  const nutriments = product.nutriments || {};
  const water = (product.categories_tags || []).some((tag) => /water/i.test(tag));
  const calories = finiteNutrient(nutriments["energy-kcal_100g"])
    ?? (finiteNutrient(nutriments.energy_100g) == null ? null : finiteNutrient(nutriments.energy_100g) / 4.184);
  const values = {
    calories: calories ?? (water ? 0 : null),
    protein: finiteNutrient(nutriments.proteins_100g) ?? (water ? 0 : null),
    fat: finiteNutrient(nutriments.fat_100g) ?? (water ? 0 : null),
    carbs: finiteNutrient(nutriments.carbohydrates_100g) ?? (water ? 0 : null),
    fiber: finiteNutrient(nutriments.fiber_100g) ?? (water ? 0 : null),
  };
  const vitamins = openFoodFactsNutrientText(nutriments, {
    "vitamin-a_100g": ["A", 1_000_000, "мкг"], "vitamin-d_100g": ["D", 1_000_000, "мкг"],
    "vitamin-e_100g": ["E", 1_000, "мг"], "vitamin-c_100g": ["C", 1_000, "мг"],
    "vitamin-b1_100g": ["B1", 1_000, "мг"], "vitamin-b2_100g": ["B2", 1_000, "мг"],
    "vitamin-b6_100g": ["B6", 1_000, "мг"], "vitamin-b9_100g": ["B9", 1_000_000, "мкг"],
    "vitamin-b12_100g": ["B12", 1_000_000, "мкг"],
  });
  const minerals = openFoodFactsNutrientText(nutriments, {
    calcium_100g: ["Кальций", 1_000, "мг"], iron_100g: ["Железо", 1_000, "мг"],
    magnesium_100g: ["Магний", 1_000, "мг"], potassium_100g: ["Калий", 1_000, "мг"],
    zinc_100g: ["Цинк", 1_000, "мг"], sodium_100g: ["Натрий", 1_000, "мг"],
  });
  if (!Object.values(values).some((value) => value != null) && !vitamins && !minerals) return null;
  return {
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value == null ? null : Number(value.toFixed(2))])),
    vitamins,
    minerals,
    basis: "100 г/мл",
    source: "Open Food Facts",
  };
}
