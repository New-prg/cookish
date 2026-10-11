// Where the КБЖУ of a product came from (epic #59). The data keeps the label
// in nutrition.source; older builds wrote other names for the same sources.
export const NUTRITION_SOURCES = Object.freeze({
  user: "Вы",
  off: "Open Food Facts",
  reference: "Справочник",
  estimate: "Оценка ИИ",
});

const LEGACY_LABELS = Object.freeze({
  "Введено пользователем": NUTRITION_SOURCES.user,
  "Встроенный справочник": NUTRITION_SOURCES.reference,
  "Ассистент": NUTRITION_SOURCES.estimate,
});

const KNOWN = new Set(Object.values(NUTRITION_SOURCES));

function canonical(label) {
  const text = String(label || "").trim();
  return KNOWN.has(text) ? text : LEGACY_LABELS[text] || "";
}

// The label of a product's КБЖУ, "" without them. A card without a known
// source was typed by the person.
export function nutritionSourceLabel(product) {
  if (!product?.nutrition) return "";
  return canonical(product.nutrition.source) || canonical(product.catalogSource) || NUTRITION_SOURCES.user;
}

export function openFoodFactsUrl(barcode) {
  const code = String(barcode || "").trim();
  return /^\d{8,14}$/.test(code) ? `https://world.openfoodfacts.org/product/${code}` : "";
}
