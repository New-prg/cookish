import { normalizeProductName } from "../../core/ration-domain.js";
import { ServiceError } from "../service-error.js";
import { createOpenFoodFacts } from "./open-food-facts.js";

// The catalog Service: product cards from public catalogs, today Open Food
// Facts.
//
//   search({ query })              → { products: [card] }
//   productByBarcode({ barcode })  → { product: card | null }
export function createCatalogService({ fetchImpl }) {
  const openFoodFacts = createOpenFoodFacts({ fetchImpl });
  return {
    async search({ query } = {}) {
      const text = String(query || "").trim();
      if (normalizeProductName(text).length < 3) return { products: [] };
      return { products: await openFoodFacts.search(text) };
    },
    async productByBarcode({ barcode } = {}) {
      const code = String(barcode || "").trim();
      if (!/^\d{8,14}$/.test(code)) throw new ServiceError("bad_request", "Введите от 8 до 14 цифр штрихкода.");
      return { product: await openFoodFacts.product(code) };
    },
  };
}
