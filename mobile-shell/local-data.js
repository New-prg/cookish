import {
  RATION_DISCREPANCY_KINDS,
  RATION_MEAL_STATES,
  RATION_SCHEMA_VERSION,
  createId,
  describeRationCommand,
  emptyRation,
  applyRationCommand,
  formatRationDate,
  genericKeyFromParts,
  migrateRationState,
  normalizeProductName,
  parseRationDate,
  plannedRationRequestItems,
  rationMeasure,
  rationOwner,
  readRationDay,
  readRationDayNutrition,
  readRationHistoryDay,
  readRationRange,
  resolveOrCreateProduct,
  todayDateKey,
  validateRationProfile,
} from "./ration-domain.js";
import {
  appendChangeSet,
  diffPlan,
  normalizeJournal,
  readChangeSets,
  revertChangeSet as revertJournalChangeSet,
} from "./plan-journal.js";
import {
  BOOKMARK_LIMIT,
  defaultAssistantState,
  enqueueNudges,
  normalizeAssistantState,
  rationNudges,
  STRICTNESS_LEVELS,
} from "./nudges.js";

export { createId, formatRationDate, genericKeyFromParts, migrateRationState, normalizeProductName, parseRationDate, plannedRationRequestItems, rationMeasure, rationOwner, readRationDayNutrition, readRationHistoryDay, readRationRange, todayDateKey, validateRationProfile, RATION_DISCREPANCY_KINDS, RATION_MEAL_STATES };

export const STORAGE_KEY = "cookish.android.data.v1";
export const SCHEMA_VERSION = RATION_SCHEMA_VERSION;

export function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    products: [],
    requests: [],
    ration: emptyRation(),
    journal: [],
    assistant: defaultAssistantState(),
    user: null,
    onboardingCompleted: true,
  };
}

export function memoryStorage(initial = null) {
  let value = initial == null ? null : structuredClone(initial);
  const backups = new Map();
  return {
    read() {
      return value == null ? null : structuredClone(value);
    },
    write(state) {
      value = structuredClone(state);
    },
    backup(state, label) {
      if (!backups.has(label)) backups.set(label, structuredClone(state));
    },
    backups: () => structuredClone(Object.fromEntries(backups)),
  };
}

export function browserStorage(localStorage, key = STORAGE_KEY) {
  // Backups are written once per label and never overwritten, so the data an
  // older build left behind survives a faulty migration or an unreadable blob.
  function keepOnce(label, raw) {
    const backupKey = `${key}.backup.${label}`;
    try {
      if (localStorage.getItem(backupKey) == null) localStorage.setItem(backupKey, raw);
    } catch {
      // A backup must never block opening the app.
    }
  }

  return {
    read() {
      let raw = null;
      try {
        raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        if (raw) keepOnce("unreadable", raw);
        return null;
      }
    },
    write(state) {
      localStorage.setItem(key, JSON.stringify(state));
    },
    backup(state, label) {
      keepOnce(label, JSON.stringify(state));
    },
  };
}

export function openLocalData(storage) {
  // `current` is always normalized and deep-frozen, so it is shared with callers
  // without copying. Commands mutate a private draft and replace `current` only
  // after the storage write succeeds. Normalization (`prepareState`) runs only
  // for data that comes from outside: storage on load and `commit`.
  let current = deepFreeze(prepareState(emptyState()));

  function snapshot() {
    return current;
  }

  function persist(next) {
    try {
      storage.write(next);
    } catch (error) {
      return { ok: false, storageFailed: true, reason: storageFailureReason(error) };
    }
    current = deepFreeze(next);
    return { ok: true };
  }

  function replaceAll(source) {
    const saved = persist(prepareState(source));
    if (!saved.ok) throw new Error(saved.reason);
    return current;
  }

  // A command copies only the parts of the state it may change; the rest stays
  // shared and frozen, so an out-of-scope write throws instead of leaking.
  function draft(scope) {
    const next = { ...current };
    if (scope.products) next.products = structuredClone(current.products);
    if (scope.ration) next.ration = structuredClone(current.ration);
    if (scope.journal) next.journal = (current.journal || []).slice();
    if (scope.assistant) next.assistant = structuredClone(current.assistant || defaultAssistantState());
    if (scope.requestId) {
      next.requests = current.requests.map((request) =>
        request.id === scope.requestId ? structuredClone(request) : request
      );
    } else if (scope.addRequest) {
      next.requests = current.requests.slice();
    }
    return next;
  }

  function apply(scope, mutator) {
    const next = draft(scope);
    const context = {
      now: new Date().toISOString(),
      actor: String(next.user?.email || "local"),
      today: todayDateKey(),
    };
    const result = mutator(next, context) || { ok: false };
    if (result.ok === false) return result;
    if (result.changed !== false) {
      const saved = persist(next);
      if (!saved.ok) return saved;
      result.state = current;
    }
    result.request = result.requestId ? current.requests.find((item) => item.id === result.requestId) : undefined;
    result.product = result.productId ? current.products.find((item) => item.id === result.productId) : undefined;
    return result;
  }

  return {
    load() {
      const stored = storage.read();
      const usable = stored && typeof stored === "object";
      const version = Number(usable && stored.schemaVersion) || 0;
      if (usable && version < SCHEMA_VERSION) storage.backup?.(stored, `v${version}`);
      current = deepFreeze(prepareState(usable ? stored : emptyState()));
      return current;
    },
    commit(nextState) {
      return replaceAll(nextState);
    },
    snapshot,
    clear() {
      return replaceAll(emptyState());
    },

    saveProduct(fields) {
      return apply({ products: true }, (next, { now, actor }) => {
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
      return apply({ products: true }, (next, { now, actor }) => {
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
      return apply({ products: true }, (next, { now, actor }) => {
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
      return apply({ addRequest: true }, (next, { now, actor }) => {
        const request = {
          id: createId("request"),
          createdAt: now,
          status: "open",
          completedAt: "",
          deletedAt: "",
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
      return apply({ products: true, requestId }, (next, { now, actor }) => {
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
      return apply({ requestId }, (next, { now, actor }) => {
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
      return apply({ products: true, requestId }, (next, { now, actor }) => {
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
      return apply({ requestId }, (next, { now, actor }) => {
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
      return apply({ products: true, requestId }, (next, { now, actor }) => {
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
      return apply({ requestId }, (next, { now, actor }) => {
        const request = (next.requests || []).find((item) => item.id === requestId && !item.deletedAt);
        if (!request) return { ok: false, reason: "Запрос не найден." };
        const transaction = (request.history || []).find((item) => item.id === historyId);
        if (!transaction) return { ok: false, reason: "Версия не найдена." };
        restoreRequestVersion(request, transaction, now, actor);
        return { ok: true, requestId };
      });
    },

    addRationMeal(dateKey) {
      return runRation({ type: "addMeal", date: dateKey });
    },

    updateRationMeal(dateKey, mealId, fields) {
      return runRation({ type: "updateMeal", date: dateKey, mealId, fields });
    },

    removeRationMeal(dateKey, mealId) {
      return runRation({ type: "removeMeal", date: dateKey, mealId });
    },

    addRationFood(dateKey, mealId) {
      return runRation({ type: "addItem", date: dateKey, mealId });
    },

    saveRationFood(dateKey, mealId, itemId, { name, hint, addNext } = {}) {
      return runRation({ type: "saveItem", date: dateKey, mealId, itemId, name, hint, addNext });
    },

    removeRationFood(dateKey, mealId, itemId) {
      return runRation({ type: "removeItem", date: dateKey, mealId, itemId });
    },

    // Applies several plan changes as one Набор изменений. `mutator(draft,
    // context)` changes the draft through domain commands and returns
    // { ok, ... }; a failure discards the whole batch. Products the batch
    // creates or edits are journaled only when it names them in `productIds`.
    changePlan({ actor = "human", page = "", summary = "", productIds = [] } = {}, mutator) {
      return apply({ ration: true, products: true, journal: true }, (next, context) => {
        const ctx = actor === "ai" ? { ...context, actor: "ai" } : context;
        const result = mutator(next, ctx) || { ok: false };
        if (result.ok === false) return result;
        const diff = diffPlan(current, next, { productIds: [...productIds, ...(result.productIds || [])] });
        if (!diff) return { ...result, ok: true, changed: false };
        const set = appendChangeSet(next, { now: ctx.now, actor, page, summary: result.summary || summary, diff });
        return { ...result, ok: true, changeSetId: set.id };
      });
    },

    revertChangeSet(changeSetId, { actor = "human" } = {}) {
      return apply({ ration: true, products: true, journal: true }, (next, context) =>
        revertJournalChangeSet(next, changeSetId, { now: context.now, actor: actor === "ai" ? "ai" : context.actor })
      );
    },

    changeSets(options) {
      return readChangeSets(current, options);
    },

    setAssistantSettings(fields = {}) {
      return apply({ assistant: true }, (next) => {
        const settings = next.assistant.settings;
        if (fields.strictness != null) {
          if (!STRICTNESS_LEVELS[fields.strictness]) return { ok: false, reason: "Неизвестный уровень жёсткости." };
          settings.strictness = fields.strictness;
        }
        if (fields.howToReact != null) settings.howToReact = String(fields.howToReact).trim().slice(0, 600);
        return { ok: true, settings: structuredClone(settings) };
      });
    },

    // The worker processed these Тычки; a non-empty text becomes the notice
    // on the handle and the first message of the next chat.
    finishNudges(ids, noticeText = "") {
      const done = new Set(ids || []);
      return apply({ assistant: true }, (next, { now }) => {
        next.assistant.nudges = next.assistant.nudges.filter((item) => !done.has(item.id));
        const text = String(noticeText || "").trim();
        if (text) next.assistant.notice = { text, createdAt: now };
        return { ok: true };
      });
    },

    // Закладка: a thread the person saved, with its messages and unapplied
    // Предложения. Saving the same thread again updates its bookmark.
    saveBookmark(bookmark) {
      if (!bookmark?.id) return { ok: false, reason: "Нечего сохранять." };
      return apply({ assistant: true }, (next, { now }) => {
        const list = next.assistant.bookmarks;
        const value = { ...structuredClone(bookmark), createdAt: bookmark.createdAt || now, updatedAt: now };
        const index = list.findIndex((item) => item.id === bookmark.id);
        if (index >= 0) list.splice(index, 1);
        list.unshift(value);
        if (list.length > BOOKMARK_LIMIT) list.length = BOOKMARK_LIMIT;
        return { ok: true, bookmarkId: value.id };
      });
    },

    removeBookmark(bookmarkId) {
      return apply({ assistant: true }, (next) => {
        const before = next.assistant.bookmarks.length;
        next.assistant.bookmarks = next.assistant.bookmarks.filter((item) => item.id !== bookmarkId);
        if (next.assistant.bookmarks.length === before) return { ok: false, reason: "Закладка не найдена." };
        return { ok: true };
      });
    },

    clearAssistantNotice() {
      return apply({ assistant: true }, (next) => {
        if (!next.assistant.notice) return { ok: true, changed: false };
        next.assistant.notice = null;
        return { ok: true };
      });
    },

    // `undo` is the payload returned by removeRationMeal/removeRationFood.
    undoRationRemoval(undo) {
      if (!["restoreMeal", "restoreItem"].includes(undo?.type)) return { ok: false, reason: "Нечего отменять." };
      return runRation(undo);
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

    removeRationDiscrepancy(dateKey, mealId, index) {
      return runRation({ type: "removeDiscrepancy", date: dateKey, mealId, index });
    },

    repeatRationDays(from, length) {
      return runRation({ type: "repeatDays", from, length });
    },

    undoRationRepeat(undo) {
      if (undo?.type !== "withdrawRepeat") return { ok: false, reason: "Нечего отменять." };
      return runRation(undo);
    },

    transferRationMeals(dateKey, mealId, minutes, confirmMidnight = false) {
      return runRation({ type: "transferMeals", date: dateKey, mealId, minutes, confirmMidnight });
    },

    createRequestFromRation({ dates, itemIds } = {}) {
      return apply({ addRequest: true }, (next, { now, actor }) => {
        const requestItems = plannedRationRequestItems(next, [...(dates || [])].sort(), new Set(itemIds || []));
        if (!requestItems.length) return { ok: false, reason: "Выберите хотя бы одну позицию рациона." };
        const request = {
          id: createId("request"),
          createdAt: now,
          status: "open",
          completedAt: "",
          deletedAt: "",
          items: requestItems.map((item) => ({ ...item, note: "" })),
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

  // Every ration command runs here. A command that changes the plan writes a
  // Набор изменений; marks and discrepancies are История and write none.
  function runRation(command) {
    return apply({ ration: true, products: true, journal: true, assistant: true }, (next, context) => {
      const result = applyRationCommand(next, command, context);
      if (result.ok === false) return result;
      // A deviation in История питания becomes a Тычок for the assistant.
      const nudges = context.actor === "ai" ? [] : rationNudges(command, current, next, { now: context.now });
      enqueueNudges(next.assistant, nudges);
      if (nudges.length) result.nudges = nudges.length;
      const diff = diffPlan(current, next);
      if (diff) {
        const set = appendChangeSet(next, {
          now: context.now,
          actor: context.actor === "ai" ? "ai" : "human",
          page: "ration",
          summary: describeRationCommand(command),
          diff,
        });
        result.changeSetId = set.id;
      }
      return result;
    });
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function storageFailureReason(error) {
  const quota = error?.name === "QuotaExceededError" || error?.code === 22 || error?.code === 1014;
  return quota
    ? "Память приложения заполнена: изменение не сохранено."
    : "Не удалось сохранить данные на устройстве: изменение не сохранено.";
}

export function prepareState(source) {
  const result = { ...emptyState(), ...structuredClone(source && typeof source === "object" ? source : {}) };
  result.onboardingCompleted = true;
  // Calendar view preferences of the retired ration editor (PRD 6.5.5).
  delete result.rationView;
  delete result.rationAnchor;
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
  result.journal = normalizeJournal(result.journal);
  result.assistant = normalizeAssistantState(result.assistant);
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

// Each history entry stores a full request snapshot, so the journal is bounded:
// repeated edits of one kind by one person within a short window update the
// latest entry (autosave while typing), and only the newest entries are kept.
export const REQUEST_HISTORY_LIMIT = 30;
const REQUEST_HISTORY_MERGE_MS = 10 * 60 * 1000;
const MERGEABLE_REQUEST_ACTIONS = new Set(["Запрос изменён", "Детали покупки обновлены"]);

export function appendRequestVersion(request, action, createdAt, actor, transactionId = createId("transaction")) {
  request.history = request.history || [];
  const writer = actor || "local";
  const latest = request.history[request.history.length - 1];
  if (
    latest
    && MERGEABLE_REQUEST_ACTIONS.has(action)
    && latest.action === action
    && latest.createdBy === writer
    && timestamp(createdAt) - timestamp(latest.updatedAt) <= REQUEST_HISTORY_MERGE_MS
  ) {
    latest.updatedAt = createdAt;
    latest.snapshot = requestSnapshot(request);
    return;
  }
  request.history.push({
    id: transactionId,
    action,
    createdAt,
    updatedAt: createdAt,
    createdBy: writer,
    snapshot: requestSnapshot(request),
  });
  trimRequestHistory(request);
}

function trimRequestHistory(request) {
  if (request.history.length > REQUEST_HISTORY_LIMIT) {
    request.history.splice(0, request.history.length - REQUEST_HISTORY_LIMIT);
  }
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
    deletedAt: "",
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
  trimRequestHistory(normalized);
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
      ...withoutStockAtRequest(item),
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
  return { ...withoutStockAtRequest(item), note: String(item?.note || "") };
}

function withoutStockAtRequest(item) {
  const normalized = { ...item };
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
