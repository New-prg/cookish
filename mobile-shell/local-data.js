export const STORAGE_KEY = "cookish.android.data.v1";
export const SCHEMA_VERSION = 11;

export function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    products: [],
    requests: [],
    rationDays: {},
    rationTemplates: [],
    rationView: "week",
    rationAnchor: "",
    user: null,
    onboardingCompleted: true,
  };
}

export function memoryStorage(initial = null) {
  let value = initial == null ? null : structuredClone(initial);
  return {
    read() {
      return value == null ? null : structuredClone(value);
    },
    write(state) {
      value = structuredClone(state);
    },
  };
}

export function browserStorage(localStorage, key = STORAGE_KEY) {
  return {
    read() {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    write(state) {
      localStorage.setItem(key, JSON.stringify(state));
    },
  };
}

export function openLocalData(storage) {
  let current = emptyState();

  function snapshot() {
    return structuredClone(current);
  }

  return {
    load() {
      const stored = storage.read();
      current = prepareState(stored && typeof stored === "object" ? stored : emptyState());
      return snapshot();
    },
    commit(nextState) {
      current = prepareState(nextState);
      storage.write(current);
      return snapshot();
    },
    snapshot,
    clear() {
      current = prepareState(emptyState());
      storage.write(current);
      return snapshot();
    },
  };
}

export function prepareState(source) {
  const result = { ...emptyState(), ...structuredClone(source && typeof source === "object" ? source : {}) };
  result.schemaVersion = SCHEMA_VERSION;
  result.onboardingCompleted = true;
  const legacyRationDays = result.rationDays && typeof result.rationDays === "object" ? result.rationDays : {};
  result.rationDays = {};
  Object.values(legacyRationDays).forEach((day) => {
    if (!day?.date) return;
    const owner = String(day.owner || result.user?.email || "local").trim().toLowerCase() || "local";
    const meals = (day.meals || []).filter((meal) => {
      const legacyNames = ["Завтрак", "Обед", "Ужин"];
      const legacyTimes = ["08:00", "13:00", "19:00"];
      const legacyIndex = Number(String(meal.id || "").match(new RegExp(`^meal_${day.date}_(\\d+)$`))?.[1]) - 1;
      return !(
        legacyIndex >= 0
        && meal.name === legacyNames[legacyIndex]
        && meal.time === legacyTimes[legacyIndex]
        && !(meal.items || []).length
      );
    });
    result.rationDays[`${owner}|${day.date}`] = { ...day, meals, owner };
  });
  result.rationView = ["day", "week", "month"].includes(result.rationView) ? result.rationView : "week";
  result.rationAnchor = /^\d{4}-\d{2}-\d{2}$/.test(result.rationAnchor || "") ? result.rationAnchor : todayDateKey();
  result.rationTemplates = Array.isArray(result.rationTemplates) ? result.rationTemplates : [];
  result.products = mergeVersioned([], (result.products || []).map((product) => {
    const normalized = normalizeProductRecord({
      ...product,
      updatedAt: product.updatedAt || new Date(0).toISOString(),
      updatedBy: product.updatedBy || "local",
    });
    delete normalized.baseQuantity;
    delete normalized.baseUpdatedAt;
    delete normalized.quantity;
    return normalized;
  }));
  result.requests = mergeRequests([], (result.requests || []).map((request) => migrateRequest(request)));
  return result;
}

export function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeProductName(name) {
  return String(name || "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
}

export function genericKeyFromParts(category, name, fallback = "") {
  if (category) return normalizeGenericKey(category);
  const first = String(name || "").trim().split(/\s+/)[0] || fallback;
  return normalizeGenericKey(first);
}

export function isProductConfirmed(product) {
  if (!product) return false;
  if (product.confirmed === true) return true;
  if (product.confirmed === false) return false;
  return Boolean(product.barcode);
}

export function normalizeProductRecord(product) {
  if (!product) return product;
  const category = product.category || "";
  const name = product.name || "";
  return {
    ...product,
    category,
    brand: product.brand || "",
    kind: inferProductKind(product),
    genericKey: product.genericKey || genericKeyFromParts(category, name),
    confirmed: isProductConfirmed(product),
    catalogSource: product.catalogSource || "",
  };
}

export function openFoodFactsSuggestion(product) {
  const name = String(product.product_name_ru || product.product_name || product.generic_name_ru || "").trim();
  if (!name) return null;
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

export function activeResponses(request) {
  return (request.responses || []).filter((response) => !response.deletedAt);
}

export function isRequestFulfilled(request) {
  return request.items.length > 0 && request.items.every((item) =>
    responseItemTotal(request, item.productId).quantity >= Number(item.quantity)
  );
}

export function ensureSingleReceipt(nextRequest, changedAt, actor = "local") {
  const writer = actor || "local";
  const active = activeResponses(nextRequest)
    .slice()
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  if (!active.length) {
    const reusable = (nextRequest.responses || [])
      .slice()
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))[0];
    if (reusable) {
      reusable.items = [];
      reusable.deletedAt = "";
      reusable.updatedAt = changedAt;
      reusable.updatedBy = writer;
      return reusable;
    }
    const receipt = {
      id: `response_${nextRequest.id}`,
      requestId: nextRequest.id,
      items: [],
      createdAt: changedAt,
      createdBy: writer,
      updatedAt: changedAt,
      updatedBy: writer,
    };
    nextRequest.responses = nextRequest.responses || [];
    nextRequest.responses.push(receipt);
    return receipt;
  }
  const primary = nextRequest.responses.find((item) => item.id === active[0].id);
  if (active.length > 1) {
    const merged = new Map();
    active.forEach((response) => {
      response.items.forEach((item) => {
        const previous = merged.get(item.productId);
        if (!previous) {
          merged.set(item.productId, structuredClone(item));
          return;
        }
        previous.quantity = (Number(previous.quantity) || 0) + (Number(item.quantity) || 0);
        previous.price = (Number(previous.price) || 0) + (Number(item.price) || 0);
        if (item.purchasedProductId) previous.purchasedProductId = item.purchasedProductId;
        if (item.completionMode === "filled") previous.completionMode = "filled";
      });
      if (response.id !== primary.id) {
        response.deletedAt = changedAt;
        response.updatedAt = changedAt;
        response.updatedBy = writer;
      }
    });
    primary.items = [...merged.values()];
    primary.updatedAt = changedAt;
    primary.updatedBy = writer;
    primary.deletedAt = "";
  }
  return primary;
}

export function purchaseLineMatches(line, expected) {
  if (!line || !expected) return false;
  return line.productId === expected.productId
    && String(line.purchasedProductId || line.productId) === String(expected.purchasedProductId || expected.productId)
    && Number(line.quantity) === Number(expected.quantity)
    && Number(line.price || 0) === Number(expected.price || 0)
    && String(line.completionMode || "closed") === String(expected.completionMode || "closed");
}

export function materializePurchasedProduct(nextState, item, changedAt, actor = "local") {
  if (!item.purchasedProduct) return item.purchasedProductId || item.productId;
  const suggestion = item.purchasedProduct;
  const writer = actor || "local";
  const requestedProduct = nextState.products.find((product) => product.id === item.productId && !product.deletedAt);
  if (requestedProduct && !isProductConfirmed(requestedProduct)) {
    const category = suggestion.category || requestedProduct.category || "";
    Object.assign(requestedProduct, {
      name: suggestion.name,
      category,
      brand: suggestion.brand || requestedProduct.brand || "",
      unit: suggestion.unit || requestedProduct.unit || "шт.",
      barcode: suggestion.barcode || requestedProduct.barcode || "",
      ingredients: suggestion.ingredients || requestedProduct.ingredients || "",
      nutrition: suggestion.nutrition ? structuredClone(suggestion.nutrition) : requestedProduct.nutrition,
      catalogSource: suggestion.catalogSource || requestedProduct.catalogSource || "Open Food Facts",
      kind: suggestion.kind || (suggestion.barcode ? "sku" : inferProductKind(requestedProduct)),
      genericKey: suggestion.genericKey
        || requestedProduct.genericKey
        || genericKeyFromParts(category, suggestion.name || requestedProduct.name),
      confirmed: Boolean(suggestion.barcode),
      updatedAt: changedAt,
      updatedBy: writer,
    });
    return requestedProduct.id;
  }
  const existing = nextState.products.find((product) =>
    !product.deletedAt && (
      (suggestion.barcode && product.barcode === suggestion.barcode)
      || normalizeProductName(product.name) === normalizeProductName(suggestion.name)
    )
  );
  if (existing) return existing.id;
  const category = suggestion.category || "";
  const product = {
    id: createId("product"),
    name: suggestion.name,
    category,
    brand: suggestion.brand || "",
    unit: suggestion.unit || "шт.",
    barcode: suggestion.barcode || "",
    ingredients: suggestion.ingredients || "",
    catalogSource: suggestion.catalogSource || "Open Food Facts",
    nutrition: suggestion.nutrition ? structuredClone(suggestion.nutrition) : null,
    kind: suggestion.kind || (suggestion.barcode ? "sku" : "generic"),
    genericKey: suggestion.genericKey || genericKeyFromParts(category, suggestion.name),
    confirmed: Boolean(suggestion.barcode),
    updatedAt: changedAt,
    updatedBy: writer,
  };
  nextState.products.push(product);
  return product.id;
}

export function productPurchasedTotal(productId, source) {
  return (source.requests || []).filter((request) => !request.deletedAt).reduce((total, request) => total + activeResponses(request).reduce(
    (requestTotal, response) => requestTotal + response.items.reduce((responseTotal, item) => {
      return responseTotal + ((item.purchasedProductId || item.productId) === productId ? Number(item.quantity) || 0 : 0);
    }, 0),
    0
  ), 0);
}

export function plannedRationRequestItems(source, dates, selectedItemIds) {
  const portions = new Map();
  dates.forEach((dateKey) => (rationDayFor(source, dateKey)?.meals || []).forEach((meal) =>
    (meal.items || []).forEach((item) => {
      if (!item.productId || !selectedItemIds.has(item.id)) return;
      const product = (source.products || []).find((value) => value.id === item.productId);
      const measure = rationMeasure(product);
      const portionSize = Number(item.portionSize) || measure.defaultPortion;
      const packageSize = Number(item.packageSize) || measure.defaultPackage;
      const current = portions.get(item.productId) || {
        productId: item.productId,
        plannedAmount: 0,
        packageSize,
        measureUnit: item.measureUnit || measure.unit,
      };
      current.plannedAmount += portionSize;
      current.packageSize = packageSize;
      portions.set(item.productId, current);
    })
  ));
  return [...portions.values()].map((item) => ({
    ...item,
    quantity: Math.max(1, Math.ceil(item.plannedAmount / item.packageSize)),
    unit: "уп.",
  }));
}

export function rationMeasure(product) {
  const unit = String(product?.unit || "г").toLowerCase();
  if (unit.includes("шт")) return { unit: "шт.", defaultPortion: 1, defaultPackage: 1 };
  if (unit === "л" || unit.includes("мл")) return { unit: "мл", defaultPortion: 250, defaultPackage: 1000 };
  return { unit: "г", defaultPortion: 100, defaultPackage: 1000 };
}

export function rationOwner(source) {
  return String(source?.user?.email || "local").trim().toLowerCase() || "local";
}

export function rationDayKey(dateKey, source) {
  return `${rationOwner(source)}|${dateKey}`;
}

export function rationDayFor(source, dateKey) {
  const owner = rationOwner(source);
  return source.rationDays?.[`${owner}|${dateKey}`]
    || (owner === "local" ? source.rationDays?.[dateKey] : null);
}

export function todayDateKey() {
  return formatRationDate(new Date());
}

export function parseRationDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function formatRationDate(value) {
  const date = value instanceof Date ? value : parseRationDate(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function timestamp(value) {
  const result = Date.parse(value || "");
  return Number.isFinite(result) ? result : 0;
}

export function updateRequestStatus(request, changedAt = request.updatedAt) {
  if (isRequestFulfilled(request)) {
    request.status = "done";
    request.completedAt = request.completedAt || changedAt || new Date().toISOString();
  } else {
    request.status = "open";
    request.completedAt = "";
  }
  return request;
}

export function appendRequestVersion(request, action, createdAt, actor, transactionId = createId("transaction")) {
  request.history = request.history || [];
  request.history.push({
    id: transactionId,
    action,
    createdAt,
    updatedAt: createdAt,
    createdBy: actor || "local",
    snapshot: requestSnapshot(request),
  });
}

export function restoreRequestVersion(request, transaction, changedAt, actor) {
  const history = structuredClone(request.history || []);
  const currentResponses = new Map((request.responses || []).map((response) => [response.id, response]));
  const restored = normalizeRequestSnapshot(transaction.snapshot, request.id);
  restored.responses = restored.responses.map((response) => ({
    ...response,
    deletedAt: response.deletedAt ? changedAt : "",
    updatedAt: changedAt,
    updatedBy: actor || "local",
  }));
  const restoredIds = new Set(restored.responses.map((response) => response.id));
  currentResponses.forEach((response, responseId) => {
    if (restoredIds.has(responseId)) return;
    restored.responses.push({
      ...structuredClone(response),
      deletedAt: changedAt,
      updatedAt: changedAt,
      updatedBy: actor || "local",
    });
  });
  Object.keys(request).forEach((key) => delete request[key]);
  Object.assign(request, restored, {
    history,
    updatedAt: changedAt,
    updatedBy: actor || "local",
  });
  updateRequestStatus(request, changedAt);
  appendRequestVersion(request, `Откат: ${transaction.action}`, changedAt, actor);
  return request;
}

function normalizeGenericKey(value) {
  return normalizeProductName(value).replace(/[^a-zа-яё0-9]+/gi, "_").replace(/^_|_$/g, "");
}

function inferProductKind(product) {
  if (product?.kind === "generic" || product?.kind === "sku") return product.kind;
  if (product?.barcode || product?.brand) return "sku";
  return "generic";
}

function formatAmount(value) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

function finiteNutrient(value) {
  const result = Number(value);
  return value === "" || value == null || !Number.isFinite(result) ? null : result;
}

function openFoodFactsUnit(product) {
  const water = (product.categories_tags || []).some((tag) => /water/i.test(tag));
  const quantity = String(product.quantity || "").toLowerCase();
  if (water || /\b(ml|мл|l|л)\b/.test(quantity)) return "л";
  if (/\b(kg|кг)\b/.test(quantity)) return "кг";
  if (/\b(g|г)\b/.test(quantity)) return "г";
  return "шт.";
}

function openFoodFactsCategory(product) {
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

function openFoodFactsNutrition(product) {
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

function requestSnapshot(request) {
  return structuredClone({
    id: request.id,
    createdAt: request.createdAt,
    completedAt: request.completedAt || "",
    createdBy: request.createdBy || "local",
    updatedAt: request.updatedAt,
    updatedBy: request.updatedBy || request.createdBy || "local",
    status: request.status,
    items: request.items,
    responses: request.responses,
  });
}

function responseItemTotal(request, productId) {
  return activeResponses(request).reduce((total, response) => {
    const item = response.items.find((value) => value.productId === productId);
    if (item) {
      total.quantity += Number(item.quantity) || 0;
      total.price += Number(item.price) || 0;
    }
    return total;
  }, { quantity: 0, price: 0 });
}

function mergeVersioned(localValues, remoteValues) {
  const merged = new Map(localValues.map((value) => [value.id, value]));
  remoteValues.forEach((remote) => {
    const local = merged.get(remote.id);
    if (!local || timestamp(remote.updatedAt) > timestamp(local.updatedAt)) {
      merged.set(remote.id, remote);
    }
  });
  return [...merged.values()];
}

function mergeRequests(localValues, remoteValues) {
  const merged = new Map(localValues.map((request) => {
    const normalized = normalizeRequest(request);
    return [normalized.id, normalized];
  }));
  remoteValues.forEach((remoteValue) => {
    const remote = normalizeRequest(remoteValue);
    const local = merged.get(remote.id);
    if (!local) {
      merged.set(remote.id, remote);
      return;
    }
    const metadata = timestamp(remote.updatedAt) > timestamp(local.updatedAt) ? remote : local;
    merged.set(remote.id, normalizeRequest({
      ...metadata,
      responses: mergeVersioned(local.responses, remote.responses),
      history: mergeVersioned(local.history || [], remote.history || []),
    }));
  });
  return [...merged.values()];
}

function dedupeByProduct(values) {
  const unique = new Map();
  values.forEach((value) => {
    if (value?.productId) unique.set(value.productId, value);
  });
  return [...unique.values()];
}

function normalizeRequest(request) {
  const responses = mergeVersioned([], (request.responses || []).map((response) =>
    normalizeResponse(response, request.id)
  ));
  const normalized = {
    ...request,
    items: dedupeByProduct(request.items || []).map(withoutLegacyStock),
    responses,
    deletedAt: request.deletedAt || "",
  };
  updateRequestStatus(normalized, request.completedAt || request.updatedAt);
  normalized.history = mergeVersioned([], (request.history || []).map((transaction) => ({
    ...transaction,
    id: transaction.id || `transaction_${request.id}_${transaction.createdAt || request.updatedAt}`,
    action: transaction.action || "Изменение запроса",
    createdAt: transaction.createdAt || transaction.updatedAt || request.updatedAt,
    updatedAt: transaction.updatedAt || transaction.createdAt || request.updatedAt,
    createdBy: transaction.createdBy || request.updatedBy || request.createdBy || "local",
    snapshot: normalizeRequestSnapshot(transaction.snapshot || request, request.id),
  })));
  if (!normalized.history.length) {
    appendRequestVersion(
      normalized,
      "Исходная версия",
      normalized.updatedAt || normalized.createdAt,
      normalized.updatedBy || normalized.createdBy,
      `transaction_initial_${normalized.id}`
    );
  }
  return normalized;
}

function normalizeRequestSnapshot(snapshot, requestId) {
  const responses = mergeVersioned([], (snapshot?.responses || []).map((response) =>
    normalizeResponse(response, requestId)
  ));
  const normalized = {
    ...structuredClone(snapshot || {}),
    id: requestId,
    items: dedupeByProduct(snapshot?.items || []).map(withoutLegacyStock),
    responses,
  };
  updateRequestStatus(normalized, normalized.completedAt || normalized.updatedAt);
  delete normalized.history;
  return normalized;
}

function normalizeResponse(response, requestId) {
  return {
    ...response,
    id: response.id || `response_legacy_${requestId}`,
    requestId,
    items: dedupeByProduct(response.items || []).map((item) => ({
      ...withoutLegacyStock(item),
      purchasedProductId: item.purchasedProductId || item.productId,
      completionMode: item.completionMode || "filled",
    })),
    createdAt: response.createdAt || response.updatedAt || new Date(0).toISOString(),
    createdBy: response.createdBy || "remote",
    updatedAt: response.updatedAt || response.createdAt || new Date(0).toISOString(),
    updatedBy: response.updatedBy || response.createdBy || "remote",
    deletedAt: response.deletedAt || "",
  };
}

function withoutLegacyStock(item) {
  const normalized = { ...item, note: String(item?.note || "") };
  delete normalized.stockAtRequest;
  return normalized;
}

function migrateRequest(request) {
  const updatedAt = request.updatedAt || request.completedAt || request.createdAt || new Date(0).toISOString();
  const legacyResponses = !request.responses?.length && request.purchases?.length
    ? [{
        id: `response_legacy_${request.id}`,
        requestId: request.id,
        items: request.purchases,
        createdAt: request.completedAt || updatedAt,
        createdBy: request.updatedBy || request.createdBy || "local",
        updatedAt,
        updatedBy: request.updatedBy || request.createdBy || "local",
      }]
    : [];
  return normalizeRequest({
    ...request,
    createdBy: request.createdBy || "local",
    updatedAt,
    updatedBy: request.updatedBy || request.createdBy || "local",
    items: dedupeByProduct(request.items || []).map(withoutLegacyStock),
    responses: request.responses?.length ? request.responses : legacyResponses,
  });
}
