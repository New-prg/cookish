import { createId } from "./replay.js";

// The queue of the Заполнитель (epic #59): a product saved without full КБЖУ
// waits here until the Заполнитель (#65) fills it. The queue is Core data, so
// it lives in the Cache and the Outbox and survives a restart.

export const REQUIRED_NUTRITION_FIELDS = Object.freeze(["calories", "protein", "fat", "carbs"]);

function filled(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

// All four of калории, белки, жиры, углеводы are known.
export function hasNutrition(product) {
  return REQUIRED_NUTRITION_FIELDS.every((field) => filled(product?.nutrition?.[field]));
}

export function emptyFiller() {
  return { queue: [] };
}

export function normalizeFiller(source) {
  const queue = (Array.isArray(source?.queue) ? source.queue : [])
    .filter((entry) => typeof entry?.productId === "string" && entry.productId)
    .map((entry) => ({ id: String(entry.id || ""), productId: entry.productId, addedAt: String(entry.addedAt || "") }));
  return { ...emptyFiller(), ...(source && typeof source === "object" ? source : {}), queue };
}

export function isQueuedForFilling(state, productId) {
  return (state.filler?.queue || []).some((entry) => entry.productId === productId);
}

// After a command changed products at `now`: a product it saved without full
// КБЖУ joins the queue; a product that got them or was deleted leaves it.
export function syncFillerQueue(filler, products, now) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const queue = (filler?.queue || []).filter((entry) => {
    const product = byId.get(entry.productId);
    return product && !product.deletedAt && !hasNutrition(product);
  });
  products.forEach((product) => {
    if (product.updatedAt !== now || product.deletedAt || hasNutrition(product)) return;
    if (queue.some((entry) => entry.productId === product.id)) return;
    queue.push({ id: createId("fill"), productId: product.id, addedAt: now });
  });
  return { ...normalizeFiller(filler), queue };
}
