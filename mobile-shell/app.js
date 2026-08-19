import {
  activeResponses,
  browserStorage,
  formatRationDate,
  isProductConfirmed,
  isRequestFulfilled,
  normalizeProductName,
  openFoodFactsSuggestion,
  openLocalData,
  parseRationDate,
  productPurchasedTotal,
  rationDayFor,
  rationMeasure,
  rationTemplatesForUser,
  receiptLine,
  remainingRequestQuantity,
  responseItemTotal,
  timestamp,
  todayDateKey,
} from "./local-data.js";

  // Небольшой офлайн-справочник для мгновенных подсказок. Значения усреднены
  // на 100 г (для напитков — на 100 мл) и могут отличаться у конкретных марок.
  const FOOD_CATALOG = [
    food("Молоко 2,5%", "Молочные продукты", "л", 52, 2.8, 2.5, 4.7, 0, "B2: 0,15 мг; B12: 0,4 мкг; D: 0,05 мкг", "Кальций: 120 мг; калий: 146 мг"),
    food("Кефир 2,5%", "Молочные продукты", "л", 53, 3, 2.5, 4, 0, "B2: 0,17 мг; B12: 0,4 мкг", "Кальций: 120 мг; калий: 146 мг"),
    food("Творог 5%", "Молочные продукты", "г", 145, 21, 5, 3, 0, "B2: 0,3 мг; B12: 1 мкг", "Кальций: 164 мг; фосфор: 220 мг"),
    food("Сыр твёрдый", "Молочные продукты", "г", 350, 25, 27, 2, 0, "A: 250 мкг; B12: 1,5 мкг", "Кальций: 700 мг; фосфор: 500 мг"),
    food("Яйца куриные", "Молочные продукты и яйца", "шт.", 157, 12.7, 11.5, 0.7, 0, "A: 260 мкг; D: 2,2 мкг; B12: 0,9 мкг", "Железо: 2,5 мг; селен: 31,7 мкг"),
    food("Куриная грудка", "Мясо и птица", "кг", 113, 23.6, 1.9, 0.4, 0, "B3: 10,9 мг; B6: 0,5 мг", "Фосфор: 173 мг; селен: 17 мкг"),
    food("Говядина", "Мясо и птица", "кг", 187, 18.9, 12.4, 0, 0, "B12: 2,6 мкг; B6: 0,4 мг", "Железо: 2,6 мг; цинк: 6 мг"),
    food("Лосось", "Рыба и морепродукты", "кг", 208, 20, 13, 0, 0, "D: 10,9 мкг; B12: 3,2 мкг", "Омега-3: 2,3 г; селен: 36,5 мкг"),
    food("Хлеб ржаной", "Хлеб и выпечка", "шт.", 210, 6.6, 1.2, 40.8, 8.3, "B1: 0,18 мг; B3: 1,2 мг", "Магний: 40 мг; железо: 2,6 мг"),
    food("Рис белый сухой", "Крупы и макароны", "г", 344, 6.7, 0.7, 78.9, 1.4, "B1: 0,08 мг; B6: 0,2 мг", "Магний: 35 мг; фосфор: 98 мг"),
    food("Гречка сухая", "Крупы и макароны", "г", 308, 12.6, 3.3, 57.1, 11.3, "B1: 0,3 мг; B6: 0,4 мг", "Магний: 200 мг; железо: 6,7 мг"),
    food("Макароны сухие", "Крупы и макароны", "г", 344, 10.4, 1.1, 71.5, 3.6, "B1: 0,17 мг; B3: 1,2 мг", "Фосфор: 87 мг; железо: 1,6 мг"),
    food("Картофель", "Овощи", "кг", 77, 2, 0.4, 16.3, 1.4, "C: 20 мг; B6: 0,3 мг", "Калий: 568 мг; магний: 23 мг"),
    food("Морковь", "Овощи", "кг", 35, 1.3, 0.1, 6.9, 2.4, "A: 835 мкг; K: 13,2 мкг", "Калий: 320 мг; кальций: 33 мг"),
    food("Помидоры", "Овощи", "кг", 18, 0.9, 0.2, 2.7, 1.2, "C: 13,7 мг; A: 42 мкг", "Калий: 237 мг; ликопин: 2,6 мг"),
    food("Огурцы", "Овощи", "кг", 15, 0.7, 0.1, 2.5, 1, "K: 16,4 мкг; C: 2,8 мг", "Калий: 147 мг; магний: 13 мг"),
    food("Яблоки", "Фрукты", "кг", 52, 0.3, 0.2, 11.4, 2.4, "C: 4,6 мг", "Калий: 107 мг; бор: 0,25 мг"),
    food("Бананы", "Фрукты", "кг", 89, 1.1, 0.3, 20.2, 2.6, "B6: 0,37 мг; C: 8,7 мг", "Калий: 358 мг; магний: 27 мг"),
    food("Апельсины", "Фрукты", "кг", 47, 0.9, 0.1, 9.4, 2.4, "C: 53,2 мг; B9: 30 мкг", "Калий: 181 мг; кальций: 40 мг"),
    food("Миндаль", "Орехи", "г", 579, 21.2, 49.9, 9.1, 12.5, "E: 25,6 мг; B2: 1,1 мг", "Магний: 270 мг; кальций: 269 мг"),
    food("Масло подсолнечное", "Масла и соусы", "л", 899, 0, 99.9, 0, 0, "E: 41 мг; K: 5,4 мкг", "Омега-6: 65,7 г"),
    food("Вода питьевая", "Напитки", "л", 0, 0, 0, 0, 0, "", "Минеральный состав зависит от источника"),
  ];

  function food(name, category, unit, calories, protein, fat, carbs, fiber, vitamins, minerals) {
    return { id: `catalog_${name.toLowerCase().replace(/[^а-яёa-z0-9]+/g, "_")}`, name, category, unit,
      catalogSource: "Встроенный справочник",
      nutrition: { calories, protein, fat, carbs, fiber, vitamins, minerals, basis: "100 г/мл", source: "Встроенный справочник" } };
  }
  const localData = openLocalData(browserStorage(window.localStorage));
  let state = localData.load();
  let route = "summary";
  let routeId = null;
  let routeSubId = null;
  let draftItems = [];
  let appUpdate = {
    status: window.NativeCookish?.checkForAppUpdate ? "idle" : "unsupported",
    installedVersion: "",
  };
  let appUpdateNoticeShown = false;
  let toastTimer = null;
  let productLookupWorking = false;
  let remoteProductSuggestions = [];
  let productNameSearchTimer = null;
  let productNameSearchSequence = 0;
  const productNameSearchCache = new Map();
  let barcodeScanTarget = "product";
  let answerDraftItems = new Map();
  let purchaseFillProduct = null;
  let rationSelectedDates = new Set();
  let rationSelectedItemIds = new Set();
  let rationSelectedMealIds = new Set();
  let rationSelectionMode = false;
  let rationPortionTarget = null;
  let formDirty = false;
  let requestAutosaveTimer = null;
  let confirmResolve = null;
  let productEditReturn = null;
  let requestGestureToken = 0;
  let purchaseDialogViewportFrame = 0;
  let purchaseDialogBaselineHeight = 0;

  const app = document.getElementById("app");
  const title = document.getElementById("page-title");
  const headerAction = document.getElementById("header-action");
  const requestHeaderMenuWrap = document.getElementById("request-header-menu-wrap");
  const headerMore = document.getElementById("header-more");
  const requestHeaderMenu = document.getElementById("request-header-menu");
  const rationHeaderPicker = document.getElementById("ration-header-picker");
  const nav = document.querySelector(".bottom-nav");

  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.route));
  });

  ["input", "change"].forEach((eventName) => app.addEventListener(eventName, (event) => {
    const dialog = event.target.closest("dialog");
    if (dialog) dialog.dataset.dirty = "true";
    if (["product-new", "product-edit", "request-answer"].includes(route)) formDirty = true;
  }));

  headerAction.addEventListener("click", () => {
    if (route === "products") {
      navigate("product-new");
    } else if (route === "requests") {
      createEmptyRequestAndOpen();
    } else if (route === "request-answer") {
      finishRequestAnswer();
    } else if (route === "request-edit") {
      finishRequestEdit();
    } else attemptBackNavigation();
  });

  headerMore.addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = requestHeaderMenu.hidden;
    requestHeaderMenu.hidden = !opening;
    headerMore.setAttribute("aria-expanded", String(opening));
  });

  document.getElementById("request-info-action").addEventListener("click", () => {
    closeRequestHeaderMenu();
    if (route === "request-edit") persistRequestDraft({ silent: true });
    const dialog = document.getElementById("request-info-dialog");
    if (!dialog) return;
    refreshRequestInfoDialog(dialog, getRequest(routeId));
    dialog.showModal();
  });

  document.getElementById("request-delete-action").addEventListener("click", () => {
    closeRequestHeaderMenu();
    const request = route === "request-edit" ? getRequest(routeId) : null;
    if (request) deleteRequestWithTransactions(request);
  });

  document.addEventListener("click", (event) => {
    if (!requestHeaderMenuWrap.contains(event.target)) closeRequestHeaderMenu();
  });

  window.__handleNativeBack = () => attemptBackNavigation();

  window.__onNativeBarcodeScan = (payload) => {
    const result = JSON.parse(payload);
    if (!result.ok) {
      if (!result.cancelled) {
        if (barcodeScanTarget === "purchase") setPurchaseStatus("Не удалось распознать штрихкод.", true);
        else setBarcodeStatus("Не удалось распознать штрихкод.", true);
      }
      return;
    }
    if (barcodeScanTarget === "purchase") {
      lookupPurchaseBarcode(result.barcode);
      return;
    }
    const form = document.getElementById("product-form");
    if (!form) return;
    form.elements.barcode.value = result.barcode;
    formDirty = true;
    setBarcodeStatus(`Распознан штрихкод ${result.barcode}. Загружаем карточку…`);
    lookupProductBarcode();
  };

  window.__onNativeAppUpdate = (payload) => {
    try {
      appUpdate = JSON.parse(payload);
    } catch {
      appUpdate = { ...appUpdate, status: "error", message: "Android вернул некорректный ответ." };
    }
    if (appUpdate.status === "available" && !appUpdateNoticeShown && state.onboardingCompleted) {
      appUpdateNoticeShown = true;
      showToast(`Доступна новая версия Cookish ${appUpdate.latestVersion}. Обновить можно в профиле.`);
    }
    if (route === "profile") renderProfile();
  };

  function applyLocal(result, reasonFallback) {
    if (!result?.ok) {
      if (result?.reason || reasonFallback) showToast(result?.reason || reasonFallback);
      return false;
    }
    state = localData.snapshot();
    return true;
  }

  function navigate(next, id = null, subId = null, options = {}) {
    if (route === "request-edit" && next !== "request-edit" && !options.skipRequestPersist) {
      clearTimeout(requestAutosaveTimer);
      if (document.getElementById("request-items") && !persistRequestDraft({ silent: false })) return;
      draftItems = [];
    }
    if (route === "ration" && next !== "ration") clearRationSelection();
    route = next;
    routeId = id;
    routeSubId = subId;
    formDirty = false;
    window.scrollTo(0, 0);
    render();
  }

  function finishRequestEdit() {
    formDirty = false;
    clearTimeout(requestAutosaveTimer);
    const active = document.activeElement;
    if (active && app.contains(active) && typeof active.blur === "function" && active !== headerAction) {
      active.blur();
    }
    if (document.getElementById("request-items") && !persistRequestDraft({ silent: false })) return;
    draftItems = [];
    navigate("requests", null, null, { skipRequestPersist: true });
  }

  function attemptBackNavigation() {
    const openDialog = document.querySelector("dialog[open]");
    if (openDialog) {
      closeDialogSafely(openDialog);
      return true;
    }
    if (route === "request-answer") {
      finishRequestAnswer();
      return true;
    }
    if (route === "request-edit") {
      finishRequestEdit();
      return true;
    }
    if (formDirty && !confirm("Отменить изменения? Несохранённые данные будут потеряны.")) return true;
    draftItems = [];
    if (route === "product-new" || route === "product-edit") {
      const ret = productEditReturn;
      productEditReturn = null;
      if (ret?.route) navigate(ret.route, ret.id || null);
      else navigate("products");
    } else if (route === "products") navigate("profile");
    else if (route === "request-detail") navigate("request-edit", routeId);
    else return false;
    return true;
  }

  function closeDialogSafely(dialog) {
    if (dialog.id === "app-confirm-dialog") {
      dialog.close();
      return true;
    }
    if (dialog.id === "answer-action-dialog") {
      // Soft-commit quantity/price so details are not lost on back/dismiss.
      const productId = dialog.dataset.productId;
      savePurchaseDraftItem(true);
      commitInlinePurchaseDraft(productId);
      return true;
    }
    if (dialog.dataset.dirty === "true") {
      // Keep native confirm here: called from sync back-handler path.
      if (!window.confirm("Закрыть без сохранения изменений?")) return false;
    }
    dialog.dataset.dirty = "false";
    dialog.close();
    return true;
  }

  function askConfirm(message) {
    return new Promise((resolve) => {
      confirmResolve = resolve;
      let dialog = document.getElementById("app-confirm-dialog");
      if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.id = "app-confirm-dialog";
        dialog.className = "answer-dialog confirm-dialog";
        dialog.innerHTML = `
          <h2 id="app-confirm-title">Подтверждение</h2>
          <p id="app-confirm-message"></p>
          <button id="app-confirm-ok" class="button full" type="button">Подтвердить</button>
          <button id="app-confirm-cancel" class="text-button dialog-cancel" type="button">Отмена</button>`;
        document.body.appendChild(dialog);
        dialog.addEventListener("cancel", (event) => {
          event.preventDefault();
          finishConfirm(false);
        });
        document.getElementById("app-confirm-ok").onclick = () => finishConfirm(true);
        document.getElementById("app-confirm-cancel").onclick = () => finishConfirm(false);
      }
      document.getElementById("app-confirm-message").textContent = message;
      dialog.showModal();
    });
  }

  function finishConfirm(result) {
    const dialog = document.getElementById("app-confirm-dialog");
    if (dialog?.open) dialog.close();
    const resolve = confirmResolve;
    confirmResolve = null;
    if (resolve) resolve(result);
  }

  function clearRationSelection() {
    rationSelectedDates.clear();
    rationSelectedItemIds.clear();
    rationSelectedMealIds.clear();
    rationSelectionMode = false;
  }

  function render() {
    const rootRoute = route.startsWith("product") ? "profile"
      : route.startsWith("request") ? "requests"
      : route;
    document.querySelectorAll(".bottom-nav button").forEach((button) => {
      const active = button.dataset.route === rootRoute;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    nav.hidden = route.includes("-new") || route.endsWith("-edit") || route === "request-answer";
    document.body.classList.toggle("nav-hidden", Boolean(nav.hidden));
    document.body.style.paddingBottom = "";
    configureHeader();

    if (route === "summary") renderSummary();
    else if (route === "products") renderProducts();
    else if (route === "product-new") renderProductForm();
    else if (route === "product-edit") renderProductForm();
    else if (route === "requests") renderRequests();
    else if (route === "request-edit") renderRequestForm();
    else if (route === "request-detail") {
      draftItems = [];
      navigate("request-edit", routeId);
      return;
    }
    else if (route === "request-answer") renderRequestAnswer();
    else if (route === "ration") renderRation();
    else if (route === "profile") renderProfile();
  }

  function configureHeader() {
    const config = {
      summary: ["Сводка", "", false],
      products: ["Продукты", "Добавить", false],
      "product-new": ["Новый продукт", "Отмена", true],
      "product-edit": ["Редактирование", productEditReturn ? "Назад" : "Отмена", true],
      requests: ["Запросы", "Создать", false],
      "request-edit": ["", "Готово", true],
      "request-detail": ["Запрос", "Назад", false],
      "request-answer": ["Отметить покупки", "Готово", true],
      ration: ["Рацион", "", false],
      profile: ["Профиль", "", false],
    }[route];
    const editedRequest = route === "request-edit" ? getRequest(routeId) : null;
    title.textContent = editedRequest ? date(editedRequest.createdAt) : config[0];
    headerAction.textContent = config[1];
    headerAction.hidden = !config[1];
    requestHeaderMenuWrap.hidden = route !== "request-edit";
    closeRequestHeaderMenu();
    rationHeaderPicker.hidden = route !== "ration";
  }

  function closeRequestHeaderMenu() {
    requestHeaderMenu.hidden = true;
    headerMore.setAttribute("aria-expanded", "false");
  }

  function renderSummary() {
    const completed = activeRequests().filter((item) => item.status === "done");
    const totals = completed.map(requestTotal);
    const total = totals.reduce((sum, value) => sum + value, 0);
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const last30 = completed
      .filter((item) => new Date(item.completedAt || item.createdAt).getTime() >= cutoff)
      .reduce((sum, item) => sum + requestTotal(item), 0);
    const active = activeRequests().filter((item) => !isRequestFulfilled(item));

    const productCount = state.products.filter((product) => !product.deletedAt).length;
    app.innerHTML = `
      <div class="summary-screen">
      <div class="metrics">
        ${metric("Активные запросы", active.length)}
        ${metric("Средний чек", money(completed.length ? total / completed.length : 0))}
        ${metric("Траты за 30 дней", money(last30))}
        <button id="summary-products" class="metric metric-button" type="button"><span>Продукты</span><strong>${productCount}</strong></button>
      </div>
      <section class="section summary-requests">
        <h2 class="section-title">Активные запросы</h2>
        ${active.length
          ? active.map((request) => requestRow(request, "summary")).join("")
          : `<div class="empty-state">
              <p class="empty">Пока нет активных запросов</p>
              <p class="muted">Создайте список покупок или соберите его из рациона.</p>
              <button id="summary-empty-request" class="button full" type="button">Создать запрос</button>
            </div>`}
        ${active.length ? `<button id="summary-new-request" class="button full summary-create-request" type="button">Создать запрос</button>` : ""}
      </section>
      </div>
    `;
    bindRequestRows();
    document.getElementById("summary-new-request")?.addEventListener("click", () => createEmptyRequestAndOpen());
    document.getElementById("summary-empty-request")?.addEventListener("click", () => createEmptyRequestAndOpen());
    document.getElementById("summary-products")?.addEventListener("click", () => navigate("products"));
  }

  function productSuggestions() {
    const unique = new Map();
    [...state.products.filter((product) => !product.deletedAt), ...remoteProductSuggestions, ...FOOD_CATALOG].forEach((product) => {
      const key = normalizeProductName(product.name);
      if (!unique.has(key)) unique.set(key, product);
    });
    return [...unique.values()];
  }

  function suggestionByName(name) {
    const key = normalizeProductName(name);
    if (!key) return null;
    return productSuggestions().find((product) => normalizeProductName(product.name) === key) || null;
  }

  function isRealProductId(productId) {
    return Boolean(productId && state.products.some((product) => product.id === productId && !product.deletedAt));
  }

  function resolveDraftProductId(query, previousId = "") {
    const key = normalizeProductName(query);
    if (!key) return "";
    const previous = isRealProductId(previousId) ? getProduct(previousId) : null;
    if (previous && normalizeProductName(previous.name) === key) return previousId;
    const existing = state.products.find((product) => !product.deletedAt && normalizeProductName(product.name) === key);
    if (existing) return existing.id;
    // Catalog/OFF ids are not real products until they are saved into local data.
    return "";
  }

  function suggestionLabel(product) {
    const nutrition = product.nutrition;
    const origin = state.products.some((item) => item.id === product.id)
      ? "В ваших продуктах"
      : product.catalogSource === "Open Food Facts"
        ? `Open Food Facts${product.brand ? ` · ${product.brand}` : ""}`
        : "Справочник";
    if (!nutrition) return `${origin} · ${product.category || "без категории"}`;
    return `${origin} · ${number(nutrition.calories)} ккал · Б ${number(nutrition.protein)} · Ж ${number(nutrition.fat)} · У ${number(nutrition.carbs)}`;
  }

  function nutritionLine(nutrition) {
    if (!nutrition) return "";
    return `<span class="nutrition-line">На 100 г/мл: ${number(nutrition.calories)} ккал · Б ${number(nutrition.protein)} · Ж ${number(nutrition.fat)} · У ${number(nutrition.carbs)}</span>`;
  }

  function nutritionField(label, name, value) {
    return `<label class="field"><span>${label}</span><input name="${name}" type="number" min="0" step="0.01" value="${value ?? ""}"></label>`;
  }

  function nutritionFromForm(data, source) {
    const fields = ["calories", "protein", "fat", "carbs", "fiber"];
    const hasValue = fields.some((field) => String(data.get(field) || "").trim()) || data.get("vitamins")?.trim() || data.get("minerals")?.trim();
    if (!hasValue) return null;
    return {
      ...Object.fromEntries(fields.map((field) => [field, Number(data.get(field)) || 0])),
      vitamins: data.get("vitamins").trim(),
      minerals: data.get("minerals").trim(),
      basis: "100 г/мл",
      source,
    };
  }

  async function searchOpenFoodFactsByName(query, rowKey) {
    const normalized = normalizeProductName(query);
    if (normalized.length < 3) return;
    const sequence = ++productNameSearchSequence;
    try {
      let suggestions = productNameSearchCache.get(normalized);
      if (!suggestions) {
        const fields = [
          "code", "product_name", "product_name_ru", "generic_name_ru", "brands", "quantity",
          "categories", "categories_tags", "nutriments", "ingredients_text_ru", "ingredients_text",
        ].join(",");
        const params = new URLSearchParams({
          search_terms: query.trim(), search_simple: "1", action: "process", json: "1", page_size: "3", fields,
        });
        const response = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?${params}`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`Open Food Facts: ${response.status}`);
        const body = await response.json();
        suggestions = (body.products || []).map(openFoodFactsSuggestion).filter(Boolean);
        productNameSearchCache.set(normalized, suggestions);
      }
      if (sequence !== productNameSearchSequence) return;
      remoteProductSuggestions = suggestions;
      updateProductDatalists();
    } catch (error) {
      if (sequence !== productNameSearchSequence) return;
    }
  }

  function matchingProductSuggestions(query = "") {
    const normalized = normalizeProductName(query);
    const purchasedIds = new Set(activeRequests().flatMap((request) =>
      activeResponses(request).flatMap((response) =>
        response.items.map((item) => item.purchasedProductId || item.productId)
      )
    ));
    const candidates = normalized
      ? productSuggestions().filter((product) => normalizeProductName(product.name).includes(normalized))
      : state.products.filter((product) => !product.deletedAt).sort((a, b) =>
          Number(purchasedIds.has(b.id)) - Number(purchasedIds.has(a.id))
          || timestamp(b.updatedAt) - timestamp(a.updatedAt)
        );
    return candidates.slice(0, 5);
  }

  function productSuggestionOptions(query = "") {
    return matchingProductSuggestions(query)
      .map((product) =>
      `<option value="${escapeAttr(product.name)}" label="${escapeAttr(suggestionLabel(product))}"></option>`
    ).join("");
  }

  function productSuggestionMenuOptions(query = "") {
    return matchingProductSuggestions(query).map((product) => `
      <button class="product-suggestion" type="button" role="option" data-name="${escapeAttr(product.name)}">
        <strong>${escapeHtml(product.name)}</strong>
        <small>${escapeHtml(suggestionLabel(product))}</small>
      </button>
    `).join("");
  }

  function updateProductDatalists() {
    document.querySelectorAll(".request-item").forEach((row) => {
      const editor = row.querySelector(".request-line-editor");
      if (editor) updateProductSuggestionMenu(row, editor);
    });
  }

  async function lookupProductBarcode() {
    if (productLookupWorking) return;
    const form = document.getElementById("product-form");
    const barcode = form.elements.barcode.value.trim();
    if (!/^\d{8,14}$/.test(barcode)) return setBarcodeStatus("Введите от 8 до 14 цифр штрихкода.", true);
    productLookupWorking = true;
    const button = document.getElementById("lookup-barcode");
    button.disabled = true;
    button.textContent = "Поиск…";
    setBarcodeStatus("Ищем товар в Open Food Facts…");
    try {
      const fields = [
        "code", "product_name", "product_name_ru", "generic_name_ru", "brands", "quantity",
        "categories", "categories_tags", "nutriments", "ingredients_text_ru", "ingredients_text",
      ].join(",");
      const response = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`,
        { headers: { Accept: "application/json" } }
      );
      if (!response.ok) throw new Error(`Open Food Facts: ${response.status}`);
      const body = await response.json();
      if (body.status !== 1 || !body.product) {
        return setBarcodeStatus("Товар с таким штрихкодом пока отсутствует в Open Food Facts.", true);
      }
      const nutritionUpdated = applyOpenFoodFactsProduct(form, body.product);
      if (nutritionUpdated) form.dataset.nutritionSource = "Open Food Facts";
      setBarcodeStatus(`Найдено: ${body.product.product_name_ru || body.product.product_name || barcode}. Проверьте данные перед сохранением.`);
    } catch (error) {
      setBarcodeStatus(error.message || "Не удалось получить карточку товара.", true);
    } finally {
      productLookupWorking = false;
      button.disabled = false;
      button.textContent = "Найти";
    }
  }

  function applyOpenFoodFactsProduct(form, product) {
    formDirty = true;
    const name = product.product_name_ru || product.product_name || product.generic_name_ru || "";
    const category = openFoodFactsCategory(product);
    if (name) form.elements.name.value = name.trim();
    if (category) form.elements.category.value = category;
    form.elements.barcode.value = String(product.code || form.elements.barcode.value);
    form.elements.unit.value = openFoodFactsUnit(product);
    const nutrition = openFoodFactsNutrition(product);
    if (nutrition) {
      ["calories", "protein", "fat", "carbs", "fiber"].forEach((field) => {
        if (nutrition[field] != null) form.elements[field].value = nutrition[field];
      });
      if (nutrition.vitamins) form.elements.vitamins.value = nutrition.vitamins;
      if (nutrition.minerals) form.elements.minerals.value = nutrition.minerals;
    }
    const ingredients = product.ingredients_text_ru || product.ingredients_text || "";
    if (ingredients) form.elements.ingredients.value = ingredients.trim();
    return Boolean(nutrition);
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
      return value == null ? [] : [`${label}: ${number(value * multiplier)} ${unit}`];
    }).join("; ");
  }

  function finiteNutrient(value) {
    const result = Number(value);
    return value === "" || value == null || !Number.isFinite(result) ? null : result;
  }

  function setBarcodeStatus(message, error = false) {
    const status = document.getElementById("barcode-status");
    status.textContent = message;
    status.className = error ? "error barcode-status" : "success barcode-status";
  }

  function renderProducts() {
    const products = state.products.filter((product) => !product.deletedAt);
    app.innerHTML = products.length
      ? products.map((product) => `
          <div class="row product-row">
            <div class="row-main">
              <strong>${escapeHtml(product.name)}</strong>
              <span>${escapeHtml(product.category || "Без категории")} · ${escapeHtml(product.unit)}${product.barcode ? ` · ${escapeHtml(product.barcode)}` : ""}</span>
              ${nutritionLine(product.nutrition)}
            </div>
            <div class="product-actions">
              <button class="text-button edit-product" data-id="${product.id}" type="button" aria-label="Изменить ${escapeAttr(product.name)}">Изменить</button>
              <button class="text-button delete-product" data-id="${product.id}" type="button" aria-label="Удалить ${escapeAttr(product.name)}">Удалить</button>
            </div>
          </div>
        `).join("")
      : `<section class="section"><div class="empty-state">
          <p class="empty">Каталог пока пуст</p>
          <p class="muted">Добавьте продукт вручную, сканером или при создании запроса.</p>
          <button id="products-empty-add" class="button full" type="button">Добавить продукт</button>
        </div></section>`;

    document.getElementById("products-empty-add")?.addEventListener("click", () => navigate("product-new"));
    document.querySelectorAll(".delete-product").forEach((button) => {
      button.addEventListener("click", async () => {
        const product = state.products.find((item) => item.id === button.dataset.id);
        if (!product) return;
        if (!await askConfirm(`Удалить продукт «${product.name}»?`)) return;
        const removed = localData.removeProduct(product.id);
        if (!removed.ok) return showToast(removed.reason);
        state = localData.snapshot();
        renderProducts();
        showToast(`Продукт «${product.name}» удалён.`, "Отменить", () => {
          const restored = localData.restoreProduct(product.id);
          if (!restored.ok) return;
          state = localData.snapshot();
          renderProducts();
          showToast(`Продукт «${product.name}» восстановлен.`);
        });
      });
    });
    document.querySelectorAll(".edit-product").forEach((button) => {
      button.addEventListener("click", () => navigate("product-edit", button.dataset.id));
    });
  }

  function renderProductForm() {
    const editing = route === "product-edit";
    const product = editing ? getProduct(routeId) : null;
    if (editing && !product) return navigate("products");
    app.innerHTML = `
      <form id="product-form" class="form">
        <label class="field"><span>Штрихкод</span>
          <div class="barcode-row">
            <input name="barcode" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="Например, 4605035006964" value="${escapeAttr(product?.barcode || "")}">
            <button id="lookup-barcode" class="button secondary" type="button" ${productLookupWorking ? "disabled" : ""}>${productLookupWorking ? "Поиск…" : "Найти"}</button>
            <button id="scan-barcode" class="button secondary" type="button">Сканировать</button>
          </div>
        </label>
        <p id="barcode-status" class="muted barcode-status">Данные предоставляет Open Food Facts. Проверьте их перед сохранением.</p>
        <label class="field"><span>Наименование</span><input name="name" required autocomplete="off" value="${escapeAttr(product?.name || "")}"></label>
        <label class="field"><span>Категория</span><input name="category" autocomplete="off" value="${escapeAttr(product?.category || "")}"></label>
        <label class="field"><span>Единица измерения</span>
          <select name="unit">
            ${["шт.", "кг", "г", "л", "уп."].map((unit) =>
              `<option value="${unit}" ${unit === product?.unit ? "selected" : ""}>${unit}</option>`
            ).join("")}
          </select>
        </label>
        <section class="nutrition-editor">
          <h2 class="section-title">Пищевая ценность на 100 г/мл</h2>
          <div class="nutrition-grid">
            ${nutritionField("Ккал", "calories", product?.nutrition?.calories)}
            ${nutritionField("Белки, г", "protein", product?.nutrition?.protein)}
            ${nutritionField("Жиры, г", "fat", product?.nutrition?.fat)}
            ${nutritionField("Углеводы, г", "carbs", product?.nutrition?.carbs)}
            ${nutritionField("Клетчатка, г", "fiber", product?.nutrition?.fiber)}
          </div>
          <label class="field"><span>Витамины</span><input name="vitamins" value="${escapeAttr(product?.nutrition?.vitamins || "")}" placeholder="Например: C: 10 мг; B6: 0,2 мг"></label>
          <label class="field"><span>Минералы и другие элементы</span><input name="minerals" value="${escapeAttr(product?.nutrition?.minerals || "")}" placeholder="Например: кальций: 120 мг"></label>
          <label class="field"><span>Состав</span><textarea name="ingredients" rows="3" placeholder="Состав с этикетки">${escapeHtml(product?.ingredients || "")}</textarea></label>
        </section>
        <button class="button full" type="submit">Сохранить</button>
      </form>
    `;
    document.getElementById("lookup-barcode").addEventListener("click", lookupProductBarcode);
    document.getElementById("scan-barcode").addEventListener("click", () => {
      if (!window.NativeCookish?.scanBarcode) return setBarcodeStatus("Сканирование доступно в Android-приложении.", true);
      barcodeScanTarget = "product";
      window.NativeCookish.scanBarcode();
    });
    document.getElementById("product-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const saved = localData.saveProduct({
        id: product?.id,
        name: data.get("name").trim(),
        barcode: data.get("barcode").trim(),
        category: data.get("category").trim(),
        unit: data.get("unit"),
        brand: product?.brand || "",
        kind: product?.kind || "generic",
        genericKey: product?.genericKey || "",
        nutrition: nutritionFromForm(data, event.currentTarget.dataset.nutritionSource || product?.nutrition?.source || "Введено пользователем"),
        ingredients: data.get("ingredients").trim(),
        catalogSource: event.currentTarget.dataset.nutritionSource || product?.catalogSource || "",
      });
      if (!saved.ok) return showToast(saved.reason);
      state = localData.snapshot();
      const ret = productEditReturn;
      productEditReturn = null;
      if (ret?.route) navigate(ret.route, ret.id || null);
      else navigate("products");
      showToast(product ? "Продукт изменён." : "Продукт добавлен.");
    });
  }

  function renderRequests() {
    const sorted = [...activeRequests()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    app.innerHTML = sorted.length
      ? sorted.map((request) => requestRow(request, "requests")).join("")
      : `<section class="section"><div class="empty-state">
          <p class="empty">Запросов пока нет</p>
          <p class="muted">Список покупок создаётся сразу, как заметка: добавляйте позиции по одной.</p>
          <button id="requests-empty-add" class="button full" type="button">Создать запрос</button>
        </div></section>`;
    bindRequestRows();
    document.getElementById("requests-empty-add")?.addEventListener("click", () => createEmptyRequestAndOpen());
  }

  function createEmptyRequestAndOpen() {
    const created = localData.createRequest();
    if (!created.ok) return showToast(created.reason || "Не удалось создать запрос.");
    state = localData.snapshot();
    draftItems = [];
    navigate("request-edit", created.requestId);
  }

  function ensureRequestDraftRows(request) {
    if (!draftItems.length) {
      draftItems = (request.items || []).map((item) => {
        const product = getProduct(item.productId);
        return {
          key: id("item"),
          productId: item.productId,
          query: product?.name || "",
          quantity: item.quantity,
          unit: item.unit || product?.unit || requestItemUnit(item),
          note: String(item.note || ""),
          confirmed: true,
          editingName: false,
        };
      });
    } else {
      // Refresh chip labels after product card edits without wiping in-progress typing.
      draftItems = draftItems.map((item) => {
        if (!item.productId || item.editingName) return item;
        const product = getProduct(item.productId);
        if (!product) return item;
        return {
          ...item,
          query: product.name,
          unit: product.unit || item.unit || "шт.",
        };
      });
    }
    if (!draftItems.some((item) => !String(item.query || "").trim())) {
      draftItems.push({ key: id("item"), productId: "", query: "", quantity: 1, unit: "", note: "", confirmed: false, editingName: true });
    }
  }

  function renderRequestForm(focusKey = "") {
    const editedRequest = getRequest(routeId);
    if (!editedRequest) return navigate("requests");
    ensureRequestDraftRows(editedRequest);
    const spent = requestTotal(editedRequest);
    app.innerHTML = `
      <div class="keep-note">
        <div class="keep-note-actions keep-note-meta" style="border-top:0;padding-bottom:4px" ${spent > 0 ? "" : "hidden"}>
          ${spent > 0 ? `<strong>${money(spent)}</strong>` : ""}
        </div>
        <div id="request-items" class="keep-list">${draftItems.map((item, index) => draftItemRow(item, editedRequest, index)).join("")}</div>
        <button id="add-request-item" class="keep-add-line" type="button">＋ Позиция</button>
        ${answerActionDialog()}
        ${requestInfoDialog(editedRequest)}
      </div>
    `;
    bindDraftItems();
    bindRequestRowGestures(editedRequest);
    bindAnswerDialog(editedRequest, null);
    document.getElementById("add-request-item").onclick = () => {
      commitRequestFieldChange();
      addEmptyRequestLine();
    };
    document.getElementById("close-request-info")?.addEventListener("click", () => {
      document.getElementById("request-info-dialog")?.close();
    });

    if (focusKey) {
      focusRequestLine(document.querySelector(`.request-item[data-key="${focusKey}"]`));
    } else if (!(editedRequest.items || []).length) {
      focusRequestLine(document.querySelector(".request-item:last-child"));
    }
  }

  function draftItemRow(item, request = null, rowIndex = 0) {
    const productName = item.query?.trim() || "позиции";
    const isBlank = !String(item.query || "").trim() && !String(item.note || "").trim();
    const removableEmpty = isBlank && rowIndex > 0;
    const currentRequest = request || getRequest(routeId);
    // Only real product ids (never catalog_*) so purchase price keys match request items.
    const productId = resolveDraftProductId(item.query, item.productId || "");
    const product = productId ? getProduct(productId) : null;
    const resolved = Boolean(product && item.confirmed !== false && !isBlank);
    const purchased = currentRequest && productId
      ? responseItemTotal(currentRequest, productId)
      : { quantity: 0, price: 0 };
    const receipt = currentRequest && productId ? receiptLine(currentRequest, productId) : null;
    const remaining = currentRequest && productId
      ? remainingRequestQuantity(currentRequest, productId)
      : 0;
    const fullyBought = Boolean(productId && !isBlank && remaining <= 0 && purchased.quantity > 0);
    const filled = Boolean(receipt && isPurchaseDetailsFilled(receipt, productId));
    const note = String(item.note || "");
    const lineContent = resolved
      ? `<span class="product-chip${isProductConfirmed(product) ? "" : " is-unconfirmed"}" contenteditable="false" role="button" data-product-id="${escapeAttr(productId)}" aria-label="Открыть карточку ${escapeAttr(product?.name || productName)}">${escapeHtml(product?.name || item.query || "")}</span><span class="request-line-tail">${note ? ` ${escapeHtml(note)}` : ""}</span>`
      : `<span class="product-candidate">${escapeHtml(item.query || "")}</span><span class="request-line-tail">${note ? ` ${escapeHtml(note)}` : ""}</span>`;
    return `
      <div class="request-item${isBlank ? " is-blank" : ""}${removableEmpty ? " is-removable-empty" : ""}${fullyBought ? " is-bought" : ""}${filled ? " is-purchase-filled" : ""}${resolved ? " is-resolved" : ""}" data-key="${item.key}" data-product-id="${escapeAttr(productId)}">
        <div class="request-swipe-bg request-swipe-delete-bg" aria-hidden="true">
          <span class="request-swipe-delete-label">Удалить</span>
        </div>
        <div class="request-swipe-bg request-swipe-fill-bg" aria-hidden="true"><span class="request-swipe-label">${fullyBought ? "Снять" : "Заполнить"}</span></div>
        <div class="request-item-surface">
          <span class="keep-remove-item" aria-hidden="true">
            <span class="request-swipe-dots" aria-hidden="true"></span><span class="keep-remove-cross" aria-hidden="true">×</span>
          </span>
          <div class="request-item-main">
            <div class="request-item-fields">
              <div class="request-product-field">
                <label class="visually-hidden" for="product-${item.key}">Название продукта</label>
                <div id="product-${item.key}" class="request-line-editor" contenteditable="true" role="textbox" aria-label="Строка покупки" data-placeholder="Товар" spellcheck="true">${lineContent}</div>
                <div class="product-token-toolbar" role="group" aria-label="Подтвердить товар" hidden>
                  <button class="confirm-product-token" type="button" aria-label="Сохранить товар">✓</button>
                </div>
                <div class="product-suggestion-menu" role="listbox" aria-label="Выберите товар" hidden></div>
              </div>
            </div>
          </div>
          <span class="request-swipe-handle" aria-hidden="true"><span class="request-swipe-arrow">&lt;</span><span class="request-swipe-dots"></span></span>
        </div>
      </div>`;
  }

  function isPurchaseDetailsFilled(line, requestedProductId = "") {
    if (!line) return false;
    if (Number(line.price) > 0) return true;
    if (line.completionMode === "filled") return true;
    if (line.purchasedProductId && requestedProductId && line.purchasedProductId !== requestedProductId) return true;
    return false;
  }

  function commitRequestFieldChange() {
    clearTimeout(requestAutosaveTimer);
    syncDraftFromForm();
    return persistRequestDraft({ silent: true });
  }

  function bindDraftItems() {
    document.querySelectorAll(".request-line-editor").forEach((editor) => {
      editor.onfocus = () => {
        const row = editor.closest(".request-item");
        row?.classList.add("is-product-picking");
        updateProductSuggestionMenu(row, editor);
        positionProductTokenToolbar(row, editor);
      };
      editor.oninput = () => handleRequestLineInput(editor);
      editor.onbeforeinput = (event) => {
        if (event.inputType !== "deleteContentBackward") return;
        const row = editor.closest(".request-item");
        const item = draftItems.find((value) => value.key === row?.dataset.key);
        if (!item?.confirmed && isRemovableEmptyRow(row)) {
          event.preventDefault();
          cancelDraftProduct(row);
          return;
        }
        if (!item?.confirmed || !isCaretAtStartOfLineTail(editor)) return;
        event.preventDefault();
        unwrapProductChip(row);
      };
      editor.onkeydown = (event) => {
        const row = editor.closest(".request-item");
        const item = draftItems.find((value) => value.key === row?.dataset.key);
        if (event.key === "Backspace" && !item?.confirmed && isRemovableEmptyRow(row)) {
          event.preventDefault();
          cancelDraftProduct(row);
        } else if (event.key === "Enter") {
          event.preventDefault();
          if (item?.confirmed) {
            commitRequestFieldChange();
            addEmptyRequestLine();
          } else {
            confirmDraftProduct(row);
          }
        } else if (event.key === "Escape" && !item?.confirmed) {
          event.preventDefault();
          cancelDraftProduct(row);
        } else if (event.key === "Backspace" && item?.confirmed && isCaretAtStartOfLineTail(editor)) {
          event.preventDefault();
          unwrapProductChip(row);
        }
      };
      editor.onkeyup = () => positionProductTokenToolbar(editor.closest(".request-item"), editor);
      editor.onclick = (event) => {
        const chip = event.target.closest(".product-chip");
        if (chip) {
          event.preventDefault();
          const row = editor.closest(".request-item");
          if (chip.dataset.suppressClick === "1" || row?.dataset.swiped === "1") {
            chip.dataset.suppressClick = "";
            row.dataset.swiped = "";
            return;
          }
          const productId = chip.dataset.productId || row?.dataset.productId;
          if (isRealProductId(productId)) openProductCardFromRequest(productId);
          return;
        }
        positionProductTokenToolbar(editor.closest(".request-item"), editor);
      };
      editor.onblur = () => {
        const row = editor.closest(".request-item");
        setTimeout(() => {
          if (row?.contains(document.activeElement)) return;
          row?.classList.remove("is-product-picking", "has-product-toolbar", "has-suggestion-menu");
          const toolbar = row?.querySelector(".product-token-toolbar");
          const menu = row?.querySelector(".product-suggestion-menu");
          if (toolbar) toolbar.hidden = true;
          if (menu) menu.hidden = true;
          const item = draftItems.find((value) => value.key === row?.dataset.key);
          if (item?.confirmed) commitRequestFieldChange();
        }, 120);
      };
    });
    document.querySelectorAll(".product-suggestion-menu").forEach((menu) => {
      menu.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      menu.addEventListener("touchstart", (event) => event.stopPropagation(), { passive: true });
      menu.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const option = event.target.closest(".product-suggestion");
        if (!option) return;
        const row = menu.closest(".request-item");
        confirmDraftProduct(row, option.dataset.name || "");
      };
    });
    document.querySelectorAll(".product-token-toolbar").forEach((toolbar) => {
      toolbar.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    });
    document.querySelectorAll(".confirm-product-token").forEach((button) => {
      button.onclick = () => confirmDraftProduct(button.closest(".request-item"));
    });
  }

  function requestInfoDialog(request) {
    const items = request.items || [];
    return `
      <dialog id="request-info-dialog" class="answer-dialog request-info-dialog" aria-labelledby="request-info-title">
        <header>
          <div><span>Товары в списке</span><h2 id="request-info-title">Информация</h2></div>
          <button id="close-request-info" type="button" aria-label="Закрыть">×</button>
        </header>
        <div class="request-info-list">
          ${items.length ? items.map((item) => requestProductInfo(item)).join("") : `<p class="muted request-info-empty">В списке пока нет товаров.</p>`}
        </div>
      </dialog>`;
  }

  function requestProductInfo(item) {
    const product = getProduct(item.productId);
    const nutrition = product?.nutrition;
    const latestPrice = latestProductPrice(item.productId);
    const purchased = productPurchasedTotal(item.productId, state);
    const unit = product?.unit || item.unit || "";
    const nutrient = (value) => value == null || value === "" ? "—" : number(value);
    return `
      <article class="request-info-product">
        <h3>${escapeHtml(product?.name || "Продукт")}</h3>
        <p class="request-info-nutrition">Б ${nutrient(nutrition?.protein)} · Ж ${nutrient(nutrition?.fat)} · У ${nutrient(nutrition?.carbs)}</p>
        <div class="request-info-stats">
          <span><small>Последняя цена</small><strong>${latestPrice > 0 ? money(latestPrice) : "—"}</strong></span>
          <span><small>Куплено за всё время</small><strong>${number(purchased)}${unit ? ` ${escapeHtml(unit)}` : ""}</strong></span>
        </div>
      </article>`;
  }

  function refreshRequestInfoDialog(dialog, request) {
    const list = dialog?.querySelector(".request-info-list");
    if (!list) return;
    const items = request?.items || [];
    list.innerHTML = items.length
      ? items.map((item) => requestProductInfo(item)).join("")
      : `<p class="muted request-info-empty">В списке пока нет товаров.</p>`;
  }

  function handleRequestLineInput(editor) {
    productNameSearchSequence += 1;
    const row = editor.closest(".request-item");
    const item = draftItems.find((value) => value.key === row?.dataset.key);
    if (!row || !item) return;
    let candidate = editor.querySelector(".product-candidate");
    let tail = editor.querySelector(".request-line-tail");
    if (item.confirmed) {
      if (!tail) {
        tail = document.createElement("span");
        tail.className = "request-line-tail";
        editor.append(tail);
      }
      const chip = editor.querySelector(".product-chip");
      [...editor.childNodes].forEach((node) => {
        if (node === chip || node === tail) return;
        if (node.nodeType === Node.TEXT_NODE) tail.append(node);
        else {
          while (node.firstChild) tail.append(node.firstChild);
          node.remove();
        }
      });
      item.note = String(tail?.textContent || "").trimStart();
      clearTimeout(requestAutosaveTimer);
      requestAutosaveTimer = setTimeout(() => commitRequestFieldChange(), 400);
      return;
    }
    const normalizedCandidate = normalizePendingCandidate(editor, item);
    ({ candidate, tail } = normalizedCandidate);
    if (normalizedCandidate.repaired) focusRequestLine(row);
    const query = String(candidate ? candidate.textContent : editor.textContent || "").trim();
    const selected = suggestionByName(query);
    item.query = query;
    item.productId = resolveDraftProductId(query);
    item.unit = selected?.unit || (item.productId ? getProduct(item.productId)?.unit : "") || "";
    item.editingName = true;
    row.dataset.productId = item.productId || "";
    refreshEmptyRowControls();
    if (query && route === "request-edit") bindRequestRowGestures(getRequest(routeId), { reuseToken: true });
    updateProductSuggestionMenu(row, editor);
    positionProductTokenToolbar(row, editor);
    clearTimeout(productNameSearchTimer);
    if (query.length >= 3) {
      productNameSearchTimer = setTimeout(() => searchOpenFoodFactsByName(query, row.dataset.key), 450);
    }
  }

  function updateProductSuggestionMenu(row, editor) {
    const menu = row?.querySelector(".product-suggestion-menu");
    const item = draftItems.find((value) => value.key === row?.dataset.key);
    if (!menu || !editor || !item) return;
    menu.innerHTML = item.confirmed ? "" : productSuggestionMenuOptions(item.query || "");
    const active = document.activeElement === editor;
    menu.hidden = item.confirmed || !active || !menu.childElementCount;
    row.classList.toggle("has-suggestion-menu", !menu.hidden);
  }

  function normalizePendingCandidate(editor, item) {
    let candidate = editor?.querySelector(".product-candidate");
    let tail = editor?.querySelector(".request-line-tail");
    let repaired = false;
    if (!editor) return { candidate: null, tail: null, repaired };
    if (!candidate) {
      repaired = true;
      candidate = document.createElement("span");
      candidate.className = "product-candidate";
      if (tail) editor.insertBefore(candidate, tail);
      else editor.prepend(candidate);
    }
    if (!tail) {
      repaired = true;
      tail = document.createElement("span");
      tail.className = "request-line-tail";
      editor.append(tail);
    }
    [...editor.childNodes].forEach((node) => {
      if (node === candidate || node === tail) return;
      repaired = true;
      if (node.nodeType === Node.TEXT_NODE) {
        candidate.append(node);
        return;
      }
      while (node.firstChild) candidate.append(node.firstChild);
      node.remove();
    });
    if (!candidate.textContent && !String(item?.note || "").trim() && tail.textContent) {
      repaired = true;
      candidate.textContent = tail.textContent;
      tail.textContent = "";
    }
    return { candidate, tail, repaired };
  }

  function positionProductTokenToolbar(row, editor) {
    const toolbar = row?.querySelector(".product-token-toolbar");
    const field = row?.querySelector(".request-product-field");
    const item = draftItems.find((value) => value.key === row?.dataset.key);
    if (!toolbar || !field || !editor || !item) return;
    const visible = !item.confirmed && document.activeElement === editor && Boolean(item.query?.trim());
    toolbar.hidden = !visible;
    row.classList.toggle("has-product-toolbar", visible);
    if (!visible) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    range?.collapse(true);
    const caretRect = range?.getBoundingClientRect();
    const fieldRect = field.getBoundingClientRect();
    const left = caretRect?.left ? caretRect.left - fieldRect.left : 28;
    toolbar.style.left = `${Math.max(28, Math.min(field.clientWidth - 28, left))}px`;
  }

  function cancelDraftProduct(row) {
    if (!row) return;
    const key = row.dataset.key;
    if (!key) return;
    const focusTarget = row.previousElementSibling || row.nextElementSibling;
    draftItems = draftItems.filter((item) => item.key !== key);
    row.remove();
    refreshEmptyRowControls();
    if (!persistRequestDraft({ silent: true })) {
      draftItems = [];
      renderRequestForm();
      return;
    }
    if (focusTarget?.isConnected) focusRequestLine(focusTarget, Boolean(focusTarget.querySelector(".product-chip")));
  }

  function isRemovableEmptyRow(row) {
    if (!row || row.querySelector(".product-chip")) return false;
    const rows = [...document.querySelectorAll(".request-item")];
    const empty = !String(row.querySelector(".product-candidate")?.textContent || "").trim()
      && !String(row.querySelector(".request-line-tail")?.textContent || "").trim();
    return empty && rows.indexOf(row) > 0;
  }

  function refreshEmptyRowControls() {
    [...document.querySelectorAll(".request-item")].forEach((row, index) => {
      const chip = row.querySelector(".product-chip");
      const query = String(row.querySelector(".product-candidate")?.textContent || "").trim();
      const tail = String(row.querySelector(".request-line-tail")?.textContent || "").trim();
      const empty = !chip && !query && !tail;
      const removableEmpty = empty && index > 0;
      row.classList.toggle("is-blank", empty);
      row.classList.toggle("is-removable-empty", removableEmpty);
    });
  }

  function confirmDraftProduct(row, selectedName = "") {
    if (!row) return;
    const item = draftItems.find((value) => value.key === row.dataset.key);
    const candidate = row.querySelector(".product-candidate");
    const query = String(selectedName || (candidate ? candidate.textContent : item?.query || "")).trim();
    if (!item || !query) return;
    const duplicate = draftItems.some((value) =>
      value.key !== item.key && value.confirmed && normalizeProductName(value.query) === normalizeProductName(query)
    );
    if (duplicate) return showToast("Этот товар уже есть в списке.");
    if (selectedName) setCandidateText(row, query);
    item.query = query;
    item.productId = resolveDraftProductId(query, item.productId);
    item.confirmed = true;
    item.editingName = false;
    if (!commitRequestFieldChange()) {
      item.confirmed = false;
      item.editingName = true;
      return;
    }
    const saved = draftItems.find((value) => value.key === row.dataset.key);
    const product = saved?.productId ? getProduct(saved.productId) : null;
    setRowProductPresentation(row, saved, product);
    focusRequestLine(row, true);
  }

  function setRowProductPresentation(row, item, product) {
    if (!row) return;
    const editor = row.querySelector(".request-line-editor");
    const toolbar = row.querySelector(".product-token-toolbar");
    const menu = row.querySelector(".product-suggestion-menu");
    const resolved = Boolean(product && item?.confirmed && String(item.query || "").trim());
    if (editor) {
      editor.innerHTML = resolved
        ? `<span class="product-chip${isProductConfirmed(product) ? "" : " is-unconfirmed"}" contenteditable="false" role="button" data-product-id="${escapeAttr(product.id)}" aria-label="Открыть карточку ${escapeAttr(product.name)}">${escapeHtml(product.name)}</span><span class="request-line-tail">${item.note ? ` ${escapeHtml(item.note)}` : ""}</span>`
        : `<span class="product-candidate">${escapeHtml(item?.query || "")}</span><span class="request-line-tail">${item?.note ? ` ${escapeHtml(item.note)}` : ""}</span>`;
    }
    if (toolbar && resolved) toolbar.hidden = true;
    if (menu && resolved) menu.hidden = true;
    if (resolved) {
      row.classList.remove("has-product-toolbar", "has-suggestion-menu", "is-product-picking");
    }
    row.dataset.productId = resolved ? product.id : "";
    row.classList.toggle("is-blank", !String(item?.query || "").trim());
    row.classList.toggle("is-resolved", resolved);
    if (resolved && route === "request-edit") {
      bindRequestRowGestures(getRequest(routeId), { reuseToken: true });
    }
  }

  function setCandidateText(row, value) {
    const item = draftItems.find((draft) => draft.key === row?.dataset.key);
    const candidate = row?.querySelector(".product-candidate");
    if (!item || !candidate) return;
    candidate.textContent = value;
    item.query = value.trim();
    item.productId = resolveDraftProductId(item.query);
    row.classList.toggle("is-blank", !item.query);
    const selected = suggestionByName(item.query);
    if (selected) item.unit = selected.unit || item.unit || "шт.";
  }

  function unwrapProductChip(row) {
    const item = draftItems.find((value) => value.key === row?.dataset.key);
    const product = item?.productId ? getProduct(item.productId) : null;
    if (!row || !item || !product) return;
    item.query = product.name;
    item.productId = "";
    item.confirmed = false;
    item.editingName = true;
    setRowProductPresentation(row, item, null);
    focusRequestLine(row);
    updateProductSuggestionMenu(row, row.querySelector(".request-line-editor"));
    positionProductTokenToolbar(row, row.querySelector(".request-line-editor"));
  }

  function isCaretAtStartOfLineTail(editor) {
    const tail = editor?.querySelector(".request-line-tail");
    const selection = window.getSelection();
    if (!tail || !selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    if (range.startContainer === tail) return range.startOffset === 0;
    if (tail.contains(range.startContainer)) {
      const before = range.cloneRange();
      before.selectNodeContents(tail);
      before.setEnd(range.startContainer, range.startOffset);
      return before.toString().length === 0;
    }
    return range.startContainer === editor
      && (range.startOffset === 1 || (range.startOffset === 2 && !tail.textContent));
  }

  function focusRequestLine(row, afterChip = false) {
    const editor = row?.querySelector(".request-line-editor");
    if (!editor) return;
    editor.focus();
    const target = afterChip
      ? editor.querySelector(".request-line-tail")
      : editor.querySelector(".product-candidate") || editor.querySelector(".request-line-tail");
    if (!target) return;
    const range = document.createRange();
    if (!target.textContent && !target.querySelector("br")) target.append(document.createElement("br"));
    if (!target.textContent) {
      range.setStart(target, 0);
      range.collapse(true);
    } else {
      range.selectNodeContents(target);
      range.collapse(false);
    }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function openProductCardFromRequest(productId) {
    clearTimeout(requestAutosaveTimer);
    syncDraftFromForm();
    if (!persistRequestDraft({ silent: false })) return;
    productEditReturn = { route: "request-edit", id: routeId };
    navigate("product-edit", productId, null, { skipRequestPersist: true });
  }

  function bindRequestRowGestures(request, { reuseToken = false } = {}) {
    const token = reuseToken ? requestGestureToken : ++requestGestureToken;
    document.querySelectorAll(".request-item").forEach((row) => {
      const removalOnly = row.classList.contains("is-removable-empty");
      if ((row.classList.contains("is-blank") && !removalOnly) || row.dataset.swipeBound === "1") return;
      const surface = row.querySelector(".request-item-surface");
      const fillLabel = row.querySelector(".request-swipe-label");
      const deleteLabel = row.querySelector(".request-swipe-delete-label");
      if (!surface) return;
      row.dataset.swipeBound = "1";

      let startX = 0;
      let startY = 0;
      let currentX = 0;
      let tracking = false;
      let horizontal = false;
      let pointerId = null;
      let tapPreviewTimer = 0;

      const clearTapPreview = () => {
        window.clearTimeout(tapPreviewTimer);
        tapPreviewTimer = 0;
        row.classList.remove("is-delete-tap-preview", "is-fill-tap-preview");
        surface.classList.remove("is-delete-tap-preview", "is-fill-tap-preview");
        row.querySelectorAll(".is-tap-bouncing").forEach((icon) => icon.classList.remove("is-tap-bouncing"));
      };

      const threshold = () => Math.max(96, Math.round(window.innerWidth / 3));
      const maxPull = () => Math.min(window.innerWidth * 0.55, threshold() * 1.35);

      const setOffset = (x, { animate = false } = {}) => {
        currentX = x;
        if (animate) surface.classList.remove("is-dragging");
        else surface.classList.add("is-dragging");
        surface.style.transform = `translate3d(${x}px,0,0)`;
        const progress = Math.min(1, Math.abs(x) / threshold());
        const swipingLeft = x < -4;
        const swipingRight = x > 4;
        row.classList.toggle("is-swiping", swipingLeft || swipingRight);
        row.classList.toggle("is-swiping-left", swipingLeft);
        row.classList.toggle("is-swiping-right", swipingRight);
        row.classList.toggle("is-swipe-armed-left", swipingLeft && progress >= 1);
        row.classList.toggle("is-swipe-armed-right", swipingRight && progress >= 1);
        const activeLabel = swipingRight ? deleteLabel : fillLabel;
        const inactiveLabel = swipingRight ? fillLabel : deleteLabel;
        if (activeLabel) {
          activeLabel.style.opacity = String(Math.min(1, 0.35 + progress * 0.65));
          activeLabel.style.transform = progress >= 1 ? "scale(1.04)" : "translateX(0)";
        }
        if (inactiveLabel) {
          inactiveLabel.style.opacity = "";
          inactiveLabel.style.transform = "";
        }
      };

      const resetSurface = ({ animate = true } = {}) => {
        setOffset(0, { animate });
        window.setTimeout(() => {
          if (currentX === 0) {
            surface.classList.remove("is-dragging");
            row.classList.remove("is-swiping", "is-swiping-left", "is-swiping-right", "is-swipe-armed-left", "is-swipe-armed-right");
            if (fillLabel) {
              fillLabel.style.opacity = "";
              fillLabel.style.transform = "";
            }
            if (deleteLabel) {
              deleteLabel.style.opacity = "";
              deleteLabel.style.transform = "";
            }
          }
        }, animate ? 220 : 0);
      };

      const runLeftAction = () => {
        if (token !== requestGestureToken) return;
        if (row.classList.contains("is-removable-empty")) {
          resetSurface({ animate: true });
          return;
        }
        const removeReadyState = row.classList.contains("is-bought");
        row.dataset.swiped = "1";
        setOffset(-threshold(), { animate: true });
        try {
          navigator.vibrate?.(12);
        } catch {}
        window.setTimeout(() => {
          if (token !== requestGestureToken || !row.isConnected) return;
          if (removeReadyState) {
            clearTimeout(requestAutosaveTimer);
            // Unchecking is a receipt-only action. Re-saving the whole request
            // here can falsely detect the scanned/refined product as a duplicate.
            const productId = ensureRowProductId(row);
            if (productId) undoLatestPurchaseForProduct(request.id, productId);
          } else {
            openPurchaseDetailsForRow(request, row);
          }
          resetSurface({ animate: true });
        }, 160);
      };

      const deleteRow = () => {
        if (token !== requestGestureToken) return;
        row.dataset.swiped = "1";
        setOffset(threshold(), { animate: true });
        try {
          navigator.vibrate?.(12);
        } catch {}
        window.setTimeout(() => {
          if (token === requestGestureToken && row.isConnected) cancelDraftProduct(row);
        }, 160);
      };

      const onPointerDown = (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        // Allow swipe from chip, input, main — any point on the tile.
        tracking = true;
        horizontal = false;
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        currentX = 0;
        row.dataset.swiped = "";
        surface.classList.add("is-dragging");
        try {
          surface.setPointerCapture?.(event.pointerId);
        } catch {}
      };

      const onPointerMove = (event) => {
        if (!tracking || (pointerId != null && event.pointerId !== pointerId)) return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (Math.abs(dx) >= 8 || Math.abs(dy) >= 8) clearTapPreview();
        if (!horizontal) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          if (Math.abs(dy) > Math.abs(dx)) {
            tracking = false;
            resetSurface({ animate: true });
            return;
          }
          horizontal = true;
          row.dataset.swiped = "1";
          const chip = row.querySelector(".product-chip");
          if (chip) chip.dataset.suppressClick = "1";
        }
        const pull = row.classList.contains("is-removable-empty")
          ? Math.max(0, Math.min(maxPull(), dx))
          : Math.max(-maxPull(), Math.min(maxPull(), dx));
        setOffset(pull, { animate: false });
        if (event.cancelable && horizontal) event.preventDefault();
      };

      const onPointerUp = (event) => {
        if (!tracking || (pointerId != null && event.pointerId !== pointerId)) return;
        tracking = false;
        pointerId = null;
        const dx = currentX;
        if (horizontal && -dx >= threshold()) {
          runLeftAction();
          return;
        }
        if (horizontal && dx >= threshold()) {
          deleteRow();
          return;
        }
        if (!horizontal) {
          surface.classList.remove("is-dragging");
          return;
        }
        resetSurface({ animate: true });
        window.setTimeout(() => {
          const chip = row.querySelector(".product-chip");
          if (chip) chip.dataset.suppressClick = "";
          row.dataset.swiped = "";
        }, 0);
      };

      const onPointerCancel = (event) => {
        if (!tracking || (pointerId != null && event.pointerId !== pointerId)) return;
        tracking = false;
        pointerId = null;
        resetSurface({ animate: true });
        window.setTimeout(() => {
          const chip = row.querySelector(".product-chip");
          if (chip) chip.dataset.suppressClick = "";
          row.dataset.swiped = "";
        }, 220);
      };

      surface.addEventListener("pointerdown", onPointerDown);
      surface.addEventListener("pointermove", onPointerMove, { passive: false });
      surface.addEventListener("pointerup", onPointerUp);
      surface.addEventListener("pointercancel", onPointerCancel);
      surface.addEventListener("lostpointercapture", () => {
        if (tracking) {
          tracking = false;
          resetSurface({ animate: true });
        }
      });
      [
        [row.querySelector(".keep-remove-item"), row.querySelector(".keep-remove-cross"), "is-delete-tap-preview"],
        [row.querySelector(".request-swipe-handle"), row.querySelector(".request-swipe-arrow"), "is-fill-tap-preview"],
      ].forEach(([hitArea, icon, previewClass]) => {
        hitArea?.addEventListener("pointerdown", (event) => {
          if (!icon || row.dataset.swiped === "1" || (event.pointerType === "mouse" && event.button !== 0)) return;
          clearTapPreview();
          void surface.offsetWidth;
          icon.classList.add("is-tap-bouncing");
          row.classList.add(previewClass);
          surface.classList.add(previewClass);
          tapPreviewTimer = window.setTimeout(clearTapPreview, 1050);
        });
      });
    });
  }

  function openPurchaseDetailsForRow(request, row) {
    if (!row || row.classList.contains("is-blank")) return;
    clearTimeout(requestAutosaveTimer);
    syncDraftFromForm();
    if (!persistRequestDraft({ silent: false })) return;
    const productId = ensureRowProductId(row);
    if (!productId) return showToast("Сначала укажите продукт.");
    const current = getRequest(request.id);
    if (!current) return;
    openInlinePurchaseDetails(current, productId);
  }

  function ensureRowProductId(row) {
    const draft = draftItems.find((item) => item.key === row.dataset.key);
    let productId = draft?.productId || row.dataset.productId || "";
    if (!isRealProductId(productId)) {
      const candidate = row.querySelector(".product-candidate");
      const query = candidate ? candidate.textContent : draft?.query || "";
      productId = resolveDraftProductId(query, draft?.productId || "");
    }
    if (!isRealProductId(productId)) {
      const request = getRequest(routeId);
      const candidate = row.querySelector(".product-candidate");
      const query = normalizeProductName(candidate ? candidate.textContent : draft?.query || "");
      const matched = request?.items.find((item) =>
        normalizeProductName(getProduct(item.productId)?.name || "") === query
      );
      productId = matched?.productId || "";
    }
    if (isRealProductId(productId)) {
      row.dataset.productId = productId;
      if (draft) draft.productId = productId;
      return productId;
    }
    return "";
  }

  function openInlinePurchaseDetails(request, productId) {
    const line = receiptLine(request, productId);
    const remaining = remainingRequestQuantity(request, productId);
    const requested = Number(request.items.find((item) => item.productId === productId)?.quantity || 0);
    const storedPrice = Number(line?.price);
    answerDraftItems = new Map();
    answerDraftItems.set(productId, {
      productId,
      purchasedProductId: line?.purchasedProductId || productId,
      quantity: Number(line?.quantity) > 0 ? Number(line.quantity) : Math.max(0.01, remaining || requested || 1),
      price: Number.isFinite(storedPrice) && storedPrice >= 0 ? storedPrice : 0,
      completionMode: line?.completionMode || "closed",
      purchasedProduct: null,
    });
    purchaseFillProduct = null;
    openAnswerFillDialog(request, productId, null);
    const priceInput = document.getElementById("purchase-price");
    if (priceInput) {
      priceInput.value = Number.isFinite(storedPrice) && storedPrice > 0 ? String(storedPrice) : "";
    }
    const quantityInput = document.getElementById("purchase-quantity");
    if (quantityInput) {
      const qty = Number(line?.quantity) > 0
        ? Number(line.quantity)
        : Math.max(0.01, remaining || requested || 1);
      quantityInput.value = String(qty);
      quantityInput.max = String(Math.max(qty, remaining || 0, requested || 0, qty));
    }
    const saveButton = document.getElementById("save-purchase-item");
    if (saveButton) {
      saveButton.onclick = () => {
        const ok = savePurchaseDraftItem(false);
        if (ok === false) return;
        const draft = answerDraftItems.get(productId);
        if (!draft) return;
        applyInlinePurchase(request.id, productId, draft);
      };
    }
  }

  function applyInlinePurchase(requestId, productId, draftItem) {
    const marked = localData.markBought(requestId, productId, {
      quantity: draftItem.quantity,
      price: draftItem.price,
      purchasedProductId: draftItem.purchasedProductId,
      purchasedProduct: draftItem.purchasedProduct,
      completionMode: draftItem.completionMode,
      query: draftItem.query,
    });
    if (!marked.ok) return;
    state = localData.snapshot();
    formDirty = false;
    patchRequestItemRow(requestId, marked.productId || productId);
  }

  function undoLatestPurchaseForProduct(requestId, productId) {
    const unmarked = localData.unmarkBought(requestId, productId);
    if (!unmarked.ok) return;
    state = localData.snapshot();
    formDirty = false;
    patchRequestItemRow(requestId, productId);
  }

  function patchRequestItemRow(requestId, productId) {
    if (route !== "request-edit" || routeId !== requestId) {
      draftItems = [];
      if (route === "request-edit") renderRequestForm();
      return;
    }
    const request = getRequest(requestId);
    if (!request) return;
    const row = [...document.querySelectorAll(".request-item")].find((element) => {
      const draft = draftItems.find((item) => item.key === element.dataset.key);
      const rowProductId = draft?.productId || element.dataset.productId || "";
      return rowProductId === productId;
    });
    if (!row) {
      // Keep draft memory; rebuild only this form when row is missing.
      renderRequestForm();
      return;
    }
    const draft = draftItems.find((item) => item.key === row.dataset.key);
    const purchased = responseItemTotal(request, productId);
    const remaining = remainingRequestQuantity(request, productId);
    const line = receiptLine(request, productId);
    const fullyBought = Boolean(productId && remaining <= 0 && purchased.quantity > 0);
    const filled = Boolean(line && isPurchaseDetailsFilled(line, productId));
    row.classList.toggle("is-bought", fullyBought);
    row.classList.toggle("is-purchase-filled", filled);
    row.dataset.productId = productId;
    const swipeLabel = row.querySelector(".request-swipe-label");
    if (swipeLabel) swipeLabel.textContent = fullyBought ? "Снять" : "Заполнить";
    // Refresh spent total in meta header without full re-render when possible.
    const meta = document.querySelector(".keep-note-meta");
    const spentNode = meta?.querySelector("strong");
    const spent = requestTotal(request);
    if (spentNode) {
      if (spent > 0) {
        spentNode.textContent = money(spent);
        meta.hidden = false;
      } else {
        spentNode.remove();
        meta.hidden = true;
      }
    } else if (spent > 0) {
      if (meta) {
        const strong = document.createElement("strong");
        strong.textContent = money(spent);
        meta.appendChild(strong);
        meta.hidden = false;
      }
    }
    if (draft) {
      const product = getProduct(productId);
      if (product) {
        // A barcode scan can refine an unconfirmed product in place. Keep the
        // row draft on that same product so the next swipe only unchecks it.
        draft.productId = product.id;
        draft.query = product.name;
        draft.unit = product.unit || draft.unit || "";
        draft.confirmed = true;
        draft.editingName = false;
        setRowProductPresentation(row, draft, product);
      }
    }
  }

  function addEmptyRequestLine() {
    syncDraftFromForm();
    const emptyInDom = [...document.querySelectorAll(".request-item")].find((row) =>
      !row.querySelector(".product-chip") && !row.querySelector(".product-candidate")?.textContent.trim()
    );
    if (emptyInDom) {
      focusRequestLine(emptyInDom);
      return;
    }
    // Drop phantom empty drafts that are not in the DOM (left by autosave remaps).
    draftItems = draftItems.filter((item) => {
      if (item.query?.trim()) return true;
      return Boolean(document.querySelector(`.request-item[data-key="${item.key}"]`));
    });
    const item = { key: id("item"), productId: "", query: "", quantity: 1, unit: "", note: "", confirmed: false, editingName: true };
    draftItems.push(item);
    renderRequestForm(item.key);
  }

  function syncDraftFromForm() {
    // Rebuild draft from DOM so memory and rows never drift after autosave.
    const nextDraft = [];
    document.querySelectorAll(".request-item").forEach((row) => {
      const previous = draftItems.find((value) => value.key === row.dataset.key);
      const chip = row.querySelector(".product-chip");
      const candidate = row.querySelector(".product-candidate");
      const query = candidate ? candidate.textContent : chip?.textContent || previous?.query || "";
      const confirmed = Boolean(previous?.confirmed && (chip || query.trim()));
      const productId = confirmed
        ? (previous?.productId || row.dataset.productId || chip?.dataset.productId || resolveDraftProductId(query))
        : resolveDraftProductId(query);
      const product = productId ? getProduct(productId) : null;
      row.dataset.productId = productId;
      nextDraft.push({
        key: row.dataset.key,
        productId,
        query,
        quantity: Math.max(0.01, Number(previous?.quantity) || 1),
        unit: (previous?.unit || product?.unit || "").trim(),
        note: String(row.querySelector(".request-line-tail")?.textContent ?? previous?.note ?? "").trimStart(),
        confirmed,
        editingName: !confirmed,
      });
    });
    if (document.getElementById("request-items")) draftItems = nextDraft;
  }

  function persistRequestDraft({ silent = false } = {}) {
    if (route !== "request-edit") return false;
    const editedRequest = getRequest(routeId);
    if (!editedRequest) return false;
    syncDraftFromForm();
    const filledDraftItems = draftItems.filter((item) => item.confirmed && item.query.trim());
    const saved = localData.saveRequestItems(editedRequest.id, filledDraftItems.map((draft) => ({
      productId: draft.productId,
      name: draft.query.trim(),
      quantity: draft.quantity,
      unit: draft.unit,
      note: draft.note,
      hint: suggestionByName(draft.query),
    })));
    if (!saved.ok) {
      if (!silent) showToast(saved.reason);
      return false;
    }
    state = localData.snapshot();
    const items = getRequest(editedRequest.id)?.items || [];

    // Keep only draft rows that still exist in the DOM (filled + current blank line).
    const keysInDom = new Set([...document.querySelectorAll(".request-item")].map((row) => row.dataset.key));
    draftItems = draftItems
      .filter((item) => keysInDom.has(item.key))
      .map((item) => {
        if (!item.query.trim()) return { ...item, editingName: true };
        const saved = items.find((value) => normalizeProductName(getProduct(value.productId)?.name || "") === normalizeProductName(item.query));
        if (!saved) return item;
        const product = getProduct(saved.productId);
        return {
          ...item,
          productId: saved.productId,
          query: product?.name || item.query,
          quantity: saved.quantity,
          unit: saved.unit || product?.unit || item.unit || "",
          note: String(saved.note || item.note || ""),
          confirmed: true,
          editingName: false,
        };
      });
    // Keep row product ids and chip presentation in sync without full re-render.
    document.querySelectorAll(".request-item").forEach((row) => {
      const item = draftItems.find((value) => value.key === row.dataset.key);
      if (!item) return;
      row.dataset.productId = item.productId || "";
      const hasText = Boolean(item.confirmed && item.productId && String(item.query || "").trim());
      const product = item.productId ? getProduct(item.productId) : null;
      if (product && hasText) {
        const chip = row.querySelector(".product-chip");
        if (!chip || chip.dataset.productId !== product.id) setRowProductPresentation(row, item, product);
        else row.classList.add("is-resolved");
      } else {
        row.classList.remove("is-resolved");
      }
    });
    return true;
  }

  function renderRequestDetail() {
    draftItems = [];
    navigate("request-edit", routeId);
  }

  async function deleteRequestWithTransactions(request) {
    if (!await askConfirm("Удалить запрос и все данные о покупках?")) return;
    const removed = localData.removeRequest(request.id);
    if (!removed.ok) return showToast(removed.reason);
    state = localData.snapshot();
    navigate("requests");
    showToast("Запрос удалён.");
  }

  function renderRequestAnswer() {
    const request = getRequest(routeId);
    if (!request) return navigate("requests");
    const editedResponse = routeSubId
      ? activeResponses(request).find((response) => response.id === routeSubId)
      : null;
    if (routeSubId && !editedResponse) return navigate("request-edit", request.id);
    answerDraftItems = new Map((editedResponse?.items || []).map((item) => [item.productId, structuredClone(item)]));
    purchaseFillProduct = null;
    formDirty = false;
    app.innerHTML = `
      <form id="answer-form" class="form">
        <p class="muted">Отметьте купленные позиции. При необходимости нажмите «Детали» для цены, количества или замены. «Готово» сохранит отмеченное.</p>
        <div class="answer-checklist">
        ${request.items.map((item) => {
          const product = getProduct(item.productId);
          const existing = editedResponse?.items.find((responseItem) => responseItem.productId === item.productId);
          const remaining = remainingRequestQuantity(request, item.productId, editedResponse?.id);
          const closed = remaining <= 0 && !existing;
          return `
            <div class="answer-list-row ${closed ? "is-complete" : ""}" data-product-id="${item.productId}">
              <label class="answer-check-main">
                <span class="answer-check-box">
                  <input class="answer-check" type="checkbox" ${existing ? "checked" : ""} ${closed ? "disabled" : ""}>
                </span>
                <span class="answer-check-copy">
                  <strong>${escapeHtml(product?.name || "Продукт")}</strong>
                  ${item.note ? `<small class="request-item-note-copy">${escapeHtml(item.note)}</small>` : ""}
                  <small>${requestAmountLabel(item)}</small>
                  <small class="answer-item-summary" ${existing || remaining <= 0 ? "" : "hidden"}>${existing ? answerItemSummary(existing, item) : remaining <= 0 ? "Уже закрыто" : ""}</small>
                </span>
              </label>
              <button class="answer-item-details" type="button" ${closed ? "disabled" : ""} aria-label="Указать детали покупки ${escapeAttr(product?.name || "продукта")}">Ещё</button>
            </div>`;
        }).join("")}
        </div>
        <button class="button full" type="submit">${editedResponse ? "Сохранить" : "Готово"}</button>
      </form>
      ${answerActionDialog()}
    `;
    document.querySelectorAll(".answer-check").forEach((checkbox) => {
      if (checkbox.disabled) return;
      checkbox.onchange = () => {
        const productId = checkbox.closest(".answer-list-row")?.dataset.productId;
        if (!productId) return;
        if (!checkbox.checked) answerDraftItems.delete(productId);
        else answerDraftItems.set(productId, defaultAnswerItem(request, productId, editedResponse));
        updateAnswerItemRow(productId);
        formDirty = true;
      };
    });
    document.querySelectorAll(".answer-item-details").forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const productId = button.closest(".answer-list-row").dataset.productId;
        if (!answerDraftItems.has(productId)) {
          answerDraftItems.set(productId, defaultAnswerItem(request, productId, editedResponse));
          updateAnswerItemRow(productId);
          const checkbox = document.querySelector(`.answer-list-row[data-product-id="${productId}"] .answer-check`);
          if (checkbox) checkbox.checked = true;
        }
        openAnswerFillDialog(request, productId, editedResponse);
      };
    });
    bindAnswerDialog(request, editedResponse);
    document.getElementById("answer-form").onsubmit = (event) => saveAnswerTransaction(event, request, editedResponse);
  }

  function finishRequestAnswer() {
    const form = document.getElementById("answer-form");
    if (form && answerDraftItems.size) {
      form.requestSubmit();
      return;
    }
    formDirty = false;
    draftItems = [];
    navigate("request-edit", routeId);
  }

  function answerActionDialog() {
    return `
      <dialog id="answer-action-dialog" class="answer-dialog purchase-dialog" aria-labelledby="answer-dialog-title">
        <div id="answer-fill-view">
          <div class="purchase-dialog-heading">
            <h2 id="answer-dialog-title">Детали покупки</h2>
          </div>
          <div class="purchase-value-grid">
            <label class="field purchase-price-field"><span>Сумма, ₽</span><input id="purchase-price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Необязательно"></label>
            <label class="field purchase-quantity-field"><span>Количество</span><input id="purchase-quantity" type="number" min="0.01" step="0.01" inputmode="decimal" required></label>
          </div>
          <p id="purchase-status" class="muted barcode-status purchase-status" aria-live="polite" hidden></p>
          <div class="purchase-dialog-actions">
            <button id="scan-purchase-barcode" class="button secondary" type="button">Сканировать</button>
            <button id="save-purchase-item" class="button" type="button">Готово</button>
          </div>
        </div>
      </dialog>`;
  }

  function defaultAnswerItem(request, productId, editedResponse) {
    return {
      productId,
      purchasedProductId: productId,
      quantity: Math.max(0.01, remainingRequestQuantity(request, productId, editedResponse?.id)),
      price: 0,
      completionMode: "closed",
    };
  }

  function commitInlinePurchaseDraft(productId) {
    if (route !== "request-edit" || !productId) return;
    const draft = answerDraftItems.get(productId);
    const current = getRequest(routeId);
    if (!draft || !current) return;
    // Apply when already on the receipt, or user entered a price / filled details.
    const onReceipt = Boolean(receiptLine(current, productId));
    const hasDetails = Number(draft.price) > 0 || draft.completionMode === "filled" || Boolean(draft.purchasedProduct);
    if (!onReceipt && !hasDetails) return;
    applyInlinePurchase(routeId, productId, draft);
  }

  function bindAnswerDialog(request, editedResponse) {
    const dialog = document.getElementById("answer-action-dialog");
    dialog.addEventListener("focusin", queuePurchaseDialogViewportSync);
    dialog.addEventListener("close", () => resetPurchaseDialogViewport(dialog));
    dialog.oncancel = (event) => {
      event.preventDefault();
      // Keep the checked item with current/default values when dismissing.
      const productId = dialog.dataset.productId;
      savePurchaseDraftItem(true);
      commitInlinePurchaseDraft(productId);
    };
    document.getElementById("save-purchase-item").onclick = () => savePurchaseDraftItem(false);
    document.getElementById("scan-purchase-barcode").onclick = () => {
      if (!window.NativeCookish?.scanBarcode) return setPurchaseStatus("Сканирование доступно в Android-приложении.", true);
      barcodeScanTarget = "purchase";
      window.NativeCookish.scanBarcode();
    };
  }

  function openAnswerFillDialog(request, productId, editedResponse) {
    const dialog = document.getElementById("answer-action-dialog");
    dialog.dataset.productId = productId;
    dialog.dataset.dirty = "false";
    showAnswerFillView(request, editedResponse);
    preparePurchaseDialogViewport(dialog);
    dialog.showModal();
    queuePurchaseDialogViewportSync();
    requestAnimationFrame(() => {
      const priceInput = document.getElementById("purchase-price");
      if (!dialog.open || !priceInput) return;
      priceInput.focus({ preventScroll: true });
      queuePurchaseDialogViewportSync();
    });
  }

  function purchaseDialogViewportMetrics() {
    const layoutHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const viewport = window.visualViewport;
    if (!viewport) return { height: layoutHeight, top: 0, bottom: layoutHeight, layoutHeight };

    const height = Math.min(layoutHeight || viewport.height, viewport.height);
    const top = viewport.height <= layoutHeight ? Math.max(0, viewport.offsetTop) : 0;
    return { height, top, bottom: top + height, layoutHeight };
  }

  function preparePurchaseDialogViewport(dialog) {
    const metrics = purchaseDialogViewportMetrics();
    purchaseDialogBaselineHeight = metrics.height;
    dialog.style.setProperty("--purchase-dialog-visible-height", `${Math.round(metrics.height)}px`);
    dialog.style.setProperty("--purchase-dialog-lift", "0px");
  }

  function queuePurchaseDialogViewportSync() {
    cancelAnimationFrame(purchaseDialogViewportFrame);
    purchaseDialogViewportFrame = requestAnimationFrame(syncPurchaseDialogViewport);
  }

  function syncPurchaseDialogViewport() {
    purchaseDialogViewportFrame = 0;
    const dialog = document.getElementById("answer-action-dialog");
    if (!dialog?.open) return;

    const metrics = purchaseDialogViewportMetrics();
    if (!purchaseDialogBaselineHeight || metrics.height > purchaseDialogBaselineHeight) {
      purchaseDialogBaselineHeight = metrics.height;
    }
    dialog.style.setProperty("--purchase-dialog-visible-height", `${Math.round(metrics.height)}px`);

    const heightReduction = Math.max(0, purchaseDialogBaselineHeight - metrics.height);
    const coveredFromBottom = Math.max(0, metrics.layoutHeight - metrics.bottom);
    const keyboardVisible = heightReduction > 64 || coveredFromBottom > 64;
    if (!keyboardVisible) {
      dialog.style.setProperty("--purchase-dialog-lift", "0px");
      return;
    }

    // Keep the whole dialog inside the animated visual viewport and leave a
    // little more air above the keyboard than the browser's native centering.
    const safeGap = 22;
    const dialogBottom = dialog.offsetTop + dialog.offsetHeight;
    const requestedLift = Math.max(16, dialogBottom - metrics.bottom + safeGap);
    const availableLift = Math.max(0, dialog.offsetTop - metrics.top - 10);
    const lift = Math.min(requestedLift, availableLift);
    dialog.style.setProperty("--purchase-dialog-lift", `${Math.round(lift)}px`);
  }

  function resetPurchaseDialogViewport(dialog) {
    cancelAnimationFrame(purchaseDialogViewportFrame);
    purchaseDialogViewportFrame = 0;
    purchaseDialogBaselineHeight = 0;
    dialog.style.removeProperty("--purchase-dialog-visible-height");
    dialog.style.removeProperty("--purchase-dialog-lift");
  }

  function showAnswerFillView(request, editedResponse) {
    const dialog = document.getElementById("answer-action-dialog");
    const productId = dialog.dataset.productId;
    const existing = answerDraftItems.get(productId);
    const requestItem = request.items.find((item) => item.productId === productId);
    const remaining = remainingRequestQuantity(request, productId, editedResponse?.id);
    const requested = Number(requestItem?.quantity || 0);
    const quantityInput = document.getElementById("purchase-quantity");
    const priceInput = document.getElementById("purchase-price");
    const qty = Number(existing?.quantity) > 0
      ? Number(existing.quantity)
      : Math.max(0.01, remaining || requested || 1);
    quantityInput.value = String(qty);
    quantityInput.max = String(Math.max(qty, remaining || 0, requested || 0, qty));
    const price = Number(existing?.price);
    priceInput.value = Number.isFinite(price) && price > 0 ? String(price) : "";
    purchaseFillProduct = existing?.purchasedProduct || null;
    const requestedProduct = getProduct(productId);
    const purchased = getProduct(existing?.purchasedProductId || productId);
    const replacement = purchaseFillProduct || (purchased && purchased.id !== productId ? purchased : null);
    setPurchaseDialogProductNames(requestedProduct?.name || "Детали покупки", replacement?.name || "");
    setPurchaseStatus(replacement?.barcode ? `Штрихкод: ${replacement.barcode}` : "");
  }

  function setPurchaseDialogProductNames(requestedName, replacementName = "") {
    const title = document.getElementById("answer-dialog-title");
    if (!title) return;
    title.replaceChildren(document.createTextNode(requestedName || "Детали покупки"));
    if (!replacementName || normalizeProductName(replacementName) === normalizeProductName(requestedName)) return;

    const arrow = document.createElement("span");
    arrow.className = "purchase-dialog-name-arrow";
    arrow.textContent = " → ";
    const replacement = document.createElement("span");
    replacement.className = "purchase-dialog-new-name";
    replacement.textContent = replacementName;
    title.append(arrow, replacement);
  }

  async function lookupPurchaseBarcode(barcode) {
    setPurchaseStatus(`Штрихкод: ${barcode}`);
    try {
      const fields = [
        "code", "product_name", "product_name_ru", "generic_name_ru", "brands", "quantity",
        "categories", "categories_tags", "nutriments", "ingredients_text_ru", "ingredients_text",
      ].join(",");
      const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Open Food Facts: ${response.status}`);
      const body = await response.json();
      if (body.status !== 1 || !body.product) throw new Error("Товар с таким штрихкодом не найден.");
      const scannedProduct = openFoodFactsSuggestion(body.product);
      const dialog = document.getElementById("answer-action-dialog");
      const requestedProductId = dialog?.dataset.productId || "";
      const request = getRequest(routeId);
      const existingRequestItem = request?.items.find((item) => {
        if (item.productId === requestedProductId) return false;
        const product = getProduct(item.productId);
        if (!product) return false;
        if (scannedProduct.barcode && product.barcode) return product.barcode === scannedProduct.barcode;
        return normalizeProductName(product.name) === normalizeProductName(scannedProduct.name);
      });
      if (request && existingRequestItem) {
        closeExistingScannedProduct(request, existingRequestItem.productId);
        return;
      }

      purchaseFillProduct = scannedProduct;
      const requestedProduct = getProduct(requestedProductId);
      setPurchaseDialogProductNames(requestedProduct?.name || "Детали покупки", purchaseFillProduct.name);
      setPurchaseStatus(`Штрихкод: ${barcode}`);
    } catch (error) {
      purchaseFillProduct = null;
      const requestedProduct = getProduct(document.getElementById("answer-action-dialog")?.dataset.productId);
      setPurchaseDialogProductNames(requestedProduct?.name || "Детали покупки");
      setPurchaseStatus(error.message || "Не удалось загрузить товар.", true);
    }
  }

  function closeExistingScannedProduct(request, productId) {
    const requestItem = request.items.find((item) => item.productId === productId);
    if (!requestItem) return;
    purchaseFillProduct = null;
    const dialog = document.getElementById("answer-action-dialog");
    if (dialog?.open) {
      dialog.dataset.dirty = "false";
      dialog.close();
    }

    applyInlinePurchase(request.id, productId, {
      productId,
      purchasedProductId: productId,
      purchasedProduct: null,
      quantity: Math.max(0.01, Number(requestItem.quantity) || 1),
      price: 0,
      completionMode: "closed",
    });

    requestAnimationFrame(() => {
      const row = [...document.querySelectorAll(".request-item")].find((element) =>
        (element.dataset.productId || "") === productId
      );
      if (!row) return;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.remove("is-scan-redirected");
      void row.offsetWidth;
      row.classList.add("is-scan-redirected");
      window.setTimeout(() => row.classList.remove("is-scan-redirected"), 1200);
    });
    showToast("Товар уже есть в списке — он отмечен купленным.");
  }

  function setPurchaseStatus(message, error = false) {
    const status = document.getElementById("purchase-status");
    if (!status) return;
    status.textContent = message;
    status.className = error ? "error barcode-status purchase-status" : "muted barcode-status purchase-status";
    status.hidden = !message;
  }

  function savePurchaseDraftItem(soft = false) {
    const dialog = document.getElementById("answer-action-dialog");
    if (!dialog?.dataset?.productId) return false;
    const productId = dialog.dataset.productId;
    if (!productId) return false;
    const request = getRequest(routeId);
    const existing = answerDraftItems.get(productId) || defaultAnswerItem(request, productId);
    const rawQuantity = document.getElementById("purchase-quantity")?.value;
    const rawPrice = document.getElementById("purchase-price")?.value;
    const quantity = rawQuantity === "" || rawQuantity == null
      ? Number(existing.quantity) || 0
      : Number(rawQuantity);
    const maxQuantity = Number(document.getElementById("purchase-quantity")?.max || 0);
    const price = rawPrice === "" || rawPrice == null ? Number(existing.price) || 0 : Number(rawPrice);
    if (!soft) {
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setPurchaseStatus("Количество должно быть больше нуля.", true);
        return false;
      }
      if (maxQuantity && quantity > maxQuantity) {
        setPurchaseStatus(`Осталось купить не больше ${number(maxQuantity)}.`, true);
        return false;
      }
      if (!Number.isFinite(price) || price < 0) {
        setPurchaseStatus("Цена не может быть отрицательной.", true);
        return false;
      }
    }
    const safeQuantity = Number.isFinite(quantity) && quantity > 0
      ? (maxQuantity ? Math.min(quantity, maxQuantity) : quantity)
      : Math.max(0.01, Number(existing.quantity) || 0.01);
    const safePrice = Number.isFinite(price) && price >= 0 ? price : 0;
    const matchedLocal = purchaseFillProduct
      ? state.products.find((product) => !product.deletedAt && product.barcode && product.barcode === purchaseFillProduct.barcode)
      : null;
    answerDraftItems.set(productId, {
      productId,
      purchasedProductId: matchedLocal?.id || (purchaseFillProduct ? "" : existing?.purchasedProductId || productId),
      purchasedProduct: purchaseFillProduct ? structuredClone(purchaseFillProduct) : existing?.purchasedProduct || null,
      quantity: safeQuantity,
      price: safePrice,
      completionMode: (purchaseFillProduct || safePrice > 0) ? "filled" : (existing.completionMode || "closed"),
    });
    updateAnswerItemRow(productId);
    dialog.dataset.dirty = "false";
    if (dialog.open) dialog.close();
    return true;
  }

  function answerItemSummary(item, requestItem = null) {
    const unit = requestItemUnit(requestItem || item);
    if (item.completionMode === "closed") return `Отмечено: ${number(item.quantity)} ${unit}`;
    const purchased = getProduct(item.purchasedProductId);
    const productName = item.purchasedProduct?.name || purchased?.name || "Товар";
    return `${productName} · ${number(item.quantity)} ${unit}${item.price ? ` · ${money(item.price)}` : ""}`;
  }

  function updateAnswerItemRow(productId) {
    const row = document.querySelector(`.answer-list-row[data-product-id="${productId}"]`);
    if (!row) return;
    const item = answerDraftItems.get(productId);
    row.querySelector(".answer-check").checked = Boolean(item);
    const summary = row.querySelector(".answer-item-summary");
    const requestItem = getRequest(routeId)?.items.find((value) => value.productId === productId);
    summary.textContent = item ? answerItemSummary(item, requestItem) : "";
    summary.hidden = !item;
  }

  function saveAnswerTransaction(event, request, editedResponse) {
    event.preventDefault();
    const saved = localData.saveReceipt(request.id, [...answerDraftItems.values()], editedResponse?.id || "");
    if (!saved.ok) return showToast(saved.reason);
    state = localData.snapshot();
    draftItems = [];
    navigate("request-edit", request.id);
    showToast("Покупки сохранены.");
  }

  function renderRation(focusItemId = "") {
    const view = ["day", "week", "month"].includes(state.rationView) ? state.rationView : "week";
    const anchor = /^\d{4}-\d{2}-\d{2}$/.test(state.rationAnchor || "") ? state.rationAnchor : todayDateKey();
    const viewLabel = view === "day" ? "День" : view === "week" ? "Неделя" : "Месяц";
    rationHeaderPicker.innerHTML = `
      <button id="ration-view-button" class="ration-view-button" type="button" aria-haspopup="menu" aria-expanded="false"><span>${viewLabel}</span><i aria-hidden="true">▾</i></button>
      <div id="ration-view-menu" class="ration-view-menu" role="menu" hidden>
        ${[["day", "День"], ["week", "Неделя"], ["month", "Месяц"]].map(([value, label]) => `<button class="ration-view-option ${view === value ? "active" : ""}" data-view="${value}" role="menuitem" type="button"><span>${view === value ? "✓" : ""}</span>${label}</button>`).join("")}
      </div>`;
    app.innerHTML = `
      <section class="ration-toolbar">
        <div class="ration-date-nav">
          <button id="ration-prev" class="ration-nav-button" type="button" aria-label="Предыдущий период">‹</button>
          <input id="ration-anchor" type="date" value="${anchor}">
          <button id="ration-next" class="ration-nav-button" type="button" aria-label="Следующий период">›</button>
          <button id="ration-today" class="text-button" type="button">Сегодня</button>
          <button id="ration-select-mode" class="text-button" type="button" ${rationSelectionActive() ? "disabled" : ""}>${rationSelectionActive() ? "Выбор включён" : "Выбрать"}</button>
          <button id="ration-add-meal" class="ration-add-button" type="button">＋ Приём</button>
        </div>
      </section>
      ${rationSelectionActive() ? `<div class="ration-selection-sheet">${rationSelectionToolbar()}${rationTemplateControls()}${rationSelectionItems()}</div>` : ""}
      <section class="ration-calendar-shell">
        ${view === "day" ? rationDayCalendar(anchor) : view === "week" ? rationWeekCalendar(anchor) : rationMonthCalendar(anchor)}
      </section>
      ${rationMealDialog(anchor)}
      ${rationPortionDialog()}
      ${rationTemplateDialog()}
    `;
    bindRation(view, anchor);
    if (focusItemId) document.querySelector(`.ration-food-row[data-item-id="${focusItemId}"] .ration-food-input`)?.focus();
    else if (view === "day" && anchor === todayDateKey() && !routeSubId) {
      setTimeout(() => document.querySelector(".ration-now-line")?.scrollIntoView({ block: "center" }), 0);
    }
  }

  function rationCalendarTitle(view, anchor) {
    const date = parseRationDate(anchor);
    if (view === "month") return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(date);
    if (view === "week") {
      const start = startOfRationWeek(anchor);
      const end = addRationDays(start, 6);
      return `${rationShortDate(start)} — ${rationShortDate(end)}`;
    }
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date);
  }

  function rationCurrentTime() {
    return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date());
  }

  function rationMealTime(meal, index = 0) {
    return /^\d{2}:\d{2}$/.test(meal?.time || "") ? meal.time : ["08:00", "13:00", "19:00"][index] || `${String(Math.min(22, 8 + index * 3)).padStart(2, "0")}:00`;
  }

  function rationMealNutrition(meal) {
    return (meal?.items || []).reduce((total, item) => {
      const product = getProduct(item.productId);
      const measure = rationMeasure(product);
      const portion = Number(item.portionSize) || measure.defaultPortion;
      const factor = measure.unit === "шт." ? 1 : portion / 100;
      total.calories += (Number(product?.nutrition?.calories) || 0) * factor;
      total.protein += (Number(product?.nutrition?.protein) || 0) * factor;
      total.fat += (Number(product?.nutrition?.fat) || 0) * factor;
      total.carbs += (Number(product?.nutrition?.carbs) || 0) * factor;
      return total;
    }, { calories: 0, protein: 0, fat: 0, carbs: 0 });
  }

  function rationDayNutrition(dateKey) {
    return (rationDayFor(state, dateKey)?.meals || []).reduce((total, meal) => {
      const value = rationMealNutrition(meal);
      Object.keys(total).forEach((key) => { total[key] += value[key]; });
      return total;
    }, { calories: 0, protein: 0, fat: 0, carbs: 0 });
  }

  function rationDayCalendar(dateKey) {
    const day = rationDayFor(state, dateKey) || { date: dateKey, meals: defaultRationMeals(dateKey) };
    return `<div class="ration-day-calendar">
      <button class="ration-day-banner ration-select-day ${dateKey === todayDateKey() ? "today" : ""} ${dateKey === state.rationAnchor ? "focused" : ""} ${rationSelectedDates.has(dateKey) ? "selected" : ""}" data-date="${dateKey}" type="button"><strong>${rationWeekday(dateKey)}</strong><span>${rationLongDate(dateKey)}</span></button>
      <div class="ration-day-agenda">
        ${dateKey === todayDateKey() ? `<div class="ration-agenda-now"><span>${rationCurrentTime()}</span><i></i><strong>Сейчас</strong></div>` : ""}
        ${(day.meals || []).map((meal, index) => rationDayMealCard(dateKey, meal, index)).join("")}
      </div>
    </div>`;
  }

  function rationDayMealCard(dateKey, meal, index) {
    const nutrition = rationMealNutrition(meal);
    const products = (meal.items || []).map((item) => getProduct(item.productId)?.name || item.name).filter(Boolean);
    return `<button class="ration-calendar-meal agenda-event ${rationSelectedMealIds.has(meal.id) ? "meal-selected" : ""}" data-date="${dateKey}" data-meal-id="${meal.id}" type="button">
      <span class="meal-event-time">${rationMealTime(meal, index)}</span>
      <div><strong>${escapeHtml(meal.name)}</strong><span class="meal-event-products">${products.length ? products.map(escapeHtml).join(" · ") : "Добавьте продукты"}</span><small>${number(nutrition.calories)} ккал · Б ${number(nutrition.protein)} · Ж ${number(nutrition.fat)} · У ${number(nutrition.carbs)}</small></div>
    </button>`;
  }

  function rationDayMealEvent(dateKey, meal, index, startHour, hourHeight) {
    const time = rationMealTime(meal, index);
    const [hour, minute] = time.split(":").map(Number);
    const top = Math.max(0, (hour * 60 + minute - startHour * 60) / 60 * hourHeight);
    const nutrition = rationMealNutrition(meal);
    const products = (meal.items || []).map((item) => getProduct(item.productId)?.name || item.name).filter(Boolean);
    return `<button class="ration-calendar-meal day-event" data-date="${dateKey}" data-meal-id="${meal.id}" type="button" style="top:${top}px">
      <span class="meal-event-time">${time}</span><strong>${escapeHtml(meal.name)}</strong>
      <span class="meal-event-products">${products.length ? products.map(escapeHtml).join(" · ") : "Добавьте продукты"}</span>
      <small>${number(nutrition.calories)} ккал · Б ${number(nutrition.protein)} · Ж ${number(nutrition.fat)} · У ${number(nutrition.carbs)}</small>
    </button>`;
  }

  function rationWeekCalendar(anchor) {
    const start = startOfRationWeek(anchor);
    return `<div class="ration-week-calendar">
      ${Array.from({ length: 7 }, (_, index) => {
        const dateKey = addRationDays(start, index);
        const day = rationDayFor(state, dateKey) || { meals: defaultRationMeals(dateKey) };
        const selected = rationSelectedDates.has(dateKey);
        return `<section class="ration-week-column ${dateKey === todayDateKey() ? "today" : ""} ${dateKey === anchor ? "focused" : ""} ${selected ? "selected" : ""}">
          <button class="ration-week-header ration-select-day" data-date="${dateKey}" type="button"><span>${rationWeekday(dateKey).slice(0, 2)}</span><strong>${parseRationDate(dateKey).getDate()}</strong>${dateKey === todayDateKey() ? `<small>${rationCurrentTime()}</small>` : ""}</button>
          <div class="ration-week-events">${(day.meals || []).map((meal, mealIndex) => {
            const nutrition = rationMealNutrition(meal);
            const selectableIds = (meal.items || []).filter((item) => item.productId).map((item) => item.id);
            const mealSelected = rationSelectedMealIds.has(meal.id) || (selectableIds.length && selectableIds.every((itemId) => rationSelectedItemIds.has(itemId)));
            return `<button class="ration-calendar-meal week-event ${mealSelected ? "meal-selected" : ""}" data-date="${dateKey}" data-meal-id="${meal.id}" type="button"><span>${rationMealTime(meal, mealIndex)}</span><strong>${escapeHtml(meal.name)}</strong><small>${number(nutrition.calories)}<i>ккал</i></small><em><span>Б ${number(nutrition.protein)}</span><span>Ж ${number(nutrition.fat)}</span><span>У ${number(nutrition.carbs)}</span></em></button>`;
          }).join("")}</div>
        </section>`;
      }).join("")}
    </div>`;
  }

  function rationMonthCalendar(anchor) {
    const date = parseRationDate(anchor);
    const first = new Date(date.getFullYear(), date.getMonth(), 1, 12);
    const gridStart = addRationDays(formatRationDate(first), -((first.getDay() + 6) % 7));
    return `<div class="ration-month-calendar">
      <div class="ration-month-weekdays">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => `<span>${day}</span>`).join("")}</div>
      <div class="ration-month-grid">${Array.from({ length: 42 }, (_, index) => {
        const dateKey = addRationDays(gridStart, index);
        const nutrition = rationDayNutrition(dateKey);
        const outside = parseRationDate(dateKey).getMonth() !== date.getMonth();
        const selected = rationSelectedDates.has(dateKey);
        return `<button class="ration-month-day ration-select-day ${outside ? "outside" : ""} ${dateKey === todayDateKey() ? "today" : ""} ${dateKey === anchor ? "focused" : ""} ${selected ? "selected" : ""}" data-date="${dateKey}" type="button"><strong>${parseRationDate(dateKey).getDate()}</strong><span>${number(nutrition.calories)}<small>ккал</small></span></button>`;
      }).join("")}</div>
    </div>`;
  }

  function rationMealDialog(dateKey) {
    if (!routeSubId) return "";
    const day = rationDayFor(state, dateKey) || { date: dateKey, meals: defaultRationMeals(dateKey) };
    const meal = day.meals.find((value) => value.id === routeSubId);
    if (!meal) return "";
    return `<dialog id="ration-meal-dialog" class="ration-meal-dialog">
      <header><div><span>${rationLongDate(dateKey)}</span><h2>${escapeHtml(meal.name)}</h2></div><button id="close-ration-meal" type="button" aria-label="Закрыть">×</button></header>
      ${rationMealEditor(dateKey, meal, day.meals.length)}
    </dialog>`;
  }

  function rationSelectionItems() {
    if (!rationSelectionActive()) return "";
    const dates = [...rationSelectedDates].sort();
    const rows = dates.flatMap((dateKey) => (rationDayFor(state, dateKey)?.meals || []).flatMap((meal) =>
      (meal.items || []).filter((item) => item.productId).map((item) => {
        const product = getProduct(item.productId);
        const measure = rationMeasure(product);
        return `<label class="ration-selection-item"><input class="ration-item-check" data-date="${dateKey}" data-item-id="${item.id}" type="checkbox" ${rationSelectedItemIds.has(item.id) ? "checked" : ""}><span><strong>${escapeHtml(product?.name || item.name || "Продукт")}</strong><small>${rationShortDate(dateKey)} · ${rationMealTime(meal)} · ${number(item.portionSize || measure.defaultPortion)} ${measure.unit}</small></span></label>`;
      })
    ));
    return `<section class="ration-selection-items">${rows.length ? rows.join("") : `<p class="muted">В выбранных днях пока нет продуктов.</p>`}</section>`;
  }

  function rationDynamics(view, anchor) {
    const points = rationMetricPoints(view, anchor);
    const maxCalories = Math.max(1, ...points.map((point) => point.calories));
    const maxPrice = Math.max(1, ...points.map((point) => point.price));
    const totalCalories = points.reduce((sum, point) => sum + point.calories, 0);
    const totalPrice = points.reduce((sum, point) => sum + point.price, 0);
    return `
      <section class="ration-dynamics section">
        <header class="ration-dynamics-header">
          <div><span class="eyebrow">Динамика</span><h2>${view === "day" ? "За день" : view === "week" ? "За неделю" : "За месяц"}</h2></div>
          <div class="ration-totals"><strong>${number(totalCalories)} ккал</strong><span>${money(totalPrice)}</span></div>
        </header>
        <div class="ration-chart ${view === "month" ? "month" : ""}">
          ${points.map((point) => `<div class="ration-chart-point" title="${escapeAttr(`${point.label}: ${number(point.calories)} ккал, ${money(point.price)}`)}">
            <div class="ration-bars"><i class="calories" style="height:${Math.max(point.calories ? 5 : 0, point.calories / maxCalories * 100)}%"></i><i class="price" style="height:${Math.max(point.price ? 5 : 0, point.price / maxPrice * 100)}%"></i></div>
            <span>${escapeHtml(point.label)}</span>
          </div>`).join("")}
        </div>
        <div class="ration-legend"><span><i class="calories"></i>Калории</span><span><i class="price"></i>Цена</span></div>
        <p class="muted ration-basis">Калории и стоимость распределяются пропорционально настроенным порциям; цена упаковки берётся из последней покупки.</p>
      </section>`;
  }

  function rationMetricPoints(view, anchor) {
    if (view === "day") {
      const day = rationDayFor(state, anchor);
      return (day?.meals?.length ? day.meals : defaultRationMeals(anchor)).map((meal) => ({
        label: meal.name,
        ...rationItemsMetrics(meal.items || []),
      }));
    }
    let dates;
    if (view === "month") {
      const date = parseRationDate(anchor);
      const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      dates = Array.from({ length: count }, (_, index) => formatRationDate(new Date(date.getFullYear(), date.getMonth(), index + 1, 12)));
    } else {
      const start = startOfRationWeek(anchor);
      dates = Array.from({ length: 7 }, (_, index) => addRationDays(start, index));
    }
    return dates.map((dateKey) => ({
      label: view === "month" ? String(parseRationDate(dateKey).getDate()) : rationWeekday(dateKey).slice(0, 2),
      ...rationItemsMetrics((rationDayFor(state, dateKey)?.meals || []).flatMap((meal) => meal.items || [])),
    }));
  }

  function rationItemsMetrics(items) {
    return items.reduce((total, item) => {
      const product = getProduct(item.productId);
      const measure = rationMeasure(product);
      const portionSize = Number(item.portionSize) || measure.defaultPortion;
      const packageSize = Number(item.packageSize) || measure.defaultPackage;
      const nutritionFactor = measure.unit === "шт." ? 1 : portionSize / 100;
      total.calories += (Number(product?.nutrition?.calories) || 0) * nutritionFactor;
      total.price += latestProductPrice(item.productId) * portionSize / packageSize;
      return total;
    }, { calories: 0, price: 0 });
  }

  function latestProductPrice(productId) {
    let latest = null;
    activeRequests().forEach((request) => activeResponses(request).forEach((response) => {
      response.items.forEach((item) => {
        if ((item.purchasedProductId || item.productId) !== productId || !Number(item.price)) return;
        if (!latest || timestamp(response.createdAt) > timestamp(latest.createdAt)) latest = { price: Number(item.price), createdAt: response.createdAt };
      });
    }));
    return latest?.price || 0;
  }

  function rationSelectionToolbar() {
    if (!rationSelectionActive()) return "";
    const dateCount = rationSelectedDates.size;
    const itemCount = rationSelectedItemIds.size;
    const mealCount = rationSelectedMealIds.size;
    const canDelete = mealCount > 0 || itemCount > 0 || dateCount > 0;
    return `<section class="ration-selection">
      <div>
        <strong>${dateCount} дн. · ${mealCount} приём. · ${itemCount} поз.</strong>
        <span>Нажимайте дни и приёмы пищи, чтобы выбрать их</span>
      </div>
      <div class="ration-selection-actions">
        <button id="request-ration" class="button" type="button" ${itemCount ? "" : "disabled"}>Запросить</button>
        <button id="delete-ration-selection" class="button danger" type="button" ${canDelete ? "" : "disabled"}>Удалить</button>
        <button id="cancel-ration-selection" class="text-button" type="button">Отмена</button>
      </div>
    </section>`;
  }

  function rationSelectionActive() {
    return rationSelectionMode;
  }

  function rationTemplateControls() {
    const templates = rationTemplatesForUser(state);
    return `<section class="ration-template-actions">
      <button id="create-ration-template" class="button secondary" type="button" ${rationSelectedDates.size !== 1 ? "disabled" : ""}>Создать шаблон дня</button>
      <div class="ration-template-apply">
        <select id="ration-template-select" aria-label="Сохранённый шаблон" ${templates.length ? "" : "disabled"}>
          ${templates.length ? templates.map((template) => `<option value="${escapeAttr(template.id)}">${escapeHtml(template.name)}</option>`).join("") : `<option>Нет шаблонов</option>`}
        </select>
        <button id="apply-ration-template" class="button" type="button" ${templates.length && rationSelectedDates.size ? "" : "disabled"}>Применить</button>
      </div>
      <div class="ration-template-manage">
        <button id="rename-ration-template" class="text-button" type="button" ${templates.length ? "" : "disabled"}>Переименовать</button>
        <button id="delete-ration-template" class="text-button error" type="button" ${templates.length ? "" : "disabled"}>Удалить шаблон</button>
      </div>
    </section>`;
  }

  function rationTemplateDialog() {
    return `<dialog id="ration-template-dialog" class="answer-dialog">
      <form id="ration-template-form">
        <h2 id="ration-template-dialog-title">Новый шаблон</h2>
        <label class="field"><span>Название шаблона</span><input id="ration-template-name" maxlength="80" autocomplete="off" required></label>
        <button class="button full" type="submit">Сохранить</button>
        <button id="cancel-ration-template" class="text-button dialog-cancel" type="button">Отмена</button>
      </form>
    </dialog>`;
  }

  function rationWeekEditor(anchor) {
    const start = startOfRationWeek(anchor);
    return `<div class="ration-week">${Array.from({ length: 7 }, (_, index) => {
      const dateKey = addRationDays(start, index);
      const selected = rationSelectedDates.has(dateKey);
      return `
        <details class="ration-day-panel ${selected ? "selected" : ""}" data-date="${dateKey}" ${dateKey === anchor || dateKey === todayDateKey() ? "open" : ""}>
          <summary><strong>${rationWeekday(dateKey)}</strong><span>${rationShortDate(dateKey)}</span></summary>
          ${rationDayEditor(dateKey, false)}
        </details>`;
    }).join("")}</div>`;
  }

  function rationMonthEditor(anchor) {
    const date = parseRationDate(anchor);
    const first = new Date(date.getFullYear(), date.getMonth(), 1, 12);
    const gridStart = addRationDays(formatRationDate(first), -((first.getDay() + 6) % 7));
    return `
      <h2 class="ration-month-title">${new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(date)}</h2>
      <div class="ration-weekdays">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => `<span>${day}</span>`).join("")}</div>
      <div class="ration-calendar">${Array.from({ length: 42 }, (_, index) => {
        const dateKey = addRationDays(gridStart, index);
        const day = rationDayFor(state, dateKey);
        const itemCount = day?.meals?.reduce((sum, meal) => sum + meal.items.filter((item) => item.name || item.productId).length, 0) || 0;
        const outside = parseRationDate(dateKey).getMonth() !== date.getMonth();
        return `<button class="ration-calendar-day ${outside ? "outside" : ""} ${dateKey === todayDateKey() ? "today" : ""}" data-date="${dateKey}" type="button">
          <strong>${parseRationDate(dateKey).getDate()}</strong>
          ${itemCount ? `<span>${itemCount} ${rationProductWord(itemCount)}</span>` : ""}
        </button>`;
      }).join("")}</div>
      <p class="muted ration-month-hint">Нажмите на день, чтобы заполнить его приёмы пищи.</p>`;
  }

  function rationDayEditor(dateKey, showHeading) {
    const day = rationDayFor(state, dateKey) || { date: dateKey, meals: defaultRationMeals(dateKey) };
    return `
      <div class="ration-day-editor" data-date="${dateKey}">
        ${showHeading ? `<h2 class="ration-day-title">${rationLongDate(dateKey)}</h2>` : ""}
        <div class="ration-meals">${day.meals.map((meal) => rationMealEditor(dateKey, meal, day.meals.length)).join("")}</div>
        <button class="add-ration-meal keep-add-item" data-date="${dateKey}" type="button"><span>＋</span> Добавить приём пищи</button>
      </div>`;
  }

  function rationMealEditor(dateKey, meal, mealCount) {
    const mealIndex = (rationDayFor(state, dateKey)?.meals || []).findIndex((value) => value.id === meal.id);
    return `
      <article class="ration-meal" data-date="${dateKey}" data-meal-id="${meal.id}">
        <header class="ration-meal-header">
          <input class="ration-meal-time" type="time" value="${rationMealTime(meal, Math.max(0, mealIndex))}" aria-label="Плановое время">
          <input class="ration-meal-name" value="${escapeAttr(meal.name)}" aria-label="Название приёма пищи">
          <button class="remove-ration-meal" type="button" aria-label="Удалить приём пищи ${escapeAttr(meal.name)}">×</button>
        </header>
        <div class="ration-food-list">
          ${(meal.items || []).map((item) => rationFoodRow(dateKey, meal.id, item)).join("")}
        </div>
        <button class="add-ration-food keep-add-item" type="button"><span>＋</span> Добавить продукт</button>
      </article>`;
  }

  function rationFoodRow(dateKey, mealId, item) {
    const product = getProduct(item.productId);
    const value = product?.name || item.name || "";
    const listId = `ration-products-${item.id}`;
    const measure = rationMeasure(product);
    const portion = Number(item.portionSize) || measure.defaultPortion;
    const packageSize = Number(item.packageSize) || measure.defaultPackage;
    return `
      <div class="ration-food-row" data-item-id="${item.id}">
        ${rationSelectionActive()
          ? `<input class="ration-item-check" data-date="${dateKey}" type="checkbox" aria-label="Добавить в запрос" ${rationSelectedItemIds.has(item.id) ? "checked" : ""}>`
          : `<span class="list-checkbox" aria-hidden="true"></span>`}
        <input class="ration-food-input" list="${listId}" value="${escapeAttr(value)}" placeholder="Продукт" autocomplete="off">
        <datalist id="${listId}">${productSuggestionOptions(value)}</datalist>
        <button class="save-ration-food" type="button" aria-label="Сохранить ${escapeAttr(value || "продукт")}">✓</button>
        <button class="ration-portion-button" type="button" aria-label="Настроить порцию ${escapeAttr(product?.name || item.query || "продукта")}">${number(portion)} ${measure.unit}<small>из ${number(packageSize)} ${measure.unit}</small></button>
        <button class="remove-ration-food" type="button" aria-label="Удалить ${escapeAttr(product?.name || item.query || "продукт")}">×</button>
      </div>`;
  }

  function rationPortionDialog() {
    return `<dialog id="ration-portion-dialog" class="answer-dialog ration-portion-dialog">
      <form id="ration-portion-form">
        <h2>Порция продукта</h2>
        <p id="ration-portion-product" class="purchase-product-name"></p>
        <label class="field"><span>Размер одной порции</span><div class="input-with-unit"><input id="ration-portion-size" type="number" min="0.01" step="0.01" required><strong id="ration-portion-unit"></strong></div></label>
        <label class="field"><span>Размер покупаемой упаковки</span><div class="input-with-unit"><input id="ration-package-size" type="number" min="0.01" step="0.01" required><strong id="ration-package-unit"></strong></div></label>
        <p id="ration-portion-preview" class="muted"></p>
        <button class="button full" type="submit">Сохранить</button>
        <button id="cancel-ration-portion" class="text-button dialog-cancel" type="button">Отмена</button>
      </form>
    </dialog>`;
  }

  function bindRation(view, anchor) {
    const viewButton = document.getElementById("ration-view-button");
    const viewMenu = document.getElementById("ration-view-menu");
    viewButton.onclick = (event) => {
      event.stopPropagation();
      viewMenu.hidden = !viewMenu.hidden;
      viewButton.setAttribute("aria-expanded", String(!viewMenu.hidden));
    };
    document.querySelectorAll(".ration-view-option").forEach((button) => {
      button.onclick = () => {
        applyLocal(localData.setRationCalendar({ view: button.dataset.view, anchor }));
        renderRation();
      };
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".ration-header-picker")) {
        viewMenu.hidden = true;
        viewButton.setAttribute("aria-expanded", "false");
      }
    }, { once: true });
    document.getElementById("ration-anchor").onchange = (event) => setRationAnchor(event.target.value || todayDateKey());
    document.getElementById("ration-today").onclick = () => setRationAnchor(todayDateKey());
    document.getElementById("ration-prev").onclick = () => shiftRationAnchor(view, anchor, -1);
    document.getElementById("ration-next").onclick = () => shiftRationAnchor(view, anchor, 1);
    document.getElementById("ration-select-mode").onclick = () => {
      rationSelectionMode = true;
      renderRation();
    };
    document.querySelectorAll(".ration-month-day").forEach((button) => {
      button.onclick = () => {
        routeSubId = null;
        applyLocal(localData.setRationCalendar({ view: "day", anchor: button.dataset.date }));
        renderRation();
      };
    });
    document.querySelectorAll(".ration-calendar-meal").forEach((button) => {
      button.onclick = (event) => {
        if (button.dataset.longPressed === "true") {
          button.dataset.longPressed = "false";
          return;
        }
        if (rationSelectionMode) {
          toggleRationMealSelection(button);
          return;
        }
        applyLocal(localData.setRationCalendar({ anchor: button.dataset.date }));
        routeSubId = button.dataset.mealId;
        renderRation();
      };
      bindRationLongPress(button, () => {
        rationSelectionMode = true;
        button.dataset.longPressed = "true";
        toggleRationMealSelection(button, true);
      });
    });
    document.getElementById("ration-add-meal").onclick = () => {
      const added = localData.addRationMeal(anchor);
      if (!applyLocal(added)) return;
      routeSubId = added.mealId;
      renderRation();
    };
    document.querySelectorAll(".ration-select-day:not(.ration-month-day)").forEach((selector) => {
      selector.onclick = () => {
        if (selector.dataset.longPressed === "true") {
          selector.dataset.longPressed = "false";
          return;
        }
        if (rationSelectionMode) return toggleRationDaySelection(selector.dataset.date);
        if (view === "week") {
          applyLocal(localData.setRationCalendar({ view: "day", anchor: selector.dataset.date }));
          renderRation();
        }
      };
      bindRationLongPress(selector, () => {
        rationSelectionMode = true;
        selector.dataset.longPressed = "true";
        toggleRationDaySelection(selector.dataset.date);
      });
    });
    document.getElementById("cancel-ration-selection")?.addEventListener("click", () => {
      clearRationSelection();
      renderRation();
    });
    document.getElementById("request-ration")?.addEventListener("click", createRequestFromRationSelection);
    document.getElementById("delete-ration-selection")?.addEventListener("click", deleteRationSelection);
    document.getElementById("create-ration-template")?.addEventListener("click", createRationTemplate);
    document.getElementById("apply-ration-template")?.addEventListener("click", applyRationTemplate);
    document.getElementById("rename-ration-template")?.addEventListener("click", renameRationTemplate);
    document.getElementById("delete-ration-template")?.addEventListener("click", deleteRationTemplate);
    document.querySelectorAll(".add-ration-meal").forEach((button) => {
      button.onclick = () => {
        applyLocal(localData.addRationMeal(button.dataset.date));
        renderRation();
      };
    });
    document.querySelectorAll(".ration-meal-name").forEach((input) => {
      input.onchange = () => updateRationMealName(input);
    });
    document.querySelectorAll(".ration-meal-time").forEach((input) => {
      input.onchange = () => updateRationMealTime(input);
    });
    document.querySelectorAll(".remove-ration-meal").forEach((button) => {
      button.onclick = () => removeRationMeal(button);
    });
    document.querySelectorAll(".add-ration-food").forEach((button) => {
      button.onclick = () => addRationFood(button);
    });
    document.querySelectorAll(".remove-ration-food").forEach((button) => {
      button.onclick = () => removeRationFood(button);
    });
    document.querySelectorAll(".save-ration-food").forEach((button) => {
      button.onclick = () => saveRationFood(button.closest(".ration-food-row").querySelector(".ration-food-input"), false);
    });
    document.querySelectorAll(".ration-item-check").forEach((checkbox) => {
      checkbox.onchange = () => {
        const itemId = checkbox.dataset.itemId || checkbox.closest(".ration-food-row")?.dataset.itemId;
        if (checkbox.checked) rationSelectedItemIds.add(itemId);
        else rationSelectedItemIds.delete(itemId);
        if (checkbox.dataset.date) refreshRationSelectedDate(checkbox.dataset.date);
        renderRation();
      };
    });
    document.querySelectorAll(".ration-portion-button").forEach((button) => {
      button.onclick = () => openRationPortionDialog(button);
    });
    document.querySelectorAll(".ration-food-input").forEach((input) => {
      input.oninput = () => {
        const list = input.parentElement.querySelector("datalist");
        if (list) list.innerHTML = productSuggestionOptions(input.value);
      };
      input.onkeydown = (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        input.dataset.saving = "true";
        saveRationFood(input, true);
      };
    });
    bindRationPortionDialog();
    bindRationTemplateDialog();
    const mealDialog = document.getElementById("ration-meal-dialog");
    if (mealDialog) {
      mealDialog.dataset.dirty = "false";
      document.getElementById("close-ration-meal").onclick = () => closeDialogSafely(mealDialog);
      mealDialog.addEventListener("close", () => { routeSubId = null; renderRation(); });
      mealDialog.showModal();
    }
  }

  function bindRationLongPress(element, handler) {
    let timer = null;
    let startX = 0;
    let startY = 0;
    element.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      startX = event.clientX;
      startY = event.clientY;
      timer = setTimeout(() => {
        timer = null;
        handler();
      }, 460);
    });
    element.addEventListener("pointermove", (event) => {
      if (timer && Math.hypot(event.clientX - startX, event.clientY - startY) > 10) {
        clearTimeout(timer);
        timer = null;
      }
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((name) => element.addEventListener(name, () => {
      if (timer) clearTimeout(timer);
      timer = null;
    }));
  }

  function toggleRationMealSelection(button, allowEmpty = false) {
    const dateKey = button.dataset.date;
    const meal = rationDayFor(state, dateKey)?.meals.find((value) => value.id === button.dataset.mealId)
      || defaultRationMeals(dateKey).find((value) => value.id === button.dataset.mealId);
    const itemIds = (meal?.items || []).filter((item) => item.productId).map((item) => item.id);
    rationSelectionMode = true;
    const mealId = meal?.id || button.dataset.mealId;
    const allSelected = rationSelectedMealIds.has(mealId);
    if (allSelected) rationSelectedMealIds.delete(mealId);
    else rationSelectedMealIds.add(mealId);
    itemIds.forEach((itemId) => allSelected ? rationSelectedItemIds.delete(itemId) : rationSelectedItemIds.add(itemId));
    refreshRationSelectedDate(dateKey);
    applyLocal(localData.setRationCalendar({ anchor: dateKey }));
    if (navigator.vibrate) navigator.vibrate(20);
    renderRation();
  }

  function toggleRationDaySelection(dateKey) {
    rationSelectionMode = true;
    const itemIds = rationItemIdsForDate(dateKey);
    const mealIds = rationMealIdsForDate(dateKey);
    const selected = rationSelectedDates.has(dateKey);
    if (selected) {
      rationSelectedDates.delete(dateKey);
      itemIds.forEach((itemId) => rationSelectedItemIds.delete(itemId));
      mealIds.forEach((mealId) => rationSelectedMealIds.delete(mealId));
    } else {
      rationSelectedDates.add(dateKey);
      itemIds.forEach((itemId) => rationSelectedItemIds.add(itemId));
      mealIds.forEach((mealId) => rationSelectedMealIds.add(mealId));
    }
    applyLocal(localData.setRationCalendar({ anchor: dateKey }));
    if (navigator.vibrate) navigator.vibrate(20);
    renderRation();
  }

  function rationItemIdsForDate(dateKey) {
    return (rationDayFor(state, dateKey)?.meals || []).flatMap((meal) =>
      (meal.items || []).filter((item) => item.productId).map((item) => item.id)
    );
  }

  function rationMealIdsForDate(dateKey) {
    return (rationDayFor(state, dateKey)?.meals || []).map((meal) => meal.id);
  }

  function refreshRationSelectedDate(dateKey) {
    const hasSelectedItems = rationItemIdsForDate(dateKey).some((itemId) => rationSelectedItemIds.has(itemId));
    const hasSelectedMeals = rationMealIdsForDate(dateKey).some((mealId) => rationSelectedMealIds.has(mealId));
    if (hasSelectedItems || hasSelectedMeals) rationSelectedDates.add(dateKey);
    else rationSelectedDates.delete(dateKey);
  }

  function openRationPortionDialog(button) {
    const row = button.closest(".ration-food-row");
    const card = button.closest(".ration-meal");
    const day = rationDayFor(state, card.dataset.date);
    const meal = day?.meals.find((value) => value.id === card.dataset.mealId);
    const item = meal?.items.find((value) => value.id === row.dataset.itemId);
    if (!item) return;
    const product = getProduct(item.productId);
    if (!product) return showToast("Сначала выберите продукт.");
    const measure = rationMeasure(product);
    rationPortionTarget = { dateKey: card.dataset.date, mealId: meal.id, itemId: item.id };
    document.getElementById("ration-portion-product").textContent = product.name;
    document.getElementById("ration-portion-size").value = Number(item.portionSize) || measure.defaultPortion;
    document.getElementById("ration-package-size").value = Number(item.packageSize) || measure.defaultPackage;
    document.getElementById("ration-portion-unit").textContent = measure.unit;
    document.getElementById("ration-package-unit").textContent = measure.unit;
    updateRationPortionPreview();
    const dialog = document.getElementById("ration-portion-dialog");
    dialog.dataset.dirty = "false";
    dialog.showModal();
  }

  function bindRationPortionDialog() {
    const dialog = document.getElementById("ration-portion-dialog");
    document.getElementById("cancel-ration-portion")?.addEventListener("click", () => closeDialogSafely(dialog));
    document.getElementById("ration-portion-size")?.addEventListener("input", updateRationPortionPreview);
    document.getElementById("ration-package-size")?.addEventListener("input", updateRationPortionPreview);
    document.getElementById("ration-portion-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!rationPortionTarget) return;
      applyLocal(localData.setRationPortion(
        rationPortionTarget.dateKey,
        rationPortionTarget.mealId,
        rationPortionTarget.itemId,
        {
          portionSize: document.getElementById("ration-portion-size").value,
          packageSize: document.getElementById("ration-package-size").value,
          measureUnit: document.getElementById("ration-portion-unit").textContent,
        }
      ));
      rationPortionTarget = null;
      renderRation();
    });
  }

  function updateRationPortionPreview() {
    const portion = Number(document.getElementById("ration-portion-size")?.value) || 0;
    const packageSize = Number(document.getElementById("ration-package-size")?.value) || 0;
    const unit = document.getElementById("ration-portion-unit")?.textContent || "г";
    const count = portion && packageSize ? Math.floor(packageSize / portion * 10) / 10 : 0;
    const preview = document.getElementById("ration-portion-preview");
    if (preview) preview.textContent = packageSize ? `Одной упаковки хватит примерно на ${number(count)} порц. по ${number(portion)} ${unit}.` : "";
  }

  function createRationTemplate() {
    const dates = [...rationSelectedDates];
    if (dates.length !== 1) return showToast("Для шаблона выберите один день.");
    const day = rationDayFor(state, dates[0]);
    if (!day?.meals?.length) return showToast("В выбранном дне пока нет приёмов пищи.");
    openRationTemplateDialog("create", `Рацион ${rationShortDate(dates[0])}`, dates[0]);
  }

  function renameRationTemplate() {
    const templateId = document.getElementById("ration-template-select")?.value;
    const template = rationTemplatesForUser(state).find((item) => item.id === templateId);
    if (template) openRationTemplateDialog("rename", template.name, "", template.id);
  }

  function openRationTemplateDialog(mode, name, dateKey = "", templateId = "") {
    const dialog = document.getElementById("ration-template-dialog");
    dialog.dataset.mode = mode;
    dialog.dataset.date = dateKey;
    dialog.dataset.templateId = templateId;
    dialog.dataset.dirty = "false";
    document.getElementById("ration-template-dialog-title").textContent = mode === "rename" ? "Переименовать шаблон" : "Новый шаблон";
    document.getElementById("ration-template-name").value = name;
    dialog.showModal();
    document.getElementById("ration-template-name").focus();
  }

  function bindRationTemplateDialog() {
    const dialog = document.getElementById("ration-template-dialog");
    document.getElementById("cancel-ration-template")?.addEventListener("click", () => closeDialogSafely(dialog));
    document.getElementById("ration-template-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = document.getElementById("ration-template-name").value.trim();
      if (!name) return;
      if (dialog.dataset.mode === "rename") saveRenamedRationTemplate(dialog.dataset.templateId, name);
      else saveNewRationTemplate(dialog.dataset.date, name);
      dialog.dataset.dirty = "false";
      dialog.close();
    });
  }

  function saveNewRationTemplate(dateKey, name) {
    if (!applyLocal(localData.saveRationTemplateFromDay(dateKey, name))) return;
    renderRation();
    showToast("Шаблон дня сохранён.");
  }

  function saveRenamedRationTemplate(templateId, name) {
    if (!applyLocal(localData.renameRationTemplate(templateId, name))) return;
    renderRation();
    showToast("Шаблон переименован.");
  }

  async function deleteRationTemplate() {
    const templateId = document.getElementById("ration-template-select")?.value;
    const template = rationTemplatesForUser(state).find((item) => item.id === templateId);
    if (!template || !await askConfirm(`Удалить шаблон «${template.name}»?`)) return;
    const previous = localData.snapshot();
    if (!applyLocal(localData.removeRationTemplate(templateId))) return;
    renderRation();
    showToast(`Шаблон «${template.name}» удалён.`, "Отменить", () => {
      state = localData.commit(previous);
      renderRation();
    });
  }

  async function applyRationTemplate() {
    const templateId = document.getElementById("ration-template-select")?.value;
    const template = rationTemplatesForUser(state).find((item) => item.id === templateId);
    const dates = [...rationSelectedDates];
    if (!template || !dates.length) return;
    const filledDates = dates.filter((dateKey) => (rationDayFor(state, dateKey)?.meals || []).some((meal) => meal.items?.length || meal.name));
    if (filledDates.length && !await askConfirm(`Шаблон заменит существующий рацион в ${filledDates.length} ${filledDates.length === 1 ? "дне" : "днях"}. Продолжить?`)) return;
    const previous = localData.snapshot();
    if (!applyLocal(localData.applyRationTemplate(templateId, dates))) return;
    renderRation();
    showToast(`Шаблон применён к ${dates.length} дн.`, "Отменить", () => {
      state = localData.commit(previous);
      renderRation();
    });
  }

  function createRequestFromRationSelection() {
    const created = localData.createRequestFromRation({
      dates: [...rationSelectedDates],
      itemIds: [...rationSelectedItemIds],
    });
    if (!applyLocal(created)) return;
    clearRationSelection();
    draftItems = [];
    navigate("request-edit", created.requestId);
    showToast("Продукты рациона добавлены в запрос.");
  }

  async function deleteRationSelection() {
    const selectedMealIds = new Set(rationSelectedMealIds);
    const selectedItemIds = new Set(rationSelectedItemIds);
    const selectedDates = new Set(rationSelectedDates);
    if (!selectedMealIds.size && !selectedItemIds.size && !selectedDates.size) {
      return showToast("Ничего не выбрано.");
    }

    let confirmText = "Удалить выбранное из рациона?";
    if (selectedMealIds.size) {
      confirmText = selectedMealIds.size === 1
        ? "Удалить выбранный приём пищи и все его продукты?"
        : `Удалить ${selectedMealIds.size} приёма(ов) пищи и все их продукты?`;
    } else if (selectedItemIds.size) {
      confirmText = selectedItemIds.size === 1
        ? "Удалить выбранный продукт из рациона?"
        : `Удалить ${selectedItemIds.size} продукт(ов) из рациона?`;
    } else if (selectedDates.size) {
      confirmText = selectedDates.size === 1
        ? "Очистить рацион выбранного дня?"
        : `Очистить рацион в ${selectedDates.size} днях?`;
    }
    if (!await askConfirm(confirmText)) return;

    const previous = localData.snapshot();
    const deleted = localData.deleteRationSelection({
      mealIds: [...selectedMealIds],
      itemIds: [...selectedItemIds],
      dates: [...selectedDates],
    });
    if (!applyLocal(deleted)) {
      clearRationSelection();
      renderRation();
      return;
    }
    clearRationSelection();
    routeSubId = null;
    renderRation();
    showToast("Выбранное удалено из рациона.", "Отменить", () => {
      state = localData.commit(previous);
      renderRation();
    });
  }

  function setRationAnchor(dateKey) {
    routeSubId = null;
    applyLocal(localData.setRationCalendar({ anchor: dateKey }));
    renderRation();
  }

  function shiftRationAnchor(view, anchor, direction) {
    const date = parseRationDate(anchor);
    if (view === "month") date.setMonth(date.getMonth() + direction);
    else date.setDate(date.getDate() + direction * (view === "week" ? 7 : 1));
    setRationAnchor(formatRationDate(date));
  }

  function updateRationMealName(input) {
    const card = input.closest(".ration-meal");
    applyLocal(localData.updateRationMeal(card.dataset.date, card.dataset.mealId, { name: input.value }));
    renderRation();
  }

  function updateRationMealTime(input) {
    const card = input.closest(".ration-meal");
    applyLocal(localData.updateRationMeal(card.dataset.date, card.dataset.mealId, { time: input.value }));
    routeSubId = card.dataset.mealId;
    renderRation();
  }

  async function removeRationMeal(button) {
    const card = button.closest(".ration-meal");
    const currentDay = rationDayFor(state, card.dataset.date);
    const currentMeal = currentDay?.meals.find((meal) => meal.id === card.dataset.mealId);
    if (!currentMeal || !await askConfirm(`Удалить приём пищи «${currentMeal.name}» и все его продукты?`)) return;
    const previous = localData.snapshot();
    if (!applyLocal(localData.removeRationMeal(card.dataset.date, card.dataset.mealId))) return;
    routeSubId = null;
    renderRation();
    showToast(`Приём пищи «${currentMeal.name}» удалён.`, "Отменить", () => {
      state = localData.commit(previous);
      routeSubId = currentMeal.id;
      renderRation();
    });
  }

  function addRationFood(button) {
    const card = button.closest(".ration-meal");
    const added = localData.addRationFood(card.dataset.date, card.dataset.mealId);
    if (!applyLocal(added)) return;
    renderRation(added.itemId);
  }

  function removeRationFood(button) {
    const card = button.closest(".ration-meal");
    const row = button.closest(".ration-food-row");
    const removedItem = rationDayFor(state, card.dataset.date)?.meals
      .find((meal) => meal.id === card.dataset.mealId)?.items
      .find((item) => item.id === row.dataset.itemId);
    const removedName = getProduct(removedItem?.productId)?.name || removedItem?.name || "Продукт";
    const previous = localData.snapshot();
    if (!applyLocal(localData.removeRationFood(card.dataset.date, card.dataset.mealId, row.dataset.itemId))) return;
    renderRation();
    showToast(`«${removedName}» удалён из рациона.`, "Отменить", () => {
      state = localData.commit(previous);
      routeSubId = card.dataset.mealId;
      renderRation();
    });
  }

  function saveRationFood(input, addNext) {
    const card = input.closest(".ration-meal");
    const row = input.closest(".ration-food-row");
    const saved = localData.saveRationFood(card.dataset.date, card.dataset.mealId, row.dataset.itemId, {
      name: input.value,
      hint: suggestionByName(input.value),
      addNext,
    });
    if (!applyLocal(saved)) return;
    renderRation(saved.nextItemId || "");
  }

  function defaultRationMeals(dateKey) {
    return [];
  }

  function addRationDays(value, count) {
    const date = parseRationDate(value);
    date.setDate(date.getDate() + count);
    return formatRationDate(date);
  }

  function startOfRationWeek(value) {
    const date = parseRationDate(value);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return formatRationDate(date);
  }

  function rationWeekday(value) {
    const result = new Intl.DateTimeFormat("ru-RU", { weekday: "long" }).format(parseRationDate(value));
    return result.charAt(0).toUpperCase() + result.slice(1);
  }

  function rationShortDate(value) {
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(parseRationDate(value));
  }

  function rationLongDate(value) {
    return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(parseRationDate(value));
  }

  function rationProductWord(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return "продукт";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "продукта";
    return "продуктов";
  }

  function renderAppUpdateSection() {
    const currentVersion = escapeHtml(appUpdate.installedVersion || "—");
    const latestVersion = escapeHtml(appUpdate.latestVersion || "");
    let content = "";

    if (appUpdate.status === "available") {
      content = `
        <p class="success"><strong>Доступна версия ${latestVersion}</strong></p>
        ${appUpdate.notes ? `<p class="muted app-update-notes">${escapeHtml(appUpdate.notes)}</p>` : ""}
        <button id="install-app-update" class="button full" type="button">Обновить до ${latestVersion}</button>
        ${appUpdate.releaseUrl ? `<button id="open-app-release" class="text-button" type="button">Открыть описание релиза</button>` : ""}
      `;
    } else if (appUpdate.status === "checking") {
      content = `<button class="button secondary full" type="button" disabled>Проверяем обновления…</button>`;
    } else if (appUpdate.status === "downloading") {
      content = `<p class="success">Загружаем Cookish ${latestVersion}…</p><button class="button full" type="button" disabled>Загрузка обновления…</button>`;
    } else if (appUpdate.status === "permissionRequired") {
      content = `<p class="warning">${escapeHtml(appUpdate.message || "Разрешите установку обновлений в настройках Android.")}</p><button id="install-app-update" class="button full" type="button">Открыть разрешение Android</button>`;
    } else if (appUpdate.status === "installing") {
      content = `<p class="success">${escapeHtml(appUpdate.message || "Подтвердите установку в Android.")}</p><button id="check-app-update" class="button secondary full" type="button">Проверить ещё раз</button>`;
    } else if (appUpdate.status === "upToDate") {
      content = `<p class="success">Установлена актуальная версия.</p><button id="check-app-update" class="button secondary full" type="button">Проверить ещё раз</button>`;
    } else if (appUpdate.status === "error") {
      content = `<p class="error">${escapeHtml(appUpdate.message || "Не удалось проверить обновления.")}</p><button id="check-app-update" class="button secondary full" type="button">Повторить проверку</button>`;
    } else if (appUpdate.status === "unsupported") {
      content = `<p class="muted">Проверка обновлений доступна в Android-приложении.</p>`;
    } else {
      content = `<button id="check-app-update" class="button secondary full" type="button">Проверить обновления</button>`;
    }

    return `
      <section class="section profile-settings-section app-update-section">
        <span class="eyebrow">Приложение</span>
        <h2 class="profile-section-title">Обновление</h2>
        <div class="compact-line"><span>Текущая версия</span><strong>${currentVersion}</strong></div>
        ${content}
      </section>
    `;
  }

  function requestAppUpdateCheck(force = false) {
    if (!window.NativeCookish?.checkForAppUpdate) {
      appUpdate = { ...appUpdate, status: "unsupported" };
      return;
    }
    if (!force && appUpdate.status !== "idle" && appUpdate.status !== "error") return;
    appUpdate = { ...appUpdate, status: "checking", message: "" };
    if (route === "profile") renderProfile();
    window.NativeCookish.checkForAppUpdate();
  }

  function renderProfile() {
    const completed = activeRequests().filter((item) => item.status === "done");
    const responseCount = activeRequests().reduce((sum, item) => sum + activeResponses(item).length, 0);
    const spent = completed.reduce((sum, item) => sum + requestTotal(item), 0);
    app.innerHTML = `
      <div class="metrics">
        ${metric("Всего запросов", activeRequests().length)}
        ${metric("Выполнено", completed.length)}
        ${metric("Количество трат", responseCount)}
        ${metric("Сумма трат", money(spent))}
      </div>
      <section class="section profile-products">
        <div class="section-heading"><div><span class="eyebrow">Данные</span><h2 class="profile-section-title">Продукты</h2></div><strong>${state.products.filter((item) => !item.deletedAt).length}</strong></div>
        <p class="muted">Каталог, единицы измерения, штрихкоды и пищевая ценность продуктов.</p>
        <button id="manage-products" class="button secondary full" type="button">Открыть продукты</button>
      </section>
      ${renderAppUpdateSection()}
      <section class="section danger-zone">
        <span class="eyebrow">Опасная зона</span>
        <h2 class="profile-section-title">Данные устройства</h2>
        <button id="clear-data" class="button danger full" type="button">Удалить все локальные данные</button>
      </section>
    `;
    bindProfileActions();
  }

  function bindProfileActions() {
    document.getElementById("manage-products")?.addEventListener("click", () => navigate("products"));
    document.getElementById("check-app-update")?.addEventListener("click", () => requestAppUpdateCheck(true));
    document.getElementById("install-app-update")?.addEventListener("click", () => {
      window.NativeCookish?.installLatestUpdate?.();
    });
    document.getElementById("open-app-release")?.addEventListener("click", () => {
      if (appUpdate.releaseUrl) window.NativeCookish?.openUrl?.(appUpdate.releaseUrl);
    });
    document.getElementById("clear-data")?.addEventListener("click", async () => {
      if (!await askConfirm("Удалить продукты, запросы и настройки с этого устройства?")) return;
      state = localData.clear();
      navigate("summary");
    });
  }

  function bindRequestRows() {
    document.querySelectorAll(".request-link").forEach((button) => {
      button.onclick = () => {
        draftItems = [];
        navigate("request-edit", button.dataset.id);
      };
    });
  }

  function requestRow(request, context) {
    const summary = requestSummary(request);
    const price = context === "requests" && isRequestFulfilled(request)
      ? `<span class="status done">${money(requestTotal(request))}</span>`
      : "";
    return `
      <button class="row link-row request-link" data-id="${request.id}" type="button">
        <div class="row-main">
          <strong>${escapeHtml(summary)}</strong>
          <span>${date(request.createdAt)}${isRemoteRequest(request) ? ` · от ${escapeHtml(request.createdBy)}` : ""}</span>
        </div>
        ${price}
      </button>`;
  }

  function metric(label, value) {
    return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
  }

  function requestTotal(request) {
    return activeResponses(request).reduce(
      (sum, response) => sum + response.items.reduce((responseSum, item) => responseSum + item.price, 0),
      0
    );
  }

  function activeRequests() {
    return (state.requests || []).filter((request) => !request.deletedAt);
  }

  function requestSummary(request) {
    if (!request.items?.length) return "Пустой запрос";
    return request.items.map((item) => {
      const product = getProduct(item.productId);
      const note = String(item.note || "").trim();
      return `${product?.name || "Продукт"}${note ? ` ${note}` : ""} — ${requestAmountLabel(item)}`;
    }).join("; ");
  }

  function requestItemUnit(item) {
    if (item?.unit) return item.unit;
    if (item?.plannedAmount) return "уп.";
    const product = getProduct(item?.productId) || suggestionByName(item?.query || "");
    return product?.unit || "шт.";
  }

  function requestAmountLabel(item) {
    if (!Number(item.plannedAmount) || !Number(item.packageSize)) return `${number(item.quantity || 1)} ${escapeHtml(requestItemUnit(item))}`;
    const packages = Math.max(1, Math.ceil(Number(item.plannedAmount) / Number(item.packageSize)));
    const rounded = packages * Number(item.packageSize);
    return `${number(rounded)} ${escapeHtml(item.measureUnit || "г")} (${packages} уп. по ${number(item.packageSize)})`;
  }

  function isRemoteRequest(request) {
    const currentEmail = state.user?.email?.toLowerCase();
    const creator = request.createdBy?.toLowerCase();
    return Boolean(currentEmail && creator && creator !== "local" && creator !== currentEmail);
  }

  function getProduct(productId) {
    return state.products.find((product) => product.id === productId && !product.deletedAt);
  }

  function getRequest(requestId) {
    return state.requests.find((request) => request.id === requestId && !request.deletedAt);
  }

  function showToast(message, actionLabel = "", action = null) {
    const toast = document.getElementById("toast");
    const messageElement = document.getElementById("toast-message");
    const actionButton = document.getElementById("toast-action");
    messageElement.textContent = message;
    actionButton.hidden = !actionLabel || typeof action !== "function";
    actionButton.textContent = actionLabel;
    actionButton.onclick = actionButton.hidden ? null : () => {
      clearTimeout(toastTimer);
      toast.classList.remove("show");
      actionButton.hidden = true;
      action();
    };
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
      actionButton.hidden = true;
      actionButton.onclick = null;
    }, action ? 6000 : 3200);
  }

  function id(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function money(value) {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB",
      maximumFractionDigits: 2,
    }).format(Number(value) || 0);
  }

  function number(value) {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
  }

  function date(value) {
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
      .format(new Date(value));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  if (typeof window.addEventListener === "function") {
    window.addEventListener("resize", queuePurchaseDialogViewportSync, { passive: true });
  }
  if (typeof window.visualViewport?.addEventListener === "function") {
    window.visualViewport.addEventListener("resize", queuePurchaseDialogViewportSync, { passive: true });
    window.visualViewport.addEventListener("scroll", queuePurchaseDialogViewportSync, { passive: true });
  }

  render();
  requestAppUpdateCheck(false);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden" && appUpdate.status === "installing") requestAppUpdateCheck(true);
  });
