import assert from "node:assert/strict";
import test from "node:test";

// The contract of the catalog Service, written against a transport and not
// against functions. `makeTransport({ fetchImpl })` builds a transport whose
// catalog reaches Open Food Facts through `fetchImpl`; the local transport
// runs it today, an HTTP adapter will run the same cases (#29).

export const KEFIR = {
  code: "4600000000001",
  product_name_ru: "Кефир 1%",
  brands: "Простоквашино",
  quantity: "900 мл",
  categories_tags: ["en:fermented-milks"],
  nutriments: { "energy-kcal_100g": 40, proteins_100g: 3, fat_100g: 1, carbohydrates_100g: 4 },
  ingredients_text_ru: "молоко нормализованное",
};

// A fake Open Food Facts: `answer(url)` returns { status, body } or throws.
export function fakeOpenFoodFacts(answer) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    const { status = 200, body } = await answer(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    };
  };
  return { fetchImpl, calls };
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("the request should fail");
}

export function catalogContract(name, makeTransport) {
  test(`${name}: catalog.search returns cards from Open Food Facts`, async () => {
    const off = fakeOpenFoodFacts(() => ({ body: { products: [KEFIR, { code: "1", quantity: "1 кг" }] } }));
    const transport = await makeTransport({ fetchImpl: off.fetchImpl });
    const { products } = await transport.request("catalog", "search", { query: "кефир" });

    assert.equal(off.calls.length, 1);
    const url = new URL(off.calls[0].url);
    assert.equal(url.origin + url.pathname, "https://world.openfoodfacts.org/cgi/search.pl");
    assert.equal(url.searchParams.get("search_terms"), "кефир");
    assert.equal(url.searchParams.get("page_size"), "5");
    assert.equal(off.calls[0].headers.Accept, "application/json");
    // A product without a name is no suggestion.
    assert.equal(products.length, 1);
    assert.deepEqual(
      { ...products[0], nutrition: undefined },
      {
        id: "off_4600000000001",
        name: "Кефир 1%",
        brand: "Простоквашино",
        category: "Молочные продукты",
        genericKey: products[0].genericKey,
        kind: "sku",
        unit: "л",
        barcode: "4600000000001",
        ingredients: "молоко нормализованное",
        nutrition: undefined,
        catalogSource: "Open Food Facts",
        confirmed: false,
      },
    );
    assert.equal(products[0].nutrition.calories, 40);
    assert.equal(products[0].nutrition.source, "Open Food Facts");
  });

  test(`${name}: catalog.search caches answers and refuses an eleventh search in a minute`, async () => {
    const off = fakeOpenFoodFacts(() => ({ body: { products: [KEFIR] } }));
    const transport = await makeTransport({ fetchImpl: off.fetchImpl });
    for (let index = 0; index < 10; index += 1) await transport.request("catalog", "search", { query: `кефир ${index}` });
    await transport.request("catalog", "search", { query: "Кефир 0" });
    assert.equal(off.calls.length, 10, "a repeated query comes from the cache");
    const error = await rejection(transport.request("catalog", "search", { query: "кефир 10" }));
    assert.equal(error.kind, "rate");
    assert.match(error.message, /10 поисков в минуту/);
    assert.equal(off.calls.length, 10, "over the limit nothing reaches Open Food Facts");
  });

  test(`${name}: catalog.search with fewer than three letters does not reach the network`, async () => {
    const off = fakeOpenFoodFacts(() => assert.fail("no request expected"));
    const transport = await makeTransport({ fetchImpl: off.fetchImpl });
    assert.deepEqual(await transport.request("catalog", "search", { query: " ке " }), { products: [] });
    assert.deepEqual(await transport.request("catalog", "search", {}), { products: [] });
    assert.equal(off.calls.length, 0);
  });

  test(`${name}: catalog.productByBarcode returns the card, or null for an unknown barcode`, async () => {
    const off = fakeOpenFoodFacts((url) => (url.includes("/4600000000001.json")
      ? { body: { status: 1, product: KEFIR } }
      : { body: { status: 0, status_verbose: "product not found" } }));
    const transport = await makeTransport({ fetchImpl: off.fetchImpl });

    const { product } = await transport.request("catalog", "productByBarcode", { barcode: " 4600000000001 " });
    assert.equal(product.name, "Кефир 1%");
    assert.equal(product.unit, "л");
    assert.equal(product.nutrition.protein, 3);
    assert.match(off.calls[0].url, /^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/4600000000001\.json\?fields=/);

    assert.deepEqual(await transport.request("catalog", "productByBarcode", { barcode: "4600000000002" }), { product: null });
  });

  test(`${name}: a card without a name still carries the unit and the nutrition`, async () => {
    const off = fakeOpenFoodFacts(() => ({ body: { status: 1, product: { code: "4600000000003", quantity: "1 кг", nutriments: { "energy-kcal_100g": 330 } } } }));
    const transport = await makeTransport({ fetchImpl: off.fetchImpl });
    const { product } = await transport.request("catalog", "productByBarcode", { barcode: "4600000000003" });
    assert.equal(product.name, "");
    assert.equal(product.unit, "кг");
    assert.equal(product.nutrition.calories, 330);
  });

  test(`${name}: a wrong barcode is rejected with a reason for the person`, async () => {
    const off = fakeOpenFoodFacts(() => assert.fail("no request expected"));
    const transport = await makeTransport({ fetchImpl: off.fetchImpl });
    const error = await rejection(transport.request("catalog", "productByBarcode", { barcode: "12ab" }));
    assert.equal(error.kind, "bad_request");
    assert.equal(error.message, "Введите от 8 до 14 цифр штрихкода.");
    assert.equal(off.calls.length, 0);
  });

  test(`${name}: a short 503 of Open Food Facts is tried once more`, async () => {
    let calls = 0;
    const off = fakeOpenFoodFacts(() => (calls++ === 0 ? { status: 503, body: "" } : { body: { products: [KEFIR] } }));
    const transport = await makeTransport({ fetchImpl: off.fetchImpl });
    const { products } = await transport.request("catalog", "search", { query: "кефир" });
    assert.equal(off.calls.length, 2);
    assert.equal(products[0].name, "Кефир 1%");
  });

  test(`${name}: network and Open Food Facts failures come back as kinds with a text`, async () => {
    const cases = [
      [() => { throw new TypeError("Failed to fetch"); }, "network", /Нет связи с Open Food Facts/],
      [() => ({ status: 503, body: "" }), "unavailable", /Open Food Facts не ответил \(503\)/],
      [() => ({ status: 200, body: "<html>" }), "bad_response", /непонятный ответ/],
    ];
    for (const [answer, kind, text] of cases) {
      const transport = await makeTransport({ fetchImpl: fakeOpenFoodFacts(answer).fetchImpl });
      for (const [method, payload] of [["search", { query: "кефир" }], ["productByBarcode", { barcode: "4600000000001" }]]) {
        const error = await rejection(transport.request("catalog", method, payload));
        assert.equal(error.kind, kind, `${method}: ${error.message}`);
        assert.match(error.message, text);
        assert.doesNotMatch(error.message, /Failed to fetch|TypeError/);
      }
    }
  });
}
