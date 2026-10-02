import {
  activeResponses,
  browserStorage,
  formatRationDate,
  isProductConfirmed,
  isRequestFulfilled,
  normalizeProductName,
  openFoodFactsCategory,
  openFoodFactsNutrition,
  openFoodFactsSuggestion,
  openFoodFactsUnit,
  openLocalData,
  parseRationDate,
  productPurchasedTotal,
  rationDayFor,
  rationMeasure,
  readRationDayNutrition,
  readRationHistoryDay,
  receiptLine,
  remainingRequestQuantity,
  responseItemTotal,
  timestamp,
  todayDateKey,
  validateRationProfile,
} from "./local-data.js";
import {
  AI_CONSENT_TEXT,
  aiConsentStore,
  aiKeyStore,
  createRouterAiProvider,
  defaultTransport,
} from "./ai-provider.js";
import { assistantContext, createAssistant, createThread } from "./ai-tools.js";
import { STRICTNESS_LEVELS, createNudgeWorker } from "./nudges.js";

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
  // Root pages in swipe order. The app always starts on the ration.
  const ROOT_PAGES = ["ration", "sport", "requests"];
  const PAGE_TITLES = { ration: "Рацион", sport: "Спорт", requests: "Покупки" };
  const PAGE_MODE_LABELS = { log: "учёт", plan: "план" };

  const localData = openLocalData(browserStorage(window.localStorage));
  let state = localData.load();
  // The AI key stays on the device apart from the local data (test mode, #44).
  const aiKey = aiKeyStore(window.localStorage);
  const aiConsent = aiConsentStore(window.localStorage);
  const aiProvider = createRouterAiProvider({ getKey: () => aiKey.read(), transport: defaultTransport(window) });
  let aiKeyStatus = { text: "", tone: "muted", busy: false };
  const assistant = createAssistant({
    provider: aiProvider,
    getState: () => localData.snapshot(),
    changePlan: localData.changePlan,
  });
  // Тычки wait in local data; the worker merges a burst into one background call.
  const nudgeWorker = createNudgeWorker({
    provider: aiProvider,
    store: {
      pending: () => localData.snapshot().assistant?.nudges || [],
      settings: () => localData.snapshot().assistant?.settings || {},
      finish: (ids, text) => {
        if (applyLocal(localData.finishNudges(ids, text))) renderAssistantHandle();
      },
    },
    buildContext: () => assistantContext(localData.snapshot(), { page: lastRootPage, mode: pageModes[lastRootPage] || "" }),
    allowed: () => aiConsent.accepted(),
  });
  // The open chat. A thread lives only in memory and is gone after closing.
  let assistantThread = null;
  let assistantBusy = false;
  // "chat" or "bookmarks": the list of Закладки opens inside the overlay.
  let assistantView = "chat";
  let route = "ration";
  // Pages with modes remember them for the session; Покупки has none.
  const pageModes = { ration: "log", sport: "log" };
  // Each mode keeps its feed length and scroll position until the end of the session.
  const FEED_STEP = 14;
  const feedDays = { ration: { log: FEED_STEP, plan: FEED_STEP }, sport: { log: FEED_STEP, plan: FEED_STEP } };
  const modeScroll = { ration: { log: 0, plan: 0 }, sport: { log: 0, plan: 0 } };
  let lastRootPage = "ration";
  let profileReturn = "ration";
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
  // The future day whose plan is open for editing in План, and the date of the
  // meal card opened from Учёт.
  let rationPlanDate = "";
  let rationMealDate = "";
  let rationPortionTarget = null;
  let formDirty = false;
  let requestAutosaveTimer = null;
  let confirmResolve = null;
  let choiceResolve = null;
  let productEditReturn = null;
  let rationProfileReturn = "profile";
  let requestGestureToken = 0;
  let purchaseDialogViewportFrame = 0;
  let purchaseDialogBaselineHeight = 0;

  const app = document.getElementById("app");
  const title = document.getElementById("page-title");
  const headerAction = document.getElementById("header-action");
  const headerBack = document.getElementById("header-back");
  const requestHeaderMenuWrap = document.getElementById("request-header-menu-wrap");
  const headerMore = document.getElementById("header-more");
  const requestHeaderMenu = document.getElementById("request-header-menu");
  const rationHeaderPicker = document.getElementById("ration-header-picker");
  const headerProfile = document.getElementById("header-profile");
  const pageSlider = document.getElementById("page-slider");
  const assistantHandle = document.getElementById("assistant-handle");
  const assistantTeaser = document.getElementById("assistant-teaser");
  const assistantDialog = document.getElementById("assistant-dialog");
  const assistantFeed = document.getElementById("assistant-feed");
  const assistantInput = document.getElementById("assistant-input");

  headerProfile.addEventListener("click", () => {
    profileReturn = lastRootPage;
    navigate("profile");
  });

  pageSlider.addEventListener("click", () => {
    // The slider only switches the mode; pages change with a swipe.
    if (!pageModes[route]) return;
    rememberModeScroll();
    pageModes[route] = pageModes[route] === "log" ? "plan" : "log";
    render();
    restoreModeScroll();
  });

  bindPageSwipe();
  bindAssistantHandle();

  ["input", "change"].forEach((eventName) => app.addEventListener(eventName, (event) => {
    const dialog = event.target.closest("dialog");
    if (dialog) dialog.dataset.dirty = "true";
    if (["product-edit", "request-answer", "ration-profile"].includes(route)) formDirty = true;
  }));

  headerAction.addEventListener("click", () => {
    if (route === "requests") {
      createEmptyRequestAndOpen();
    } else if (route === "request-answer") {
      finishRequestAnswer();
    } else if (route === "request-edit") {
      finishRequestEdit();
    } else if (route === "product-edit") {
      document.getElementById("product-form")?.requestSubmit();
    } else if (route === "ration-profile") {
      document.getElementById("ration-profile-form")?.requestSubmit();
    } else if (route === "ration" && pageModes.ration === "plan") {
      openRationRequestDialog();
    } else attemptBackNavigation();
  });

  headerBack.addEventListener("click", () => attemptBackNavigation());

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
    if (result.nudges) nudgeWorker.schedule();
    return true;
  }

  function navigate(next, id = null, subId = null, options = {}) {
    if (route === "request-edit" && next !== "request-edit" && !options.skipRequestPersist) {
      clearTimeout(requestAutosaveTimer);
      if (document.getElementById("request-items") && !persistRequestDraft({ silent: false })) return;
      draftItems = [];
    }
    rememberModeScroll();
    route = next;
    routeId = id;
    routeSubId = subId;
    rationMealDate = "";
    formDirty = false;
    // The page itself never scrolls: only <main> does (see styles.css).
    app.scrollTop = 0;
    render();
    restoreModeScroll();
  }

  function rememberModeScroll() {
    if (pageModes[route]) modeScroll[route][pageModes[route]] = app.scrollTop;
  }

  function restoreModeScroll() {
    if (pageModes[route]) app.scrollTop = modeScroll[route][pageModes[route]] || 0;
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
    // The topmost dialog closes first: a confirm may sit over the assistant.
    const openDialog = [...document.querySelectorAll("dialog[open]")].pop();
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
    if (route === "sport" || route === "requests") {
      navigate("ration");
      return true;
    }
    if (formDirty) {
      askConfirm("Изменения не сохранены.", "Выйти без сохранения").then((leave) => {
        if (!leave) return;
        formDirty = false;
        leaveCurrentRoute();
      });
      return true;
    }
    return leaveCurrentRoute();
  }

  function leaveCurrentRoute() {
    draftItems = [];
    if (route === "product-edit") leaveProductCard();
    else if (route === "ration-profile") navigate(rationProfileReturn);
    else if (route === "profile") navigate(profileReturn);
    else if (route === "request-detail") navigate("request-edit", routeId);
    else return false;
    return true;
  }

  // A product card opens from a chip and returns to where it was opened.
  function leaveProductCard() {
    const ret = productEditReturn;
    productEditReturn = null;
    navigate(ret?.route || lastRootPage, ret?.id || null);
  }

  function closeDialogSafely(dialog) {
    if (dialog.id === "app-confirm-dialog") {
      finishConfirm(false);
      return true;
    }
    if (dialog.id === "ration-request-dialog") {
      dialog.close();
      return true;
    }
    if (dialog.id === "app-choice-dialog") {
      finishChoice(null);
      return true;
    }
    if (dialog.id === "assistant-dialog") {
      requestCloseAssistant();
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

  function askConfirm(message, okLabel = "Подтвердить") {
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
      document.getElementById("app-confirm-ok").textContent = okLabel;
      dialog.showModal();
    });
  }

  // A dialog with several answers; resolves with the chosen value or null.
  function askChoice(message, options) {
    return new Promise((resolve) => {
      choiceResolve = resolve;
      let dialog = document.getElementById("app-choice-dialog");
      if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.id = "app-choice-dialog";
        dialog.className = "answer-dialog confirm-dialog";
        dialog.innerHTML = `<p id="app-choice-message"></p><div id="app-choice-options" class="choice-options"></div>
          <button id="app-choice-cancel" class="text-button dialog-cancel" type="button">Остаться</button>`;
        document.body.appendChild(dialog);
        dialog.addEventListener("cancel", (event) => {
          event.preventDefault();
          finishChoice(null);
        });
        document.getElementById("app-choice-cancel").onclick = () => finishChoice(null);
      }
      document.getElementById("app-choice-message").textContent = message;
      const list = document.getElementById("app-choice-options");
      list.innerHTML = options.map((option, index) => `<button class="button full ${option.secondary ? "secondary" : ""}" data-index="${index}" type="button">${escapeHtml(option.label)}</button>`).join("");
      list.querySelectorAll("button").forEach((button) => {
        button.onclick = () => finishChoice(options[Number(button.dataset.index)].value);
      });
      dialog.showModal();
    });
  }

  function finishChoice(value) {
    const dialog = document.getElementById("app-choice-dialog");
    if (dialog?.open) dialog.close();
    const resolve = choiceResolve;
    choiceResolve = null;
    if (resolve) resolve(value);
  }

  function finishConfirm(result) {
    const dialog = document.getElementById("app-confirm-dialog");
    if (dialog?.open) dialog.close();
    const resolve = confirmResolve;
    confirmResolve = null;
    if (resolve) resolve(result);
  }

  function render() {
    const rootPage = ROOT_PAGES.includes(route);
    if (rootPage) lastRootPage = route;
    document.body.classList.toggle("root-page", rootPage);
    renderPageSlider();
    renderAssistantHandle();
    configureHeader();

    if (route === "ration") renderRation();
    else if (route === "sport") renderSport();
    else if (route === "product-edit") renderProductForm();
    else if (route === "requests") renderRequests();
    else if (route === "request-edit") renderRequestForm();
    else if (route === "request-detail") {
      draftItems = [];
      navigate("request-edit", routeId);
      return;
    }
    else if (route === "request-answer") renderRequestAnswer();
    else if (route === "ration-profile") renderRationProfileForm();
    else if (route === "profile") renderProfile();
  }

  function configureHeader() {
    const config = {
      ration: [PAGE_TITLES.ration, pageModes.ration === "plan" ? "Запросить" : ""],
      sport: [PAGE_TITLES.sport, ""],
      requests: [PAGE_TITLES.requests, "Создать"],
      "product-edit": ["Продукт", "Сохранить"],
      "request-edit": ["", "Готово"],
      "request-detail": ["Запрос", "Назад"],
      "request-answer": ["Отметить покупки", "Готово"],
      "ration-profile": ["Профиль рациона", "Сохранить"],
      profile: ["Профиль", ""],
    }[route];
    const editedRequest = route === "request-edit" ? getRequest(routeId) : null;
    title.textContent = editedRequest ? date(editedRequest.createdAt) : config[0];
    headerAction.textContent = config[1];
    headerAction.hidden = !config[1];
    headerBack.hidden = !["product-edit", "ration-profile", "profile"].includes(route);
    headerProfile.hidden = !ROOT_PAGES.includes(route);
    requestHeaderMenuWrap.hidden = route !== "request-edit";
    closeRequestHeaderMenu();
    rationHeaderPicker.hidden = route !== "ration";
  }

  function closeRequestHeaderMenu() {
    requestHeaderMenu.hidden = true;
    headerMore.setAttribute("aria-expanded", "false");
  }

  function renderPageSlider() {
    const index = ROOT_PAGES.indexOf(route);
    pageSlider.hidden = index < 0;
    if (index < 0) return;
    const mode = pageModes[route];
    document.getElementById("page-slider-prev").textContent = PAGE_TITLES[ROOT_PAGES[index - 1]] || "";
    document.getElementById("page-slider-current").textContent = PAGE_TITLES[route];
    document.getElementById("page-slider-next").textContent = PAGE_TITLES[ROOT_PAGES[index + 1]] || "";
    document.getElementById("page-slider-modes").hidden = !mode;
    pageSlider.querySelectorAll("[data-mode]").forEach((label) => {
      label.classList.toggle("active", label.dataset.mode === mode);
    });
    pageSlider.setAttribute("aria-disabled", String(!mode));
    pageSlider.setAttribute("aria-label", mode
      ? `${PAGE_TITLES[route]}, режим ${PAGE_MODE_LABELS[mode]}. Переключить на ${PAGE_MODE_LABELS[mode === "log" ? "plan" : "log"]}`
      : PAGE_TITLES[route]);
  }

  function neighbourPage(step) {
    const index = ROOT_PAGES.indexOf(route);
    return index < 0 ? "" : ROOT_PAGES[index + step] || "";
  }

  function pageSwipeAllowed(event) {
    if (!ROOT_PAGES.includes(route)) return false;
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return false;
    if (document.querySelector("dialog[open]")) return false;
    // Screen edges belong to the system back gesture.
    if (event.clientX < 24 || event.clientX > window.innerWidth - 24) return false;
    return !event.target.closest("input, textarea, select, [contenteditable]");
  }

  // Root pages switch with a horizontal swipe over the content. Screens over a
  // page (request note, product card, Profile, forms) and dialogs keep
  // horizontal gestures for themselves.
  function bindPageSwipe() {
    let start = null;
    let dragging = false;
    let suppressClick = false;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const animate = (frames) => {
      if (!reducedMotion?.matches && typeof app.animate === "function") app.animate(frames, { duration: 180, easing: "ease-out" });
    };
    const stopDrag = () => {
      start = null;
      dragging = false;
      app.classList.remove("is-page-dragging");
      app.style.transform = "";
    };

    app.addEventListener("pointerdown", (event) => {
      if (!pageSwipeAllowed(event)) return;
      // A mouse press on selected text would start a native drag and cancel the swipe.
      if (event.pointerType === "mouse") window.getSelection?.()?.removeAllRanges();
      start = { x: event.clientX, y: event.clientY, time: event.timeStamp, pointerId: event.pointerId };
      dragging = false;
    });
    app.addEventListener("pointermove", (event) => {
      if (!start || event.pointerId !== start.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!dragging) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          start = null;
          return;
        }
        dragging = true;
        app.classList.add("is-page-dragging");
        try {
          app.setPointerCapture?.(event.pointerId);
        } catch {}
      }
      // Past the first and the last page the content only gives a little.
      const offset = neighbourPage(dx < 0 ? 1 : -1) ? dx : dx / 4;
      app.style.transform = `translate3d(${offset}px,0,0)`;
      if (event.cancelable) event.preventDefault();
    }, { passive: false });
    app.addEventListener("pointerup", (event) => {
      if (!start || event.pointerId !== start.pointerId) return;
      const dx = event.clientX - start.x;
      const fast = Math.abs(dx) > 40 && event.timeStamp - start.time < 250;
      const wasDragging = dragging;
      const offset = app.style.transform;
      stopDrag();
      if (!wasDragging) return;
      // The click of this gesture follows pointerup in the same task.
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      const step = dx < 0 ? 1 : -1;
      const next = Math.abs(dx) >= Math.max(64, window.innerWidth * 0.22) || fast ? neighbourPage(step) : "";
      if (!next) {
        animate([{ transform: offset }, { transform: "none" }]);
        return;
      }
      navigate(next);
      animate([{ transform: `translate3d(${step * 32}%,0,0)`, opacity: 0.4 }, { transform: "none", opacity: 1 }]);
    });
    app.addEventListener("pointercancel", stopDrag);
    // A drag that ends over a button must not also press it.
    app.addEventListener("click", (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  // Assistant: a handle at the right edge of every root page opens one chat.
  // The chat knows the page and mode it was opened from; changes come as
  // Предложения that write nothing until applied.
  const ASSISTANT_SUGGESTIONS = {
    "ration:log": ["Как я соблюдал рацион последние недели?", "Чем заменить пропущенный приём пищи?", "Какие расхождения у меня бывают чаще всего?"],
    "ration:plan": ["Сделай завтра день без мяса", "Добавь больше белка в план на неделю", "Укладывается ли план в мою цель?"],
    "sport:log": ["Сколько белка у меня в плане на завтра?", "Подстрой питание под дни тренировок"],
    "sport:plan": ["Подстрой питание под дни тренировок", "Добавь перекус перед вечерней тренировкой"],
    "requests:": ["Сколько я потратил на продукты за месяц?", "Какие продукты нужны по плану на неделю?"],
  };
  const PROPOSAL_STATUS = {
    pending: "Предложение",
    applied: "Применено",
    conflict: "Конфликт",
    dismissed: "Убрано",
    reverted: "Отменено",
  };
  let handleDrag = null;
  let suppressHandleClick = false;
  let lastGestureExclusion = "";

  function assistantUnavailableText() {
    return "ИИ недоступен: добавьте ключ в Профиле";
  }

  function renderAssistantHandle() {
    const visible = ROOT_PAGES.includes(route) && !assistantDialog.open;
    assistantHandle.hidden = !visible;
    const available = aiProvider.hasKey();
    // A notice from a Тычок: a badge on the handle and a teaser line.
    const notice = available ? state.assistant?.notice : null;
    assistantHandle.classList.toggle("unavailable", !available);
    assistantHandle.classList.toggle("has-notice", Boolean(notice));
    document.getElementById("assistant-handle-badge").hidden = !notice;
    assistantHandle.setAttribute("aria-label", !available
      ? assistantUnavailableText()
      : notice ? `Ассистент: ${notice.text}` : "Открыть ассистента");
    assistantHandle.title = available ? "Ассистент" : assistantUnavailableText();
    assistantTeaser.hidden = !visible || !notice;
    assistantTeaser.textContent = notice ? notice.text : "";
    syncGestureExclusion();
  }

  // The handle's area is excluded from the Android back gesture (API 29+).
  function syncGestureExclusion() {
    if (typeof window.NativeCookish?.setGestureExclusion !== "function") return;
    const rects = [];
    if (!assistantHandle.hidden) {
      const box = assistantHandle.getBoundingClientRect();
      if (box.width && box.height) rects.push({ x: box.left, y: box.top, width: box.width, height: box.height });
    }
    const json = JSON.stringify(rects.map((rect) => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Math.round(value)]))));
    if (json === lastGestureExclusion) return;
    lastGestureExclusion = json;
    window.NativeCookish.setGestureExclusion(json);
  }

  function bindAssistantHandle() {
    assistantHandle.addEventListener("pointerdown", (event) => {
      handleDrag = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, opened: false };
      try {
        assistantHandle.setPointerCapture?.(event.pointerId);
      } catch {}
    });
    assistantHandle.addEventListener("pointermove", (event) => {
      if (!handleDrag || event.pointerId !== handleDrag.pointerId || handleDrag.opened) return;
      const dx = Math.min(0, event.clientX - handleDrag.x);
      assistantHandle.style.setProperty("--pull", `${Math.max(dx, -48)}px`);
      // Pulling the handle to the left opens the chat.
      if (dx < -36 && Math.abs(event.clientY - handleDrag.y) < 90) {
        handleDrag.opened = true;
        suppressHandleClick = true;
        openAssistant();
      }
    });
    const release = () => {
      handleDrag = null;
      assistantHandle.style.removeProperty("--pull");
      setTimeout(() => { suppressHandleClick = false; }, 0);
    };
    assistantHandle.addEventListener("pointerup", release);
    assistantHandle.addEventListener("pointercancel", release);
    // A tap opens the chat too.
    assistantHandle.addEventListener("click", () => {
      if (suppressHandleClick) return;
      openAssistant();
    });
    assistantTeaser.addEventListener("click", () => openAssistant());
    document.getElementById("assistant-close").addEventListener("click", () => requestCloseAssistant());
    document.getElementById("assistant-bookmark-save").addEventListener("click", () => saveAssistantBookmark());
    document.getElementById("assistant-bookmarks").addEventListener("click", () => {
      assistantView = assistantView === "bookmarks" ? "chat" : "bookmarks";
      renderAssistantFeed();
    });
    assistantDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      requestCloseAssistant();
    });
    document.getElementById("assistant-form").addEventListener("submit", (event) => {
      event.preventDefault();
      sendAssistantMessage(assistantInput.value);
    });
    assistantInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendAssistantMessage(assistantInput.value);
      }
    });
    document.getElementById("assistant-apply-all").addEventListener("click", () => {
      applyAssistantProposals(pendingProposals(), true);
    });
    assistantFeed.addEventListener("click", (event) => {
      const suggestion = event.target.closest(".assistant-suggestion");
      if (suggestion) {
        assistantInput.value = suggestion.dataset.text;
        assistantInput.focus();
        return;
      }
      if (event.target.closest("#assistant-bookmarks-back")) {
        assistantView = "chat";
        renderAssistantFeed();
        return;
      }
      const openBookmark = event.target.closest(".assistant-bookmark-open");
      if (openBookmark) {
        openAssistantBookmark(openBookmark.dataset.bookmarkId);
        return;
      }
      const removeBookmark = event.target.closest(".assistant-bookmark-remove");
      if (removeBookmark) {
        removeAssistantBookmark(removeBookmark.dataset.bookmarkId);
        return;
      }
      if (event.target.closest("#assistant-open-profile")) {
        assistantDialog.close();
        assistantThread = null;
        profileReturn = lastRootPage;
        navigate("profile");
        return;
      }
      const button = event.target.closest("[data-proposal-action]");
      if (!button || !assistantThread) return;
      const proposal = assistantThread.proposals.find((value) => value.id === button.dataset.proposalId);
      if (!proposal) return;
      const action = button.dataset.proposalAction;
      if (action === "apply") applyAssistantProposals([proposal], false);
      else if (action === "dismiss") {
        proposal.status = "dismissed";
        renderAssistantFeed();
      } else if (action === "undo") undoAssistantProposal(proposal);
    });
  }

  function openAssistant() {
    if (assistantDialog.open || !ROOT_PAGES.includes(route)) return;
    const mode = pageModes[route] || "";
    assistantThread = createThread({ page: route, mode });
    assistantView = "chat";
    // The assistant's reaction to a Тычок opens the thread.
    const notice = aiProvider.hasKey() ? state.assistant?.notice : null;
    if (notice) {
      assistantThread.log.push({ type: "assistant", text: notice.text });
      assistantThread.messages.push({ role: "assistant", content: notice.text });
      applyLocal(localData.clearAssistantNotice());
    }
    document.getElementById("assistant-title").textContent = assistantContextTitle(route, mode);
    assistantInput.value = "";
    renderAssistantFeed();
    assistantDialog.showModal();
    renderAssistantHandle();
    // The keyboard would cover the suggestions: focus stays on the dialog.
    assistantDialog.focus?.();
  }

  function assistantContextTitle(page, mode) {
    return mode ? `${PAGE_TITLES[page]} · ${capitalize(PAGE_MODE_LABELS[mode])}` : PAGE_TITLES[page];
  }

  function pendingProposals() {
    return (assistantThread?.proposals || []).filter((proposal) => proposal.status === "pending");
  }

  // Closing with unapplied Предложения asks what to do with them. A thread in
  // Закладки is saved again on close instead.
  async function requestCloseAssistant() {
    if (!assistantDialog.open) return;
    if (assistantThread?.bookmarkId) {
      saveAssistantBookmark({ silent: true });
      closeAssistant();
      return;
    }
    const pending = pendingProposals();
    if (pending.length) {
      const choice = await askChoice(
        `В чате ${pending.length} неприменённ${pending.length === 1 ? "ое предложение" : "ых предложения"}. Без закладки чат после закрытия не сохранится.`,
        [
          { label: `Применить ${pending.length}`, value: "apply" },
          { label: "Отбросить", value: "discard", secondary: true },
          { label: "В закладки", value: "bookmark", secondary: true },
        ]
      );
      if (!choice) return;
      if (choice === "apply" && !applyAssistantProposals(pending, true)) return;
      if (choice === "bookmark" && !saveAssistantBookmark({ silent: true })) return;
      if (choice === "bookmark") showToast("Тред сохранён в закладках.");
    }
    closeAssistant();
  }

  // Keeps the messages and the unapplied Предложения of the open thread.
  function saveAssistantBookmark({ silent = false } = {}) {
    const thread = assistantThread;
    const firstUser = thread?.log.find((entry) => entry.type === "user");
    if (!firstUser) {
      showToast("Сначала напишите ассистенту.");
      return false;
    }
    const proposals = thread.proposals.filter((proposal) => proposal.status === "pending" || proposal.status === "conflict");
    const kept = new Set(proposals.map((proposal) => proposal.id));
    const bookmark = {
      id: thread.bookmarkId || `bookmark_${thread.id}`,
      title: firstUser.text.length > 60 ? `${firstUser.text.slice(0, 59)}…` : firstUser.text,
      page: thread.page,
      mode: thread.mode,
      createdAt: thread.createdAt,
      log: thread.log.filter((entry) => entry.type !== "proposal" || kept.has(entry.proposalId)),
      messages: bookmarkMessages(thread.messages),
      proposals,
    };
    if (!applyLocal(localData.saveBookmark(bookmark))) return false;
    thread.bookmarkId = bookmark.id;
    if (!silent) showToast("Тред в закладках.");
    renderAssistantFeed();
    return true;
  }

  // The model conversation is bounded; it must start with a user message so
  // that tool results never lose their call.
  function bookmarkMessages(messages) {
    const recent = (messages || []).slice(-60);
    const start = recent.findIndex((message) => message.role === "user");
    return start < 0 ? [] : recent.slice(start);
  }

  async function openAssistantBookmark(bookmarkId) {
    const bookmark = (state.assistant?.bookmarks || []).find((item) => item.id === bookmarkId);
    if (!bookmark) return;
    const unsaved = assistantThread && !assistantThread.bookmarkId && assistantThread.log.some((entry) => entry.type === "user");
    if (unsaved && !await askConfirm("Текущий чат не в закладках и пропадёт. Открыть закладку?", "Открыть")) return;
    assistantThread = {
      id: bookmark.id.replace(/^bookmark_/, ""),
      page: bookmark.page,
      mode: bookmark.mode,
      createdAt: bookmark.createdAt,
      bookmarkId: bookmark.id,
      messages: structuredClone(bookmark.messages || []),
      proposals: structuredClone(bookmark.proposals || []),
      log: structuredClone(bookmark.log || []),
    };
    // The plan may have changed since: stale Предложения get a conflict.
    assistant.recheck(assistantThread.proposals);
    assistantView = "chat";
    document.getElementById("assistant-title").textContent = assistantContextTitle(bookmark.page, bookmark.mode);
    renderAssistantFeed();
    const stale = assistantThread.proposals.filter((proposal) => proposal.status === "conflict").length;
    if (stale) showToast(stale === 1 ? "Одно предложение устарело: план изменился." : `Устарело предложений: ${stale}.`);
  }

  async function removeAssistantBookmark(bookmarkId) {
    const bookmark = (state.assistant?.bookmarks || []).find((item) => item.id === bookmarkId);
    if (!bookmark || !await askConfirm(`Удалить закладку «${bookmark.title}»?`, "Удалить")) return;
    if (!applyLocal(localData.removeBookmark(bookmarkId))) return;
    if (assistantThread?.bookmarkId === bookmarkId) delete assistantThread.bookmarkId;
    renderAssistantFeed();
  }

  function assistantBookmarksList() {
    const bookmarks = state.assistant?.bookmarks || [];
    const rows = bookmarks.map((bookmark) => {
      const pending = (bookmark.proposals || []).length;
      const meta = [
        assistantContextTitle(bookmark.page, bookmark.mode),
        date(bookmark.updatedAt || bookmark.createdAt),
        pending ? `предложений: ${pending}` : "",
      ].filter(Boolean).join(" · ");
      return `<article class="assistant-bookmark">
        <button class="assistant-bookmark-open" data-bookmark-id="${escapeAttr(bookmark.id)}" type="button">
          <strong>${escapeHtml(bookmark.title || "Тред")}</strong>
          <small>${escapeHtml(meta)}</small>
        </button>
        <button class="assistant-bookmark-remove" data-bookmark-id="${escapeAttr(bookmark.id)}" type="button" aria-label="Удалить закладку «${escapeAttr(bookmark.title || "Тред")}»">×</button>
      </article>`;
    }).join("");
    return `<div class="assistant-bookmarks">
      <button id="assistant-bookmarks-back" class="text-button" type="button">← К чату</button>
      <h3>Закладки</h3>
      ${rows || `<p class="muted">Закладок пока нет. Сохраните тред кнопкой «В закладки» в шапке чата.</p>`}
    </div>`;
  }

  function closeAssistant() {
    if (assistantDialog.open) assistantDialog.close();
    assistantThread = null;
    assistantBusy = false;
    renderAssistantHandle();
  }

  async function sendAssistantMessage(value) {
    const text = String(value || "").trim();
    if (!text || assistantBusy || !assistantThread) return;
    if (!aiProvider.hasKey()) return renderAssistantFeed();
    if (!await ensureAiConsent()) return;
    const thread = assistantThread;
    assistantBusy = true;
    assistantInput.value = "";
    renderAssistantFeed();
    try {
      await assistant.run(thread, text, {
        page: thread.page,
        mode: thread.mode,
        onEvent: () => {
          if (assistantThread === thread) renderAssistantFeed();
        },
      });
    } finally {
      if (assistantThread === thread) {
        assistantBusy = false;
        // A thread in Закладки keeps its bookmark current.
        if (thread.bookmarkId) saveAssistantBookmark({ silent: true });
        renderAssistantFeed();
      }
    }
  }

  function applyAssistantProposals(proposals, together) {
    if (!proposals.length) return false;
    const result = assistant.apply(proposals, { together });
    state = localData.snapshot();
    render();
    renderAssistantFeed();
    const failed = result.results.filter((entry) => !entry.ok);
    if (!result.ok) showToast(failed[0]?.reason || "Предложение не применилось.");
    else if (failed.length) showToast(`Применено ${result.results.length - failed.length}, с конфликтом ${failed.length}.`);
    else showToast(proposals.length > 1 ? "Предложения применены." : "Предложение применено.");
    return result.ok;
  }

  function undoAssistantProposal(proposal) {
    const result = localData.revertChangeSet(proposal.changeSetId);
    if (!applyLocal(result)) return;
    assistantThread.proposals
      .filter((value) => value.changeSetId === proposal.changeSetId)
      .forEach((value) => { value.status = "reverted"; });
    render();
    renderAssistantFeed();
    showToast("Изменение отменено.");
  }

  function renderAssistantFeed() {
    if (!assistantThread) return;
    const available = aiProvider.hasKey();
    const listing = assistantView === "bookmarks";
    const form = document.getElementById("assistant-form");
    form.hidden = !available || listing;
    const saveButton = document.getElementById("assistant-bookmark-save");
    saveButton.hidden = !available || listing || !assistantThread.log.some((entry) => entry.type === "user");
    saveButton.classList.toggle("saved", Boolean(assistantThread.bookmarkId));
    saveButton.setAttribute("aria-label", assistantThread.bookmarkId ? "Сохранено в закладках" : "В закладки");
    document.getElementById("assistant-bookmarks").hidden = !available;
    document.getElementById("assistant-bookmarks").setAttribute("aria-pressed", String(listing));
    assistantInput.disabled = assistantBusy;
    document.getElementById("assistant-send").disabled = assistantBusy;
    const pending = pendingProposals();
    const applyBar = document.getElementById("assistant-apply-bar");
    applyBar.hidden = pending.length < 2 || assistantBusy || listing;
    document.getElementById("assistant-apply-all").textContent = `Применить все (${pending.length})`;
    if (!available) {
      assistantFeed.innerHTML = `<div class="assistant-unavailable">
        <p>${assistantUnavailableText()}.</p>
        <button id="assistant-open-profile" class="button secondary" type="button">Открыть Профиль</button>
      </div>`;
      return;
    }
    if (listing) {
      assistantFeed.innerHTML = assistantBookmarksList();
      assistantFeed.scrollTop = 0;
      return;
    }
    const entries = assistantThread.log.map((entry) => assistantLogEntry(entry)).join("");
    const suggestions = assistantThread.log.some((entry) => entry.type === "user") ? "" : `<div class="assistant-suggestions">
      <p class="muted">Спросите или попросите изменить план. Ассистент пришлёт изменения на подтверждение.</p>
      ${(ASSISTANT_SUGGESTIONS[`${assistantThread.page}:${assistantThread.mode}`] || []).slice(0, 3).map((text) =>
        `<button class="assistant-suggestion" type="button" data-text="${escapeAttr(text)}">${escapeHtml(text)}</button>`).join("")}
    </div>`;
    assistantFeed.innerHTML = `${entries}${suggestions}${assistantBusy ? `<p class="assistant-typing">Ассистент думает…</p>` : ""}`;
    assistantFeed.scrollTop = assistantFeed.scrollHeight;
  }

  function assistantLogEntry(entry) {
    if (entry.type === "user") return `<div class="assistant-message from-user">${escapeHtml(entry.text)}</div>`;
    if (entry.type === "assistant") return `<div class="assistant-message from-assistant">${escapeHtml(entry.text)}</div>`;
    if (entry.type === "progress") return `<p class="assistant-progress">· ${escapeHtml(entry.text)}</p>`;
    if (entry.type === "error") return `<p class="assistant-error error" role="alert">${escapeHtml(entry.text)}</p>`;
    if (entry.type === "proposal") {
      const proposal = assistantThread.proposals.find((value) => value.id === entry.proposalId);
      return proposal ? assistantProposalCard(proposal) : "";
    }
    return "";
  }

  function assistantProposalCard(proposal) {
    const status = PROPOSAL_STATUS[proposal.status] ? proposal.status : "pending";
    const actions = {
      pending: `<button class="text-button" data-proposal-action="dismiss" data-proposal-id="${proposal.id}" type="button">Убрать</button>
        <button class="button" data-proposal-action="apply" data-proposal-id="${proposal.id}" type="button">Применить</button>`,
      applied: proposal.changeSetId ? `<button class="button secondary" data-proposal-action="undo" data-proposal-id="${proposal.id}" type="button">Отменить</button>` : "",
      conflict: `<button class="text-button" data-proposal-action="dismiss" data-proposal-id="${proposal.id}" type="button">Убрать</button>`,
      dismissed: "",
      reverted: "",
    }[status];
    return `<article class="assistant-proposal status-${status}" data-proposal-id="${proposal.id}">
      <header>
        <strong>${escapeHtml(proposal.summary)}</strong>
        <span class="assistant-proposal-status">${PROPOSAL_STATUS[status]}</span>
      </header>
      ${assistantProposalBody(proposal)}
      ${status === "conflict" && proposal.conflict ? `<p class="assistant-proposal-conflict">${escapeHtml(proposal.conflict)}</p>` : ""}
      ${actions ? `<div class="assistant-proposal-actions">${actions}</div>` : ""}
    </article>`;
  }

  function assistantProposalBody(proposal) {
    const preview = proposal.preview || {};
    if (preview.type === "product") {
      const line = (values) => values ? `${number(values.calories)} ккал · Б ${number(values.protein)} · Ж ${number(values.fat)} · У ${number(values.carbs)}` : "нет данных";
      return `<dl class="assistant-proposal-product">
        <dt>Было</dt><dd>${preview.before ? escapeHtml(line(preview.before)) : "нового продукта не было"}</dd>
        <dt>Стало</dt><dd>${escapeHtml(line(preview.after))} на 100 ${preview.unit === "л" ? "мл" : "г"}</dd>
      </dl>`;
    }
    const days = (preview.days || []).slice(0, 7).map((day) => {
      const before = new Map((day.before || []).map((meal) => [meal.name, meal]));
      const after = new Map((day.after || []).map((meal) => [meal.name, meal]));
      const names = [...new Set([...before.keys(), ...after.keys()])];
      const changed = names.filter((name) => JSON.stringify(before.get(name)) !== JSON.stringify(after.get(name)));
      const rows = changed.map((name) => `<li>
        <span class="assistant-proposal-meal">${escapeHtml(name)}</span>
        <span class="was">Было: ${escapeHtml(assistantMealText(before.get(name)))}</span>
        <span class="now">Стало: ${escapeHtml(assistantMealText(after.get(name)))}</span>
      </li>`).join("");
      return `<section class="assistant-proposal-day">
        <h4>${capitalize(rationShortWeekday(day.date))}, ${rationShortDate(day.date)}</h4>
        ${rows ? `<ul>${rows}</ul>` : ""}
        <small>${assistantDelta(day.delta)}</small>
      </section>`;
    }).join("");
    const more = (preview.days || []).length > 7 ? `<p class="muted">И ещё ${(preview.days || []).length - 7} дн.</p>` : "";
    return days ? `${days}${more}` : `<p class="muted">Затронутые дни: ${escapeHtml((proposal.dates || []).map((date) => rationShortDate(date)).join(", ") || "—")}</p>`;
  }

  function assistantMealText(meal) {
    if (!meal) return "нет";
    const items = (meal.items || []).map((item) => `${item.product} ${number(item.amount)} ${item.unit}`).join(", ");
    return `${meal.time} · ${items || "без продуктов"}`;
  }

  function assistantDelta(delta = {}) {
    const sign = (value) => {
      const rounded = Math.round(Number(value) || 0);
      return rounded > 0 ? `+${number(rounded)}` : rounded < 0 ? `−${number(Math.abs(rounded))}` : "0";
    };
    return `Δ ${sign(delta.calories)} ккал · Б ${sign(delta.protein)} · Ж ${sign(delta.fat)} · У ${sign(delta.carbs)}`;
  }

  function renderSport() {
    app.innerHTML = `<section class="section sport-soon"><div class="empty-state">
        <p class="empty">Скоро</p>
        <p class="muted">Здесь появятся план тренировок и их учёт.</p>
      </div></section>`;
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
    if (ingredients || nutrition?.vitamins || nutrition?.minerals) document.getElementById("product-more")?.setAttribute("open", "");
    return Boolean(nutrition);
  }

  function setBarcodeStatus(message, error = false) {
    const status = document.getElementById("barcode-status");
    status.textContent = message;
    status.className = error ? "error barcode-status" : "success barcode-status";
  }

  function renderProductForm() {
    const product = getProduct(routeId);
    if (!product) return leaveProductCard();
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
        <label class="field"><span>Наименование</span><input name="name" required autocomplete="off" value="${escapeAttr(product.name)}"></label>
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
        </section>
        <details id="product-more" class="product-more" ${product?.nutrition?.vitamins || product?.nutrition?.minerals || product?.ingredients ? "open" : ""}>
          <summary>Витамины, минералы, состав</summary>
          <label class="field"><span>Витамины</span><input name="vitamins" value="${escapeAttr(product?.nutrition?.vitamins || "")}" placeholder="Например: C: 10 мг; B6: 0,2 мг"></label>
          <label class="field"><span>Минералы и другие элементы</span><input name="minerals" value="${escapeAttr(product?.nutrition?.minerals || "")}" placeholder="Например: кальций: 120 мг"></label>
          <label class="field"><span>Состав</span><textarea name="ingredients" rows="3" placeholder="Состав с этикетки">${escapeHtml(product?.ingredients || "")}</textarea></label>
        </details>
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
      leaveProductCard();
      showToast("Продукт изменён.");
    });
  }

  function renderRequests() {
    const sorted = [...activeRequests()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    app.innerHTML = sorted.length
      ? sorted.map((request) => requestRow(request)).join("")
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
          <span class="request-swipe-handle" ${isBlank ? 'aria-hidden="true"' : `role="checkbox" tabindex="0" aria-checked="${fullyBought}" aria-label="Куплено: ${escapeAttr(productName)}"`}><span class="request-swipe-arrow" aria-hidden="true">&lt;</span><span class="request-swipe-dots" aria-hidden="true"></span></span>
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
    if (!row) return false;
    const key = row.dataset.key;
    if (!key) return false;
    const focusTarget = row.previousElementSibling || row.nextElementSibling;
    draftItems = draftItems.filter((item) => item.key !== key);
    row.remove();
    refreshEmptyRowControls();
    if (!persistRequestDraft({ silent: true })) {
      draftItems = [];
      renderRequestForm();
      return false;
    }
    if (focusTarget?.isConnected) focusRequestLine(focusTarget, Boolean(focusTarget.querySelector(".product-chip")));
    return true;
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
      let startedOnHandle = false;

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
        const name = (row.querySelector(".product-chip, .product-candidate")?.textContent || "").trim();
        window.setTimeout(() => {
          if (token !== requestGestureToken || !row.isConnected) return;
          if (cancelDraftProduct(row) && name) showToast(`Позиция «${name}» удалена.`);
        }, 160);
      };

      const toggleBought = () => {
        if (token !== requestGestureToken || !row.isConnected || row.classList.contains("is-blank")) return;
        clearTapPreview();
        if (row.classList.contains("is-bought")) unmarkRowBought(request, row);
        else quickMarkRowBought(request, row);
      };

      const handle = row.querySelector(".request-swipe-handle[role=checkbox]");
      handle?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggleBought();
      });

      const onPointerDown = (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        startedOnHandle = Boolean(handle && handle.contains(event.target));
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
          // Pointer capture retargets the click to the surface, so a tap on
          // the check handle is detected here instead of with a click listener.
          if (startedOnHandle) toggleBought();
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

  function quickMarkRowBought(request, row) {
    clearTimeout(requestAutosaveTimer);
    syncDraftFromForm();
    if (!persistRequestDraft({ silent: false })) return;
    const productId = ensureRowProductId(row);
    if (!productId) return showToast("Сначала укажите продукт.");
    const current = getRequest(request.id);
    if (!current) return;
    // Keep price and SKU already entered in the purchase sheet; only close the line.
    const line = receiptLine(current, productId);
    const requested = Number(current.items.find((item) => item.productId === productId)?.quantity || 0);
    const marked = localData.markBought(request.id, productId, line ? {
      quantity: requested || line.quantity,
      price: line.price,
      purchasedProductId: line.purchasedProductId,
      completionMode: line.completionMode,
    } : {});
    if (!marked.ok) return showToast(marked.reason);
    state = localData.snapshot();
    formDirty = false;
    try {
      navigator.vibrate?.(12);
    } catch {}
    patchRequestItemRow(request.id, marked.productId || productId);
    playRowPurchaseAnimation(marked.productId || productId, "is-just-bought");
  }

  function unmarkRowBought(request, row) {
    clearTimeout(requestAutosaveTimer);
    const productId = ensureRowProductId(row);
    if (!productId) return;
    const current = getRequest(request.id);
    const line = current ? receiptLine(current, productId) : null;
    const unmarked = localData.unmarkBought(request.id, productId);
    if (!unmarked.ok) return showToast(unmarked.reason);
    state = localData.snapshot();
    formDirty = false;
    patchRequestItemRow(request.id, productId);
    playRowPurchaseAnimation(productId, "is-just-unbought");
    if (!line) return;
    const saved = { ...line };
    showToast("Отметка покупки снята.", "Отменить", () => {
      applyInlinePurchase(request.id, productId, saved);
      playRowPurchaseAnimation(productId, "is-just-bought");
    });
  }

  function playRowPurchaseAnimation(productId, className) {
    const row = [...document.querySelectorAll(".request-item")].find((element) => element.dataset.productId === productId);
    if (!row) return;
    row.classList.remove("is-just-bought", "is-just-unbought");
    void row.offsetWidth;
    row.classList.add(className);
    window.setTimeout(() => row.classList.remove(className), 700);
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
    if (!marked.ok) return showToast(marked.reason);
    state = localData.snapshot();
    formDirty = false;
    patchRequestItemRow(requestId, marked.productId || productId);
  }

  function undoLatestPurchaseForProduct(requestId, productId) {
    const unmarked = localData.unmarkBought(requestId, productId);
    if (!unmarked.ok) return showToast(unmarked.reason);
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
    row.querySelector(".request-swipe-handle[role=checkbox]")?.setAttribute("aria-checked", String(fullyBought));
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
      if (!silent || saved.storageFailed) showToast(saved.reason);
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

  const RATION_STATE_LABELS = {
    unmarked: "не отмечено",
    eaten: "съедено",
    changed: "изменено",
    skipped: "не съедено",
  };

  function renderRation(focusItemId = "") {
    // Marking a meal or editing a day re-renders the feed in place: keep its scroll.
    const top = app.scrollTop;
    const today = todayDateKey();
    const mode = pageModes.ration;
    rationHeaderPicker.innerHTML = "";
    app.innerHTML = `
      <div class="ration-feed" data-mode="${mode}">
        ${mode === "plan" ? rationPlanFeed(today) : rationLogFeed(today)}
      </div>
      ${mode === "log" ? rationMealDialog(rationMealDate || today) : ""}
      ${rationPortionDialog()}
      ${mode === "plan" ? rationRequestDialog(today) : ""}
    `;
    app.scrollTop = top;
    bindRation(today);
    if (focusItemId) document.querySelector(`.ration-food-row[data-item-id="${focusItemId}"] .ration-food-input`)?.focus();
  }

  // Учёт: the «Сегодня» card, then past days in reverse order.
  function rationLogFeed(today) {
    const day = rationDayFor(state, today) || { date: today, meals: [] };
    const historyDay = readRationHistoryDay(state, today);
    const nutrition = readRationDayNutrition(state, today);
    const profile = state.ration?.profile || {};
    const meals = rationSortedMeals(day);
    const pastDates = Array.from({ length: feedDays.ration.log }, (_, index) => addRationDays(today, -(index + 1)));
    return `
      <section class="ration-today ration-day-card" data-date="${today}">
        <header class="ration-today-header">
          <div class="ration-today-date">
            <span>Сегодня · ${rationWeekday(today)}</span>
            <h2>${rationDayMonth(today)}</h2>
          </div>
          <div class="ration-today-totals">
            <strong>${number(nutrition.totals.calories)} ккал</strong>
            <span>Б ${number(nutrition.totals.protein)} · Ж ${number(nutrition.totals.fat)} · У ${number(nutrition.totals.carbs)}</span>
            ${Number(profile.targetCalories)
              ? `<em>Цель ${number(profile.targetCalories)} ккал</em>`
              : `<button id="ration-set-goal" class="text-button ration-set-goal" type="button">Задать цель</button>`}
          </div>
        </header>
        <div class="ration-today-meals">
          ${meals.length ? meals.map((meal) => rationTodayMealCard(today, meal, historyDay, nutrition)).join("") : `<p class="ration-today-empty muted">На сегодня приёмов пока нет. Добавьте первый приём пищи или переключитесь на План.</p>`}
        </div>
        <button id="ration-add-meal" class="keep-add-item" type="button"><span>＋</span> Добавить приём пищи</button>
      </section>
      ${pastDates.map((dateKey) => rationPastDayCard(dateKey, today)).join("")}
      <button class="feed-more" data-page="ration" type="button">Показать ещё</button>
    `;
  }

  // План: tomorrow first, then the following days.
  function rationPlanFeed(today) {
    const dates = Array.from({ length: feedDays.ration.plan }, (_, index) => addRationDays(today, index + 1));
    return `
      ${dates.map((dateKey) => rationPlanDayCard(dateKey, today)).join("")}
      <button class="feed-more" data-page="ration" type="button">Показать ещё</button>
    `;
  }

  function rationSortedMeals(day) {
    return [...(day?.meals || [])].sort((a, b) => rationMealTime(a).localeCompare(rationMealTime(b)));
  }

  function rationDayLabel(dateKey, today) {
    if (dateKey === addRationDays(today, 1)) return `Завтра · ${rationWeekday(dateKey)}`;
    if (dateKey === addRationDays(today, -1)) return `Вчера · ${rationWeekday(dateKey)}`;
    return rationWeekday(dateKey);
  }

  function rationPastDayCard(dateKey, today) {
    const day = rationDayFor(state, dateKey);
    const record = readRationHistoryDay(state, dateKey);
    const meals = rationSortedMeals(day);
    const counts = { eaten: 0, changed: 0, skipped: 0 };
    meals.forEach((meal) => {
      const mealState = record?.meals?.[meal.id]?.state;
      if (counts[mealState] != null) counts[mealState] += 1;
    });
    const summary = counts.eaten + counts.changed + counts.skipped
      ? `Съедено ${counts.eaten} · изменено ${counts.changed} · не съедено ${counts.skipped}`
      : "Нет отметок";
    const rows = meals.map((meal) => {
      const mealRecord = record?.meals?.[meal.id] || {};
      const stateKey = RATION_STATE_LABELS[mealRecord.state] ? mealRecord.state : "unmarked";
      const shift = Number(mealRecord.transferredMinutes) || 0;
      const discrepancies = (mealRecord.discrepancies || []).length;
      return `<button class="ration-past-meal state-${stateKey}" data-date="${dateKey}" data-meal-id="${meal.id}" type="button" aria-label="Открыть приём пищи ${escapeAttr(meal.name)}, ${rationDayMonth(dateKey)}">
        <span class="meal-event-time">${shiftedRationMealTime(rationMealTime(meal), shift)}</span>
        <strong>${escapeHtml(meal.name)}</strong>
        <span class="ration-state-chip">${RATION_STATE_LABELS[stateKey]}</span>
        ${discrepancies ? `<small>Расхождений: ${discrepancies}</small>` : ""}
      </button>`;
    }).join("");
    return `<article class="ration-day-card ration-past-day" data-date="${dateKey}">
      <header class="ration-day-card-header">
        <div class="ration-day-card-date"><span>${rationDayLabel(dateKey, today)}</span><h3>${rationDayMonth(dateKey)}</h3></div>
        ${meals.length ? `<small class="ration-day-card-summary">${summary}</small>` : ""}
      </header>
      ${meals.length ? `<div class="ration-past-meals">${rows}</div>` : `<p class="muted ration-day-card-empty">Приёмов пищи не было.</p>`}
    </article>`;
  }

  function rationPlanDayCard(dateKey, today) {
    const day = rationDayFor(state, dateKey);
    const meals = rationSortedMeals(day);
    const nutrition = meals.length ? readRationDayNutrition(state, dateKey) : null;
    const expanded = rationPlanDate === dateKey;
    const summary = meals.map((meal) => {
      const kcal = nutrition.perMeal.find((entry) => entry.mealId === meal.id)?.calories || 0;
      const products = (meal.items || []).map((item) => getProduct(item.productId)?.name || item.name).filter(Boolean).join(", ");
      return `<li>
        <span class="meal-event-time">${rationMealTime(meal)}</span>
        <div><strong>${escapeHtml(meal.name)}</strong>${products ? `<small>${escapeHtml(products)}</small>` : ""}</div>
        ${kcal ? `<em>${number(kcal)} ккал</em>` : ""}
      </li>`;
    }).join("");
    const body = expanded
      ? `${rationNutritionGaps(dateKey)}${rationDayEditor(dateKey, false)}${rationRepeatActions(dateKey)}`
      : meals.length ? `<ul class="ration-plan-meals">${summary}</ul>` : `<p class="muted ration-day-card-empty">Приёмов пока нет.</p>`;
    return `<article class="ration-day-card ration-plan-day${expanded ? " expanded" : ""}" data-date="${dateKey}">
      <header class="ration-day-card-header">
        <div class="ration-day-card-date">
          <span>${rationDayLabel(dateKey, today)}${day?.source === "special" ? " · Особый день" : ""}</span>
          <h3>${rationDayMonth(dateKey)}</h3>
        </div>
        ${nutrition?.totals.calories ? `<div class="ration-day-card-totals">
          <strong>${number(nutrition.totals.calories)} ккал</strong>
          <span>Б ${number(nutrition.totals.protein)} · Ж ${number(nutrition.totals.fat)} · У ${number(nutrition.totals.carbs)}</span>
        </div>` : ""}
      </header>
      ${body}
      <button class="ration-plan-edit text-button" data-date="${dateKey}" type="button" aria-expanded="${expanded}">${expanded ? "Готово" : "Изменить"}</button>
    </article>`;
  }

  function rationNutritionGaps(dateKey) {
    const gaps = new Set(readRationDayNutrition(state, dateKey).missing.map((entry) => entry.itemId)).size;
    return gaps ? `<p class="muted ration-plan-gaps">Нет данных о КБЖУ для ${gaps} поз.</p>` : "";
  }

  function rationRequestDialog(today) {
    return `<dialog id="ration-request-dialog" class="answer-dialog ration-request-dialog">
      <form id="ration-plan-request">
        <h2>Запросить продукты</h2>
        <p class="muted">Продукты выбранных дней попадут в новый запрос, количества округлятся до упаковок.</p>
        <div class="ration-request-fields">
          <label><span>С</span><input id="ration-request-from" type="date" value="${addRationDays(today, 1)}"></label>
          <label><span>По</span><input id="ration-request-to" type="date" value="${addRationDays(today, 7)}"></label>
        </div>
        <button class="button full" type="submit">Создать запрос</button>
        <button id="cancel-ration-request" class="text-button dialog-cancel" type="button">Отмена</button>
      </form>
    </dialog>`;
  }

  function openRationRequestDialog() {
    const dialog = document.getElementById("ration-request-dialog");
    if (!dialog || dialog.open) return;
    dialog.showModal();
  }

  function shiftedRationMealTime(time, minutes) {
    if (!minutes) return time;
    const total = timeMinutesOf(time) + minutes;
    const wrapped = (total % 1440 + 1440) % 1440;
    return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
  }

  function timeMinutesOf(time) {
    const match = String(time || "").match(/^(\d{1,2}):(\d{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
  }

  function rationTodayMealCard(dateKey, meal, historyDay, nutrition) {
    const record = historyDay?.meals?.[meal.id] || {};
    const stateKey = RATION_STATE_LABELS[record.state] ? record.state : "unmarked";
    const shift = Number(record.transferredMinutes) || 0;
    const time = shiftedRationMealTime(rationMealTime(meal), shift);
    const mealTotals = nutrition.perMeal.find((entry) => entry.mealId === meal.id)
      || { calories: 0, protein: 0, fat: 0, carbs: 0 };
    const rows = (meal.items || []).map((item) => {
      const product = getProduct(item.productId);
      const measure = rationMeasure(product);
      const portion = Number(item.portionSize) || measure.defaultPortion;
      return `<li>${escapeHtml(product?.name || item.name || "Продукт")}<small>${number(portion)} ${measure.unit}</small></li>`;
    }).join("");
    return `<article class="ration-today-meal state-${stateKey}" data-meal-id="${meal.id}">
      <header class="ration-today-meal-header">
        <span class="meal-event-time">${time}${shift ? `<small>${shift > 0 ? "+" : ""}${shift} мин</small>` : ""}</span>
        <button class="ration-today-meal-open" data-meal-id="${meal.id}" type="button" aria-label="Открыть приём пищи ${escapeAttr(meal.name)}">
          <strong>${escapeHtml(meal.name)}</strong>
          <span class="ration-state-chip">${RATION_STATE_LABELS[stateKey]}</span>
          <small>${number(mealTotals.calories)} ккал · Б ${number(mealTotals.protein)} · Ж ${number(mealTotals.fat)} · У ${number(mealTotals.carbs)}</small>
        </button>
        <button class="ration-eat-button ${stateKey === "eaten" ? "done" : ""}" data-meal-id="${meal.id}" type="button" aria-label="${stateKey === "eaten" ? "Снять отметку" : "Отметить съедено"}">${stateKey === "eaten" ? "✓" : "Съесть"}</button>
      </header>
      ${(meal.items || []).length ? `<ul class="ration-today-items">${rows}</ul>` : ""}
    </article>`;
  }

  function rationRepeatActions(dateKey) {
    return `<div class="ration-repeat">
      <button class="button secondary ration-repeat-button" data-date="${dateKey}" data-length="1" type="button">Повторять этот день каждый день</button>
      <button class="button secondary ration-repeat-button" data-date="${dateKey}" data-length="7" type="button">Повторять эту неделю</button>
    </div>`;
  }

  // In a past meal card the plan is read-only: only the ate-it checks remain.
  function rationPastMealItems(dateKey, meal, record) {
    const rows = (meal.items || []).map((item) => {
      const product = getProduct(item.productId);
      const name = product?.name || item.name || "Продукт";
      const measure = rationMeasure(product);
      const portion = Number(item.portionSize) || measure.defaultPortion;
      return `<div class="ration-food-row ration-food-row-past" data-item-id="${item.id}">
        ${rationEatenCheck(record, item, name)}
        <span class="ration-food-name">${escapeHtml(name)}</span>
        <small>${number(portion)} ${measure.unit}</small>
      </div>`;
    }).join("");
    return `<article class="ration-meal ration-meal-past" data-date="${dateKey}" data-meal-id="${meal.id}">
      <div class="ration-food-list">${rows || `<p class="muted">В приёме не было продуктов.</p>`}</div>
    </article>`;
  }

  function rationDiscrepancyLabel(item) {
    const product = getProduct(item.productId)?.name || item.name || "";
    if (item.kind === "excluded") return `Исключён: ${product}`;
    if (item.kind === "added") return `Добавлен: ${item.replacedName || product}${item.amount ? `, ${number(item.amount)} ${item.measureUnit || ""}` : ""}`;
    if (item.kind === "replaced") return `Заменён: ${product} → ${getProduct(item.replacedProductId)?.name || item.replacedName || ""}`;
    if (item.kind === "amount") return `Съедено ${number(item.amount)} ${item.measureUnit || ""} вместо порции: ${product}`;
    return "Расхождение";
  }

  const RATION_DISCREPANCY_OPTIONS = [
    ["excluded", "Не ел продукт"],
    ["replaced", "Заменил продукт"],
    ["amount", "Съел другое количество"],
    ["added", "Добавил продукт"],
  ];

  function liveProductByName(name) {
    const key = normalizeProductName(name);
    return key ? state.products.find((product) => !product.deletedAt && normalizeProductName(product.name) === key) : null;
  }

  function rationDiscrepancyEditor(dateKey, meal, record) {
    const items = (meal.items || []).filter((item) => item.productId);
    const discrepancies = record?.discrepancies || [];
    const list = discrepancies.map((item, index) => {
      const label = rationDiscrepancyLabel(item);
      return `<li><span>${escapeHtml(label)}</span><button class="ration-discrepancy-remove" data-date="${dateKey}" data-meal-id="${meal.id}" data-index="${index}" type="button" aria-label="Удалить запись: ${escapeAttr(label)}">×</button></li>`;
    }).join("");
    const kinds = RATION_DISCREPANCY_OPTIONS.filter(([kind]) => kind === "added" || items.length);
    return `<section class="ration-discrepancies">
      <h3>Расхождения с планом</h3>
      ${list ? `<ul class="ration-history-discrepancies">${list}</ul>` : `<p class="muted">Расхождений нет.</p>`}
      <form class="ration-discrepancy-form" data-date="${dateKey}" data-meal-id="${meal.id}">
        <select name="kind" aria-label="Вид расхождения">${kinds.map(([kind, label]) => `<option value="${kind}">${label}</option>`).join("")}</select>
        <select name="itemId" aria-label="Продукт из плана">${items.map((item) => `<option value="${item.id}">${escapeHtml(getProduct(item.productId)?.name || item.name || "Продукт")}</option>`).join("")}</select>
        <input name="name" autocomplete="off" aria-label="Продукт">
        <input name="amount" type="number" min="0" step="any" inputmode="decimal" aria-label="Количество">
        <button class="button secondary" type="submit">Записать</button>
      </form>
    </section>`;
  }

  function syncRationDiscrepancyForm(form) {
    const kind = form.elements.kind.value;
    const meal = rationDayFor(state, form.dataset.date)?.meals.find((value) => value.id === form.dataset.mealId);
    const item = meal?.items?.find((value) => value.id === form.elements.itemId.value);
    const unit = rationMeasure(kind === "added" ? liveProductByName(form.elements.name.value) : getProduct(item?.productId)).unit;
    form.elements.itemId.hidden = kind === "added";
    form.elements.name.hidden = kind !== "replaced" && kind !== "added";
    form.elements.name.placeholder = kind === "added" ? "Что добавили" : "Чем заменили";
    form.elements.amount.hidden = kind !== "amount" && kind !== "added";
    form.elements.amount.placeholder = kind === "amount" ? `Сколько съели, ${unit}` : `Сколько, ${unit} (необязательно)`;
  }

  function rationDiscrepancyFromForm(form) {
    const kind = form.elements.kind.value;
    const meal = rationDayFor(state, form.dataset.date)?.meals.find((value) => value.id === form.dataset.mealId);
    const item = meal?.items?.find((value) => value.id === form.elements.itemId.value);
    const name = form.elements.name.value.trim();
    const amount = Number(form.elements.amount.value);
    const discrepancy = { kind };
    if (kind !== "added") {
      if (!item) return { error: "Выберите продукт из плана." };
      discrepancy.productId = item.productId;
      discrepancy.name = getProduct(item.productId)?.name || item.name || "";
    }
    if ((kind === "replaced" || kind === "added") && !name) {
      return { error: kind === "added" ? "Укажите, что добавили." : "Укажите, чем заменили." };
    }
    if (kind === "replaced") {
      discrepancy.replacedName = name;
      const replacement = liveProductByName(name);
      if (replacement) discrepancy.replacedProductId = replacement.id;
    }
    if (kind === "added") {
      discrepancy.name = name;
      const added = liveProductByName(name);
      if (added) discrepancy.productId = added.id;
    }
    if (kind === "amount" && !(amount > 0)) return { error: "Укажите, сколько съели." };
    if ((kind === "amount" || kind === "added") && amount > 0) {
      discrepancy.amount = amount;
      discrepancy.measureUnit = rationMeasure(getProduct(discrepancy.productId)).unit;
    }
    return { discrepancy };
  }

  function bindRationEatenChecks() {
    document.querySelectorAll("#ration-meal-dialog .ration-item-check").forEach((input) => {
      input.addEventListener("change", (event) => {
        // A recorded discrepancy is saved at once; it is not an unsaved dialog edit.
        event.stopPropagation();
        const row = input.closest(".ration-food-row");
        const mealNode = input.closest(".ration-meal");
        const date = mealNode?.dataset.date;
        const mealId = mealNode?.dataset.mealId;
        const item = rationDayFor(state, date)?.meals.find((value) => value.id === mealId)?.items?.find((value) => value.id === row?.dataset.itemId);
        if (!item?.productId) return;
        const name = getProduct(item.productId)?.name || item.name || "";
        const record = readRationHistoryDay(state, date)?.meals?.[mealId];
        const result = input.checked
          ? localData.removeRationDiscrepancy(date, mealId, rationExcludedIndex(record, item.productId))
          : localData.recordRationDiscrepancy(date, mealId, { kind: "excluded", productId: item.productId, name });
        if (!applyLocal(result)) {
          input.checked = !input.checked;
          return;
        }
        renderRation();
        showToast(input.checked ? `«${name}» съеден по плану.` : `Записано: не ел «${name}».`);
      });
    });
  }

  function bindRationDiscrepancies() {
    document.querySelectorAll(".ration-discrepancy-form").forEach((form) => {
      syncRationDiscrepancyForm(form);
      form.elements.kind.addEventListener("change", (event) => {
        // Switching the kind alone is not an unsaved change of the dialog.
        event.stopPropagation();
        syncRationDiscrepancyForm(form);
      });
      form.elements.itemId.addEventListener("change", () => syncRationDiscrepancyForm(form));
      form.elements.name.addEventListener("input", () => syncRationDiscrepancyForm(form));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const { discrepancy, error } = rationDiscrepancyFromForm(form);
        if (error) return showToast(error);
        const result = localData.recordRationDiscrepancy(form.dataset.date, form.dataset.mealId, discrepancy);
        if (!applyLocal(result)) return;
        renderRation();
        showToast("Расхождение записано.");
      });
    });
    document.querySelectorAll(".ration-discrepancy-remove").forEach((button) => {
      button.onclick = () => {
        const result = localData.removeRationDiscrepancy(button.dataset.date, button.dataset.mealId, Number(button.dataset.index));
        if (!applyLocal(result)) return;
        renderRation();
        showToast("Запись о расхождении удалена.");
      };
    });
  }

  function rationMealTime(meal, index = 0) {
    return /^\d{2}:\d{2}$/.test(meal?.time || "") ? meal.time : ["08:00", "13:00", "19:00"][index] || `${String(Math.min(22, 8 + index * 3)).padStart(2, "0")}:00`;
  }

  function rationMealDialog(dateKey) {
    if (!routeSubId) return "";
    const day = rationDayFor(state, dateKey) || { date: dateKey, meals: [] };
    const meal = day.meals.find((value) => value.id === routeSubId);
    if (!meal) return "";
    const record = readRationHistoryDay(state, dateKey)?.meals?.[meal.id] || { state: "unmarked", discrepancies: [] };
    const stateKey = RATION_STATE_LABELS[record.state] ? record.state : "unmarked";
    const isPast = dateKey < todayDateKey();
    return `<dialog id="ration-meal-dialog" class="ration-meal-dialog" data-date="${dateKey}">
      <header><div><span>${capitalize(rationLongDate(dateKey))}</span><h2>${escapeHtml(meal.name)}</h2></div><button id="close-ration-meal" type="button" aria-label="Закрыть">×</button></header>
      <div class="ration-meal-states">
        ${["eaten", "changed", "skipped", "unmarked"].map((value) => `<button class="ration-state-set ${stateKey === value ? "active" : ""}" data-date="${dateKey}" data-meal-id="${meal.id}" data-state="${value}" type="button">${RATION_STATE_LABELS[value]}</button>`).join("")}
      </div>
      ${isPast ? `<p class="muted">Прошлые отметки можно исправить; план этого дня не меняется.</p>` : `<div class="ration-meal-transfer">
        <span>Перенести</span>
        ${[-60, -15, 15, 60].map((delta) => `<button class="ration-transfer-button" data-meal-id="${meal.id}" data-delta="${delta}" type="button">${delta > 0 ? "+" : ""}${delta}</button>`).join("")}
      </div>`}
      ${rationDiscrepancyEditor(dateKey, meal, record)}
      ${isPast ? rationPastMealItems(dateKey, meal, record) : rationMealEditor(dateKey, meal, day.meals.length, record)}
    </dialog>`;
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

  function rationDayEditor(dateKey, showHeading) {
    const day = rationDayFor(state, dateKey) || { date: dateKey, meals: [] };
    return `
      <div class="ration-day-editor" data-date="${dateKey}">
        ${showHeading ? `<h2 class="ration-day-title">${capitalize(rationLongDate(dateKey))}</h2>` : ""}
        <div class="ration-meals">${day.meals.map((meal) => rationMealEditor(dateKey, meal, day.meals.length)).join("")}</div>
        <button class="add-ration-meal keep-add-item" data-date="${dateKey}" type="button"><span>＋</span> Добавить приём пищи</button>
      </div>`;
  }

  // `record` is the meal's history entry. It is passed only where the meal
  // already happened or happens today, so rows can offer the "ate it" checkbox.
  function rationMealEditor(dateKey, meal, mealCount, record = null) {
    const mealIndex = (rationDayFor(state, dateKey)?.meals || []).findIndex((value) => value.id === meal.id);
    return `
      <article class="ration-meal" data-date="${dateKey}" data-meal-id="${meal.id}">
        <header class="ration-meal-header">
          <input class="ration-meal-time" type="time" value="${rationMealTime(meal, Math.max(0, mealIndex))}" aria-label="Плановое время">
          <input class="ration-meal-name" value="${escapeAttr(meal.name)}" aria-label="Название приёма пищи">
          <button class="remove-ration-meal" type="button" aria-label="Удалить приём пищи ${escapeAttr(meal.name)}">×</button>
        </header>
        <div class="ration-food-list">
          ${(meal.items || []).map((item) => rationFoodRow(dateKey, meal.id, item, record)).join("")}
        </div>
        <button class="add-ration-food keep-add-item" type="button"><span>＋</span> Добавить продукт</button>
      </article>`;
  }

  function rationExcludedIndex(record, productId) {
    if (!productId) return -1;
    return (record?.discrepancies || []).findIndex((value) => value.kind === "excluded" && value.productId === productId);
  }

  function rationEatenCheck(record, item, name) {
    if (!record) return "";
    if (!item.productId) return `<span aria-hidden="true"></span>`;
    const eaten = rationExcludedIndex(record, item.productId) < 0;
    return `<input class="ration-item-check" type="checkbox" ${eaten ? "checked" : ""} aria-label="Съел: ${escapeAttr(name || "продукт")}">`;
  }

  function rationFoodRow(dateKey, mealId, item, record = null) {
    const product = getProduct(item.productId);
    const value = product?.name || item.name || "";
    const listId = `ration-products-${item.id}`;
    const measure = rationMeasure(product);
    const portion = Number(item.portionSize) || measure.defaultPortion;
    return `
      <div class="ration-food-row${record ? "" : " no-check"}" data-item-id="${item.id}">
        ${rationEatenCheck(record, item, value)}
        <input class="ration-food-input" list="${listId}" value="${escapeAttr(value)}" placeholder="Продукт" autocomplete="off">
        <datalist id="${listId}">${productSuggestionOptions(value)}</datalist>
        <button class="save-ration-food" type="button" aria-label="Сохранить ${escapeAttr(value || "продукт")}">✓</button>
        <button class="ration-portion-button" type="button" aria-label="Настроить порцию ${escapeAttr(product?.name || item.query || "продукта")}">${number(portion)} ${measure.unit}</button>
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

  function bindRation(today) {
    document.querySelectorAll(".ration-today-meal-open").forEach((button) => {
      button.onclick = () => {
        routeSubId = button.dataset.mealId;
        rationMealDate = today;
        renderRation();
      };
    });
    document.querySelectorAll(".ration-past-meal").forEach((button) => {
      button.onclick = () => {
        routeSubId = button.dataset.mealId;
        rationMealDate = button.dataset.date;
        renderRation();
      };
    });
    document.querySelectorAll(".ration-plan-edit").forEach((button) => {
      button.onclick = () => {
        rationPlanDate = rationPlanDate === button.dataset.date ? "" : button.dataset.date;
        renderRation();
      };
    });
    document.querySelectorAll(".feed-more").forEach((button) => {
      button.onclick = () => {
        const mode = pageModes[button.dataset.page];
        feedDays[button.dataset.page][mode] = Math.min(feedDays[button.dataset.page][mode] + FEED_STEP, 366);
        render();
      };
    });
    document.querySelectorAll(".ration-eat-button").forEach((button) => {
      button.onclick = () => {
        const mealId = button.dataset.mealId;
        const current = readRationHistoryDay(state, today)?.meals?.[mealId]?.state;
        const result = localData.markRationMeal(today, mealId, current === "eaten" ? "unmarked" : "eaten");
        if (!applyLocal(result)) return showToast(result.reason);
        renderRation();
        showToast(current === "eaten" ? "Отметка снята." : "Приём пищи съеден.");
      };
    });
    document.querySelectorAll(".ration-state-set").forEach((button) => {
      button.onclick = () => {
        const result = localData.markRationMeal(button.dataset.date, button.dataset.mealId, button.dataset.state);
        if (!applyLocal(result)) return showToast(result.reason);
        renderRation();
      };
    });
    document.querySelectorAll(".ration-transfer-button").forEach((button) => {
      button.onclick = async () => {
        const delta = Number(button.dataset.delta);
        const shift = rationShiftFor(today, button.dataset.mealId, delta);
        if (shift.crossesMidnight && !await askConfirm("Перенос сдвигает приём пищи через полночь. Продолжить?")) return;
        const result = localData.transferRationMeals(today, button.dataset.mealId, delta, shift.crossesMidnight);
        if (!applyLocal(result)) return showToast(result.reason);
        renderRation();
        showToast("Приёмы пищи перенесены.");
      };
    });
    const requestDialog = document.getElementById("ration-request-dialog");
    document.getElementById("cancel-ration-request")?.addEventListener("click", () => requestDialog.close());
    document.getElementById("ration-plan-request")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const from = document.getElementById("ration-request-from").value;
      const to = document.getElementById("ration-request-to").value;
      if (!from || !to || from > to) return showToast("Проверьте диапазон дат.");
      const dates = [];
      let cursor = from;
      while (cursor <= to && dates.length < 60) {
        dates.push(cursor);
        cursor = addRationDays(cursor, 1);
      }
      const itemIds = dates.flatMap((dateKey) => (rationDayFor(state, dateKey)?.meals || [])
        .flatMap((meal) => (meal.items || []).filter((item) => item.productId).map((item) => item.id)));
      if (!itemIds.length) return showToast("В выбранных днях нет продуктов.");
      const created = localData.createRequestFromRation({ dates, itemIds });
      if (!applyLocal(created)) return showToast(created.reason);
      requestDialog.close();
      draftItems = [];
      navigate("request-edit", created.requestId);
      showToast("Продукты рациона добавлены в запрос.");
    });
    bindRationDiscrepancies();
    bindRationEatenChecks();
    document.querySelectorAll(".ration-repeat-button").forEach((button) => {
      button.onclick = async () => {
        const { date: from } = button.dataset;
        const week = button.dataset.length === "7";
        const message = week
          ? `С ${rationDayMonth(from)} план будет каждую неделю повторять семь дней, начиная с этого. Отдельно изменённые дни после этой даты сохранятся.`
          : `С ${rationDayMonth(from)} план будет каждый день повторять этот день. Отдельно изменённые дни после этой даты сохранятся.`;
        if (!await askConfirm(message)) return;
        const repeated = localData.repeatRationDays(from, week ? 7 : 1);
        if (!applyLocal(repeated)) return;
        renderRation();
        showToast(week ? "Неделя теперь повторяется." : "День теперь повторяется.", "Отменить", () => {
          if (!applyLocal(localData.undoRationRepeat(repeated.undo))) return;
          renderRation();
        });
      };
    });
    document.getElementById("ration-set-goal")?.addEventListener("click", () => {
      rationProfileReturn = "ration";
      navigate("ration-profile");
    });
    const addMeal = document.getElementById("ration-add-meal");
    if (addMeal) addMeal.onclick = () => {
      const added = localData.addRationMeal(today);
      if (!applyLocal(added)) return;
      routeSubId = added.mealId;
      rationMealDate = today;
      renderRation();
    };
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
    const mealDialog = document.getElementById("ration-meal-dialog");
    if (mealDialog) {
      mealDialog.dataset.dirty = "false";
      document.getElementById("close-ration-meal").onclick = () => closeDialogSafely(mealDialog);
      mealDialog.addEventListener("close", () => {
        routeSubId = null;
        rationMealDate = "";
        renderRation();
      });
      mealDialog.showModal();
    }
  }

  function rationShiftFor(dateKey, mealId, delta) {
    const day = rationDayFor(state, dateKey);
    const meal = day?.meals.find((value) => value.id === mealId);
    const shift = Number(readRationHistoryDay(state, dateKey)?.meals?.[mealId]?.transferredMinutes) || 0;
    const total = timeMinutesOf(rationMealTime(meal)) + shift + delta;
    return { crossesMidnight: total < 0 || total >= 1440 };
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

  function updateRationMealName(input) {
    const card = input.closest(".ration-meal");
    applyLocal(localData.updateRationMeal(card.dataset.date, card.dataset.mealId, { name: input.value }));
    renderRation();
  }

  function updateRationMealTime(input) {
    const card = input.closest(".ration-meal");
    applyLocal(localData.updateRationMeal(card.dataset.date, card.dataset.mealId, { time: input.value }));
    reopenRationMealCard(card);
    renderRation();
  }

  // Cycle days share meal ids across dates, so only an edit made inside the
  // meal card may reopen it; an edit in the План feed stays in the feed.
  function reopenRationMealCard(card) {
    if (!card.closest("#ration-meal-dialog")) return;
    routeSubId = card.dataset.mealId;
    rationMealDate = card.dataset.date;
  }

  async function removeRationMeal(button) {
    const card = button.closest(".ration-meal");
    const currentDay = rationDayFor(state, card.dataset.date);
    const currentMeal = currentDay?.meals.find((meal) => meal.id === card.dataset.mealId);
    const fromCard = Boolean(card.closest("#ration-meal-dialog"));
    if (!currentMeal || !await askConfirm(`Удалить приём пищи «${currentMeal.name}» и все его продукты?`)) return;
    const removed = localData.removeRationMeal(card.dataset.date, card.dataset.mealId);
    if (!applyLocal(removed)) return;
    routeSubId = null;
    renderRation();
    showToast(`Приём пищи «${currentMeal.name}» удалён.`, "Отменить", () => {
      if (!applyLocal(localData.undoRationRemoval(removed.undo))) return;
      if (fromCard) {
        routeSubId = currentMeal.id;
        rationMealDate = card.dataset.date;
      }
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
    const removed = localData.removeRationFood(card.dataset.date, card.dataset.mealId, row.dataset.itemId);
    if (!applyLocal(removed)) return;
    renderRation();
    showToast(`«${removedName}» удалён из рациона.`, "Отменить", () => {
      if (!applyLocal(localData.undoRationRemoval(removed.undo))) return;
      reopenRationMealCard(card);
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

  function addRationDays(value, count) {
    const date = parseRationDate(value);
    date.setDate(date.getDate() + count);
    return formatRationDate(date);
  }

  function rationWeekday(value) {
    const result = new Intl.DateTimeFormat("ru-RU", { weekday: "long" }).format(parseRationDate(value));
    return result.charAt(0).toUpperCase() + result.slice(1);
  }

  function rationShortDate(value) {
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(parseRationDate(value));
  }

  function rationShortWeekday(value) {
    return capitalize(new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(parseRationDate(value)));
  }

  function rationDayMonth(value) {
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(parseRationDate(value));
  }

  function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function rationLongDate(value) {
    return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(parseRationDate(value));
  }

  const RATION_AGE_GROUPS = ["Ребёнок", "Подросток", "Взрослый", "Пожилой"];
  const RATION_GOALS = ["Снижение веса", "Поддержание веса", "Набор массы"];
  const RATION_PROFILE_FIELDS = ["ageGroup", "goal", "heightCm", "weightKg", "mealsPerDay", "budget", "schedule",
    "preferences", "targetCalories", "targetProtein", "targetFat", "targetCarbs"];
  const RATION_PROFILE_LABELS = {
    ageGroup: "возрастная группа",
    heightCm: "рост",
    weightKg: "вес",
    goal: "цель",
    mealsPerDay: "приёмов пищи в день",
    targetCalories: "калории в день",
    targetProtein: "белки",
    targetFat: "жиры",
    targetCarbs: "углеводы",
    macroMismatch: "БЖУ расходятся с калориями больше чем на 15%",
  };

  function rationProfileSummary(profile) {
    if (!Number(profile?.targetCalories)) return "Цель по калориям не задана.";
    const macros = [["Б", profile.targetProtein], ["Ж", profile.targetFat], ["У", profile.targetCarbs]]
      .filter(([, value]) => value != null)
      .map(([label, value]) => `${label} ${number(value)}`);
    return [`Цель ${number(profile.targetCalories)} ккал`, ...macros].join(" · ");
  }

  function rationProfileSection() {
    const profile = state.ration?.profile || {};
    return `
      <section class="section profile-ration">
        <span class="eyebrow">Рацион</span>
        <h2 class="profile-section-title">Профиль рациона</h2>
        <p class="muted">${escapeHtml(rationProfileSummary(profile))}</p>
        <button id="edit-ration-profile" class="button secondary full" type="button">${Number(profile.targetCalories) ? "Изменить профиль" : "Заполнить профиль"}</button>
      </section>
    `;
  }

  function rationProfileLabels(keys) {
    return keys.map((key) => RATION_PROFILE_LABELS[key] || key);
  }

  function renderRationProfileForm() {
    const profile = state.ration?.profile || {};
    const numberField = (label, name, attrs) => `<label class="field"><span>${label}</span><input name="${name}" type="number" inputmode="decimal" ${attrs} value="${profile[name] ?? ""}"></label>`;
    const selectField = (label, name, options) => `<label class="field"><span>${label}</span><select name="${name}">
      <option value="">Не выбрано</option>
      ${options.map((option) => `<option ${option === profile[name] ? "selected" : ""}>${option}</option>`).join("")}
      ${profile[name] && !options.includes(profile[name]) ? `<option selected>${escapeHtml(profile[name])}</option>` : ""}
    </select></label>`;
    app.innerHTML = `
      <form id="ration-profile-form" class="form">
        <p class="muted">Профиль задаёт цели для КБЖУ и хранится только на этом устройстве.</p>
        <p id="ration-profile-status" class="muted" role="status"></p>
        ${selectField("Возрастная группа", "ageGroup", RATION_AGE_GROUPS)}
        ${selectField("Цель", "goal", RATION_GOALS)}
        <div class="nutrition-grid">
          ${numberField("Рост, см", "heightCm", 'min="1" max="300" step="0.1"')}
          ${numberField("Вес, кг", "weightKg", 'min="1" max="1000" step="0.1"')}
          ${numberField("Приёмов пищи в день", "mealsPerDay", 'min="1" max="12" step="1"')}
          ${numberField("Бюджет на неделю, ₽", "budget", 'min="0" step="1"')}
        </div>
        <label class="field"><span>Расписание</span><input name="schedule" autocomplete="off" placeholder="Например: завтрак 8:00, обед 13:00, ужин 19:00" value="${escapeAttr(profile.schedule || "")}"></label>
        <label class="field"><span>Предпочтения</span><textarea name="preferences" rows="2" placeholder="Например: больше овощей, без острого">${escapeHtml(profile.preferences || "")}</textarea></label>
        <label class="field"><span>Исключённые продукты</span><input name="excludedProducts" autocomplete="off" placeholder="Через запятую" value="${escapeAttr((profile.excludedProducts || []).join(", "))}"></label>
        <section class="nutrition-editor">
          <h2 class="section-title">Цели на день</h2>
          <div class="nutrition-grid">
            ${numberField("Ккал", "targetCalories", 'min="0" step="1"')}
            ${numberField("Белки, г", "targetProtein", 'min="0" step="0.1"')}
            ${numberField("Жиры, г", "targetFat", 'min="0" step="0.1"')}
            ${numberField("Углеводы, г", "targetCarbs", 'min="0" step="0.1"')}
          </div>
        </section>
      </form>
    `;
    document.getElementById("ration-profile-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const fields = Object.fromEntries(RATION_PROFILE_FIELDS.map((name) => [name, String(data.get(name) || "").trim()]));
      fields.excludedProducts = String(data.get("excludedProducts") || "").split(",").map((value) => value.trim()).filter(Boolean);
      const violations = rationProfileLabels(validateRationProfile(fields).violations);
      if (violations.length) {
        const status = document.getElementById("ration-profile-status");
        status.className = "error";
        status.textContent = `Проверьте: ${violations.join(", ")}.`;
        app.scrollTop = 0;
        return;
      }
      const saved = localData.setRationProfile(fields);
      if (!applyLocal(saved)) return;
      const missing = rationProfileLabels(saved.validation.missing);
      formDirty = false;
      navigate(rationProfileReturn);
      showToast(missing.length ? `Профиль сохранён. Не заполнено: ${missing.join(", ")}.` : "Профиль рациона сохранён.");
    });
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

  // Before the first request to the provider the person sees, once, which
  // data leaves the device and where it goes.
  async function ensureAiConsent() {
    if (aiConsent.accepted()) return true;
    if (!await askConfirm(AI_CONSENT_TEXT, "Понятно, продолжить")) return false;
    aiConsent.accept();
    return true;
  }

  function aiKeySection() {
    const saved = Boolean(aiKey.read());
    const status = aiKeyStatus.text || (saved ? "Ключ сохранён на этом устройстве." : "Ключ не задан: ассистент недоступен.");
    return `
      <section class="section profile-ai">
        <span class="eyebrow">Ассистент</span>
        <h2 class="profile-section-title">Ключ ИИ (тест)</h2>
        <p class="muted">Временное поле на время теста. Ключ хранится только на этом устройстве, отдельно от данных приложения.</p>
        <label class="field"><span>Ключ routerai.ru</span>
          <input id="ai-key-input" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${saved ? "Ключ сохранён · введите новый, чтобы заменить" : "Вставьте ключ"}">
        </label>
        <p id="ai-key-status" class="${aiKeyStatus.tone}" role="status">${escapeHtml(status)}</p>
        <div class="button-row">
          <button id="ai-key-check" class="button secondary" type="button" ${aiKeyStatus.busy ? "disabled" : ""}>${aiKeyStatus.busy ? "Проверяем…" : "Проверить"}</button>
          <button id="ai-key-delete" class="button danger" type="button" ${saved && !aiKeyStatus.busy ? "" : "disabled"}>Удалить</button>
        </div>
      </section>`;
  }

  function strictnessSection() {
    const settings = state.assistant?.settings || {};
    return `
      <section class="section profile-strictness">
        <span class="eyebrow">Ассистент</span>
        <h2 class="profile-section-title">Жёсткость</h2>
        <p class="muted">На какие отклонения от плана ассистент обращает ваше внимание. План он сам не меняет.</p>
        <div class="strictness-options" role="radiogroup" aria-label="Жёсткость">
          ${Object.entries(STRICTNESS_LEVELS).map(([value, level]) => `<label class="strictness-option">
            <input type="radio" name="strictness" value="${value}" ${settings.strictness === value ? "checked" : ""}>
            <span>${escapeHtml(level.label)}${value === "any" ? " · по умолчанию" : ""}</span>
          </label>`).join("")}
        </div>
        <label class="field"><span>Как реагировать (необязательно)</span>
          <textarea id="ai-how-to-react" rows="2" maxlength="600" placeholder="Например: коротко и без упрёков">${escapeHtml(settings.howToReact || "")}</textarea>
        </label>
      </section>`;
  }

  function bindStrictnessActions() {
    document.querySelectorAll(".profile-strictness input[name=strictness]").forEach((input) => {
      input.addEventListener("change", () => {
        if (applyLocal(localData.setAssistantSettings({ strictness: input.value }))) showToast("Жёсткость сохранена.");
      });
    });
    document.getElementById("ai-how-to-react")?.addEventListener("change", (event) => {
      if (applyLocal(localData.setAssistantSettings({ howToReact: event.target.value }))) showToast("Пожелание сохранено.");
    });
  }

  function setAiKeyStatus(text, tone = "muted", busy = false) {
    aiKeyStatus = { text, tone, busy };
    if (route !== "profile") return;
    const section = document.querySelector(".profile-ai");
    if (!section) return;
    const typed = document.getElementById("ai-key-input")?.value || "";
    section.outerHTML = aiKeySection();
    document.getElementById("ai-key-input").value = typed;
    bindAiKeyActions();
  }

  function bindAiKeyActions() {
    document.getElementById("ai-key-check")?.addEventListener("click", async () => {
      const input = document.getElementById("ai-key-input");
      const typed = input.value.trim();
      if (!typed && !aiKey.read()) return setAiKeyStatus("Введите ключ, чтобы проверить его.", "error");
      if (!await ensureAiConsent()) return;
      if (typed && !aiKey.write(typed)) return setAiKeyStatus("Не удалось сохранить ключ на устройстве.", "error");
      input.value = "";
      setAiKeyStatus("Проверяем ключ…", "muted", true);
      const result = await aiProvider.checkKey();
      setAiKeyStatus(result.ok ? "Ключ работает." : result.reason, result.ok ? "success" : "error");
      if (result.ok) nudgeWorker.schedule();
    });
    document.getElementById("ai-key-delete")?.addEventListener("click", async () => {
      if (!await askConfirm("Удалить ключ ИИ с этого устройства? Ассистент станет недоступен.", "Удалить ключ")) return;
      aiKey.clear();
      setAiKeyStatus("Ключ удалён.", "muted");
    });
  }

  function renderProfile() {
    app.innerHTML = `
      ${rationProfileSection()}
      ${aiKeySection()}
      ${strictnessSection()}
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
    bindAiKeyActions();
    bindStrictnessActions();
    document.getElementById("edit-ration-profile")?.addEventListener("click", () => {
      rationProfileReturn = "profile";
      navigate("ration-profile");
    });
    document.getElementById("check-app-update")?.addEventListener("click", () => requestAppUpdateCheck(true));
    document.getElementById("install-app-update")?.addEventListener("click", () => {
      window.NativeCookish?.installLatestUpdate?.();
    });
    document.getElementById("open-app-release")?.addEventListener("click", () => {
      if (appUpdate.releaseUrl) window.NativeCookish?.openUrl?.(appUpdate.releaseUrl);
    });
    document.getElementById("clear-data")?.addEventListener("click", async () => {
      if (!await askConfirm("Удалить продукты, запросы и настройки с этого устройства?")) return;
      try {
        state = localData.clear();
      } catch (error) {
        return showToast(error.message);
      }
      navigate("ration");
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

  function requestRow(request) {
    const summary = requestSummary(request);
    const price = isRequestFulfilled(request)
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

  // A modal dialog makes the rest of the page inert, so while one is open the
  // toast moves into it to keep «Отменить» clickable. Dialogs with a transform
  // would become the toast's containing block, so they are skipped.
  const toast = document.getElementById("toast");
  const toastMessage = document.getElementById("toast-message");
  const toastAction = document.getElementById("toast-action");

  function toastHost() {
    const dialog = [...document.querySelectorAll("dialog[open]")].pop();
    return dialog && getComputedStyle(dialog).transform === "none" ? dialog : document.body;
  }

  function hideToast() {
    clearTimeout(toastTimer);
    toast.classList.remove("show");
    toastAction.hidden = true;
    toastAction.onclick = null;
    document.body.append(toast);
  }

  function showToast(message, actionLabel = "", action = null) {
    toastHost().append(toast);
    toastMessage.textContent = message;
    toastAction.hidden = !actionLabel || typeof action !== "function";
    toastAction.textContent = actionLabel;
    toastAction.onclick = toastAction.hidden ? null : () => {
      hideToast();
      action();
    };
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 6000 : 3200);
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
    window.addEventListener("resize", syncGestureExclusion, { passive: true });
  }
  if (typeof window.visualViewport?.addEventListener === "function") {
    window.visualViewport.addEventListener("resize", queuePurchaseDialogViewportSync, { passive: true });
    window.visualViewport.addEventListener("scroll", queuePurchaseDialogViewportSync, { passive: true });
  }

  render();
  requestAppUpdateCheck(false);
  // Тычки queued before a restart or while offline go out when possible.
  nudgeWorker.schedule();
  window.addEventListener?.("online", () => nudgeWorker.schedule(1000));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden" && appUpdate.status === "installing") requestAppUpdateCheck(true);
  });
