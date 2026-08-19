import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  activeResponses,
  appendRequestVersion,
  ensureSingleReceipt,
  isRequestFulfilled,
  materializePurchasedProduct,
  memoryStorage,
  openFoodFactsSuggestion,
  openLocalData,
  plannedRationRequestItems,
  prepareState,
  productPurchasedTotal,
  purchaseLineMatches,
  restoreRequestVersion,
  STORAGE_KEY,
} from "../mobile-shell/local-data.js";

test("app opens locally without Google Sheets or a sign-in flow", () => {
  const appSource = fs.readFileSync(new URL("../mobile-shell/app.js", import.meta.url), "utf8");
  const localDataSource = fs.readFileSync(new URL("../mobile-shell/local-data.js", import.meta.url), "utf8");
  const activitySource = fs.readFileSync(
    new URL("../android/app/src/main/java/ru/listok/purchases/MainActivity.java", import.meta.url),
    "utf8"
  );
  const gradleSource = fs.readFileSync(
    new URL("../android/app/build.gradle", import.meta.url),
    "utf8"
  );
  const manifestSource = fs.readFileSync(
    new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
    "utf8"
  );

  assert.match(appSource, /let route = "summary";/);
  assert.match(appSource, /openLocalData\(browserStorage/);
  assert.match(localDataSource, new RegExp(STORAGE_KEY.replaceAll(".", "\\.")));
  assert.doesNotMatch(appSource, /localStorage\.setItem|localStorage\.getItem/);
  assert.doesNotMatch(appSource, /authorizeGoogle|__onNativeGoogleAuth|onboarding-google|google-auth/);
  assert.doesNotMatch(appSource, /sheets\.googleapis\.com|configureBackgroundSync|googleFetch/);
  assert.doesNotMatch(activitySource, /public void authorize\(\)/);
  assert.doesNotMatch(activitySource, /SheetsSyncWorker|configureBackgroundSync|play-services-auth/);
  assert.doesNotMatch(gradleSource, /play-services-auth|work-runtime|google-services/);
  assert.doesNotMatch(manifestSource, /GOOGLE_ANDROID_CLIENT_ID|POST_NOTIFICATIONS|WAKE_LOCK/);
});

const baseProduct = {
  id: "product_water",
  name: "Вода",
  category: "",
  unit: "л",
  updatedAt: "2026-01-01T00:00:00.000Z",
  updatedBy: "a@example.com",
};

function requestWithResponses(responses, updatedAt = "2026-01-01T00:01:00.000Z") {
  return {
    id: "request_1",
    createdAt: "2026-01-01T00:01:00.000Z",
    createdBy: "a@example.com",
    updatedAt,
    updatedBy: "a@example.com",
    status: "done",
    items: [{ productId: "product_water", quantity: 2, stockAtRequest: 0 }],
    responses,
  };
}

function response(id, quantity, updatedAt, createdAt = updatedAt) {
  return {
    id,
    requestId: "request_1",
    createdAt,
    createdBy: "a@example.com",
    updatedAt,
    updatedBy: "a@example.com",
    items: [{ productId: "product_water", quantity, price: 100 }],
  };
}

test("local data loads and commits through a memory adapter", () => {
  const storage = memoryStorage();
  const data = openLocalData(storage);
  data.commit({
    products: [baseProduct],
    requests: [],
    spreadsheetId: "legacy_sheet",
  });
  const loaded = openLocalData(storage).load();
  assert.equal(loaded.schemaVersion, 11);
  assert.equal(loaded.onboardingCompleted, true);
  assert.equal(loaded.products[0].id, baseProduct.id);
  assert.equal(loaded.spreadsheetId, "legacy_sheet");
});

test("prepared state preserves completed first-run setup", () => {
  const result = prepareState({
    onboardingCompleted: true,
    products: [],
    requests: [],
    spreadsheetId: "sheet_123",
    user: { email: "a@example.com" },
  });

  assert.equal(result.schemaVersion, 11);
  assert.equal(result.onboardingCompleted, true);
});

test("request line text stays separate from the product identity", () => {
  const result = prepareState({
    requests: [{
      id: "request_note",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "a@example.com",
      status: "open",
      items: [{ productId: baseProduct.id, quantity: 1, unit: "л", note: "без лактозы, если будет" }],
      responses: [],
      history: [],
    }],
  });

  assert.equal(result.requests[0].items[0].productId, baseProduct.id);
  assert.equal(result.requests[0].items[0].note, "без лактозы, если будет");
});

test("existing local blob keeps products, requests, purchases and ration", () => {
  const storage = memoryStorage({
    schemaVersion: 9,
    spreadsheetId: "legacy_sheet",
    user: { email: "a@example.com" },
    products: [{
      ...baseProduct,
      nutrition: { calories: 0, protein: 0, fat: 0, carbs: 0 },
    }],
    requests: [requestWithResponses([
      response("response_keep", 2, "2026-01-01T00:02:00.000Z"),
    ])],
    rationDays: {
      "2026-08-03": {
        date: "2026-08-03",
        meals: [{ id: "meal_1", name: "Обед", time: "13:00", items: [{ id: "item_1", productId: "product_water" }] }],
        updatedAt: "2026-08-03T08:00:00.000Z",
      },
    },
  });
  const result = openLocalData(storage).load();

  assert.equal(result.products[0].id, "product_water");
  assert.equal(result.requests[0].responses[0].id, "response_keep");
  assert.equal(result.rationDays["a@example.com|2026-08-03"].meals[0].items[0].productId, "product_water");
});

test("newer local product deletion survives an older remote merge", () => {
  const local = {
    ...baseProduct,
    deletedAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
  };
  const remote = {
    ...baseProduct,
    updatedAt: "2026-08-03T11:00:00.000Z",
  };

  const result = prepareState({ products: [local, remote] });

  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].deletedAt, "2026-08-03T12:00:00.000Z");
});

test("Open Food Facts name search result becomes a complete local suggestion", () => {
  const suggestion = openFoodFactsSuggestion({
    code: "4605035006964",
    product_name_ru: "Вода минеральная Псыж газ",
    brands: "Псыж",
    quantity: "1.5 л",
    categories_tags: ["en:waters"],
    nutriments: {},
    ingredients_text_ru: "Вода минеральная природная",
  });

  assert.equal(suggestion.name, "Вода минеральная Псыж газ");
  assert.equal(suggestion.barcode, "4605035006964");
  assert.equal(suggestion.unit, "л");
  assert.equal(suggestion.catalogSource, "Open Food Facts");
  assert.equal(suggestion.nutrition.calories, 0);
  assert.equal(suggestion.nutrition.protein, 0);
});

test("replacement purchase keeps product records independent from purchase quantities", () => {
  const result = prepareState({
    schemaVersion: 4,
    products: [
      { ...baseProduct, id: "product_requested" },
      { ...baseProduct, id: "product_replacement" },
    ],
    requests: [{
      id: "request_replacement",
      status: "done",
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z",
      items: [{ productId: "product_requested", quantity: 2, stockAtRequest: 0 }],
      responses: [{
        id: "response_replacement",
        requestId: "request_replacement",
        createdAt: "2026-01-01T00:02:00.000Z",
        updatedAt: "2026-01-01T00:02:00.000Z",
        items: [{
          productId: "product_requested",
          purchasedProductId: "product_replacement",
          quantity: 2,
          price: 150,
        }],
      }],
    }],
  });

  assert.equal(result.requests[0].responses[0].items[0].purchasedProductId, "product_replacement");
  assert.equal("quantity" in result.products.find((item) => item.id === "product_requested"), false);
  assert.equal("quantity" in result.products.find((item) => item.id === "product_replacement"), false);
});

test("scanned replacement confirms and fully corrects a request item instead of adding a product", () => {
  const products = [{
    ...baseProduct,
    id: "product_manual",
    name: "Молоко",
    barcode: "",
    confirmed: false,
    nutrition: null,
  }];
  const purchasedProductId = materializePurchasedProduct({ products }, {
    productId: "product_manual",
    purchasedProduct: {
      name: "Молоко Простоквашино 2,5%",
      category: "Молочные продукты",
      unit: "л",
      barcode: "4607053473544",
      ingredients: "Молоко нормализованное",
      nutrition: { calories: 52, source: "Open Food Facts" },
      catalogSource: "Open Food Facts",
      kind: "sku",
      brand: "Простоквашино",
    },
  }, "2026-01-01T00:03:00.000Z");

  assert.equal(purchasedProductId, "product_manual");
  assert.equal(products.length, 1);
  assert.equal(products[0].name, "Молоко Простоквашино 2,5%");
  assert.equal(products[0].barcode, "4607053473544");
  assert.equal(products[0].confirmed, true);
});

test("confirmed product is not rewritten when a different SKU is scanned", () => {
  const products = [{
    ...baseProduct,
    id: "product_domik",
    name: "Молоко Домик в деревне",
    barcode: "4600000000001",
    confirmed: true,
    kind: "sku",
    category: "Молочные продукты",
  }];
  const purchasedProductId = materializePurchasedProduct({ products }, {
    productId: "product_domik",
    purchasedProduct: {
      name: "Молоко Простоквашино 2,5%",
      category: "Молочные продукты",
      unit: "л",
      barcode: "4607053473544",
      ingredients: "Молоко нормализованное",
      nutrition: { calories: 52, source: "Open Food Facts" },
      catalogSource: "Open Food Facts",
      kind: "sku",
      brand: "Простоквашино",
    },
  }, "2026-01-01T00:03:00.000Z");

  assert.notEqual(purchasedProductId, "product_domik");
  assert.equal(products.length, 2);
  assert.equal(products[0].name, "Молоко Домик в деревне");
  assert.equal(products[0].barcode, "4600000000001");
  assert.equal(products.find((item) => item.id === purchasedProductId)?.name, "Молоко Простоквашино 2,5%");
});

test("Open Food Facts suggestion carries generic key and sku kind", () => {
  const suggestion = openFoodFactsSuggestion({
    code: "4607053473544",
    product_name_ru: "Кукуруза молодая Global Village",
    generic_name_ru: "Кукуруза",
    brands: "Global Village",
    categories_tags: ["en:canned-vegetables"],
    nutriments: { "energy-kcal_100g": 58, proteins_100g: 2, fat_100g: 0.5, carbohydrates_100g: 11 },
  });

  assert.equal(suggestion.kind, "sku");
  assert.equal(suggestion.brand, "Global Village");
  assert.ok(suggestion.genericKey);
  assert.equal(suggestion.confirmed, false);
});

test("deleted request and its transactions stay deleted after an older remote merge", () => {
  const remote = requestWithResponses([
    response("response_deleted_with_request", 2, "2026-01-01T00:02:00.000Z"),
  ], "2026-01-01T00:02:00.000Z");
  const local = structuredClone(remote);
  local.updatedAt = "2026-01-01T00:04:00.000Z";
  local.deletedAt = "2026-01-01T00:04:00.000Z";
  local.responses[0].updatedAt = "2026-01-01T00:04:00.000Z";
  local.responses[0].deletedAt = "2026-01-01T00:04:00.000Z";

  const merged = prepareState({ requests: [local, remote] }).requests[0];

  assert.equal(merged.deletedAt, "2026-01-01T00:04:00.000Z");
  assert.equal(merged.responses[0].deletedAt, "2026-01-01T00:04:00.000Z");
});

test("package deduplicates resends and sums distinct responses", () => {
  const state = {
    products: [
      baseProduct,
      { ...baseProduct, updatedAt: "2025-12-31T23:59:00.000Z", name: "Старая вода" },
    ],
    requests: [
      requestWithResponses([
        response("response_a", 1, "2026-01-01T00:02:00.000Z"),
      ]),
      requestWithResponses([
        response("response_a", 2, "2026-01-01T00:04:00.000Z", "2026-01-01T00:02:00.000Z"),
        response("response_b", 3, "2026-01-01T00:03:00.000Z"),
      ], "2026-01-01T00:04:00.000Z"),
    ],
  };

  const result = prepareState(state);
  assert.equal(result.products.length, 1);
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].responses.length, 2);
  assert.equal(result.requests[0].responses.find((item) => item.id === "response_a").items[0].quantity, 2);
  assert.equal("quantity" in result.products[0], false);
});

test("sync package removes legacy stock fields", () => {
  const result = prepareState({
    products: [{
      ...baseProduct,
      baseQuantity: 7,
      baseUpdatedAt: "2026-01-01T00:05:00.000Z",
      quantity: 9,
      updatedAt: "2026-01-01T00:05:00.000Z",
    }],
    requests: [requestWithResponses([
      response("response_old", 3, "2026-01-01T00:03:00.000Z"),
    ])],
  });
  assert.equal("baseQuantity" in result.products[0], false);
  assert.equal("baseUpdatedAt" in result.products[0], false);
  assert.equal("quantity" in result.products[0], false);
  assert.equal("stockAtRequest" in result.requests[0].items[0], false);
});

test("legacy purchase becomes one stable response without double counting", () => {
  const product = {
    ...baseProduct,
    baseQuantity: undefined,
    baseUpdatedAt: undefined,
    quantity: 2,
    updatedAt: "2026-01-01T00:04:00.000Z",
  };
  const result = prepareState({
    products: [product],
    requests: [{
      id: "request_legacy",
      createdAt: "2026-01-01T00:01:00.000Z",
      completedAt: "2026-01-01T00:03:00.000Z",
      updatedAt: "2026-01-01T00:03:00.000Z",
      createdBy: "a@example.com",
      items: [{ productId: "product_water", quantity: 2, stockAtRequest: 0 }],
      purchases: [{ productId: "product_water", quantity: 2, price: 100 }],
    }],
  });

  assert.equal(result.requests[0].responses.length, 1);
  assert.equal(result.requests[0].responses[0].id, "response_legacy_request_legacy");
  assert.equal("quantity" in result.products[0], false);
});

test("checkbox reuses one receipt after repeated uncheck and recheck", () => {
  const request = requestWithResponses([], "2026-01-01T00:01:00.000Z");
  const first = ensureSingleReceipt(request, "2026-01-01T00:02:00.000Z");
  first.items.push({ productId: "product_water", purchasedProductId: "product_water", quantity: 2, price: 0, completionMode: "closed" });
  first.deletedAt = "2026-01-01T00:03:00.000Z";

  const reused = ensureSingleReceipt(request, "2026-01-01T00:04:00.000Z");

  assert.equal(request.responses.length, 1);
  assert.equal(reused.id, "response_request_1");
  assert.equal(reused.deletedAt, "");
  assert.equal(reused.items.length, 0);
});

test("saving unchanged purchase details is detected as a no-op", () => {
  const line = {
    productId: "product_water",
    purchasedProductId: "product_water",
    quantity: 2,
    price: 179.9,
    completionMode: "filled",
  };

  assert.equal(purchaseLineMatches(line, structuredClone(line)), true);
  assert.equal(purchaseLineMatches(line, { ...line, price: 180 }), false);
});

test("all-time purchased total uses the purchased product identity", () => {
  const state = {
    requests: [{
      responses: [{
        items: [
          { productId: "product_requested", purchasedProductId: "product_water", quantity: 2 },
          { productId: "product_water", quantity: 3 },
        ],
      }, {
        deletedAt: "2026-01-02T00:00:00.000Z",
        items: [{ productId: "product_water", quantity: 10 }],
      }],
    }],
  };

  assert.equal(productPurchasedTotal("product_water", state), 5);
  assert.equal(productPurchasedTotal("product_requested", state), 0);
});

test("partial response keeps a multi-product request active", () => {
  const request = prepareState({
    requests: [{
      id: "request_multi",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      items: [
        { productId: "product_water", quantity: 2, stockAtRequest: 0 },
        { productId: "product_bread", quantity: 3, stockAtRequest: 0 },
      ],
      responses: [response("response_partial", 2, "2026-01-01T00:01:00.000Z")],
    }],
  }).requests[0];

  assert.equal(request.items.length, 2);
  assert.equal(isRequestFulfilled(request), false);
  assert.equal(request.status, "open");
  assert.equal(request.completedAt, "");
});

test("request closes only when every product is fulfilled across responses", () => {
  const request = prepareState({
    requests: [{
      id: "request_fulfilled",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:03:00.000Z",
      items: [
        { productId: "product_water", quantity: 2, stockAtRequest: 0 },
        { productId: "product_bread", quantity: 3, stockAtRequest: 0 },
      ],
      responses: [
        response("response_water", 2, "2026-01-01T00:01:00.000Z"),
        {
          ...response("response_bread", 3, "2026-01-01T00:02:00.000Z"),
          items: [{ productId: "product_bread", quantity: 3, price: 120 }],
        },
      ],
    }],
  }).requests[0];

  assert.equal(isRequestFulfilled(request), true);
  assert.equal(request.status, "done");
});

test("request versions restore items and responses atomically", () => {
  const request = prepareState({
    requests: [{
      id: "request_history",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "a@example.com",
      updatedBy: "a@example.com",
      items: [
        { productId: "product_water", quantity: 2, stockAtRequest: 0 },
        { productId: "product_bread", quantity: 3, stockAtRequest: 0 },
      ],
      responses: [],
    }],
  }).requests[0];
  const initial = request.history[0];
  request.items[0].quantity = 9;
  request.responses.push(response("response_changed", 1, "2026-01-01T00:02:00.000Z"));
  request.updatedAt = "2026-01-01T00:02:00.000Z";
  appendRequestVersion(
    request,
    "Ответ добавлен",
    request.updatedAt,
    "a@example.com",
    "transaction_changed"
  );

  restoreRequestVersion(
    request,
    initial,
    "2026-01-01T00:03:00.000Z",
    "a@example.com"
  );

  assert.equal(request.items.map((item) => item.quantity).join(","), "2,3");
  assert.equal(activeResponses(request).length, 0);
  assert.equal(Boolean(request.responses[0].deletedAt), true);
  assert.equal(request.status, "open");
  assert.equal(request.history.at(-1).action, "Откат: Исходная версия");
});

test("rolled back response stays deleted after merging an older remote copy", () => {
  const remote = requestWithResponses([
    response("response_remote", 2, "2026-01-01T00:02:00.000Z"),
  ], "2026-01-01T00:02:00.000Z");
  const local = structuredClone(remote);
  local.updatedAt = "2026-01-01T00:03:00.000Z";
  local.responses[0].updatedAt = "2026-01-01T00:03:00.000Z";
  local.responses[0].deletedAt = "2026-01-01T00:03:00.000Z";

  const merged = prepareState({ requests: [local, remote] }).requests[0];

  assert.equal(activeResponses(merged).length, 0);
  assert.equal(merged.status, "open");
  assert.equal(merged.responses[0].deletedAt, "2026-01-01T00:03:00.000Z");
});

test("ration sync preserves an arbitrary number of meals and their products", () => {
  const date = "2026-08-03";
  const meals = ["breakfast", "lunch", "dinner", "snack"].map((id, index) => ({
    id,
    name: id,
    time: ["08:00", "13:00", "19:00", "21:30"][index],
    items: [{ id: `${id}_item`, productId: `product_${id}`, name: id }],
    order: index,
  }));

  const result = prepareState({
    products: [],
    requests: [],
    rationDays: {
      [date]: { date, meals, updatedAt: "2026-08-03T08:00:00.000Z", updatedBy: "local" },
    },
    rationView: "month",
    rationAnchor: date,
  });

  assert.equal(result.schemaVersion, 11);
  assert.equal(result.rationView, "month");
  assert.equal(result.rationAnchor, date);
  assert.equal(result.rationDays[`local|${date}`].meals.length, 4);
  assert.equal(result.rationDays[`local|${date}`].meals[3].items[0].productId, "product_snack");
  assert.equal(result.rationDays[`local|${date}`].meals[3].time, "21:30");
  assert.equal(result.rationDays[`local|${date}`].owner, "local");
});

test("ration days are namespaced by user while products remain shared", () => {
  const result = prepareState({
    user: { email: "Owner@Example.com" },
    products: [{ ...baseProduct }],
    requests: [],
    rationDays: {
      "2026-08-04": { date: "2026-08-04", meals: [], updatedAt: "2026-08-04T08:00:00.000Z" },
      "other@example.com|2026-08-04": { date: "2026-08-04", owner: "other@example.com", meals: [], updatedAt: "2026-08-04T09:00:00.000Z" },
    },
  });

  assert.ok(result.rationDays["owner@example.com|2026-08-04"]);
  assert.ok(result.rationDays["other@example.com|2026-08-04"]);
  assert.equal(result.products[0].id, baseProduct.id);
});

test("ration request includes only selected positions and rounds portions to packages", () => {
  const chickenItems = Array.from({ length: 7 }, (_, index) => ({
    id: `chicken_${index}`, productId: "chicken", portionSize: 150, packageSize: 1000, measureUnit: "г",
  }));
  const source = {
    products: [{ id: "chicken", name: "Куриная грудка", unit: "кг" }, { id: "rice", name: "Рис", unit: "кг" }],
    rationDays: {
      "local|2026-08-03": {
        date: "2026-08-03", owner: "local",
        meals: [{ id: "meal", name: "Обед", items: [...chickenItems, { id: "rice_0", productId: "rice", portionSize: 100, packageSize: 1000 }] }],
      },
    },
  };

  const items = plannedRationRequestItems(
    source,
    ["2026-08-03"],
    new Set(chickenItems.map((item) => item.id))
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].productId, "chicken");
  assert.equal(items[0].plannedAmount, 1050);
  assert.equal(items[0].quantity, 2);
  assert.equal(items[0].packageSize, 1000);
});

function shoppingList() {
  const data = openLocalData(memoryStorage());
  const created = data.createRequest();
  const saved = data.saveRequestItems(created.requestId, [
    { name: "Вода", quantity: 2, unit: "л" },
    { name: "Хлеб", quantity: 3, unit: "шт." },
  ]);
  assert.equal(saved.ok, true);
  const request = data.snapshot().requests.find((item) => item.id === created.requestId);
  return {
    data,
    requestId: created.requestId,
    waterId: request.items[0].productId,
    breadId: request.items[1].productId,
  };
}

test("partial purchase keeps a multi-product request open", () => {
  const { data, requestId, waterId } = shoppingList();
  const marked = data.markBought(requestId, waterId, { quantity: 2 });
  assert.equal(marked.ok, true);
  const request = data.snapshot().requests.find((item) => item.id === requestId);
  assert.equal(isRequestFulfilled(request), false);
  assert.equal(request.status, "open");
});

test("repeat purchase mark does not add a second receipt line", () => {
  const { data, requestId, waterId } = shoppingList();
  const first = data.markBought(requestId, waterId, { quantity: 2, price: 80, completionMode: "filled" });
  assert.equal(first.ok, true);
  const afterFirst = data.snapshot().requests.find((item) => item.id === requestId);
  const historyLength = afterFirst.history.length;
  const second = data.markBought(requestId, waterId, { quantity: 2, price: 80, completionMode: "filled" });
  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  const request = data.snapshot().requests.find((item) => item.id === requestId);
  assert.equal(activeResponses(request).length, 1);
  assert.equal(activeResponses(request)[0].items.filter((item) => item.productId === waterId).length, 1);
  assert.equal(request.history.length, historyLength);
});

test("request version restore rolls back items and purchases", () => {
  const data = openLocalData(memoryStorage());
  const created = data.createRequest();
  const initialId = data.snapshot().requests.find((item) => item.id === created.requestId).history[0].id;
  data.saveRequestItems(created.requestId, [{ name: "Вода", quantity: 2, unit: "л" }]);
  const waterId = data.snapshot().requests.find((item) => item.id === created.requestId).items[0].productId;
  data.markBought(created.requestId, waterId, { quantity: 2 });
  const restored = data.restoreVersion(created.requestId, initialId);
  assert.equal(restored.ok, true);
  const request = data.snapshot().requests.find((item) => item.id === created.requestId);
  assert.equal(request.items.length, 0);
  assert.equal(activeResponses(request).length, 0);
  assert.equal(request.status, "open");
});

test("duplicate product lines in one request are rejected", () => {
  const data = openLocalData(memoryStorage());
  const created = data.createRequest();
  const saved = data.saveRequestItems(created.requestId, [
    { name: "Вода", quantity: 1, unit: "л" },
    { name: "вода", quantity: 2, unit: "л" },
  ]);
  assert.equal(saved.ok, false);
  assert.match(saved.reason, /дважды/);
  const request = data.snapshot().requests.find((item) => item.id === created.requestId);
  assert.equal(request.items.length, 0);
});

test("product used in a request cannot be deleted", () => {
  const { data, waterId } = shoppingList();
  const removed = data.removeProduct(waterId);
  assert.equal(removed.ok, false);
  assert.match(removed.reason, /используется/);
});

test("ration template applies meals to several days", () => {
  const data = openLocalData(memoryStorage());
  data.addRationMeal("2026-08-03");
  const mealId = data.snapshot().rationDays["local|2026-08-03"].meals[0].id;
  data.saveRationFood("2026-08-03", mealId, data.addRationFood("2026-08-03", mealId).itemId, { name: "Гречка" });
  const saved = data.saveRationTemplateFromDay("2026-08-03", "Будний день");
  assert.equal(saved.ok, true);
  data.applyRationTemplate(saved.templateId, ["2026-08-04", "2026-08-05"]);
  const state = data.snapshot();
  assert.equal(state.rationDays["local|2026-08-04"].meals.length, 1);
  assert.equal(state.rationDays["local|2026-08-05"].meals[0].items[0].name, "Гречка");
  assert.notEqual(state.rationDays["local|2026-08-04"].meals[0].id, mealId);
});

test("ration request merges the same product across days and rounds packages", () => {
  const data = openLocalData(memoryStorage());
  const first = data.addRationMeal("2026-08-03");
  const second = data.addRationMeal("2026-08-04");
  const firstItem = data.addRationFood("2026-08-03", first.mealId);
  const secondItem = data.addRationFood("2026-08-04", second.mealId);
  data.saveRationFood("2026-08-03", first.mealId, firstItem.itemId, { name: "Куриная грудка" });
  data.saveRationFood("2026-08-04", second.mealId, secondItem.itemId, { name: "Куриная грудка" });
  const chickenId = data.snapshot().products.find((item) => item.name === "Куриная грудка").id;
  data.setRationPortion("2026-08-03", first.mealId, firstItem.itemId, { portionSize: 150, packageSize: 1000, measureUnit: "г" });
  data.setRationPortion("2026-08-04", second.mealId, secondItem.itemId, { portionSize: 150, packageSize: 1000, measureUnit: "г" });
  const created = data.createRequestFromRation({
    dates: ["2026-08-03", "2026-08-04"],
    itemIds: [firstItem.itemId, secondItem.itemId],
  });
  assert.equal(created.ok, true);
  const request = data.snapshot().requests.find((item) => item.id === created.requestId);
  assert.equal(request.items.length, 1);
  assert.equal(request.items[0].productId, chickenId);
  assert.equal(request.items[0].plannedAmount, 300);
  assert.equal(request.items[0].quantity, 1);
});

test("ration selection delete removes meals and items", () => {
  const data = openLocalData(memoryStorage());
  const meal = data.addRationMeal("2026-08-03");
  const kept = data.addRationFood("2026-08-03", meal.mealId);
  const gone = data.addRationFood("2026-08-03", meal.mealId);
  data.saveRationFood("2026-08-03", meal.mealId, kept.itemId, { name: "Рис" });
  data.saveRationFood("2026-08-03", meal.mealId, gone.itemId, { name: "Огурцы" });
  const deleted = data.deleteRationSelection({ itemIds: [gone.itemId] });
  assert.equal(deleted.ok, true);
  const day = data.snapshot().rationDays["local|2026-08-03"];
  assert.equal(day.meals[0].items.length, 1);
  assert.equal(day.meals[0].items[0].name, "Рис");
  data.deleteRationSelection({ mealIds: [meal.mealId] });
  assert.equal(data.snapshot().rationDays["local|2026-08-03"].meals.length, 0);
});
