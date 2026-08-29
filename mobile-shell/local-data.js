import {
  RATION_DISCREPANCY_KINDS,
  RATION_MEAL_STATES,
  RATION_SCHEMA_VERSION,
  cloneMealsWithNewIds,
  createId,
  emptyRation,
  executeRationCommand,
  formatRationDate,
  genericKeyFromParts,
  migrateRationState,
  normalizeProductName,
  parseRationDate,
  plannedRationRequestItems,
  rationDayKey,
  rationMeasure,
  rationOwner,
  readRationDay,
  readRationDayNutrition,
  readRationHistoryDay,
  resolveOrCreateProduct,
  todayDateKey,
  validateRationProfile,
} from "./ration-domain.js";

export { createId, formatRationDate, genericKeyFromParts, migrateRationState, normalizeProductName, parseRationDate, plannedRationRequestItems, rationDayKey, rationMeasure, rationOwner, readRationDayNutrition, readRationHistoryDay, todayDateKey, validateRationProfile, RATION_DISCREPANCY_KINDS, RATION_MEAL_STATES };

export const STORAGE_KEY = "cookish.android.data.v1";
export const SCHEMA_VERSION = RATION_SCHEMA_VERSION;

export function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    products: [],
    requests: [],
    ration: emptyRation(),
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

  function apply(mutator) {
    const next = structuredClone(current);
    const context = {
      now: new Date().toISOString(),
      actor: String(next.user?.email || "local"),
      today: todayDateKey(),
    };
    const result = mutator(next, context) || { ok: false };
    if (result.ok === false) return result;
    if (result.changed === false) {
      result.request = result.requestId
        ? snapshot().requests.find((item) => item.id === result.requestId)
        : undefined;
      result.product = result.productId
        ? snapshot().products.find((item) => item.id === result.productId)
        : undefined;
      return result;
    }
    current = prepareState(next);
    storage.write(current);
    const view = snapshot();
    if (result.requestId) result.request = view.requests.find((item) => item.id === result.requestId);
    if (result.productId) result.product = view.products.find((item) => item.id === result.productId);
    result.state = view;
    return result;
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

    saveProduct(fields) {
      return apply((next, { now, actor }) => {
        const name = String(fields.name || "").trim();
        if (!name) return { ok: false, reason: "Название продукта не заполнено." };
        const category = String(fields.category || "").trim();
        const barcode = String(fields.barcode || "").trim();
        const values = {
          name,
          barcode,
          category,
          unit: fields.unit || "шт.",
          brand: fields.brand || "",
          kind: barcode ? "sku" : (fields.kind || "generic"),
          genericKey: fields.genericKey || genericKeyFromParts(category, name),
          confirmed: true,
          updatedAt: now,
          updatedBy: actor,
          nutrition: fields.nutrition || null,
          ingredients: String(fields.ingredients || "").trim(),
          catalogSource: fields.catalogSource || "",
        };
        if (fields.id) {
          const product = next.products.find((item) => item.id === fields.id);
          if (!product || product.deletedAt) return { ok: false, reason: "Продукт не найден." };
          Object.assign(product, values);
          return { ok: true, productId: product.id };
        }
        const product = { id: createId("product"), ...values };
        next.products.push(product);
        return { ok: true, productId: product.id };
      });
    },

    removeProduct(productId) {
      return apply((next, { now, actor }) => {
        const used = (next.requests || []).some((request) =>
          !request.deletedAt && (
            (request.items || []).some((item) => item.productId === productId)
            || (request.responses || []).some((response) => !response.deletedAt && (response.items || []).some((item) =>
              (item.purchasedProductId || item.productId) === productId
            ))
          )
        );
        if (used) return { ok: false, reason: "Продукт используется в запросе." };
        const product = next.products.find((item) => item.id === productId);
        if (!product || product.deletedAt) return { ok: false, reason: "Продукт не найден." };
        product.deletedAt = now;
        product.updatedAt = now;
        product.updatedBy = actor;
        return { ok: true, productId, name: product.name };
      });
    },

    restoreProduct(productId) {
      return apply((next, { now, actor }) => {
        const product = next.products.find((item) => item.id === productId);
        if (!product) return { ok: false, reason: "Продукт не найден." };
        if (!product.deletedAt) return { ok: true, changed: false, productId };
        product.deletedAt = "";
        product.updatedAt = now;
        product.updatedBy = actor;
        return { ok: true, productId, name: product.name };
      });
    },

    createRequest() {
      return apply((next, { now, actor }) => {
        const request = {
          id: createId("request"),
          createdAt: now,
          status: "open",
          items: [],
          responses: [],
          createdBy: actor,
          updatedBy: actor,
          updatedAt: now,
          history: [],
        };
        appendRequestVersion(request, "Запрос создан", now, actor);
        next.requests.push(request);
        return { ok: true, requestId: request.id };
      });
    },

    saveRequestItems(requestId, lines) {
      return apply((next, { now, actor }) => {
        const request = (next.requests || []).find((item) => item.id === requestId && !item.deletedAt);
        if (!request) return { ok: false, reason: "Запрос не найден." };
        const items = [];
        for (const line of lines || []) {
          const product = resolveOrCreateProduct(next, line, now, actor);
          if (!product) continue;
          const previous = (request.items || []).find((item) => item.productId === product.id) || {};
          const unit = String(previous.unit || product.unit || line.unit || "шт.").trim() || "шт.";
          items.push({
            ...previous,
            productId: product.id,
            quantity: Number(line.quantity) || 1,
            unit,
            note: String(line.note || "").trim(),
          });
        }
        if (new Set(items.map((item) => item.productId)).size !== items.length) {
          return { ok: false, reason: "Один продукт нельзя добавлять в запрос дважды." };
        }
        const answeredProductIds = new Set(
          activeResponses(request).flatMap((response) =>
            response.items.filter((item) => item.quantity || item.price).map((item) => item.productId)
          )
        );
        if ([...answeredProductIds].some((productId) => !items.some((item) => item.productId === productId))) {
          return { ok: false, reason: "Нельзя удалить товар, который уже указан в ответе." };
        }
        if (items.some((item) => responseItemTotal(request, item.productId).quantity > Number(item.quantity))) {
          return { ok: false, reason: "Количество нельзя уменьшить ниже уже купленного." };
        }
        const sameItems = items.length === (request.items || []).length
          && items.every((item, index) => {
            const previous = request.items[index];
            return previous
              && previous.productId === item.productId
              && Number(previous.quantity) === Number(item.quantity)
              && String(previous.unit || "") === String(item.unit || "")
              && String(previous.note || "") === String(item.note || "");
          });
        if (sameItems) return { ok: true, changed: false, requestId };
        request.items = items;
        request.updatedAt = now;
        request.updatedBy = actor;
        updateRequestStatus(request);
        appendRequestVersion(request, items.length ? "Запрос изменён" : "Запрос очищен", now, actor);
        return { ok: true, requestId };
      });
    },

    removeRequest(requestId) {
      return apply((next, { now, actor }) => {
        const request = (next.requests || []).find((item) => item.id === requestId);
        if (!request || request.deletedAt) return { ok: false, reason: "Запрос не найден." };
        request.deletedAt = now;
        request.updatedAt = now;
        request.updatedBy = actor;
        (request.responses || []).forEach((response) => {
          response.deletedAt = now;
          response.updatedAt = now;
          response.updatedBy = actor;
        });
        return { ok: true, requestId };
      });
    },

    markBought(requestId, productId, details = {}) {
      return apply((next, { now, actor }) => {
        const request = (next.requests || []).find((item) => item.id === requestId && !item.deletedAt);
        if (!request) return { ok: false, reason: "Запрос не найден." };
        const requestItem = (request.items || []).find((item) => item.productId === productId)
          || (request.items || []).find((item) =>
            normalizeProductName(liveProduct(next, item.productId)?.name || "")
            === normalizeProductName(liveProduct(next, productId)?.name || details.query || "")
          );
        const resolvedProductId = requestItem?.productId || (liveProduct(next, productId) ? productId : "");
        if (!resolvedProductId) return { ok: false, reason: "Товар не найден в запросе." };
        const requested = Number(requestItem?.quantity || 0);
        let quantity = Number(details.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) quantity = requested || 1;
        quantity = Math.min(quantity, requested || quantity);
        const price = Number(details.price);
        const safePrice = Number.isFinite(price) && price >= 0 ? price : 0;
        const currentLine = receiptLine(request, resolvedProductId);
        const expectedPurchasedProductId = details.purchasedProductId || resolvedProductId;
        const expectedFilled = safePrice > 0
          || Boolean(details.purchasedProduct)
          || expectedPurchasedProductId !== resolvedProductId
          || details.completionMode === "filled";
        const expectedCompletionMode = expectedFilled ? "filled" : (details.completionMode || "closed");
        if (!details.purchasedProduct && purchaseLineMatches(currentLine, {
          productId: resolvedProductId,
          purchasedProductId: expectedPurchasedProductId,
          quantity,
          price: safePrice,
          completionMode: expectedCompletionMode,
        })) {
          return { ok: true, changed: false, requestId };
        }
        const purchasedProductId = materializePurchasedProduct(next, {
          ...details,
          productId: resolvedProductId,
        }, now, actor) || resolvedProductId;
        const receipt = ensureSingleReceipt(request, now, actor);
        let line = receipt.items.find((item) => item.productId === resolvedProductId);
        const isNewLine = !line;
        const filled = safePrice > 0
          || Boolean(details.purchasedProduct)
          || (purchasedProductId && purchasedProductId !== resolvedProductId)
          || details.completionMode === "filled";
        if (!line) {
          line = {
            productId: resolvedProductId,
            purchasedProductId,
            quantity,
            price: safePrice,
            completionMode: filled ? "filled" : (details.completionMode || "closed"),
          };
          receipt.items.push(line);
        } else {
          line.quantity = quantity;
          line.price = safePrice;
          line.purchasedProductId = purchasedProductId;
          line.completionMode = filled ? "filled" : (details.completionMode || line.completionMode || "closed");
        }
        receipt.updatedAt = now;
        receipt.updatedBy = actor;
        receipt.deletedAt = "";
        request.updatedAt = now;
        request.updatedBy = actor;
        updateRequestStatus(request, now);
        appendRequestVersion(
          request,
          isNewLine ? "Покупка отмечена" : "Детали покупки обновлены",
          now,
          actor
        );
        return { ok: true, requestId, productId: resolvedProductId };
      });
    },

    unmarkBought(requestId, productId) {
      return apply((next, { now, actor }) => {
        const request = (next.requests || []).find((item) => item.id === requestId && !item.deletedAt);
        if (!request) return { ok: false, reason: "Запрос не найден." };
        if (!receiptLine(request, productId)) return { ok: true, changed: false, requestId };
        const receipt = ensureSingleReceipt(request, now, actor);
        const before = receipt.items.length;
        receipt.items = receipt.items.filter((item) => item.productId !== productId);
        if (receipt.items.length === before) return { ok: true, changed: false, requestId };
        receipt.updatedAt = now;
        receipt.updatedBy = actor;
        if (!receipt.items.length) receipt.deletedAt = now;
        request.updatedAt = now;
        request.updatedBy = actor;
        updateRequestStatus(request, now);
        appendRequestVersion(request, "Отметка покупки снята", now, actor);
        return { ok: true, requestId, productId };
      });
    },

    saveReceipt(requestId, items, responseId = "") {
      return apply((next, { now, actor }) => {
        const request = (next.requests || []).find((item) => item.id === requestId && !item.deletedAt);
        if (!request) return { ok: false, reason: "Запрос не найден." };
        const sourceItems = (items || []).filter((item) => item.productId);
        if (!sourceItems.length) return { ok: false, reason: "Отметьте хотя бы одну купленную позицию." };
        const responseItems = sourceItems.map((item) => ({
          productId: item.productId,
          purchasedProductId: materializePurchasedProduct(next, item, now, actor),
          quantity: Number(item.quantity),
          price: Number(item.price) || 0,
          completionMode: item.completionMode || "filled",
        }));
        const edited = responseId
          ? (request.responses || []).find((response) => response.id === responseId)
          : null;
        if (edited) {
          edited.items = responseItems;
          edited.updatedAt = now;
          edited.updatedBy = actor;
          edited.deletedAt = "";
        } else {
          const receipt = ensureSingleReceipt(request, now, actor);
          receipt.items = responseItems;
          receipt.updatedAt = now;
          receipt.updatedBy = actor;
          receipt.deletedAt = "";
        }
        request.updatedAt = now;
        request.updatedBy = actor;
        updateRequestStatus(request, now);
        appendRequestVersion(request, edited ? "Транзакция изменена" : "Транзакция добавлена", now, actor);
        return { ok: true, requestId };
      });
    },

    restoreVersion(requestId, historyId) {
      return apply((next, { now, actor }) => {
        const request = (next.requests || []).find((item) => item.id === requestId && !item.deletedAt);
        if (!request) return { ok: false, reason: "Запрос не найден." };
        const transaction = (request.history || []).find((item) => item.id === historyId);
        if (!transaction) return { ok: false, reason: "Версия не найдена." };
        restoreRequestVersion(request, transaction, now, actor);
        return { ok: true, requestId };
      });
    },

    setRationCalendar({ view, anchor } = {}) {
      return apply((next) => {
        if (view) next.rationView = view;
        if (anchor) next.rationAnchor = anchor;
        return { ok: true };
      });
    },

    addRationMeal(dateKey) {
      return runRation({ type: "addMeal", date: dateKey }, dateKey);
    },

    updateRationMeal(dateKey, mealId, fields) {
      return runRation({ type: "updateMeal", date: dateKey, mealId, fields }, dateKey);
    },

    removeRationMeal(dateKey, mealId) {
      return runRation({ type: "removeMeal", date: dateKey, mealId }, dateKey);
    },

    addRationFood(dateKey, mealId) {
      return runRation({ type: "addItem", date: dateKey, mealId }, dateKey);
    },

    saveRationFood(dateKey, mealId, itemId, { name, hint, addNext } = {}) {
      return runRation({ type: "saveItem", date: dateKey, mealId, itemId, name, hint, addNext }, dateKey);
    },

    removeRationFood(dateKey, mealId, itemId) {
      return runRation({ type: "removeItem", date: dateKey, mealId, itemId }, dateKey);
    },

    setRationPortion(dateKey, mealId, itemId, { portionSize, packageSize, measureUnit } = {}) {
      return runRation({ type: "setPortion", date: dateKey, mealId, itemId, portionSize, packageSize, measureUnit });
    },

    markRationMeal(dateKey, mealId, state) {
      return runRation({ type: "markMeal", date: dateKey, mealId, state });
    },

    setRationProfile(fields) {
      return runRation({ type: "setRationProfile", fields });
    },

    recordRationDiscrepancy(dateKey, mealId, discrepancy) {
      return runRation({ type: "recordDiscrepancy", date: dateKey, mealId, discrepancy });
    },

    transferRationMeals(dateKey, mealId, minutes, confirmMidnight = false) {
      return runRation({ type: "transferMeals", date: dateKey, mealId, minutes, confirmMidnight });
    },

    saveRationTemplateFromDay(dateKey, name) {
      return apply((next, { now, actor }) => {
        const title = String(name || "").trim();
        if (!title) return { ok: false, reason: "Название шаблона не заполнено." };
        const day = readRationDay(next, dateKey);
        if (!day?.meals?.length) return { ok: false, reason: "День больше не содержит приёмов пищи." };
        next.rationTemplates = next.rationTemplates || [];
        const template = {
          id: createId("ration_template"),
          name: title,
          owner: rationOwner(next),
          meals: cloneMealsWithNewIds(day.meals),
          createdAt: now,
          updatedAt: now,
          updatedBy: actor,
        };
        next.rationTemplates.push(template);
        return { ok: true, templateId: template.id };
      });
    },

    renameRationTemplate(templateId, name) {
      return apply((next, { now }) => {
        const title = String(name || "").trim();
        if (!title) return { ok: false, reason: "Название шаблона не заполнено." };
        const template = (next.rationTemplates || []).find((item) => item.id === templateId);
        if (!template) return { ok: false, reason: "Шаблон не найден." };
        template.name = title;
        template.updatedAt = now;
        return { ok: true, templateId };
      });
    },

    removeRationTemplate(templateId) {
      return apply((next) => {
        const before = (next.rationTemplates || []).length;
        next.rationTemplates = (next.rationTemplates || []).filter((item) => item.id !== templateId);
        if (next.rationTemplates.length === before) return { ok: false, reason: "Шаблон не найден." };
        return { ok: true };
      });
    },

    applyRationTemplate(templateId, dates) {
      return apply((next, context) => {
        const template = (next.rationTemplates || []).find((item) => item.id === templateId);
        if (!template) return { ok: false, reason: "Шаблон не найден." };
        const keys = [...new Set(dates || [])];
        if (!keys.length) return { ok: false, reason: "Выберите дни для шаблона." };
        const result = executeRationCommand(next, { type: "replaceDays", dates: keys, meals: template.meals }, context);
        if (result.ok === false) return result;
        replaceStateInPlace(next, result.state);
        return { ok: true, dates: keys };
      });
    },

    deleteRationSelection({ mealIds, itemIds, dates } = {}) {
      return runRation({ type: "deleteSelection", mealIds, itemIds, dates });
    },

    createRequestFromRation({ dates, itemIds } = {}) {
      return apply((next, { now, actor }) => {
        const requestItems = plannedRationRequestItems(next, [...(dates || [])].sort(), new Set(itemIds || []));
        if (!requestItems.length) return { ok: false, reason: "Выберите хотя бы одну позицию рациона." };
        const request = {
          id: createId("request"),
          createdAt: now,
          status: "open",
          items: requestItems,
          responses: [],
          createdBy: actor,
          updatedBy: actor,
          updatedAt: now,
          history: [],
        };
        appendRequestVersion(request, "Запрос создан из рациона", now, actor);
        next.requests.push(request);
        return { ok: true, requestId: request.id };
      });
    },
  };

  function runRation(command, anchor = "") {
    return apply((next, context) => {
      const result = executeRationCommand(next, command, context);
      if (result.ok === false) return { ok: false, reason: result.reason };
      if (anchor) next.rationAnchor = anchor;
      const { state: commandState, ...payload } = result;
      replaceStateInPlace(next, commandState);
      return payload;
    });
  }
}

function replaceStateInPlace(target, source) {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, source);
}

export function prepareState(source) {
  const result = { ...emptyState(), ...structuredClone(source && typeof source === "object" ? source : {}) };
  result.onboardingCompleted = true;
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
  return migrateRationState(result);
}

export function rationDayFor(source, dateKey) {
  return readRationDay(source, dateKey);
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

export function requestReceipt(request) {
  return activeResponses(request)
    .slice()
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))[0] || null;
}

export function receiptLine(request, productId) {
  return requestReceipt(request)?.items.find((item) => item.productId === productId) || null;
}

export function remainingRequestQuantity(request, productId, excludedResponseId = "") {
  const requested = Number(request.items.find((item) => item.productId === productId)?.quantity || 0);
  const bought = activeResponses(request)
    .filter((response) => response.id !== excludedResponseId)
    .reduce((sum, response) => sum + Number(response.items.find((item) => item.productId === productId)?.quantity || 0), 0);
  return Math.max(0, requested - bought);
}

function liveProduct(source, productId) {
  return (source.products || []).find((product) => product.id === productId && !product.deletedAt) || null;
}

export function rationTemplatesForUser(source) {
  const owner = rationOwner(source);
  return (source.rationTemplates || [])
    .filter((template) => String(template.owner || "local").trim().toLowerCase() === owner)
    .sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
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

export function responseItemTotal(request, productId) {
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
