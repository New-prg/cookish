import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadModel() {
  const sourcePath = new URL("../mobile-shell/app.js", import.meta.url);
  const source = fs.readFileSync(sourcePath, "utf8");
  const marker = "  render();\n  mirrorStateForBackgroundSync();";
  assert.ok(source.includes(marker), "Test export marker was not found");
  const instrumented = source.replace(marker, `
  globalThis.__listokModel = {
    buildSyncPackage,
    mergeRequests,
    migrateRequest,
    normalizeRequest,
    parseProductRow,
    parseResponseRow,
  };
  return;
${marker}`);
  const element = {
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {} },
    hidden: false,
    style: {},
  };
  const context = {
    console,
    FormData,
    Intl,
    Map,
    Set,
    URL,
    clearInterval,
    clearTimeout,
    document: {
      getElementById: () => element,
      querySelector: () => element,
      querySelectorAll: () => [],
    },
    localStorage: {
      getItem: () => null,
      setItem() {},
    },
    setInterval,
    setTimeout,
    structuredClone,
    window: { scrollTo() {} },
  };
  context.globalThis = context;
  vm.runInNewContext(instrumented, context, { filename: "mobile-shell/app.js" });
  return context.__listokModel;
}

const model = loadModel();
const baseProduct = {
  id: "product_water",
  name: "Вода",
  category: "",
  unit: "л",
  baseQuantity: 0,
  baseUpdatedAt: "2026-01-01T00:00:00.000Z",
  quantity: 0,
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

  const result = model.buildSyncPackage(state);
  assert.equal(result.products.length, 1);
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].responses.length, 2);
  assert.equal(result.requests[0].responses.find((item) => item.id === "response_a").items[0].quantity, 2);
  assert.equal(result.products[0].quantity, 5);
});

test("manual stock checkpoint excludes older responses", () => {
  const state = {
    products: [{
      ...baseProduct,
      baseQuantity: 7,
      baseUpdatedAt: "2026-01-01T00:05:00.000Z",
      updatedAt: "2026-01-01T00:05:00.000Z",
    }],
    requests: [requestWithResponses([
      response("response_old", 3, "2026-01-01T00:03:00.000Z"),
    ])],
  };

  assert.equal(model.buildSyncPackage(state).products[0].quantity, 7);
});

test("legacy purchase becomes one stable response without double counting", () => {
  const product = {
    ...baseProduct,
    baseQuantity: undefined,
    baseUpdatedAt: undefined,
    quantity: 2,
    updatedAt: "2026-01-01T00:04:00.000Z",
  };
  const migrated = model.migrateRequest({
    id: "request_legacy",
    createdAt: "2026-01-01T00:01:00.000Z",
    completedAt: "2026-01-01T00:03:00.000Z",
    updatedAt: "2026-01-01T00:03:00.000Z",
    createdBy: "a@example.com",
    items: [{ productId: "product_water", quantity: 2, stockAtRequest: 0 }],
    purchases: [{ productId: "product_water", quantity: 2, price: 100 }],
  }, [product]);
  const result = model.buildSyncPackage({ products: [product], requests: [migrated] });

  assert.equal(result.requests[0].responses.length, 1);
  assert.equal(result.requests[0].responses[0].id, "response_legacy_request_legacy");
  assert.equal(result.products[0].quantity, 2);
});
