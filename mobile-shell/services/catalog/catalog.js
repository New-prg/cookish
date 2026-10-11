import { normalizeProductName } from "../../core/ration-domain.js";
import { ServiceError } from "../service-error.js";
import { createOpenFoodFacts } from "./open-food-facts.js";

// The catalog Service: product cards from public catalogs, today Open Food
// Facts.
//
//   search({ query })              → { products: [card] }
//   productByBarcode({ barcode })  → { product: card | null }
//
// Open Food Facts asks for at most 10 searches a minute: answers are cached,
// and a search over the limit fails at once instead of waiting.
export const SEARCHES_PER_MINUTE = 10;
const SEARCH_CACHE_SIZE = 200;

export function createCatalogService({ fetchImpl, now = () => Date.now() }) {
  const openFoodFacts = createOpenFoodFacts({ fetchImpl });
  const answers = new Map();
  const recent = [];
  return {
    async search({ query } = {}) {
      const text = String(query || "").trim();
      const key = normalizeProductName(text);
      if (key.length < 3) return { products: [] };
      if (answers.has(key)) return { products: answers.get(key) };
      const time = now();
      while (recent.length && time - recent[0] >= 60_000) recent.shift();
      if (recent.length >= SEARCHES_PER_MINUTE) {
        throw new ServiceError("rate", "Open Food Facts принимает не больше 10 поисков в минуту. Повтори поиск через минуту.");
      }
      recent.push(time);
      const products = await openFoodFacts.search(text);
      answers.set(key, products);
      if (answers.size > SEARCH_CACHE_SIZE) answers.delete(answers.keys().next().value);
      return { products };
    },
    async productByBarcode({ barcode } = {}) {
      const code = String(barcode || "").trim();
      if (!/^\d{8,14}$/.test(code)) throw new ServiceError("bad_request", "Введите от 8 до 14 цифр штрихкода.");
      return { product: await openFoodFacts.product(code) };
    },
  };
}
