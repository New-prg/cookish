(() => {
  "use strict";

  const STORAGE_KEY = "cookish.android.data.v1";
  const FOREGROUND_SYNC_INTERVAL_MS = 30_000;
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
  const defaultState = {
    schemaVersion: 10,
    products: [],
    requests: [],
    rationDays: {},
    rationTemplates: [],
    rationView: "week",
    rationAnchor: "",
    spreadsheetId: "",
    spreadsheetTitle: "",
    user: null,
    onboardingCompleted: false,
    backgroundAccessSkipped: false,
    seenRemoteRequestIds: [],
    remoteTrackingInitialized: false,
  };

  let state = loadState();
  let route = state.onboardingCompleted ? "summary" : "onboarding";
  let routeId = null;
  let routeSubId = null;
  let draftItems = [];
  let accessToken = null;
  let authResolve = null;
  let backgroundAccess = null;
  let toastTimer = null;
  let syncTimer = null;
  let foregroundSyncTimer = null;
  let syncInProgress = false;
  let onboardingWorking = false;
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
  let syncStatusLabel = "";
  let confirmResolve = null;
  let productEditReturn = null;
  let requestGestureToken = 0;

  const app = document.getElementById("app");
  const title = document.getElementById("page-title");
  const headerAction = document.getElementById("header-action");
  const rationHeaderPicker = document.getElementById("ration-header-picker");
  const syncChip = document.getElementById("sync-chip");
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

  window.__handleNativeBack = () => attemptBackNavigation();

  window.__onNativeGoogleAuth = (payload) => {
    const result = JSON.parse(payload);
    if (!authResolve) return;
    authResolve(result);
    authResolve = null;
  };

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

  window.__onNativeBackgroundAccess = (payload) => {
    const next = JSON.parse(payload);
    const changed = JSON.stringify(next) !== JSON.stringify(backgroundAccess);
    backgroundAccess = next;
    if (next?.fullyGranted && state.backgroundAccessSkipped) {
      state.backgroundAccessSkipped = false;
      saveState(false);
    }
    if (changed && route === "profile") renderProfile();
    if (changed && route === "onboarding") renderOnboarding();
  };

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const loaded = { ...defaultState, ...stored };
      if (typeof stored.onboardingCompleted !== "boolean") {
        loaded.onboardingCompleted = Boolean(stored.user && stored.spreadsheetId);
      }
      loaded.products = loaded.products.map((product) => normalizeProductRecord({
        ...product,
        updatedAt: product.updatedAt || new Date(0).toISOString(),
        updatedBy: product.updatedBy || "local",
      }));
      loaded.requests = loaded.requests.map((request) => migrateRequest(request, loaded.products));
      loaded.rationDays = loaded.rationDays && typeof loaded.rationDays === "object" ? loaded.rationDays : {};
      loaded.rationTemplates = Array.isArray(loaded.rationTemplates) ? loaded.rationTemplates : [];
      loaded.rationView = ["day", "week", "month"].includes(loaded.rationView) ? loaded.rationView : "week";
      loaded.rationAnchor = /^\d{4}-\d{2}-\d{2}$/.test(loaded.rationAnchor || "") ? loaded.rationAnchor : todayDateKey();
      return buildSyncPackage(loaded);
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveState(sync = true) {
    commitState(state, sync);
  }

  function commitState(nextState, sync = true) {
    const normalized = buildSyncPackage(nextState);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    state = normalized;
    mirrorStateForBackgroundSync();
    if (sync) queueAutoSync();
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

  function isInteractiveEditing() {
    if (document.querySelector("dialog[open]")) return true;
    if (formDirty) return true;
    if (route === "ration" && routeSubId) return true;
    if (["product-new", "product-edit", "request-edit", "request-answer"].includes(route)) return true;
    const active = document.activeElement;
    return Boolean(
      active
      && app.contains(active)
      && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)
      && active.type !== "checkbox"
      && active.type !== "radio"
      && active.type !== "button"
      && active.type !== "submit"
    );
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

  function setSyncChip(label, kind = "") {
    syncStatusLabel = label || "";
    if (!syncChip) return;
    if (!label) {
      syncChip.hidden = true;
      syncChip.textContent = "";
      syncChip.className = "sync-chip";
      return;
    }
    syncChip.hidden = false;
    syncChip.textContent = label;
    syncChip.className = `sync-chip${kind ? ` ${kind}` : ""}`;
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
    nav.hidden = route === "onboarding" || route.includes("-new") || route.endsWith("-edit") || route === "request-answer";
    document.body.classList.toggle("nav-hidden", Boolean(nav.hidden));
    document.body.style.paddingBottom = "";
    configureHeader();

    if (route === "onboarding") renderOnboarding();
    else if (route === "summary") renderSummary();
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
      onboarding: ["Первый запуск", "", false],
      summary: ["Сводка", "", false],
      products: ["Продукты", "Добавить", false],
      "product-new": ["Новый продукт", "Отмена", true],
      "product-edit": ["Редактирование", productEditReturn ? "Назад" : "Отмена", true],
      requests: ["Запросы", "Создать", false],
      "request-edit": ["Запрос", "Готово", true],
      "request-detail": ["Запрос", "Назад", false],
      "request-answer": ["Отметить покупки", "Готово", true],
      ration: ["Рацион", "", false],
      profile: ["Профиль", "", false],
    }[route];
    title.textContent = config[0];
    headerAction.textContent = config[1];
    headerAction.hidden = !config[1];
    rationHeaderPicker.hidden = route !== "ration";
  }

  function renderOnboarding() {
    const backgroundSupported = Boolean(window.NativeGoogle?.requestBackgroundAccess);
    const backgroundReady = Boolean(backgroundAccess?.fullyGranted);
    const backgroundStepDone = backgroundReady || state.backgroundAccessSkipped;
    if (backgroundStepDone && state.user && state.spreadsheetId) {
      state.onboardingCompleted = true;
      saveState();
      navigate("summary");
      showToast("Первоначальная настройка завершена.");
      return;
    }

    const step = !backgroundStepDone ? 1 : !state.user ? 2 : 3;
    app.innerHTML = `
      <section class="section onboarding-card">
        <p class="muted">Шаг ${step} из 3</p>
        ${step === 1 ? `
          <p class="onboarding-eyebrow">Настройка уведомлений</p>
          <h2 class="onboarding-title">Разрешите фоновую работу</h2>
          <p>Чтобы «Cookish» проверял общую таблицу в фоне, Android попросит уведомления и разрешение не ограничивать приложение батареей. Это можно включить позже в профиле.</p>
          <div class="compact-line"><span>Уведомления</span><strong>${backgroundAccess?.notificationsGranted ? "Разрешены" : "Ожидают разрешения"}</strong></div>
          <div class="compact-line"><span>Фоновая работа</span><strong>${backgroundAccess?.batteryOptimizationDisabled ? "Разрешена" : "Ожидает разрешения"}</strong></div>
          ${backgroundSupported
            ? `<button id="onboarding-background" class="button full" type="button">${backgroundAccess ? "Выдать разрешения" : "Запросить разрешения"}</button>
               <button id="onboarding-check-background" class="button secondary full onboarding-secondary" type="button">Проверить снова</button>`
            : `<p class="warning">Системный запрос сейчас недоступен. Можно продолжить и включить фоновую синхронизацию позже в профиле.</p>`}
          <button id="onboarding-skip-background" class="text-button onboarding-skip" type="button">Продолжить без фоновой синхронизации</button>
        ` : step === 2 ? `
          <p class="onboarding-eyebrow">Общий доступ</p>
          <h2 class="onboarding-title">Подключите Google-аккаунт</h2>
          <p>Аккаунт используется для доступа к общей Google Таблице. Пароль приложение не получает и не хранит.</p>
          <button id="onboarding-google" class="button full" type="button" ${onboardingWorking ? "disabled" : ""}>${onboardingWorking ? "Подключение…" : "Войти через Google"}</button>
        ` : `
          <p class="onboarding-eyebrow">Хранилище данных</p>
          <h2 class="onboarding-title">Настройте Google Таблицу</h2>
          <p>Создайте новую таблицу или подключите существующую таблицу участников.</p>
          <label class="field"><span>Ссылка или ID существующей таблицы</span><input id="onboarding-sheet-input" autocomplete="off" ${onboardingWorking ? "disabled" : ""}></label>
          <button id="onboarding-connect-sheet" class="button secondary full" type="button" ${onboardingWorking ? "disabled" : ""}>Подключить существующую</button>
          <button id="onboarding-create-sheet" class="button full" type="button" style="margin-top:10px" ${onboardingWorking ? "disabled" : ""}>${onboardingWorking ? "Настройка…" : "Создать новую таблицу"}</button>
        `}
        <p id="onboarding-status" class="muted"></p>
      </section>
    `;

    window.NativeGoogle?.getBackgroundAccessStatus?.();
    document.getElementById("onboarding-background")?.addEventListener("click", () => {
      window.NativeGoogle.requestBackgroundAccess();
      setOnboardingStatus("Подтвердите системные запросы Android.");
    });
    document.getElementById("onboarding-check-background")?.addEventListener("click", () => {
      window.NativeGoogle.getBackgroundAccessStatus?.();
      setOnboardingStatus("Проверяем системные разрешения…");
    });
    document.getElementById("onboarding-skip-background")?.addEventListener("click", () => {
      state.backgroundAccessSkipped = true;
      saveState(false);
      renderOnboarding();
    });
    document.getElementById("onboarding-google")?.addEventListener("click", async () => {
      onboardingWorking = true;
      renderOnboarding();
      const token = await authorizeGoogle(false);
      onboardingWorking = false;
      if (!token) {
        renderOnboarding();
        return setOnboardingStatus("Не удалось подключить Google-аккаунт.", true);
      }
      renderOnboarding();
    });
    document.getElementById("onboarding-connect-sheet")?.addEventListener("click", async () => {
      const spreadsheetId = extractSpreadsheetId(document.getElementById("onboarding-sheet-input").value);
      if (!spreadsheetId) return setOnboardingStatus("Укажите корректную ссылку или ID.", true);
      await configureOnboardingSheet(async (token) => {
        const sheetTitle = await setupSpreadsheet(token, spreadsheetId);
        state.spreadsheetId = spreadsheetId;
        state.spreadsheetTitle = sheetTitle;
      });
    });
    document.getElementById("onboarding-create-sheet")?.addEventListener("click", async () => {
      await configureOnboardingSheet(async (token) => {
        const response = await googleFetch("https://sheets.googleapis.com/v4/spreadsheets", token, {
          method: "POST",
          body: JSON.stringify({ properties: { title: `Cookish — ${new Date().toLocaleDateString("ru-RU")}` } }),
        });
        state.spreadsheetId = response.spreadsheetId;
        state.spreadsheetTitle = response.properties.title;
        await setupSpreadsheet(token, response.spreadsheetId);
      });
    });
  }

  async function configureOnboardingSheet(action) {
    if (onboardingWorking) return;
    onboardingWorking = true;
    renderOnboarding();
    try {
      const token = accessToken || await authorizeGoogle(false);
      if (!token) throw new Error("Google-аккаунт не подключён.");
      await action(token);
      state.onboardingCompleted = true;
      saveState();
      onboardingWorking = false;
      navigate("summary");
      showToast("Первоначальная настройка завершена.");
    } catch (error) {
      onboardingWorking = false;
      renderOnboarding();
      setOnboardingStatus(error.message || "Не удалось настроить таблицу.", true);
    }
  }

  function setOnboardingStatus(message, error = false) {
    const element = document.getElementById("onboarding-status");
    if (!element) return showToast(message);
    element.textContent = message;
    element.className = error ? "error" : "muted";
  }

  function renderSummary() {
    const completed = activeRequests().filter((item) => item.status === "done");
    const totals = completed.map(requestTotal);
    const total = totals.reduce((sum, value) => sum + value, 0);
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const last30 = completed
      .filter((item) => new Date(item.completedAt || item.createdAt).getTime() >= cutoff)
      .reduce((sum, item) => sum + requestTotal(item), 0);
    const active = activeRequests().filter((item) => item.status === "open");

    const productCount = state.products.filter((product) => !product.deletedAt).length;
    app.innerHTML = `
      <div class="metrics">
        ${metric("Активные запросы", active.length)}
        ${metric("Средний чек", money(completed.length ? total / completed.length : 0))}
        ${metric("Траты за 30 дней", money(last30))}
        <button id="summary-products" class="metric metric-button" type="button"><span>Продукты</span><strong>${productCount}</strong></button>
      </div>
      <section class="section">
        <h2 class="section-title">Активные запросы</h2>
        ${active.length
          ? active.map(requestRow).join("")
          : `<div class="empty-state">
              <p class="empty">Пока нет активных запросов</p>
              <p class="muted">Создайте список покупок или соберите его из рациона.</p>
              <button id="summary-empty-request" class="button full" type="button">Создать запрос</button>
            </div>`}
      </section>
      ${active.length ? `<section class="section"><button id="summary-new-request" class="button full" type="button">Создать запрос</button></section>` : ""}
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

  function normalizeProductName(name) {
    return String(name || "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
  }

  function isRealProductId(productId) {
    return Boolean(productId && state.products.some((product) => product.id === productId && !product.deletedAt));
  }

  function resolveDraftProductId(query, previousId = "") {
    if (isRealProductId(previousId)) return previousId;
    const key = normalizeProductName(query);
    if (!key) return "";
    const existing = state.products.find((product) => !product.deletedAt && normalizeProductName(product.name) === key);
    if (existing) return existing.id;
    // Catalog/OFF ids are not real products until resolveOrCreateProduct runs.
    return "";
  }

  function normalizeGenericKey(value) {
    return normalizeProductName(value).replace(/[^a-zа-яё0-9]+/gi, "_").replace(/^_|_$/g, "");
  }

  function genericKeyFromParts(category, name, fallback = "") {
    if (category) return normalizeGenericKey(category);
    const first = String(name || "").trim().split(/\s+/)[0] || fallback;
    return normalizeGenericKey(first);
  }

  function inferProductKind(product) {
    if (product?.kind === "generic" || product?.kind === "sku") return product.kind;
    if (product?.barcode || product?.brand) return "sku";
    return "generic";
  }

  function isProductConfirmed(product) {
    if (!product) return false;
    if (product.confirmed === true) return true;
    if (product.confirmed === false) return false;
    // Legacy rows without the flag: barcode-backed cards are treated as confirmed SKUs.
    return Boolean(product.barcode);
  }

  function normalizeProductRecord(product) {
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

  function resolveOrCreateProduct(draft, products, changedAt) {
    const key = normalizeProductName(draft.query);
    const existing = products.find((product) => !product.deletedAt && normalizeProductName(product.name) === key);
    if (existing) return existing;
    const catalog = [...remoteProductSuggestions, ...FOOD_CATALOG]
      .find((product) => normalizeProductName(product.name) === key);
    const category = catalog?.category || "";
    const name = draft.query.trim();
    const product = {
      id: id("product"),
      name,
      category,
      unit: catalog?.unit || "шт.",
      brand: catalog?.brand || "",
      kind: catalog?.kind || (catalog?.barcode ? "sku" : "generic"),
      genericKey: catalog?.genericKey || genericKeyFromParts(category, name),
      confirmed: false,
      updatedAt: changedAt,
      updatedBy: state.user?.email || "local",
      nutrition: catalog ? structuredClone(catalog.nutrition) : null,
      barcode: catalog?.barcode || "",
      ingredients: catalog?.ingredients || "",
      catalogSource: catalog?.catalogSource || (catalog ? "Встроенный справочник" : ""),
      nutritionSource: catalog?.catalogSource || (catalog ? "Справочник" : ""),
    };
    products.push(product);
    return product;
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

  function openFoodFactsUnit(product) {
    const water = (product.categories_tags || []).some((tag) => /water/i.test(tag));
    const quantity = String(product.quantity || "").toLowerCase();
    if (water || /\b(ml|мл|l|л)\b/.test(quantity)) return "л";
    if (/\b(kg|кг)\b/.test(quantity)) return "кг";
    if (/\b(g|г)\b/.test(quantity)) return "г";
    return "шт.";
  }

  function openFoodFactsSuggestion(product) {
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

  async function searchOpenFoodFactsByName(query, rowKey) {
    const normalized = normalizeProductName(query);
    if (normalized.length < 3) return;
    const sequence = ++productNameSearchSequence;
    setDraftProductMeta(rowKey, "Ищем в Open Food Facts…");
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
      const selected = suggestionByName(query);
      setDraftProductMeta(rowKey, selected
        ? suggestionLabel(selected)
        : suggestions.length
          ? `Найдено в Open Food Facts: ${suggestions.length}. Выберите вариант из подсказок.`
          : "В Open Food Facts совпадений нет — товар будет добавлен вручную.");
    } catch (error) {
      if (sequence !== productNameSearchSequence) return;
      setDraftProductMeta(rowKey, "Онлайн-поиск недоступен — товар всё равно можно добавить вручную.");
    }
  }

  function productSuggestionOptions(query = "") {
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
    return candidates
      .slice(0, 3)
      .map((product) =>
      `<option value="${escapeAttr(product.name)}" label="${escapeAttr(suggestionLabel(product))}"></option>`
    ).join("");
  }

  function updateProductDatalists() {
    document.querySelectorAll(".request-item").forEach((row) => {
      const input = row.querySelector(".draft-product");
      const list = row.querySelector("datalist");
      if (input && list) list.innerHTML = productSuggestionOptions(input.value);
    });
  }

  function setDraftProductMeta(rowKey, message) {
    const row = [...document.querySelectorAll(".request-item")].find((item) => item.dataset.key === rowKey);
    const meta = row?.querySelector(".draft-product-meta");
    if (!meta) return;
    meta.textContent = message || "";
    meta.hidden = !message;
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
        const used = activeRequests().some((request) =>
          request.items.some((item) => item.productId === button.dataset.id)
          || request.responses.some((response) => response.items.some((item) =>
            (item.purchasedProductId || item.productId) === button.dataset.id
          ))
        );
        if (used) return showToast("Продукт используется в запросе.");
        const product = state.products.find((item) => item.id === button.dataset.id);
        if (!product) return;
        if (!await askConfirm(`Удалить продукт «${product.name}»?`)) return;
        const changedAt = new Date().toISOString();
        product.deletedAt = changedAt;
        product.updatedAt = changedAt;
        product.updatedBy = state.user?.email || "local";
        saveState();
        renderProducts();
        showToast(`Продукт «${product.name}» удалён.`, "Отменить", () => {
          const deletedProduct = state.products.find((item) => item.id === product.id);
          if (!deletedProduct) return;
          deletedProduct.deletedAt = "";
          deletedProduct.updatedAt = new Date().toISOString();
          deletedProduct.updatedBy = state.user?.email || "local";
          saveState();
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
      if (!window.NativeGoogle?.scanBarcode) return setBarcodeStatus("Сканирование доступно в Android-приложении.", true);
      barcodeScanTarget = "product";
      window.NativeGoogle.scanBarcode();
    });
    document.getElementById("product-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const changedAt = new Date().toISOString();
      const name = data.get("name").trim();
      const category = data.get("category").trim();
      const barcode = data.get("barcode").trim();
      const values = {
        name,
        barcode,
        category,
        unit: data.get("unit"),
        brand: product?.brand || "",
        kind: barcode ? "sku" : (product?.kind || "generic"),
        genericKey: product?.genericKey || genericKeyFromParts(category, name),
        confirmed: true,
        updatedAt: changedAt,
        updatedBy: state.user?.email || "local",
        nutrition: nutritionFromForm(data, event.currentTarget.dataset.nutritionSource || product?.nutrition?.source || "Введено пользователем"),
        ingredients: data.get("ingredients").trim(),
        catalogSource: event.currentTarget.dataset.nutritionSource || product?.catalogSource || "",
      };
      if (product) Object.assign(product, values);
      else state.products.push({ id: id("product"), ...values });
      saveState();
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
      ? sorted.map(requestRow).join("")
      : `<section class="section"><div class="empty-state">
          <p class="empty">Запросов пока нет</p>
          <p class="muted">Список покупок создаётся сразу, как заметка: добавляйте позиции по одной.</p>
          <button id="requests-empty-add" class="button full" type="button">Создать запрос</button>
        </div></section>`;
    bindRequestRows();
    document.getElementById("requests-empty-add")?.addEventListener("click", () => createEmptyRequestAndOpen());
  }

  function createEmptyRequestAndOpen() {
    const changedAt = new Date().toISOString();
    const nextRequest = {
      id: id("request"),
      createdAt: changedAt,
      status: "open",
      items: [],
      responses: [],
      createdBy: state.user?.email || "local",
      updatedBy: state.user?.email || "local",
      updatedAt: changedAt,
      history: [],
    };
    appendRequestVersion(nextRequest, "Запрос создан", changedAt, nextRequest.createdBy);
    const nextState = structuredClone(state);
    nextState.requests.push(nextRequest);
    commitState(nextState);
    draftItems = [];
    navigate("request-edit", nextRequest.id);
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
      draftItems.push({ key: id("item"), productId: "", query: "", quantity: 1, unit: "", editingName: true });
    }
  }

  function renderRequestForm(focusKey = "") {
    const editedRequest = getRequest(routeId);
    if (!editedRequest) return navigate("requests");
    ensureRequestDraftRows(editedRequest);
    const history = [...(editedRequest.history || [])]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const spent = requestTotal(editedRequest);
    app.innerHTML = `
      <div class="keep-note">
        <div class="keep-note-actions keep-note-meta" style="border-top:0;padding-bottom:4px">
          <span class="status ${editedRequest.status}">${requestStatusLabel(editedRequest)}</span>
          <span class="muted">${date(editedRequest.createdAt)}${editedRequest.createdBy && editedRequest.createdBy !== "local" ? ` · ${escapeHtml(editedRequest.createdBy)}` : ""}</span>
          ${spent > 0 ? `<strong>${money(spent)}</strong>` : ""}
        </div>
        <div id="request-items" class="keep-list">${draftItems.map((item) => draftItemRow(item, editedRequest)).join("")}</div>
        <button id="add-request-item" class="keep-add-line" type="button">＋ Позиция</button>
        ${answerActionDialog()}
        <div class="keep-note-actions">
          <p class="muted">Галочка — куплено. Свайп или долгий тап по строке — цена, количество и штрихкод. Тап по названию товара — карточка.</p>
          ${history.length > 1 ? `
            <details class="section" style="padding:0;border:0">
              <summary class="section-title" style="cursor:pointer;list-style:none">История изменений</summary>
              ${history.map((transaction, index) => `
                <div class="compact-line transaction-line">
                  <span><strong>${escapeHtml(transaction.action)}</strong><br>${dateTime(transaction.createdAt)}</span>
                  ${index === 0
                    ? `<span class="muted">Текущая</span>`
                    : `<button class="text-button restore-version" data-id="${escapeAttr(transaction.id)}" type="button">Откатить</button>`}
                </div>
              `).join("")}
            </details>
          ` : ""}
          <button id="delete-request" class="button danger full" type="button">Удалить запрос</button>
        </div>
      </div>
    `;
    bindDraftItems();
    bindRequestPurchaseChecks(editedRequest);
    bindAnswerDialog(editedRequest, null);
    document.getElementById("add-request-item").onclick = () => {
      commitRequestFieldChange();
      addEmptyRequestLine();
    };
    document.querySelectorAll(".restore-version").forEach((button) => {
      button.onclick = async () => {
        const transaction = (editedRequest.history || []).find((item) => item.id === button.dataset.id);
        if (!transaction) return;
        if (!await askConfirm(`Откатить запрос к версии «${transaction.action}» от ${dateTime(transaction.createdAt)}?`)) return;
        const changedAt = new Date().toISOString();
        const nextState = structuredClone(state);
        const nextRequest = nextState.requests.find((item) => item.id === editedRequest.id);
        if (!nextRequest) return;
        restoreRequestVersion(nextRequest, transaction, changedAt, state.user?.email || "local");
        commitState(nextState);
        draftItems = [];
        renderRequestForm();
        showToast("Запрос откатан к выбранной версии.");
      };
    });
    document.getElementById("delete-request").onclick = () => deleteRequestWithTransactions(editedRequest);

    if (focusKey) {
      document.querySelector(`.request-item[data-key="${focusKey}"] .draft-product`)?.focus();
    } else if (!(editedRequest.items || []).length) {
      document.querySelector(".request-item:last-child .draft-product")?.focus();
    }
  }

  function draftItemRow(item, request = null) {
    const listId = `products-${item.key}`;
    const productName = item.query?.trim() || "позиции";
    const isBlank = !String(item.query || "").trim();
    const currentRequest = request || getRequest(routeId);
    // Only real product ids (never catalog_*) so purchase price keys match request items.
    const productId = resolveDraftProductId(item.query, item.productId || "");
    const product = productId ? getProduct(productId) : null;
    const resolved = Boolean(product && !isBlank);
    const purchased = currentRequest && productId
      ? responseItemTotal(currentRequest, productId)
      : { quantity: 0, price: 0 };
    const receipt = currentRequest && productId ? receiptLine(currentRequest, productId) : null;
    const remaining = currentRequest && productId
      ? remainingRequestQuantity(currentRequest, productId)
      : 0;
    const fullyBought = Boolean(productId && !isBlank && remaining <= 0 && purchased.quantity > 0);
    const filled = Boolean(receipt && isPurchaseDetailsFilled(receipt, productId));
    const progress = currentRequest && productId && !isBlank
      ? requestProgressLabel(currentRequest, { productId, quantity: item.quantity, unit: item.unit || product?.unit }, purchased)
      : "";
    const unitValue = item.unit || product?.unit || requestItemUnit(item) || "шт.";
    const editingName = Boolean(item.editingName) || !resolved;
    return `
      <div class="request-item${isBlank ? " is-blank" : ""}${fullyBought ? " is-bought" : ""}${filled ? " is-purchase-filled" : ""}${resolved ? " is-resolved" : ""}" data-key="${item.key}" data-product-id="${escapeAttr(productId)}">
        <label class="request-check-wrap">
          <input class="request-purchase-check" type="checkbox" ${fullyBought ? "checked" : ""} ${isBlank ? "disabled" : ""} aria-label="Куплено: ${escapeAttr(productName)}">
        </label>
        <div class="request-item-main">
          <div class="request-item-fields">
            <div class="request-product-field">
              <label class="visually-hidden" for="product-${item.key}">Название продукта</label>
              <input id="product-${item.key}" class="draft-product keep-item-input" list="${listId}" autocomplete="off" placeholder="Продукт" value="${escapeAttr(item.query || "")}" ${editingName ? "" : "hidden"}>
              <button class="product-chip" type="button" data-product-id="${escapeAttr(productId)}" ${resolved && !editingName ? "" : "hidden"} aria-label="Открыть карточку ${escapeAttr(product?.name || productName)}">${escapeHtml(product?.name || item.query || "")}</button>
            </div>
            <div class="qty-stepper" ${isBlank ? "hidden" : ""}>
              <button class="qty-dec" type="button" aria-label="Уменьшить количество" tabindex="${isBlank ? "-1" : "0"}">−</button>
              <input class="draft-quantity" type="number" min="0.01" step="0.01" inputmode="decimal" value="${escapeAttr(item.quantity || 1)}" aria-label="Количество для ${escapeAttr(productName)}" ${isBlank ? "tabindex=\"-1\"" : ""}>
              <span class="qty-unit-label">${escapeHtml(unitValue)}</span>
              <button class="qty-inc" type="button" aria-label="Увеличить количество" tabindex="${isBlank ? "-1" : "0"}">+</button>
            </div>
          </div>
          <datalist id="${listId}">${productSuggestionOptions(item.query)}</datalist>
          <div class="draft-product-meta" hidden></div>
          ${progress ? `<p class="request-progress-meta">${progress}</p>` : ""}
          ${filled ? `<p class="request-filled-badge">${escapeHtml(purchaseFilledLabel(currentRequest, productId, receipt))}</p>` : ""}
        </div>
        <button class="keep-remove-item remove-item" type="button" aria-label="Удалить ${escapeAttr(productName)}" ${isBlank ? "tabindex=\"-1\"" : ""}>×</button>
      </div>`;
  }

  function isPurchaseDetailsFilled(line, requestedProductId = "") {
    if (!line) return false;
    if (Number(line.price) > 0) return true;
    if (line.completionMode === "filled") return true;
    if (line.purchasedProductId && requestedProductId && line.purchasedProductId !== requestedProductId) return true;
    return false;
  }

  function purchaseFilledLabel(request, productId, line) {
    const parts = [];
    const purchasedId = line?.purchasedProductId || productId;
    if (purchasedId && purchasedId !== productId) {
      const purchased = getProduct(purchasedId);
      if (purchased?.name) parts.push(purchased.name);
    }
    if (Number(line?.price) > 0) parts.push(money(line.price));
    if (!parts.length && Number(line?.quantity) > 0) {
      const unit = requestItemUnit(request?.items?.find((item) => item.productId === productId));
      parts.push(`${number(line.quantity)} ${unit}`);
    }
    return parts.join(" · ") || "Детали заполнены";
  }

  function commitRequestFieldChange() {
    clearTimeout(requestAutosaveTimer);
    syncDraftFromForm();
    return persistRequestDraft({ silent: true });
  }

  function bindDraftItems() {
    document.querySelectorAll(".draft-product").forEach((input) => {
      input.oninput = () => {
        productNameSearchSequence += 1;
        const row = input.closest(".request-item");
        const item = draftItems.find((value) => value.key === row.dataset.key);
        if (item) {
          item.query = input.value;
          item.editingName = true;
        }
        const hasText = Boolean(input.value.trim());
        row.classList.toggle("is-blank", !hasText);
        const removeButton = row.querySelector(".remove-item");
        if (removeButton) {
          removeButton.tabIndex = hasText ? 0 : -1;
          removeButton.setAttribute("aria-hidden", hasText ? "false" : "true");
        }
        const quantity = row.querySelector(".draft-quantity");
        if (quantity) quantity.tabIndex = hasText ? 0 : -1;
        const stepper = row.querySelector(".qty-stepper");
        if (stepper) stepper.hidden = !hasText;
        const purchaseCheck = row.querySelector(".request-purchase-check");
        const list = row.querySelector("datalist");
        if (list) list.innerHTML = productSuggestionOptions(input.value);
        const selected = suggestionByName(input.value);
        if (item) {
          if (selected) {
            item.productId = resolveDraftProductId(input.value, item.productId);
            row.dataset.productId = item.productId || "";
            if (!item.unit || item.unit === getProduct(item.productId)?.unit) {
              item.unit = selected.unit || item.unit || "шт.";
            }
            updateRowUnitLabel(row, item.unit || selected.unit || "шт.");
            if (purchaseCheck) purchaseCheck.disabled = !hasText;
          } else if (!hasText) {
            item.productId = "";
            item.unit = "";
            row.dataset.productId = "";
            updateRowUnitLabel(row, "шт.");
            if (purchaseCheck) {
              purchaseCheck.checked = false;
              purchaseCheck.disabled = true;
            }
            setRowProductPresentation(row, item, null);
          } else {
            item.productId = resolveDraftProductId(input.value, item.productId);
            row.dataset.productId = item.productId || "";
            if (purchaseCheck) purchaseCheck.disabled = false;
          }
        }
        setDraftProductMeta(row.dataset.key, selected
          ? suggestionLabel(selected)
          : input.value.trim().length < 3
            ? ""
            : "Подождите, ищем варианты в Open Food Facts…");
        clearTimeout(productNameSearchTimer);
        if (input.value.trim().length >= 3) {
          const query = input.value;
          productNameSearchTimer = setTimeout(() => searchOpenFoodFactsByName(query, row.dataset.key), 450);
        }
      };
      input.onblur = () => {
        const row = input.closest(".request-item");
        const item = draftItems.find((value) => value.key === row?.dataset.key);
        if (item) item.editingName = false;
        commitRequestFieldChange();
        if (item && row) {
          const product = getProduct(item.productId) || (item.query ? null : null);
          const resolved = item.productId ? getProduct(item.productId) : null;
          if (resolved) setRowProductPresentation(row, item, resolved);
        }
      };
      input.onkeydown = (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (!input.value.trim()) return;
        const row = input.closest(".request-item");
        const item = draftItems.find((value) => value.key === row?.dataset.key);
        if (item) item.editingName = false;
        commitRequestFieldChange();
        addEmptyRequestLine();
      };
    });
    document.querySelectorAll(".draft-quantity").forEach((input) => {
      input.oninput = () => {
        const row = input.closest(".request-item");
        const item = draftItems.find((value) => value.key === row.dataset.key);
        if (!item) return;
        item.quantity = Math.max(0.01, Number(input.value) || 1);
      };
      input.onblur = () => commitRequestFieldChange();
      input.onkeydown = (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commitRequestFieldChange();
        addEmptyRequestLine();
      };
    });
    document.querySelectorAll(".qty-dec, .qty-inc").forEach((button) => {
      button.onclick = () => {
        const row = button.closest(".request-item");
        const item = draftItems.find((value) => value.key === row?.dataset.key);
        const input = row?.querySelector(".draft-quantity");
        if (!item || !input) return;
        const current = Math.max(0.01, Number(input.value) || 1);
        const next = button.classList.contains("qty-inc")
          ? current + 1
          : Math.max(0.01, current - 1);
        const rounded = Math.round(next * 100) / 100;
        input.value = String(rounded);
        item.quantity = rounded;
        commitRequestFieldChange();
      };
    });
    document.querySelectorAll(".product-chip").forEach((chip) => {
      let chipLongPress = null;
      chip.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (chip.dataset.suppressClick === "1") {
          chip.dataset.suppressClick = "";
          return;
        }
        const productId = chip.dataset.productId || chip.closest(".request-item")?.dataset.productId;
        if (!isRealProductId(productId)) return showToast("Сначала сохраните продукт.");
        openProductCardFromRequest(productId);
      };
      chip.ondblclick = (event) => {
        event.preventDefault();
        enterRowNameEdit(chip.closest(".request-item"));
      };
      chip.addEventListener("touchstart", () => {
        chipLongPress = setTimeout(() => {
          chipLongPress = null;
          chip.dataset.suppressClick = "1";
          enterRowNameEdit(chip.closest(".request-item"));
        }, 480);
      }, { passive: true });
      chip.addEventListener("touchend", () => {
        if (chipLongPress) clearTimeout(chipLongPress);
        chipLongPress = null;
      }, { passive: true });
      chip.addEventListener("touchmove", () => {
        if (chipLongPress) clearTimeout(chipLongPress);
        chipLongPress = null;
      }, { passive: true });
      chip.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        enterRowNameEdit(chip.closest(".request-item"));
      });
    });
    document.querySelectorAll(".remove-item").forEach((button) => {
      button.onclick = () => {
        syncDraftFromForm();
        const key = button.closest(".request-item").dataset.key;
        const hasOtherFilled = [...document.querySelectorAll(".request-item")].some((row) =>
          row.dataset.key !== key && row.querySelector(".draft-product")?.value.trim()
        );
        const currentFilled = Boolean(document.querySelector(`.request-item[data-key="${key}"] .draft-product`)?.value.trim());
        if (!hasOtherFilled && !currentFilled) return;
        draftItems = draftItems.filter((value) => value.key !== key);
        if (!draftItems.length) draftItems = [{ key: id("item"), productId: "", query: "", quantity: 1, unit: "", editingName: true }];
        commitRequestFieldChange();
        renderRequestForm();
      };
    });
  }

  function updateRowUnitLabel(row, unit) {
    const label = row?.querySelector(".qty-unit-label");
    if (label) label.textContent = unit || "шт.";
  }

  function setRowProductPresentation(row, item, product) {
    if (!row) return;
    const input = row.querySelector(".draft-product");
    const chip = row.querySelector(".product-chip");
    const resolved = Boolean(product && String(item?.query || "").trim());
    const editing = Boolean(item?.editingName) || !resolved;
    if (input) input.hidden = resolved && !editing;
    if (chip) {
      chip.hidden = !resolved || editing;
      if (product) {
        chip.textContent = product.name;
        chip.dataset.productId = product.id;
        chip.setAttribute("aria-label", `Открыть карточку ${product.name}`);
      }
    }
    row.classList.toggle("is-resolved", resolved && !editing);
    updateRowUnitLabel(row, item?.unit || product?.unit || "шт.");
    const stepper = row.querySelector(".qty-stepper");
    if (stepper) stepper.hidden = !String(item?.query || "").trim();
  }

  function enterRowNameEdit(row) {
    if (!row) return;
    const item = draftItems.find((value) => value.key === row.dataset.key);
    if (item) item.editingName = true;
    const product = item?.productId ? getProduct(item.productId) : null;
    setRowProductPresentation(row, item, product);
    const input = row.querySelector(".draft-product");
    if (input) {
      input.hidden = false;
      input.focus();
      input.select?.();
    }
  }

  function openProductCardFromRequest(productId) {
    clearTimeout(requestAutosaveTimer);
    syncDraftFromForm();
    if (!persistRequestDraft({ silent: false })) return;
    productEditReturn = { route: "request-edit", id: routeId };
    navigate("product-edit", productId, null, { skipRequestPersist: true });
  }

  function bindRequestPurchaseChecks(request) {
    document.querySelectorAll(".request-purchase-check").forEach((checkbox) => {
      checkbox.onchange = () => {
        const row = checkbox.closest(".request-item");
        if (!row || checkbox.disabled) return;
        clearTimeout(requestAutosaveTimer);
        syncDraftFromForm();
        if (!persistRequestDraft({ silent: false })) {
          checkbox.checked = !checkbox.checked;
          return;
        }
        const productId = ensureRowProductId(row);
        if (!productId) {
          checkbox.checked = !checkbox.checked;
          showToast("Сначала укажите продукт.");
          return;
        }
        toggleRequestItemPurchase(request.id, productId, checkbox.checked);
      };
    });
    bindRequestRowGestures(request);
  }

  function bindRequestRowGestures(request) {
    const token = ++requestGestureToken;
    document.querySelectorAll(".request-item").forEach((row) => {
      let startX = 0;
      let startY = 0;
      let tracking = false;
      let longPressTimer = null;
      let moved = false;

      const clearLongPress = () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      };

      const openDetails = () => {
        if (token !== requestGestureToken) return;
        openPurchaseDetailsForRow(request, row);
      };

      row.addEventListener("touchstart", (event) => {
        if (event.touches.length !== 1) return;
        if (event.target.closest(".request-check-wrap, .remove-item, .qty-stepper, .product-chip, .draft-product, .draft-quantity")) {
          tracking = false;
          return;
        }
        const touch = event.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        tracking = true;
        moved = false;
        clearLongPress();
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          tracking = false;
          openDetails();
        }, 480);
      }, { passive: true });

      row.addEventListener("touchmove", (event) => {
        if (!tracking || event.touches.length !== 1) return;
        const touch = event.touches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
          moved = true;
          clearLongPress();
        }
        if (Math.abs(dy) > Math.abs(dx)) {
          tracking = false;
          clearLongPress();
        }
      }, { passive: true });

      row.addEventListener("touchend", (event) => {
        clearLongPress();
        if (!tracking) return;
        tracking = false;
        const touch = event.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        if (Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          openDetails();
        }
      }, { passive: true });

      row.addEventListener("touchcancel", () => {
        tracking = false;
        clearLongPress();
      }, { passive: true });

      row.addEventListener("contextmenu", (event) => {
        if (event.target.closest(".request-check-wrap, .remove-item, .draft-product, .draft-quantity, .product-chip")) return;
        event.preventDefault();
        openDetails();
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
      const query = row.querySelector(".draft-product")?.value || draft?.query || "";
      productId = resolveDraftProductId(query, draft?.productId || "");
    }
    if (!isRealProductId(productId)) {
      const request = getRequest(routeId);
      const query = normalizeProductName(row.querySelector(".draft-product")?.value || draft?.query || "");
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

  function requestReceipt(request) {
    return activeResponses(request)
      .slice()
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))[0] || null;
  }

  function receiptLine(request, productId) {
    return requestReceipt(request)?.items.find((item) => item.productId === productId) || null;
  }

  function ensureSingleReceipt(nextRequest, changedAt) {
    // One request = one receipt: merge historical multi-response data into a single active response.
    const active = activeResponses(nextRequest)
      .slice()
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    if (!active.length) {
      const receipt = {
        id: id("response"),
        requestId: nextRequest.id,
        items: [],
        createdAt: changedAt,
        createdBy: state.user?.email || "local",
        updatedAt: changedAt,
        updatedBy: state.user?.email || "local",
      };
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
          response.updatedBy = state.user?.email || "local";
        }
      });
      primary.items = [...merged.values()];
      primary.updatedAt = changedAt;
      primary.updatedBy = state.user?.email || "local";
      primary.deletedAt = "";
    }
    return primary;
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

  function toggleRequestItemPurchase(requestId, productId, checked) {
    const request = getRequest(requestId);
    if (!request) return;
    if (checked) {
      const remaining = remainingRequestQuantity(request, productId);
      const line = receiptLine(request, productId);
      if (remaining <= 0 && line) {
        patchRequestItemRow(requestId, productId);
        return;
      }
      const requested = Number(request.items.find((item) => item.productId === productId)?.quantity || 0);
      applyInlinePurchase(requestId, productId, {
        productId,
        purchasedProductId: productId,
        quantity: requested || remaining || 1,
        price: Number(line?.price) || 0,
        completionMode: line && isPurchaseDetailsFilled(line, productId) ? (line.completionMode || "filled") : "closed",
      });
      return;
    }
    undoLatestPurchaseForProduct(requestId, productId);
  }

  function applyInlinePurchase(requestId, productId, draftItem) {
    const request = getRequest(requestId);
    if (!request || !productId) return;
    const changedAt = new Date().toISOString();
    const nextState = structuredClone(state);
    const nextRequest = nextState.requests.find((item) => item.id === requestId);
    if (!nextRequest) return;
    // Guard against catalog-only ids: purchases must use real product ids from the request.
    const requestItem = nextRequest.items.find((item) => item.productId === productId)
      || nextRequest.items.find((item) =>
        normalizeProductName(getProduct(item.productId)?.name || "")
        === normalizeProductName(getProduct(productId)?.name || draftItem?.query || "")
      );
    const resolvedProductId = requestItem?.productId || (isRealProductId(productId) ? productId : "");
    if (!resolvedProductId) return;
    const requested = Number(requestItem?.quantity || nextRequest.items.find((item) => item.productId === resolvedProductId)?.quantity || 0);
    let quantity = Number(draftItem.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) quantity = requested || 1;
    quantity = Math.min(quantity, requested || quantity);
    const price = Number(draftItem.price);
    const safePrice = Number.isFinite(price) && price >= 0 ? price : 0;
    const purchasedProductId = materializePurchasedProduct(nextState, { ...draftItem, productId: resolvedProductId }, changedAt) || resolvedProductId;
    const receipt = ensureSingleReceipt(nextRequest, changedAt);
    let line = receipt.items.find((item) => item.productId === resolvedProductId);
    const isNewLine = !line;
    const filled = safePrice > 0
      || Boolean(draftItem.purchasedProduct)
      || (purchasedProductId && purchasedProductId !== resolvedProductId)
      || draftItem.completionMode === "filled";
    if (!line) {
      line = {
        productId: resolvedProductId,
        purchasedProductId,
        quantity,
        price: safePrice,
        completionMode: filled ? "filled" : (draftItem.completionMode || "closed"),
      };
      receipt.items.push(line);
    } else {
      line.quantity = quantity;
      line.price = safePrice;
      line.purchasedProductId = purchasedProductId;
      line.completionMode = filled ? "filled" : (draftItem.completionMode || line.completionMode || "closed");
    }
    receipt.updatedAt = changedAt;
    receipt.updatedBy = state.user?.email || "local";
    receipt.deletedAt = "";
    nextRequest.updatedAt = changedAt;
    nextRequest.updatedBy = state.user?.email || "local";
    updateRequestStatus(nextRequest, changedAt);
    appendRequestVersion(
      nextRequest,
      isNewLine ? "Покупка отмечена" : "Детали покупки обновлены",
      changedAt,
      nextRequest.updatedBy
    );
    commitState(nextState);
    formDirty = false;
    patchRequestItemRow(requestId, resolvedProductId);
    // If scan created/updated products, chip labels may need refresh for this row only.
    showToast(isNewLine ? "Позиция отмечена как купленная." : "Цена и детали сохранены.");
  }

  function undoLatestPurchaseForProduct(requestId, productId) {
    const request = getRequest(requestId);
    if (!request) return;
    const nextState = structuredClone(state);
    const nextRequest = nextState.requests.find((item) => item.id === requestId);
    if (!nextRequest) return;
    const changedAt = new Date().toISOString();
    const receipt = ensureSingleReceipt(nextRequest, changedAt);
    const before = receipt.items.length;
    receipt.items = receipt.items.filter((item) => item.productId !== productId);
    if (receipt.items.length === before) {
      patchRequestItemRow(requestId, productId);
      return;
    }
    receipt.updatedAt = changedAt;
    receipt.updatedBy = state.user?.email || "local";
    if (!receipt.items.length) receipt.deletedAt = changedAt;
    nextRequest.updatedAt = changedAt;
    nextRequest.updatedBy = state.user?.email || "local";
    updateRequestStatus(nextRequest, changedAt);
    appendRequestVersion(nextRequest, "Отметка покупки снята", changedAt, nextRequest.updatedBy);
    commitState(nextState);
    formDirty = false;
    patchRequestItemRow(requestId, productId);
    showToast("Отметка покупки снята.");
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
    const requestItem = request.items.find((item) => item.productId === productId);
    const purchased = responseItemTotal(request, productId);
    const remaining = remainingRequestQuantity(request, productId);
    const line = receiptLine(request, productId);
    const fullyBought = Boolean(productId && remaining <= 0 && purchased.quantity > 0);
    const filled = Boolean(line && isPurchaseDetailsFilled(line, productId));
    row.classList.toggle("is-bought", fullyBought);
    row.classList.toggle("is-purchase-filled", filled);
    row.dataset.productId = productId;
    const checkbox = row.querySelector(".request-purchase-check");
    if (checkbox) checkbox.checked = fullyBought;
    const progress = row.querySelector(".request-progress-meta");
    const progressText = requestItem
      ? requestProgressLabel(request, requestItem, purchased)
      : "";
    if (progress) {
      progress.textContent = progressText;
      progress.hidden = !progressText;
    } else if (progressText) {
      const main = row.querySelector(".request-item-main");
      const meta = document.createElement("p");
      meta.className = "request-progress-meta";
      meta.textContent = progressText;
      main?.appendChild(meta);
    }
    let badge = row.querySelector(".request-filled-badge");
    if (filled) {
      const label = purchaseFilledLabel(request, productId, line);
      if (!badge) {
        badge = document.createElement("p");
        badge.className = "request-filled-badge";
        row.querySelector(".request-item-main")?.appendChild(badge);
      }
      badge.textContent = label;
      badge.hidden = false;
    } else if (badge) {
      badge.hidden = true;
      badge.textContent = "";
    }
    // Refresh spent total in meta header without full re-render when possible.
    const spentNode = document.querySelector(".keep-note-meta strong");
    const spent = requestTotal(request);
    if (spentNode) {
      if (spent > 0) spentNode.textContent = money(spent);
      else spentNode.remove();
    } else if (spent > 0) {
      const meta = document.querySelector(".keep-note-meta");
      if (meta) {
        const strong = document.createElement("strong");
        strong.textContent = money(spent);
        meta.appendChild(strong);
      }
    }
    const status = document.querySelector(".keep-note-meta .status");
    if (status) {
      status.className = `status ${request.status}`;
      status.textContent = requestStatusLabel(request);
    }
    if (draft) {
      const product = getProduct(productId);
      if (product) setRowProductPresentation(row, draft, product);
    }
  }

  function addEmptyRequestLine() {
    syncDraftFromForm();
    const emptyInDom = [...document.querySelectorAll(".request-item")].find((row) =>
      !row.querySelector(".draft-product")?.value.trim()
    );
    if (emptyInDom) {
      emptyInDom.querySelector(".draft-product")?.focus();
      return;
    }
    // Drop phantom empty drafts that are not in the DOM (left by autosave remaps).
    draftItems = draftItems.filter((item) => {
      if (item.query?.trim()) return true;
      return Boolean(document.querySelector(`.request-item[data-key="${item.key}"]`));
    });
    const item = { key: id("item"), productId: "", query: "", quantity: 1, unit: "" };
    draftItems.push(item);
    renderRequestForm(item.key);
  }

  function syncDraftFromForm() {
    // Rebuild draft from DOM so memory and rows never drift after autosave.
    const nextDraft = [];
    document.querySelectorAll(".request-item").forEach((row) => {
      const previous = draftItems.find((value) => value.key === row.dataset.key);
      const query = row.querySelector(".draft-product")?.value || previous?.query || "";
      const productId = resolveDraftProductId(query, previous?.productId || row.dataset.productId || "");
      const product = productId ? getProduct(productId) : null;
      row.dataset.productId = productId;
      nextDraft.push({
        key: row.dataset.key,
        productId,
        query,
        quantity: Math.max(0.01, Number(row.querySelector(".draft-quantity")?.value) || previous?.quantity || 1),
        unit: (previous?.unit || product?.unit || "").trim(),
        editingName: Boolean(previous?.editingName) && !row.querySelector(".draft-product")?.hidden,
      });
    });
    if (nextDraft.length) draftItems = nextDraft;
  }

  function persistRequestDraft({ silent = false } = {}) {
    if (route !== "request-edit") return false;
    const editedRequest = getRequest(routeId);
    if (!editedRequest) return false;
    syncDraftFromForm();
    const filledDraftItems = draftItems.filter((item) => item.query.trim());
    const nextState = structuredClone(state);
    const nextRequest = nextState.requests.find((request) => request.id === editedRequest.id);
    if (!nextRequest) return false;

    const items = [];
    for (const draft of filledDraftItems) {
      const product = resolveOrCreateProduct(draft, nextState.products, new Date().toISOString());
      const previous = editedRequest.items.find((item) => item.productId === product.id) || {};
      // Unit comes from the product card (not a free-text field on the line).
      const unit = String(previous.unit || product.unit || draft.unit || "шт.").trim() || "шт.";
      items.push({
        ...previous,
        productId: product.id,
        quantity: Number(draft.quantity) || 1,
        unit,
      });
    }

    if (new Set(items.map((item) => item.productId)).size !== items.length) {
      if (!silent) showToast("Один продукт нельзя добавлять в запрос дважды.");
      return false;
    }
    const answeredProductIds = new Set(
      activeResponses(editedRequest).flatMap((response) =>
        response.items.filter((item) => item.quantity || item.price).map((item) => item.productId)
      )
    );
    if ([...answeredProductIds].some((productId) => !items.some((item) => item.productId === productId))) {
      if (!silent) showToast("Нельзя удалить товар, который уже указан в ответе.");
      return false;
    }
    if (items.some((item) => responseItemTotal(editedRequest, item.productId).quantity > Number(item.quantity))) {
      if (!silent) showToast("Количество нельзя уменьшить ниже уже купленного.");
      return false;
    }

    const sameItems = items.length === editedRequest.items.length
      && items.every((item, index) => {
        const previous = editedRequest.items[index];
        return previous
          && previous.productId === item.productId
          && Number(previous.quantity) === Number(item.quantity)
          && String(previous.unit || "") === String(item.unit || "");
      });
    if (sameItems) return true;

    const changedAt = new Date().toISOString();
    nextRequest.items = items;
    nextRequest.updatedAt = changedAt;
    nextRequest.updatedBy = state.user?.email || "local";
    updateRequestStatus(nextRequest);
    appendRequestVersion(nextRequest, items.length ? "Запрос изменён" : "Запрос очищен", changedAt, nextRequest.updatedBy);
    commitState(nextState);

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
          editingName: false,
        };
      });
    // Keep row product ids and chip presentation in sync without full re-render.
    document.querySelectorAll(".request-item").forEach((row) => {
      const item = draftItems.find((value) => value.key === row.dataset.key);
      if (!item) return;
      row.dataset.productId = item.productId || "";
      const hasText = Boolean(String(item.query || "").trim());
      const purchaseCheck = row.querySelector(".request-purchase-check");
      if (purchaseCheck) purchaseCheck.disabled = !hasText;
      const product = item.productId ? getProduct(item.productId) : null;
      if (product && hasText) {
        const input = row.querySelector(".draft-product");
        if (input && input.value.trim() !== product.name && !item.editingName) {
          input.value = product.name;
          item.query = product.name;
        }
        setRowProductPresentation(row, item, product);
      } else {
        setRowProductPresentation(row, item, null);
      }
      const qtyInput = row.querySelector(".draft-quantity");
      if (qtyInput && Number(qtyInput.value) !== Number(item.quantity)) {
        qtyInput.value = String(item.quantity || 1);
      }
    });
    return true;
  }

  function renderRequestDetail() {
    draftItems = [];
    navigate("request-edit", routeId);
  }

  async function deleteRequestWithTransactions(request) {
    if (!await askConfirm("Удалить запрос и все связанные с ним транзакции?")) return;
    const changedAt = new Date().toISOString();
    const actor = state.user?.email || "local";
    const nextState = structuredClone(state);
    const nextRequest = nextState.requests.find((item) => item.id === request.id);
    if (!nextRequest) return;
    nextRequest.deletedAt = changedAt;
    nextRequest.updatedAt = changedAt;
    nextRequest.updatedBy = actor;
    nextRequest.responses.forEach((response) => {
      response.deletedAt = changedAt;
      response.updatedAt = changedAt;
      response.updatedBy = actor;
    });
    commitState(nextState);
    navigate("requests");
    showToast("Запрос и его транзакции удалены.");
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
      <dialog id="answer-action-dialog" class="answer-dialog">
        <div id="answer-fill-view">
          <h2 id="answer-dialog-title">Детали покупки</h2>
          <p id="purchase-requested-name" class="muted purchase-requested-name"></p>
          <p id="purchase-product-name" class="purchase-product-name"></p>
          <label class="field purchase-quantity-field"><span>Куплено</span><div class="input-with-unit"><input id="purchase-quantity" type="number" min="0.01" step="0.01" inputmode="decimal" required><strong id="purchase-quantity-unit"></strong></div></label>
          <label class="field purchase-price-field"><span>Сумма за позицию, ₽</span><input id="purchase-price" type="number" min="0" step="0.01" placeholder="Необязательно"></label>
          <div class="purchase-product-section">
            <span class="eyebrow">Товар</span>
            <button id="scan-purchase-barcode" class="button secondary full" type="button">Сканировать штрихкод</button>
            <p id="purchase-status" class="muted barcode-status">Скан обновит неподтверждённый товар или привяжет другой SKU к этой покупке.</p>
          </div>
          <button id="save-purchase-item" class="button full" type="button">Готово</button>
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

  function remainingRequestQuantity(request, productId, excludedResponseId = "") {
    const requested = Number(request.items.find((item) => item.productId === productId)?.quantity || 0);
    const bought = activeResponses(request)
      .filter((response) => response.id !== excludedResponseId)
      .reduce((sum, response) => sum + Number(response.items.find((item) => item.productId === productId)?.quantity || 0), 0);
    return Math.max(0, requested - bought);
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
    dialog.oncancel = (event) => {
      event.preventDefault();
      // Keep the checked item with current/default values when dismissing.
      const productId = dialog.dataset.productId;
      savePurchaseDraftItem(true);
      commitInlinePurchaseDraft(productId);
    };
    document.getElementById("save-purchase-item").onclick = () => savePurchaseDraftItem(false);
    document.getElementById("scan-purchase-barcode").onclick = () => {
      if (!window.NativeGoogle?.scanBarcode) return setPurchaseStatus("Сканирование доступно в Android-приложении.", true);
      barcodeScanTarget = "purchase";
      window.NativeGoogle.scanBarcode();
    };
  }

  function openAnswerFillDialog(request, productId, editedResponse) {
    const dialog = document.getElementById("answer-action-dialog");
    dialog.dataset.productId = productId;
    dialog.dataset.dirty = "false";
    document.getElementById("answer-dialog-title").textContent = getProduct(productId)?.name || "Детали покупки";
    showAnswerFillView(request, editedResponse);
    dialog.showModal();
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
    document.getElementById("purchase-quantity-unit").textContent = requestItemUnit(requestItem);
    const price = Number(existing?.price);
    priceInput.value = Number.isFinite(price) && price > 0 ? String(price) : "";
    purchaseFillProduct = existing?.purchasedProduct || null;
    const requestedProduct = getProduct(productId);
    const purchased = getProduct(existing?.purchasedProductId || productId);
    const requestedLabel = document.getElementById("purchase-requested-name");
    if (requestedLabel) {
      requestedLabel.textContent = requestedProduct
        ? `Запрошено: ${requestedProduct.name}${isProductConfirmed(requestedProduct) ? "" : " · неподтверждённый"}`
        : "";
    }
    document.getElementById("purchase-product-name").textContent = purchaseFillProduct
      ? `Куплен: ${purchaseFillProduct.name}`
      : purchased && purchased.id !== productId
        ? `Куплен: ${purchased.name}`
        : purchased?.name || requestedProduct?.name || "";
    setPurchaseStatus(
      isProductConfirmed(requestedProduct)
        ? "Скан привяжет другой товар к покупке, не изменяя запрошенный."
        : "Скан может обновить неподтверждённый товар или указать замену."
    );
  }

  async function lookupPurchaseBarcode(barcode) {
    setPurchaseStatus(`Ищем ${barcode} в Open Food Facts…`);
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
      purchaseFillProduct = openFoodFactsSuggestion(body.product);
      document.getElementById("purchase-product-name").textContent = `Куплен: ${purchaseFillProduct.name}`;
      setPurchaseStatus(`Штрихкод ${barcode} распознан. Товар будет сохранён вместе с транзакцией.`);
    } catch (error) {
      purchaseFillProduct = null;
      setPurchaseStatus(error.message || "Не удалось загрузить товар.", true);
    }
  }

  function setPurchaseStatus(message, error = false) {
    const status = document.getElementById("purchase-status");
    if (!status) return;
    status.textContent = message;
    status.className = error ? "error barcode-status" : "muted barcode-status";
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

  function materializePurchasedProduct(nextState, item, changedAt) {
    if (!item.purchasedProduct) return item.purchasedProductId || item.productId;
    const suggestion = item.purchasedProduct;
    const requestedProduct = nextState.products.find((product) => product.id === item.productId && !product.deletedAt);
    // Only unconfirmed cards may be rewritten in place (e.g. free-text "Молоко" + scan).
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
        confirmed: false,
        updatedAt: changedAt,
        updatedBy: state.user?.email || "local",
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
      id: id("product"),
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
      updatedBy: state.user?.email || "local",
    };
    nextState.products.push(product);
    return product.id;
  }

  function isCatalogIdentifiedProduct(product) {
    // Kept for callers/tests; confirmed SKUs and barcode-backed cards are "identified".
    return isProductConfirmed(product);
  }

  function saveAnswerTransaction(event, request, editedResponse) {
    event.preventDefault();
    if (!answerDraftItems.size) return showToast("Отметьте хотя бы одну купленную позицию.");
    const changedAt = new Date().toISOString();
    const nextState = structuredClone(state);
    const responseItems = [...answerDraftItems.values()].map((item) => ({
      productId: item.productId,
      purchasedProductId: materializePurchasedProduct(nextState, item, changedAt),
      quantity: Number(item.quantity),
      price: Number(item.price) || 0,
      completionMode: item.completionMode || "filled",
    }));
    const nextRequest = nextState.requests.find((item) => item.id === request.id);
    const nextEditedResponse = editedResponse
      ? nextRequest.responses.find((response) => response.id === editedResponse.id)
      : null;
    if (nextEditedResponse) {
      nextEditedResponse.items = responseItems;
      nextEditedResponse.updatedAt = changedAt;
      nextEditedResponse.updatedBy = state.user?.email || "local";
    } else {
      nextRequest.responses.push({
        id: id("response"), requestId: nextRequest.id, items: responseItems,
        createdAt: changedAt, createdBy: state.user?.email || "local",
        updatedAt: changedAt, updatedBy: state.user?.email || "local",
      });
    }
    nextRequest.updatedAt = changedAt;
    nextRequest.updatedBy = state.user?.email || "local";
    updateRequestStatus(nextRequest, changedAt);
    appendRequestVersion(nextRequest, nextEditedResponse ? "Транзакция изменена" : "Транзакция добавлена", changedAt, nextRequest.updatedBy);
    commitState(nextState);
    draftItems = [];
    navigate("request-edit", request.id);
    showToast(nextEditedResponse ? "Транзакция изменена." : "Транзакция добавлена.");
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
    const templates = rationTemplatesForUser();
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
        const nextState = structuredClone(state);
        nextState.rationView = button.dataset.view;
        nextState.rationAnchor = anchor;
        commitState(nextState);
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
        const nextState = structuredClone(state);
        nextState.rationAnchor = button.dataset.date;
        nextState.rationView = "day";
        routeSubId = null;
        commitState(nextState);
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
        const nextState = structuredClone(state);
        nextState.rationAnchor = button.dataset.date;
        commitState(nextState);
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
      const nextState = structuredClone(state);
      const day = mutableRationDay(nextState, anchor);
      const nextMeal = { id: id("meal"), name: `Приём пищи ${day.meals.length + 1}`, time: rationMealTime(null, day.meals.length), items: [] };
      day.meals.push(nextMeal);
      touchRationDay(day);
      commitState(nextState);
      routeSubId = nextMeal.id;
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
          const nextState = structuredClone(state);
          nextState.rationAnchor = selector.dataset.date;
          nextState.rationView = "day";
          commitState(nextState);
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
        const nextState = structuredClone(state);
        const day = mutableRationDay(nextState, button.dataset.date);
        nextState.rationAnchor = button.dataset.date;
        day.meals.push({ id: id("meal"), name: `Приём пищи ${day.meals.length + 1}`, time: rationMealTime(null, day.meals.length), items: [] });
        touchRationDay(day);
        commitState(nextState);
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
    const nextState = structuredClone(state);
    nextState.rationAnchor = dateKey;
    commitState(nextState, false);
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
    const nextState = structuredClone(state);
    nextState.rationAnchor = dateKey;
    commitState(nextState, false);
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

  function rationMeasure(product) {
    const unit = String(product?.unit || "г").toLowerCase();
    if (unit.includes("шт")) return { unit: "шт.", defaultPortion: 1, defaultPackage: 1 };
    if (unit === "л" || unit.includes("мл")) return { unit: "мл", defaultPortion: 250, defaultPackage: 1000 };
    return { unit: "г", defaultPortion: 100, defaultPackage: 1000 };
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
      const nextState = structuredClone(state);
      const day = mutableRationDay(nextState, rationPortionTarget.dateKey);
      const meal = day.meals.find((value) => value.id === rationPortionTarget.mealId);
      const item = meal?.items.find((value) => value.id === rationPortionTarget.itemId);
      if (!item) return;
      item.portionSize = Number(document.getElementById("ration-portion-size").value) || 1;
      item.packageSize = Number(document.getElementById("ration-package-size").value) || 1;
      item.measureUnit = document.getElementById("ration-portion-unit").textContent;
      touchRationDay(day);
      commitState(nextState);
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

  function rationTemplatesForUser(source = state) {
    const owner = rationOwner(source);
    return (source.rationTemplates || [])
      .filter((template) => String(template.owner || "local").trim().toLowerCase() === owner)
      .sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
  }

  function cloneTemplateMeals(meals) {
    return (meals || []).map((meal, mealIndex) => ({
      id: id("meal"),
      name: meal.name || `Приём пищи ${mealIndex + 1}`,
      time: rationMealTime(meal, mealIndex),
      items: (meal.items || []).map((item) => ({
        id: id("ration_item"),
        productId: item.productId || "",
        name: item.name || "",
        portionSize: Number(item.portionSize) || 0,
        packageSize: Number(item.packageSize) || 0,
      })),
    }));
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
    const template = rationTemplatesForUser().find((item) => item.id === templateId);
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
    const day = rationDayFor(state, dateKey);
    if (!day?.meals?.length) return showToast("День больше не содержит приёмов пищи.");
    const changedAt = new Date().toISOString();
    const nextState = structuredClone(state);
    nextState.rationTemplates = nextState.rationTemplates || [];
    nextState.rationTemplates.push({
      id: id("ration_template"),
      name,
      owner: rationOwner(nextState),
      meals: cloneTemplateMeals(day.meals),
      createdAt: changedAt,
      updatedAt: changedAt,
    });
    commitState(nextState);
    renderRation();
    showToast("Шаблон дня сохранён.");
  }

  function saveRenamedRationTemplate(templateId, name) {
    const nextState = structuredClone(state);
    const template = (nextState.rationTemplates || []).find((item) => item.id === templateId);
    if (!template) return;
    template.name = name;
    template.updatedAt = new Date().toISOString();
    commitState(nextState);
    renderRation();
    showToast("Шаблон переименован.");
  }

  async function deleteRationTemplate() {
    const templateId = document.getElementById("ration-template-select")?.value;
    const template = rationTemplatesForUser().find((item) => item.id === templateId);
    if (!template || !await askConfirm(`Удалить шаблон «${template.name}»?`)) return;
    const previousState = structuredClone(state);
    const nextState = structuredClone(state);
    nextState.rationTemplates = (nextState.rationTemplates || []).filter((item) => item.id !== templateId);
    commitState(nextState);
    renderRation();
    showToast(`Шаблон «${template.name}» удалён.`, "Отменить", () => {
      commitState(previousState);
      renderRation();
    });
  }

  async function applyRationTemplate() {
    const templateId = document.getElementById("ration-template-select")?.value;
    const template = rationTemplatesForUser().find((item) => item.id === templateId);
    const dates = [...rationSelectedDates];
    if (!template || !dates.length) return;
    const filledDates = dates.filter((dateKey) => (rationDayFor(state, dateKey)?.meals || []).some((meal) => meal.items?.length || meal.name));
    if (filledDates.length && !await askConfirm(`Шаблон заменит существующий рацион в ${filledDates.length} ${filledDates.length === 1 ? "дне" : "днях"}. Продолжить?`)) return;
    const previousState = structuredClone(state);
    const nextState = structuredClone(state);
    dates.forEach((dateKey) => {
      const day = mutableRationDay(nextState, dateKey);
      day.meals = cloneTemplateMeals(template.meals);
      touchRationDay(day);
    });
    commitState(nextState);
    renderRation();
    showToast(`Шаблон применён к ${dates.length} дн.`, "Отменить", () => {
      commitState(previousState);
      renderRation();
    });
  }

  function createRequestFromRationSelection() {
    const dates = [...rationSelectedDates].sort();
    const requestItems = plannedRationRequestItems(state, dates, rationSelectedItemIds);
    if (!requestItems.length) return showToast("Выберите хотя бы одну позицию рациона.");
    const changedAt = new Date().toISOString();
    const nextState = structuredClone(state);
    const nextRequest = {
      id: id("request"), createdAt: changedAt, status: "open",
      items: requestItems,
      responses: [], createdBy: state.user?.email || "local", updatedBy: state.user?.email || "local",
      updatedAt: changedAt, history: [],
    };
    appendRequestVersion(nextRequest, "Запрос создан из рациона", changedAt, nextRequest.createdBy);
    nextState.requests.push(nextRequest);
    commitState(nextState);
    clearRationSelection();
    draftItems = [];
    navigate("request-edit", nextRequest.id);
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

    const previousState = structuredClone(state);
    const nextState = structuredClone(state);
    const datesToEdit = new Set(selectedDates);
    Object.values(state.rationDays || {}).forEach((day) => {
      if (!day?.date) return;
      const hasMeal = (day.meals || []).some((meal) => selectedMealIds.has(meal.id));
      const hasItem = (day.meals || []).some((meal) =>
        (meal.items || []).some((item) => selectedItemIds.has(item.id))
      );
      if (hasMeal || hasItem) datesToEdit.add(day.date);
    });

    let changed = false;
    datesToEdit.forEach((dateKey) => {
      const day = mutableRationDay(nextState, dateKey);
      let dayChanged = false;

      if (selectedMealIds.size) {
        const before = day.meals.length;
        day.meals = day.meals.filter((meal) => !selectedMealIds.has(meal.id));
        dayChanged = day.meals.length !== before;
      } else if (selectedItemIds.size) {
        day.meals.forEach((meal) => {
          const before = (meal.items || []).length;
          meal.items = (meal.items || []).filter((item) => !selectedItemIds.has(item.id));
          if (meal.items.length !== before) dayChanged = true;
        });
      } else if (selectedDates.has(dateKey)) {
        if (day.meals.length) {
          day.meals = [];
          dayChanged = true;
        }
      }

      if (dayChanged) {
        touchRationDay(day);
        changed = true;
      }
    });

    if (!changed) {
      clearRationSelection();
      renderRation();
      return showToast("В сохранённом рационе нечего удалять.");
    }

    commitState(nextState);
    clearRationSelection();
    routeSubId = null;
    renderRation();
    showToast("Выбранное удалено из рациона.", "Отменить", () => {
      commitState(previousState);
      renderRation();
    });
  }

  function plannedRationRequestItems(source, dates, selectedItemIds) {
    const portions = new Map();
    dates.forEach((dateKey) => (rationDayFor(source, dateKey)?.meals || []).forEach((meal) =>
      (meal.items || []).forEach((item) => {
        if (!item.productId || !selectedItemIds.has(item.id)) return;
        const product = (source.products || []).find((value) => value.id === item.productId);
        const measure = rationMeasure(product);
        const portionSize = Number(item.portionSize) || measure.defaultPortion;
        const packageSize = Number(item.packageSize) || measure.defaultPackage;
        const current = portions.get(item.productId) || { productId: item.productId, plannedAmount: 0, packageSize, measureUnit: item.measureUnit || measure.unit };
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

  function setRationAnchor(dateKey) {
    const nextState = structuredClone(state);
    nextState.rationAnchor = dateKey;
    routeSubId = null;
    commitState(nextState);
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
    const nextState = structuredClone(state);
    const day = mutableRationDay(nextState, card.dataset.date);
    nextState.rationAnchor = card.dataset.date;
    const meal = day.meals.find((item) => item.id === card.dataset.mealId);
    if (!meal) return;
    meal.name = input.value.trim() || "Приём пищи";
    touchRationDay(day);
    commitState(nextState);
    renderRation();
  }

  function updateRationMealTime(input) {
    const card = input.closest(".ration-meal");
    const nextState = structuredClone(state);
    const day = mutableRationDay(nextState, card.dataset.date);
    const meal = day.meals.find((item) => item.id === card.dataset.mealId);
    if (!meal) return;
    meal.time = /^\d{2}:\d{2}$/.test(input.value) ? input.value : "12:00";
    touchRationDay(day);
    commitState(nextState);
    routeSubId = meal.id;
    renderRation();
  }

  async function removeRationMeal(button) {
    const card = button.closest(".ration-meal");
    const currentDay = rationDayFor(state, card.dataset.date);
    const currentMeal = currentDay?.meals.find((meal) => meal.id === card.dataset.mealId);
    if (!currentMeal || !await askConfirm(`Удалить приём пищи «${currentMeal.name}» и все его продукты?`)) return;
    const previousState = structuredClone(state);
    const nextState = structuredClone(state);
    const day = mutableRationDay(nextState, card.dataset.date);
    nextState.rationAnchor = card.dataset.date;
    day.meals = day.meals.filter((meal) => meal.id !== card.dataset.mealId);
    touchRationDay(day);
    commitState(nextState);
    routeSubId = null;
    renderRation();
    showToast(`Приём пищи «${currentMeal.name}» удалён.`, "Отменить", () => {
      commitState(previousState);
      routeSubId = currentMeal.id;
      renderRation();
    });
  }

  function addRationFood(button) {
    const card = button.closest(".ration-meal");
    const nextState = structuredClone(state);
    const day = mutableRationDay(nextState, card.dataset.date);
    nextState.rationAnchor = card.dataset.date;
    const meal = day.meals.find((item) => item.id === card.dataset.mealId);
    if (!meal) return;
    const item = { id: id("ration_item"), productId: "", name: "" };
    meal.items.push(item);
    touchRationDay(day);
    commitState(nextState);
    renderRation(item.id);
  }

  function removeRationFood(button) {
    const card = button.closest(".ration-meal");
    const row = button.closest(".ration-food-row");
    const previousState = structuredClone(state);
    const removedItem = rationDayFor(state, card.dataset.date)?.meals
      .find((meal) => meal.id === card.dataset.mealId)?.items
      .find((item) => item.id === row.dataset.itemId);
    const removedName = getProduct(removedItem?.productId)?.name || removedItem?.name || "Продукт";
    const nextState = structuredClone(state);
    const day = mutableRationDay(nextState, card.dataset.date);
    nextState.rationAnchor = card.dataset.date;
    const meal = day.meals.find((item) => item.id === card.dataset.mealId);
    if (!meal) return;
    meal.items = meal.items.filter((item) => item.id !== row.dataset.itemId);
    touchRationDay(day);
    commitState(nextState);
    renderRation();
    showToast(`«${removedName}» удалён из рациона.`, "Отменить", () => {
      commitState(previousState);
      routeSubId = card.dataset.mealId;
      renderRation();
    });
  }

  function saveRationFood(input, addNext) {
    const value = input.value.trim();
    if (!value) return showToast("Введите название продукта.");
    const card = input.closest(".ration-meal");
    const row = input.closest(".ration-food-row");
    const nextState = structuredClone(state);
    const day = mutableRationDay(nextState, card.dataset.date);
    nextState.rationAnchor = card.dataset.date;
    const meal = day.meals.find((item) => item.id === card.dataset.mealId);
    const item = meal?.items.find((value) => value.id === row.dataset.itemId);
    if (!item) return;
    const product = resolveOrCreateProduct({ query: value }, nextState.products, new Date().toISOString());
    item.productId = product.id;
    item.name = product.name;
    let focusId = "";
    if (addNext) {
      const nextItem = { id: id("ration_item"), productId: "", name: "" };
      meal.items.push(nextItem);
      focusId = nextItem.id;
    }
    touchRationDay(day);
    commitState(nextState);
    renderRation(focusId);
  }

  function mutableRationDay(nextState, dateKey) {
    if (!nextState.rationDays) nextState.rationDays = {};
    const key = rationDayKey(dateKey, nextState);
    if (!nextState.rationDays[key]) {
      nextState.rationDays[key] = { date: dateKey, owner: rationOwner(nextState), meals: defaultRationMeals(dateKey), updatedAt: "", updatedBy: "" };
    }
    return nextState.rationDays[key];
  }

  function rationOwner(source = state) {
    return String(source.user?.email || "local").trim().toLowerCase() || "local";
  }

  function rationDayKey(dateKey, source = state) {
    return `${rationOwner(source)}|${dateKey}`;
  }

  function rationDayFor(source, dateKey) {
    const owner = rationOwner(source);
    return source.rationDays?.[`${owner}|${dateKey}`]
      || (owner === "local" ? source.rationDays?.[dateKey] : null);
  }

  function defaultRationMeals(dateKey) {
    return [];
  }

  function touchRationDay(day) {
    day.updatedAt = new Date().toISOString();
    day.updatedBy = state.user?.email || "local";
    day.owner = rationOwner(state);
  }

  function todayDateKey() {
    return formatRationDate(new Date());
  }

  function parseRationDate(value) {
    const [year, month, day] = String(value).split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  }

  function formatRationDate(value) {
    const date = value instanceof Date ? value : parseRationDate(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

  function renderProfile() {
    const completed = activeRequests().filter((item) => item.status === "done");
    const responseCount = activeRequests().reduce((sum, item) => sum + activeResponses(item).length, 0);
    const spent = completed.reduce((sum, item) => sum + requestTotal(item), 0);
    const backgroundSupported = Boolean(window.NativeGoogle?.requestBackgroundAccess);
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
      <section class="section profile-settings-section">
        <span class="eyebrow">Система</span>
        <h2 class="profile-section-title">Фоновая синхронизация</h2>
        <p class="muted">Для проверки общей таблицы при закрытом приложении Android должен разрешить уведомления и не ограничивать «Cookish» экономией батареи.</p>
        ${state.backgroundAccessSkipped && !backgroundAccess?.fullyGranted ? `<p class="warning">Фоновая синхронизация отключена. Приложение продолжает работать, пока оно открыто.</p>` : ""}
        ${backgroundSupported ? `
          <div class="compact-line"><span>Уведомления</span><strong>${backgroundAccess?.notificationsGranted ? "Разрешены" : "Не разрешены"}</strong></div>
          <div class="compact-line"><span>Работа без ограничения батареи</span><strong>${backgroundAccess?.batteryOptimizationDisabled ? "Разрешена" : "Не разрешена"}</strong></div>
          ${backgroundAccess?.lastBackgroundSyncAt ? `<p class="muted">Последняя фоновая синхронизация: ${dateTime(new Date(backgroundAccess.lastBackgroundSyncAt).toISOString())}</p>` : `<p class="muted">Фоновая синхронизация ещё не выполнялась.</p>`}
          ${backgroundAccess?.lastBackgroundSyncError ? `<p class="error">${escapeHtml(backgroundAccess.lastBackgroundSyncError)}</p>` : ""}
          <button id="request-background-access" class="button ${backgroundAccess?.fullyGranted ? "secondary" : ""} full" type="button" ${backgroundAccess?.fullyGranted ? "disabled" : ""}>
            ${backgroundAccess?.fullyGranted ? "Фоновый доступ предоставлен" : "Разрешить фоновую работу"}
          </button>
        ` : `<p class="error">Системный доступ недоступен в этой сборке.</p>`}
      </section>
      <section class="section profile-settings-section">
        <span class="eyebrow">Подключения</span>
        <h2 class="profile-section-title">Google-аккаунт</h2>
        ${state.user ? `
          <div class="account">
            ${state.user.picture ? `<img class="avatar" src="${escapeAttr(state.user.picture)}" alt="">` : `<div class="avatar"></div>`}
            <div class="row-main"><strong>${escapeHtml(state.user.name || "Google")}</strong><span>${escapeHtml(state.user.email || "")}</span></div>
          </div>
          <button id="google-disconnect" class="text-button error" type="button" style="margin-top:10px">Отключить</button>
        ` : `
          <p class="muted">Нужен только для синхронизации с Google Sheets.</p>
          <button id="google-auth" class="button secondary full" type="button">Войти через Google</button>
        `}
      </section>
      <section class="section profile-settings-section">
        <h2 class="profile-section-title">Google Таблица</h2>
        ${state.spreadsheetId ? `
          <p><strong>${escapeHtml(state.spreadsheetTitle || "Подключённая таблица")}</strong></p>
          <p class="muted">${escapeHtml(state.spreadsheetId)}</p>
          ${!state.user ? `<p class="warning">Таблица сохранена, но синхронизация приостановлена до повторного входа в Google.</p>` : ""}
          <button id="sync-sheet" class="button full" type="button">${state.user ? "Синхронизировать" : "Войти и синхронизировать"}</button>
          <div class="button-row">
            <button id="open-sheet" class="button secondary" type="button">Открыть таблицу</button>
            <button id="share-sheet" class="button secondary" type="button">Поделиться</button>
          </div>
          ${state.lastSyncAt ? `<p class="muted">Последняя синхронизация: ${dateTime(state.lastSyncAt)}</p>` : ""}
          <button id="disconnect-sheet" class="text-button error" type="button" style="margin-top:8px">Отключить таблицу</button>
        ` : `
          <label class="field"><span>Ссылка или ID существующей таблицы</span><input id="sheet-input" autocomplete="off"></label>
          <button id="connect-sheet" class="button secondary full" type="button">Подключить и разметить</button>
          <button id="create-sheet" class="button full" type="button" style="margin-top:10px">Создать пустую таблицу</button>
        `}
        <p id="sync-status" class="muted"></p>
      </section>
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
    document.getElementById("request-background-access")?.addEventListener("click", () => {
      window.NativeGoogle.requestBackgroundAccess();
      showToast("Подтвердите системные запросы Android.");
    });
    window.NativeGoogle?.getBackgroundAccessStatus?.();
    document.getElementById("google-auth")?.addEventListener("click", async () => {
      await authorizeGoogle(true);
      renderProfile();
    });
    document.getElementById("google-disconnect")?.addEventListener("click", async () => {
      if (!await askConfirm("Отключить Google-аккаунт? Автоматическая синхронизация остановится.")) return;
      accessToken = null;
      state.user = null;
      saveState();
      renderProfile();
      showToast("Google-аккаунт отключён.");
    });
    document.getElementById("connect-sheet")?.addEventListener("click", async () => {
      const value = document.getElementById("sheet-input").value;
      const spreadsheetId = extractSpreadsheetId(value);
      if (!spreadsheetId) return setSyncStatus("Укажите корректную ссылку или ID.", true);
      await runSheetAction(async (token) => {
        const title = await setupSpreadsheet(token, spreadsheetId);
        state.spreadsheetId = spreadsheetId;
        state.spreadsheetTitle = title;
        saveState();
      }, "Таблица подключена.");
    });
    document.getElementById("create-sheet")?.addEventListener("click", async () => {
      await runSheetAction(async (token) => {
        const response = await googleFetch("https://sheets.googleapis.com/v4/spreadsheets", token, {
          method: "POST",
          body: JSON.stringify({ properties: { title: `Cookish — ${new Date().toLocaleDateString("ru-RU")}` } }),
        });
        state.spreadsheetId = response.spreadsheetId;
        state.spreadsheetTitle = response.properties.title;
        await setupSpreadsheet(token, response.spreadsheetId);
        saveState();
      }, "Пустая таблица создана и размечена.");
    });
    document.getElementById("sync-sheet")?.addEventListener("click", async () => {
      await runSheetAction(
        (token) => setupSpreadsheet(token, state.spreadsheetId),
        "Данные синхронизированы."
      );
    });
    document.getElementById("open-sheet")?.addEventListener("click", () => {
      const url = spreadsheetUrl();
      if (window.NativeGoogle?.openUrl) window.NativeGoogle.openUrl(url);
      else window.open(url, "_blank");
    });
    document.getElementById("share-sheet")?.addEventListener("click", () => {
      const url = spreadsheetUrl();
      if (window.NativeGoogle?.shareText) window.NativeGoogle.shareText("Таблица закупок", url);
      else if (navigator.share) navigator.share({ title: "Таблица закупок", url });
    });
    document.getElementById("disconnect-sheet")?.addEventListener("click", async () => {
      if (!await askConfirm("Отключить Google Таблицу? Локальные данные останутся на устройстве.")) return;
      state.spreadsheetId = "";
      state.spreadsheetTitle = "";
      state.lastSyncAt = "";
      saveState();
      renderProfile();
      showToast("Google Таблица отключена.");
    });
    document.getElementById("clear-data")?.addEventListener("click", async () => {
      if (!await askConfirm("Удалить продукты, запросы и настройки с этого устройства?")) return;
      state = structuredClone(defaultState);
      accessToken = null;
      saveState();
      navigate("onboarding");
    });
  }

  async function runSheetAction(action, successMessage) {
    setSyncStatus("Подготовка…");
    try {
      const token = await authorizeGoogle(false);
      if (!token) return;
      setSyncStatus("Синхронизация…");
      await action(token);
      renderProfile();
      setSyncStatus(successMessage);
      showToast(successMessage);
    } catch (error) {
      setSyncStatus(error.message || "Ошибка Google Sheets.", true);
    }
  }

  async function authorizeGoogle(showSuccess) {
    if (!window.NativeGoogle?.authorize) {
      setSyncStatus("Google-вход доступен только в Android-приложении.", true);
      return null;
    }
    const resultPromise = new Promise((resolve) => { authResolve = resolve; });
    window.NativeGoogle.authorize();
    const result = await resultPromise;
    if (!result.ok) {
      setSyncStatus(result.error, true);
      return null;
    }
    accessToken = result.accessToken;
    const user = await googleFetch("https://www.googleapis.com/oauth2/v3/userinfo", accessToken);
    state.user = {
      name: user.name || "",
      email: user.email || "",
      picture: user.picture || "",
    };
    state.products.forEach((product) => {
      if (!product.updatedBy || product.updatedBy === "local") product.updatedBy = state.user.email;
    });
    state.requests.forEach((request) => {
      if (!request.createdBy || request.createdBy === "local") request.createdBy = state.user.email;
      if (!request.updatedBy || request.updatedBy === "local") request.updatedBy = state.user.email;
      request.responses.forEach((response) => {
        if (!response.createdBy || response.createdBy === "local") response.createdBy = state.user.email;
        if (!response.updatedBy || response.updatedBy === "local") response.updatedBy = state.user.email;
      });
    });
    const migratedRationDays = {};
    Object.values(state.rationDays || {}).forEach((day) => {
      if (!day.owner || day.owner === "local") day.owner = state.user.email.toLowerCase();
      if (!day.updatedBy || day.updatedBy === "local") day.updatedBy = state.user.email;
      migratedRationDays[`${day.owner}|${day.date}`] = day;
    });
    state.rationDays = migratedRationDays;
    saveState(false);
    if (showSuccess) showToast("Вход выполнен.");
    return accessToken;
  }

  function mirrorStateForBackgroundSync() {
    if (!window.NativeGoogle?.configureBackgroundSync) return;
    const syncPackage = buildSyncPackage(state);
    window.NativeGoogle.configureBackgroundSync(
      JSON.stringify(syncPackage),
      syncPackage.spreadsheetId || "",
      syncPackage.user?.email || ""
    );
  }

  function queueAutoSync(delay = 700) {
    if (!state.spreadsheetId || !state.user) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => autoSync(), delay);
  }

  async function autoSync() {
    if (syncInProgress || !state.spreadsheetId || !state.user) return;
    syncInProgress = true;
    setSyncChip("Синхронизация…", "busy");
    try {
      const token = accessToken || await authorizeGoogle(false);
      if (token) {
        await setupSpreadsheet(token, state.spreadsheetId);
        setSyncChip(state.lastSyncAt ? `Синхр. ${dateTime(state.lastSyncAt)}` : "Синхронизировано", "ok");
        setTimeout(() => {
          if (syncStatusLabel.startsWith("Синхр.") || syncStatusLabel === "Синхронизировано") setSyncChip("");
        }, 2500);
      } else {
        setSyncChip("");
      }
    } catch (error) {
      console.warn("Automatic sync failed", error);
      setSyncChip("Ошибка синхр.", "error");
    } finally {
      syncInProgress = false;
    }
  }

  function startForegroundSync(syncImmediately = true) {
    clearInterval(foregroundSyncTimer);
    foregroundSyncTimer = null;
    if (document.visibilityState === "hidden") return;

    if (syncImmediately) queueAutoSync(0);
    foregroundSyncTimer = setInterval(() => {
      if (document.visibilityState !== "hidden") queueAutoSync(0);
    }, FOREGROUND_SYNC_INTERVAL_MS);
  }

  function stopForegroundSync() {
    clearInterval(foregroundSyncTimer);
    foregroundSyncTimer = null;
    clearTimeout(syncTimer);
    syncTimer = null;
  }

  async function setupSpreadsheet(token, spreadsheetId) {
    let metadata = await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties(sheetId,title)`,
      token
    );
    const required = ["Продукты", "Запросы", "Покупки", "Рацион"];
    const existing = new Set(metadata.sheets.map((sheet) => sheet.properties.title));
    const requests = [];
    if (metadata.sheets.length === 1 && !existing.has("Продукты")) {
      requests.push({
        updateSheetProperties: {
          properties: { sheetId: metadata.sheets[0].properties.sheetId, title: "Продукты" },
          fields: "title",
        },
      });
      existing.add("Продукты");
    }
    required.forEach((name) => {
      if (!existing.has(name)) requests.push({ addSheet: { properties: { title: name } } });
    });
    if (requests.length) {
      await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, token, {
        method: "POST",
        body: JSON.stringify({ requests }),
      });
      metadata = await googleFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties(sheetId,title)`,
        token
      );
    }
    await readAndMergeSpreadsheetData(token, spreadsheetId);
    await writeSpreadsheetData(token, spreadsheetId);
    state.spreadsheetTitle = metadata.properties.title;
    state.lastSyncAt = new Date().toISOString();
    saveState(false);
    return metadata.properties.title;
  }

  async function readAndMergeSpreadsheetData(token, spreadsheetId) {
    const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet`);
    url.searchParams.append("ranges", "Продукты!A2:P");
    url.searchParams.append("ranges", "Запросы!A2:N");
    url.searchParams.append("ranges", "Покупки!A2:L");
    url.searchParams.append("ranges", "Рацион!A2:N");
    const response = await googleFetch(url.toString(), token);
    const productRows = response.valueRanges?.[0]?.values || [];
    const requestRows = response.valueRanges?.[1]?.values || [];
    const responseRows = response.valueRanges?.[2]?.values || [];
    const rationRows = response.valueRanges?.[3]?.values || [];

    const remoteProducts = productRows
      .filter((row) => row[0])
      .map(parseProductRow);
    state.products = mergeVersioned(state.products, remoteProducts);

    const remoteById = new Map();
    requestRows.forEach((row) => {
      if (!row[0] || !row[1]) return;
      const legacyStockSchema = isLegacyRequestRow(row);
      const offset = legacyStockSchema ? 1 : 0;
      const requestId = String(row[0]);
      const request = remoteById.get(requestId) || {
        id: requestId,
        status: String(row[3 + offset]) === "Выполнен" ? "done" : "open",
        createdAt: String(row[4 + offset] || new Date().toISOString()),
        completedAt: String(row[5 + offset] || ""),
        createdBy: String(row[6 + offset] || "remote"),
        updatedAt: String(row[7 + offset] || row[5 + offset] || row[4 + offset] || new Date(0).toISOString()),
        updatedBy: String(row[8 + offset] || row[6 + offset] || "remote"),
        deletedAt: String(row[9 + offset] || ""),
        items: [],
        responses: [],
      };
      const plannedAmount = Number(row[10 + offset]) || 0;
      const measureOrUnit = String(row[12 + offset] || "");
      const item = {
        productId: String(row[1]),
        quantity: Number(row[2]) || 0,
        plannedAmount,
        packageSize: Number(row[11 + offset]) || 0,
        measureUnit: plannedAmount ? measureOrUnit : "",
        // Shopping unit is request-local; defaults from product only when missing.
        unit: plannedAmount ? "уп." : measureOrUnit,
      };
      const existingIndex = request.items.findIndex((value) => value.productId === item.productId);
      if (existingIndex === -1) request.items.push(item);
      else request.items[existingIndex] = item;
      remoteById.set(requestId, request);
    });

    const parsedResponses = new Map();
    responseRows.forEach((row) => {
      const normalized = parseResponseRow(row, remoteById);
      if (!normalized) return;
      const existing = parsedResponses.get(normalized.id);
      if (!existing || timestamp(normalized.updatedAt) > timestamp(existing.updatedAt)) {
        parsedResponses.set(normalized.id, normalized);
      } else if (timestamp(normalized.updatedAt) === timestamp(existing.updatedAt)) {
        existing.items = dedupeByProduct([...existing.items, ...normalized.items]);
      }
    });
    parsedResponses.forEach((responseValue) => {
      remoteById.get(responseValue.requestId)?.responses.push(responseValue);
    });
    const remoteRequests = [...remoteById.values()].map(normalizeRequest);

    const knownIds = new Set(state.requests.map((request) => request.id));
    const seenIds = new Set(state.seenRemoteRequestIds || []);
    const trackingWasInitialized = Boolean(state.remoteTrackingInitialized);
    remoteRequests.forEach((request) => {
      if (
        trackingWasInitialized &&
        !knownIds.has(request.id) &&
        !seenIds.has(request.id) &&
        !request.deletedAt &&
        request.status === "open" &&
        isRemoteRequest(request)
      ) {
        notifyRemoteRequest(request);
      }
      if (isRemoteRequest(request)) seenIds.add(request.id);
    });
    state.requests = mergeRequests(state.requests, remoteRequests);
    const remoteRationDays = {};
    rationRows.forEach((row) => {
      const dateKey = String(row[0] || "");
      const mealId = String(row[1] || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !mealId) return;
      const owner = String(row[10] || state.user?.email || "local").trim().toLowerCase();
      const storageKey = `${owner}|${dateKey}`;
      const day = remoteRationDays[storageKey] || {
        date: dateKey, owner, meals: [], updatedAt: String(row[8] || ""), updatedBy: String(row[9] || "remote"),
      };
      if (timestamp(row[8]) > timestamp(day.updatedAt)) {
        day.updatedAt = String(row[8]);
        day.updatedBy = String(row[9] || "remote");
      }
      if (mealId === "__empty__") {
        remoteRationDays[storageKey] = day;
        return;
      }
      let meal = day.meals.find((item) => item.id === mealId);
      if (!meal) {
        meal = { id: mealId, name: String(row[2] || "Приём пищи"), time: String(row[13] || ""), items: [], order: Number(row[6]) || 0 };
        day.meals.push(meal);
      }
      if (row[3]) {
        meal.items.push({
          id: String(row[3]), productId: String(row[4] || ""), name: String(row[5] || ""), order: Number(row[7]) || 0,
          portionSize: Number(row[11]) || 0, packageSize: Number(row[12]) || 0,
        });
      }
      remoteRationDays[storageKey] = day;
    });
    Object.values(remoteRationDays).forEach((day) => {
      day.meals.sort((a, b) => a.order - b.order).forEach((meal) => {
        delete meal.order;
        meal.items.sort((a, b) => a.order - b.order).forEach((item) => delete item.order);
      });
    });
    state.rationDays = mergeRationDays(state.rationDays || {}, remoteRationDays);
    state.seenRemoteRequestIds = [...seenIds];
    state.remoteTrackingInitialized = true;
    saveState(false);

    if (["summary", "products", "requests", "ration"].includes(route) && !isInteractiveEditing()) render();
  }

  async function writeSpreadsheetData(token, spreadsheetId) {
    const syncPackage = buildSyncPackage(state);
    const requestRows = syncPackage.requests.flatMap((request) =>
      request.items.map((item) => [
        request.id,
        item.productId,
        item.quantity,
        request.status === "open" ? "Активен" : "Выполнен",
        request.createdAt,
        request.completedAt || "",
        request.createdBy || "local",
        request.updatedAt || request.createdAt,
        request.updatedBy || request.createdBy || "local",
        request.deletedAt || "",
        item.plannedAmount || "",
        item.packageSize || "",
        item.plannedAmount ? (item.measureUnit || "") : (item.unit || item.measureUnit || ""),
      ])
    );
    const responseRows = syncPackage.requests.flatMap((request) =>
      request.responses.flatMap((response) =>
        response.items.map((item) => [
          response.id,
          request.id,
          item.productId,
          item.purchasedProductId || item.productId,
          item.quantity,
          item.price,
          response.createdAt,
          response.createdBy || "local",
          response.updatedAt || response.createdAt,
          response.updatedBy || response.createdBy || "local",
          response.deletedAt || "",
          item.completionMode || "filled",
        ])
      )
    );
    const rationRows = Object.values(syncPackage.rationDays || {}).flatMap((day) => {
      if (!(day.meals || []).length) {
        return [[day.date, "__empty__", "", "", "", "", 0, 0, day.updatedAt || "", day.updatedBy || "local", day.owner || "local", "", "", ""]];
      }
      return (day.meals || []).flatMap((meal, mealIndex) => {
        const items = meal.items?.length ? meal.items : [{ id: "", productId: "", name: "" }];
        return items.map((item, itemIndex) => [
          day.date, meal.id, meal.name, item.id || "", item.productId || "", item.name || "",
          mealIndex, itemIndex, day.updatedAt || "", day.updatedBy || "local", day.owner || "local",
          item.portionSize || "", item.packageSize || "", meal.time || rationMealTime(meal, mealIndex),
        ]);
      });
    });
    await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`, token, {
      method: "POST",
      body: JSON.stringify({ ranges: ["Продукты!A:P", "Запросы!A:N", "Покупки!A:L", "Рацион!A:N"] }),
    });
    await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, token, {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: [
          {
            range: "Продукты!A1:P",
            values: [["id", "Наименование", "Категория", "Единица", "Обновлён", "Кем обновлён", "Пищевая ценность JSON", "Источник данных", "Штрихкод", "Состав", "Удалён", "Подтверждён", "Тип", "generic_key", "Бренд", "catalog_source"], ...syncPackage.products.map((item) =>
              [
                item.id,
                item.name,
                item.category,
                item.unit,
                item.updatedAt || "",
                item.updatedBy || "",
                item.nutrition ? JSON.stringify(item.nutrition) : "",
                item.nutrition?.source || "",
                item.barcode || "",
                item.ingredients || "",
                item.deletedAt || "",
                item.confirmed ? "true" : "false",
                item.kind || "",
                item.genericKey || "",
                item.brand || "",
                item.catalogSource || "",
              ]
            )],
          },
          {
            range: "Запросы!A1:M",
            values: [["request_id", "product_id", "Запрошено", "Статус", "Создан", "Закрыт", "Автор", "Обновлён", "Кем обновлён", "Удалён", "Объём рациона", "Размер упаковки", "Единица объёма"], ...requestRows],
          },
          {
            range: "Покупки!A1:L",
            values: [["response_id", "request_id", "product_id", "purchased_product_id", "Куплено", "Цена позиции", "Ответ создан", "Автор ответа", "Ответ обновлён", "Кем обновлён", "Удалён", "Режим"], ...responseRows],
          },
          {
            range: "Рацион!A1:N",
            values: [["Дата", "meal_id", "Приём пищи", "item_id", "product_id", "Продукт", "Порядок приёма", "Порядок продукта", "Обновлён", "Кем обновлён", "Владелец рациона", "Размер порции", "Размер упаковки", "Плановое время"], ...rationRows],
          },
        ],
      }),
    });
  }

  async function googleFetch(url, token, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    if (response.ok) return response.status === 204 ? {} : response.json();
    let message = `Google API: ${response.status}`;
    try {
      const body = await response.json();
      message = body.error?.message || message;
    } catch {}
    if (response.status === 401) accessToken = null;
    throw new Error(message);
  }

  function bindRequestRows() {
    document.querySelectorAll(".request-link").forEach((button) => {
      button.onclick = () => {
        draftItems = [];
        navigate("request-edit", button.dataset.id);
      };
    });
  }

  function requestRow(request) {
    const summary = requestSummary(request);
    return `
      <button class="row link-row request-link" data-id="${request.id}" type="button">
        <div class="row-main">
          <strong>${escapeHtml(summary)}</strong>
          <span>${date(request.createdAt)}${isRemoteRequest(request) ? ` · от ${escapeHtml(request.createdBy)}` : ""}</span>
        </div>
        <span class="status ${request.status}">${request.status === "open" ? requestStatusLabel(request) : money(requestTotal(request))}</span>
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

  function isRequestFulfilled(request) {
    return request.items.length > 0 && request.items.every((item) =>
      responseItemTotal(request, item.productId).quantity >= Number(item.quantity)
    );
  }

  function activeResponses(request) {
    return (request.responses || []).filter((response) => !response.deletedAt);
  }

  function activeRequests() {
    return (state.requests || []).filter((request) => !request.deletedAt);
  }

  function requestStatusLabel(request) {
    if (request.status === "done") return "Выполнен";
    const hasProgress = activeResponses(request).some((response) =>
      response.items.some((item) => Number(item.quantity) > 0 || Number(item.price) > 0)
    );
    return hasProgress ? "Частично выполнен" : "Активен";
  }

  function updateRequestStatus(request, changedAt = request.updatedAt) {
    if (isRequestFulfilled(request)) {
      request.status = "done";
      request.completedAt = request.completedAt || changedAt || new Date().toISOString();
    } else {
      request.status = "open";
      request.completedAt = "";
    }
    return request;
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

  function appendRequestVersion(request, action, createdAt, actor, transactionId = id("transaction")) {
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

  function restoreRequestVersion(request, transaction, changedAt, actor) {
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

  function requestSummary(request) {
    if (!request.items?.length) return "Пустой запрос";
    return request.items.map((item) => {
      const product = getProduct(item.productId);
      return `${product?.name || "Продукт"} — ${requestAmountLabel(item)}`;
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

  function requestProgressLabel(request, item, purchased) {
    const bought = Number(purchased.quantity) || 0;
    const requested = Number(item.quantity) || 0;
    const price = Number(purchased.price) || 0;
    const line = receiptLine(request, item.productId);
    const purchasedId = line?.purchasedProductId || item.productId;
    const purchasedProduct = purchasedId && purchasedId !== item.productId ? getProduct(purchasedId) : null;
    const swapPart = purchasedProduct ? ` → ${escapeHtml(purchasedProduct.name)}` : "";
    const pricePart = price > 0 ? ` · ${money(price)}` : "";
    if (!bought) return "Не куплено";
    if (remainingRequestQuantity(request, item.productId) <= 0) {
      return isPurchaseDetailsFilled(line, item.productId)
        ? `✓ Закрыто${swapPart}${pricePart}`
        : `✓ Куплено${swapPart}${pricePart}`;
    }
    return `Куплено ${number(bought)} из ${number(requested)} ${escapeHtml(requestItemUnit(item))}${swapPart}${pricePart}`;
  }

  function isRemoteRequest(request) {
    const currentEmail = state.user?.email?.toLowerCase();
    const creator = request.createdBy?.toLowerCase();
    return Boolean(currentEmail && creator && creator !== "local" && creator !== currentEmail);
  }

  function notifyRemoteRequest(request) {
    const summary = requestSummary(request);
    if (window.NativeGoogle?.notifyRequest) {
      window.NativeGoogle.notifyRequest(request.id, summary, request.createdBy || "");
    } else {
      showToast(`Новый запрос: ${summary}`);
    }
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

  function mergeRationDays(localValues, remoteValues) {
    const merged = structuredClone(localValues || {});
    Object.entries(remoteValues || {}).forEach(([dateKey, remote]) => {
      const local = merged[dateKey];
      if (!local || timestamp(remote.updatedAt) > timestamp(local.updatedAt)) {
        merged[dateKey] = structuredClone(remote);
      }
    });
    return merged;
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
    const normalized = { ...item };
    delete normalized.stockAtRequest;
    return normalized;
  }

  function migrateRequest(request, products) {
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

  function buildSyncPackage(source) {
    const result = structuredClone(source);
    result.schemaVersion = 10;
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
    result.requests = mergeRequests([], result.requests || []);
    return result;
  }

  function isLegacyProductRow(row) {
    if (!row || row.length < 8) return false;
    const maybeStock = String(row[4] ?? "").trim();
    // Modern rows store ISO updatedAt at index 4; legacy stock quantity is a plain number.
    if (/^\d{4}-\d{2}-\d{2}/.test(maybeStock)) return false;
    const looksLikeStock = maybeStock !== "" && Number.isFinite(Number(maybeStock));
    return looksLikeStock && Boolean(row[7]);
  }

  function parseProductRow(row) {
    const legacyStockSchema = isLegacyProductRow(row);
    const updatedAt = String((legacyStockSchema ? row[7] : row[4]) || new Date(0).toISOString());
    let nutrition = null;
    const nutritionIndex = legacyStockSchema ? 9 : 6;
    try { nutrition = row[nutritionIndex] ? JSON.parse(String(row[nutritionIndex])) : null; } catch { nutrition = null; }
    const confirmedRaw = String(row[legacyStockSchema ? 14 : 11] || "").toLowerCase();
    const product = {
      id: String(row[0]),
      name: String(row[1] || ""),
      category: String(row[2] || ""),
      unit: String(row[3] || "шт."),
      updatedAt,
      updatedBy: String((legacyStockSchema ? row[8] : row[5]) || "remote"),
      nutrition,
      barcode: String(row[legacyStockSchema ? 11 : 8] || ""),
      ingredients: String(row[legacyStockSchema ? 12 : 9] || ""),
      deletedAt: String(row[legacyStockSchema ? 13 : 10] || ""),
      confirmed: confirmedRaw === "1" || confirmedRaw === "true" || confirmedRaw === "да",
      kind: String(row[legacyStockSchema ? 15 : 12] || ""),
      genericKey: String(row[legacyStockSchema ? 16 : 13] || ""),
      brand: String(row[legacyStockSchema ? 17 : 14] || ""),
      catalogSource: String(row[legacyStockSchema ? 18 : 15] || ""),
    };
    if (!confirmedRaw) delete product.confirmed;
    return normalizeProductRecord(product);
  }

  function isLegacyRequestRow(row) {
    const statuses = new Set(["Активен", "Выполнен"]);
    return row.length >= 14 || (!statuses.has(String(row[3] || "")) && statuses.has(String(row[4] || "")));
  }

  function parseResponseRow(row, requestsById) {
    if (!row[0] || !row[1]) return null;
    const modern = row.length >= 5 && requestsById.has(String(row[1]));
    const requestId = String(modern ? row[1] : row[0]);
    const request = requestsById.get(requestId);
    if (!request) return null;
    const extended = modern && row.length >= 11;
    const createdAt = String(
      (modern ? row[extended ? 6 : 5] : request.completedAt || request.updatedAt) ||
      request.updatedAt ||
      request.createdAt ||
      new Date(0).toISOString()
    );
    return normalizeResponse({
      id: modern ? String(row[0]) : `response_legacy_${requestId}`,
      requestId,
      items: [{
        productId: String(modern ? row[2] : row[1]),
        purchasedProductId: String(extended ? row[3] || row[2] : modern ? row[2] : row[1]),
        quantity: Number(modern ? row[extended ? 4 : 3] : row[2]) || 0,
        price: Number(modern ? row[extended ? 5 : 4] : row[3]) || 0,
        completionMode: String(extended ? row[11] || "filled" : "filled"),
      }],
      createdAt,
      createdBy: String((modern ? row[extended ? 7 : 6] : request.updatedBy || request.createdBy) || "remote"),
      updatedAt: String((modern ? row[extended ? 8 : 7] : request.updatedAt) || createdAt),
      updatedBy: String((modern ? row[extended ? 9 : 8] : request.updatedBy || request.createdBy) || "remote"),
      deletedAt: String(modern ? row[extended ? 10 : 9] || "" : ""),
    }, requestId);
  }

  function timestamp(value) {
    const result = Date.parse(value || "");
    return Number.isFinite(result) ? result : 0;
  }

  function getProduct(productId) {
    return state.products.find((product) => product.id === productId && !product.deletedAt);
  }

  function getRequest(requestId) {
    return state.requests.find((request) => request.id === requestId && !request.deletedAt);
  }

  function extractSpreadsheetId(value) {
    const trimmed = value.trim();
    const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    return /^[a-zA-Z0-9_-]{20,}$/.test(trimmed) ? trimmed : null;
  }

  function spreadsheetUrl() {
    return `https://docs.google.com/spreadsheets/d/${state.spreadsheetId}/edit`;
  }

  function setSyncStatus(message, error = false) {
    const element = document.getElementById("sync-status");
    if (!element) return showToast(message);
    element.textContent = message;
    element.className = error ? "error" : "muted";
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

  function dateTime(value) {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
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

  render();
  mirrorStateForBackgroundSync();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      stopForegroundSync();
    } else {
      startForegroundSync(true);
    }
  });
  startForegroundSync(false);
  if (state.spreadsheetId && state.user) queueAutoSync(1200);
})();
