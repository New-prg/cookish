(() => {
  "use strict";

  const STORAGE_KEY = "listok.android.data.v1";
  const defaultState = {
    products: [],
    requests: [],
    spreadsheetId: "",
    spreadsheetTitle: "",
    user: null,
    seenRemoteRequestIds: [],
    remoteTrackingInitialized: false,
  };

  let state = loadState();
  let route = "summary";
  let routeId = null;
  let draftItems = [];
  let accessToken = null;
  let authResolve = null;
  let toastTimer = null;
  let syncTimer = null;
  let syncInProgress = false;

  const app = document.getElementById("app");
  const title = document.getElementById("page-title");
  const headerAction = document.getElementById("header-action");
  const nav = document.querySelector(".bottom-nav");

  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.route));
  });

  headerAction.addEventListener("click", () => {
    if (route === "products") {
      navigate("product-new");
    } else if (route === "requests") {
      draftItems = [];
      navigate("request-new");
    } else if (route.includes("-new") || route.endsWith("-edit") || route === "request-detail" || route === "request-answer") {
      draftItems = [];
      navigate(route.startsWith("product") ? "products" : "requests");
    }
  });

  window.__onNativeGoogleAuth = (payload) => {
    const result = JSON.parse(payload);
    if (!authResolve) return;
    authResolve(result);
    authResolve = null;
  };

  function loadState() {
    try {
      const loaded = { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
      loaded.products = loaded.products.map((product) => ({
        ...product,
        quantity: Number(product.quantity) || 0,
        updatedAt: product.updatedAt || new Date(0).toISOString(),
        updatedBy: product.updatedBy || "local",
      }));
      loaded.requests = loaded.requests.map((request) => ({
        ...request,
        createdBy: request.createdBy || "local",
        updatedAt: request.updatedAt || request.completedAt || request.createdAt,
        updatedBy: request.updatedBy || request.createdBy || "local",
        items: request.items.map((item) => ({
          ...item,
          stockAtRequest: Number(item.stockAtRequest ?? loaded.products.find((product) => product.id === item.productId)?.quantity) || 0,
        })),
      }));
      return loaded;
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveState(sync = true) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    mirrorStateForBackgroundSync();
    if (sync) queueAutoSync();
  }

  function navigate(next, id = null) {
    route = next;
    routeId = id;
    window.scrollTo(0, 0);
    render();
  }

  function render() {
    const rootRoute = route.startsWith("product") ? "products"
      : route.startsWith("request") ? "requests"
      : route;
    document.querySelectorAll(".bottom-nav button").forEach((button) => {
      button.classList.toggle("active", button.dataset.route === rootRoute);
    });
    nav.hidden = route.includes("-new") || route.endsWith("-edit") || route === "request-answer";
    document.body.style.paddingBottom = nav.hidden ? "env(safe-area-inset-bottom)" : "";
    configureHeader();

    if (route === "summary") renderSummary();
    else if (route === "products") renderProducts();
    else if (route === "product-new") renderProductForm();
    else if (route === "product-edit") renderProductForm();
    else if (route === "requests") renderRequests();
    else if (route === "request-new") renderRequestForm();
    else if (route === "request-edit") renderRequestForm();
    else if (route === "request-detail") renderRequestDetail();
    else if (route === "request-answer") renderRequestAnswer();
    else if (route === "profile") renderProfile();
  }

  function configureHeader() {
    const config = {
      summary: ["Сводка", "", false],
      products: ["Продукты", "Добавить", false],
      "product-new": ["Новый продукт", "Отмена", true],
      "product-edit": ["Редактирование", "Отмена", true],
      requests: ["Запросы", "Создать", false],
      "request-new": ["Новый запрос", "Отмена", true],
      "request-edit": ["Редактирование", "Отмена", true],
      "request-detail": ["Запрос", "Назад", false],
      "request-answer": ["Закупка", "Отмена", true],
      profile: ["Профиль", "", false],
    }[route];
    title.textContent = config[0];
    headerAction.textContent = config[1];
    headerAction.hidden = !config[1];
  }

  function renderSummary() {
    const completed = state.requests.filter((item) => item.status === "done");
    const totals = completed.map(requestTotal);
    const total = totals.reduce((sum, value) => sum + value, 0);
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const last30 = completed
      .filter((item) => new Date(item.completedAt || item.createdAt).getTime() >= cutoff)
      .reduce((sum, item) => sum + requestTotal(item), 0);
    const active = state.requests.filter((item) => item.status === "open");

    app.innerHTML = `
      <div class="metrics">
        ${metric("Активные запросы", active.length)}
        ${metric("Средний чек", money(completed.length ? total / completed.length : 0))}
        ${metric("Траты за 30 дней", money(last30))}
        ${metric("Продукты", state.products.length)}
      </div>
      <section class="section">
        <h2 class="section-title">Активные запросы</h2>
        ${active.length ? active.map(requestRow).join("") : `<p class="empty">Нет активных запросов</p>`}
      </section>
      <section class="section">
        <button id="summary-new-request" class="button full" type="button">Создать запрос</button>
      </section>
    `;
    bindRequestRows();
    document.getElementById("summary-new-request").onclick = () => {
      draftItems = [];
      navigate("request-new");
    };
  }

  function renderProducts() {
    app.innerHTML = state.products.length
      ? state.products.map((product) => `
          <div class="row">
            <div class="row-main">
              <strong>${escapeHtml(product.name)}</strong>
              <span>${escapeHtml(product.category || "Без категории")} · ${escapeHtml(product.unit)}</span>
            </div>
            <div class="row-value"><strong>${number(product.quantity)} ${escapeHtml(product.unit)}</strong></div>
            <div>
              <button class="text-button edit-product" data-id="${product.id}" type="button">Изменить</button>
              <button class="text-button delete-product" data-id="${product.id}" type="button">Удалить</button>
            </div>
          </div>
        `).join("")
      : `<section class="section"><p class="empty">Продукты не добавлены</p></section>`;

    document.querySelectorAll(".delete-product").forEach((button) => {
      button.addEventListener("click", () => {
        const used = state.requests.some((request) => request.items.some((item) => item.productId === button.dataset.id));
        if (used) return showToast("Продукт используется в запросе.");
        state.products = state.products.filter((product) => product.id !== button.dataset.id);
        saveState();
        renderProducts();
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
        <label class="field"><span>Наименование</span><input name="name" required autocomplete="off" value="${escapeAttr(product?.name || "")}"></label>
        <label class="field"><span>Категория</span><input name="category" autocomplete="off" value="${escapeAttr(product?.category || "")}"></label>
        <label class="field"><span>Единица измерения</span>
          <select name="unit">
            ${["шт.", "кг", "г", "л", "уп."].map((unit) =>
              `<option value="${unit}" ${unit === product?.unit ? "selected" : ""}>${unit}</option>`
            ).join("")}
          </select>
        </label>
        <label class="field"><span>Текущий остаток</span><input name="quantity" type="number" min="0" step="0.01" value="${product?.quantity ?? 0}" required></label>
        <button class="button full" type="submit">Сохранить</button>
      </form>
    `;
    document.getElementById("product-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const values = {
        name: data.get("name").trim(),
        category: data.get("category").trim(),
        unit: data.get("unit"),
        quantity: Number(data.get("quantity")),
        updatedAt: new Date().toISOString(),
        updatedBy: state.user?.email || "local",
      };
      if (product) Object.assign(product, values);
      else state.products.push({ id: id("product"), ...values });
      saveState();
      navigate("products");
      showToast(product ? "Продукт изменён." : "Продукт добавлен.");
    });
  }

  function renderRequests() {
    const sorted = [...state.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    app.innerHTML = sorted.length
      ? sorted.map(requestRow).join("")
      : `<section class="section"><p class="empty">Запросы не созданы</p></section>`;
    bindRequestRows();
  }

  function renderRequestForm() {
    if (!state.products.length) {
      app.innerHTML = `
        <section class="section">
          <p class="empty">Сначала добавьте хотя бы один продукт.</p>
          <button id="go-products" class="button secondary full" type="button">Перейти к продуктам</button>
        </section>`;
      document.getElementById("go-products").onclick = () => navigate("product-new");
      return;
    }
    const editing = route === "request-edit";
    const editedRequest = editing ? getRequest(routeId) : null;
    if (editing && !editedRequest) return navigate("requests");
    if (!draftItems.length) {
      draftItems = editedRequest
        ? editedRequest.items.map((item) => ({
            key: id("item"),
            productId: item.productId,
            quantity: item.quantity,
            stockAtRequest: item.stockAtRequest ?? getProduct(item.productId)?.quantity ?? 0,
          }))
        : [{
            key: id("item"),
            productId: state.products[0].id,
            quantity: 1,
            stockAtRequest: state.products[0].quantity || 0,
          }];
    }
    app.innerHTML = `
      <form id="request-form" class="form">
        <div id="request-items">${draftItems.map(draftItemRow).join("")}</div>
        <button id="add-request-item" class="button secondary full" type="button">Добавить позицию</button>
        <button class="button full" style="margin-top:16px" type="submit">${editing ? "Сохранить изменения" : "Создать запрос"}</button>
      </form>
    `;
    bindDraftItems();
    document.getElementById("add-request-item").onclick = () => {
      draftItems.push({
        key: id("item"),
        productId: state.products[0].id,
        quantity: 1,
        stockAtRequest: state.products[0].quantity || 0,
      });
      renderRequestForm();
    };
    document.getElementById("request-form").addEventListener("submit", (event) => {
      event.preventDefault();
      syncDraftFromForm();
      const items = draftItems.map(({ productId, quantity, stockAtRequest }) => ({
        productId,
        quantity: Number(quantity),
        stockAtRequest: Number(stockAtRequest),
      }));
      items.forEach((item) => {
        const product = getProduct(item.productId);
        if (product) updateProductQuantity(product, item.stockAtRequest);
      });
      if (editedRequest) {
        editedRequest.items = items;
        editedRequest.updatedAt = new Date().toISOString();
        editedRequest.updatedBy = state.user?.email || "local";
        if (editedRequest.purchases) {
          editedRequest.purchases = editedRequest.purchases.filter((purchase) =>
            items.some((item) => item.productId === purchase.productId)
          );
          if (editedRequest.status === "done") {
            items.forEach((item) => {
              const product = getProduct(item.productId);
              const purchase = editedRequest.purchases.find((value) => value.productId === item.productId);
              if (product && purchase) updateProductQuantity(product, item.stockAtRequest + purchase.quantity);
            });
          }
        }
      } else {
        state.requests.push({
          id: id("request"),
          createdAt: new Date().toISOString(),
          status: "open",
          items,
          createdBy: state.user?.email || "local",
          updatedBy: state.user?.email || "local",
          updatedAt: new Date().toISOString(),
        });
      }
      draftItems = [];
      saveState();
      navigate(editedRequest ? "request-detail" : "requests", editedRequest?.id || null);
      showToast(editedRequest ? "Запрос изменён." : "Запрос создан.");
    });
  }

  function draftItemRow(item) {
    return `
      <div class="request-item" data-key="${item.key}">
        <label class="field"><span>Продукт</span>
          <select class="draft-product">${state.products.map((product) =>
            `<option value="${product.id}" ${product.id === item.productId ? "selected" : ""}>${escapeHtml(product.name)}</option>`
          ).join("")}</select>
        </label>
        <div class="request-item-fields">
          <label class="field"><span>Остаток</span><input class="draft-stock" type="number" min="0" step="0.01" value="${item.stockAtRequest ?? 0}" required></label>
          <label class="field"><span>Запросить</span><input class="draft-quantity" type="number" min="0.01" step="0.01" value="${item.quantity}" required></label>
          <button class="icon-button remove-item" type="button" aria-label="Удалить">×</button>
        </div>
      </div>`;
  }

  function bindDraftItems() {
    document.querySelectorAll(".draft-product").forEach((select) => {
      select.onchange = () => {
        const row = select.closest(".request-item");
        const product = getProduct(select.value);
        row.querySelector(".draft-stock").value = product?.quantity ?? 0;
      };
    });
    document.querySelectorAll(".remove-item").forEach((button) => {
      button.onclick = () => {
        syncDraftFromForm();
        const key = button.closest(".request-item").dataset.key;
        if (draftItems.length === 1) return showToast("В запросе нужна хотя бы одна позиция.");
        draftItems = draftItems.filter((item) => item.key !== key);
        renderRequestForm();
      };
    });
  }

  function syncDraftFromForm() {
    document.querySelectorAll(".request-item").forEach((row) => {
      const item = draftItems.find((value) => value.key === row.dataset.key);
      if (!item) return;
      item.productId = row.querySelector(".draft-product").value;
      item.quantity = Number(row.querySelector(".draft-quantity").value);
      item.stockAtRequest = Number(row.querySelector(".draft-stock").value);
    });
  }

  function renderRequestDetail() {
    const request = getRequest(routeId);
    if (!request) return navigate("requests");
    const rows = request.items.map((item) => {
      const product = getProduct(item.productId);
      const purchase = request.purchases?.find((value) => value.productId === item.productId);
      return `
        <div class="row">
          <div class="row-main">
            <strong>${escapeHtml(product?.name || "Удалённый продукт")}</strong>
            <span>Остаток: ${number(item.stockAtRequest || 0)} · Запрошено: ${number(item.quantity)} ${escapeHtml(product?.unit || "")}</span>
          </div>
          ${purchase ? `<div class="row-value">${money(purchase.price)}</div>` : ""}
        </div>`;
    }).join("");
    app.innerHTML = `
      <section class="section">
        <span class="status ${request.status}">${request.status === "open" ? "Активен" : "Выполнен"}</span>
        <p class="muted">${date(request.createdAt)}${request.createdBy && request.createdBy !== "local" ? ` · ${escapeHtml(request.createdBy)}` : ""}</p>
      </section>
      <section>
        ${rows}
      </section>
      <section class="section">
        ${request.status === "done" ? `<p><strong>Итого: ${money(requestTotal(request))}</strong></p>` : ""}
        <div class="button-row">
          <button id="edit-request" class="button secondary" type="button">Редактировать запрос</button>
          <button id="answer-request" class="button" type="button">${request.status === "open" ? "Заполнить закупку" : "Редактировать закупку"}</button>
        </div>
      </section>
    `;
    document.getElementById("edit-request").onclick = () => {
      draftItems = [];
      navigate("request-edit", request.id);
    };
    document.getElementById("answer-request").onclick = () => navigate("request-answer", request.id);
  }

  function renderRequestAnswer() {
    const request = getRequest(routeId);
    if (!request) return navigate("requests");
    app.innerHTML = `
      <form id="answer-form" class="form">
        <p class="muted">Укажите фактически купленное количество и итоговую цену позиции.</p>
        ${request.items.map((item) => {
          const product = getProduct(item.productId);
          const existing = request.purchases?.find((purchase) => purchase.productId === item.productId);
          return `
            <div class="section" style="padding-left:0;padding-right:0">
              <strong>${escapeHtml(product?.name || "Продукт")}</strong>
              <div class="button-row">
                <label class="field" style="flex:1;margin:0"><span>Куплено</span><input name="qty-${item.productId}" type="number" min="0" step="0.01" value="${existing?.quantity ?? item.quantity}" required></label>
                <label class="field" style="flex:1;margin:0"><span>Цена позиции, ₽</span><input name="price-${item.productId}" type="number" min="0" step="0.01" value="${existing?.price ?? ""}" required></label>
              </div>
            </div>`;
        }).join("")}
        <button class="button full" type="submit">${request.status === "done" ? "Сохранить изменения" : "Завершить закупку"}</button>
      </form>
    `;
    document.getElementById("answer-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      request.purchases = request.items.map((item) => ({
        productId: item.productId,
        quantity: Number(data.get(`qty-${item.productId}`)),
        price: Number(data.get(`price-${item.productId}`)),
      }));
      request.status = "done";
      request.completedAt = request.completedAt || new Date().toISOString();
      request.updatedAt = new Date().toISOString();
      request.updatedBy = state.user?.email || "local";
      request.items.forEach((item) => {
        const product = getProduct(item.productId);
        const purchase = request.purchases.find((value) => value.productId === item.productId);
        if (product && purchase) updateProductQuantity(product, Number(item.stockAtRequest || 0) + purchase.quantity);
      });
      saveState();
      navigate("request-detail", request.id);
      showToast("Закупка сохранена.");
    });
  }

  function renderProfile() {
    const completed = state.requests.filter((item) => item.status === "done");
    const spent = completed.reduce((sum, item) => sum + requestTotal(item), 0);
    app.innerHTML = `
      <div class="metrics">
        ${metric("Всего запросов", state.requests.length)}
        ${metric("Выполнено", completed.length)}
        ${metric("Количество трат", completed.length)}
        ${metric("Сумма трат", money(spent))}
      </div>
      <section class="section">
        <h2 class="section-title">Google</h2>
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
      <section class="section">
        <h2 class="section-title">Google Таблица</h2>
        ${state.spreadsheetId ? `
          <p><strong>${escapeHtml(state.spreadsheetTitle || "Подключённая таблица")}</strong></p>
          <p class="muted">${escapeHtml(state.spreadsheetId)}</p>
          <button id="sync-sheet" class="button full" type="button">Синхронизировать</button>
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
      <section class="section">
        <h2 class="section-title">Данные устройства</h2>
        <button id="clear-data" class="button danger full" type="button">Удалить все локальные данные</button>
      </section>
    `;
    bindProfileActions();
  }

  function bindProfileActions() {
    document.getElementById("google-auth")?.addEventListener("click", async () => {
      await authorizeGoogle(true);
      renderProfile();
    });
    document.getElementById("google-disconnect")?.addEventListener("click", () => {
      accessToken = null;
      state.user = null;
      saveState();
      renderProfile();
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
          body: JSON.stringify({ properties: { title: `Листок — ${new Date().toLocaleDateString("ru-RU")}` } }),
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
    document.getElementById("disconnect-sheet")?.addEventListener("click", () => {
      state.spreadsheetId = "";
      state.spreadsheetTitle = "";
      state.lastSyncAt = "";
      saveState();
      renderProfile();
    });
    document.getElementById("clear-data")?.addEventListener("click", () => {
      if (!confirm("Удалить продукты, запросы и настройки с этого устройства?")) return;
      state = structuredClone(defaultState);
      accessToken = null;
      saveState();
      renderProfile();
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
    });
    saveState(false);
    if (showSuccess) showToast("Вход выполнен.");
    return accessToken;
  }

  function mirrorStateForBackgroundSync() {
    if (!window.NativeGoogle?.configureBackgroundSync) return;
    window.NativeGoogle.configureBackgroundSync(
      JSON.stringify(state),
      state.spreadsheetId || "",
      state.user?.email || ""
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
    try {
      const token = accessToken || await authorizeGoogle(false);
      if (token) await setupSpreadsheet(token, state.spreadsheetId);
    } catch (error) {
      console.warn("Automatic sync failed", error);
    } finally {
      syncInProgress = false;
    }
  }

  async function setupSpreadsheet(token, spreadsheetId) {
    let metadata = await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties(sheetId,title)`,
      token
    );
    const required = ["Продукты", "Запросы", "Покупки"];
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
    url.searchParams.append("ranges", "Продукты!A2:G");
    url.searchParams.append("ranges", "Запросы!A2:J");
    url.searchParams.append("ranges", "Покупки!A2:D");
    const response = await googleFetch(url.toString(), token);
    const productRows = response.valueRanges?.[0]?.values || [];
    const requestRows = response.valueRanges?.[1]?.values || [];
    const purchaseRows = response.valueRanges?.[2]?.values || [];

    const remoteProducts = productRows
      .filter((row) => row[0])
      .map((row) => ({
        id: String(row[0]),
        name: String(row[1] || ""),
        category: String(row[2] || ""),
        unit: String(row[3] || "шт."),
        quantity: Number(row[4]) || 0,
        updatedAt: String(row[5] || new Date(0).toISOString()),
        updatedBy: String(row[6] || "remote"),
      }));
    state.products = mergeVersioned(state.products, remoteProducts);

    const purchasesByRequest = new Map();
    purchaseRows.forEach((row) => {
      if (!row[0] || !row[1]) return;
      const values = purchasesByRequest.get(String(row[0])) || [];
      values.push({
        productId: String(row[1]),
        quantity: Number(row[2]) || 0,
        price: Number(row[3]) || 0,
      });
      purchasesByRequest.set(String(row[0]), values);
    });

    const remoteById = new Map();
    requestRows.forEach((row) => {
      if (!row[0] || !row[1]) return;
      const requestId = String(row[0]);
      const request = remoteById.get(requestId) || {
        id: requestId,
        status: String(row[4]) === "Выполнен" ? "done" : "open",
        createdAt: String(row[5] || new Date().toISOString()),
        completedAt: String(row[6] || ""),
        createdBy: String(row[7] || "remote"),
        updatedAt: String(row[8] || row[6] || row[5] || new Date(0).toISOString()),
        updatedBy: String(row[9] || row[7] || "remote"),
        items: [],
      };
      request.items.push({
        productId: String(row[1]),
        quantity: Number(row[2]) || 0,
        stockAtRequest: Number(row[3]) || 0,
      });
      remoteById.set(requestId, request);
    });
    const remoteRequests = [...remoteById.values()].map((request) => ({
      ...request,
      purchases: purchasesByRequest.get(request.id) || [],
    }));

    const knownIds = new Set(state.requests.map((request) => request.id));
    const seenIds = new Set(state.seenRemoteRequestIds || []);
    const trackingWasInitialized = Boolean(state.remoteTrackingInitialized);
    remoteRequests.forEach((request) => {
      if (
        trackingWasInitialized &&
        !knownIds.has(request.id) &&
        !seenIds.has(request.id) &&
        request.status === "open" &&
        isRemoteRequest(request)
      ) {
        notifyRemoteRequest(request);
      }
      if (isRemoteRequest(request)) seenIds.add(request.id);
    });
    state.requests = mergeVersioned(state.requests, remoteRequests);
    state.seenRemoteRequestIds = [...seenIds];
    state.remoteTrackingInitialized = true;
    saveState(false);

    if (["summary", "products", "requests"].includes(route)) render();
  }

  async function writeSpreadsheetData(token, spreadsheetId) {
    const requestRows = state.requests.flatMap((request) =>
      request.items.map((item) => [
        request.id,
        item.productId,
        item.quantity,
        item.stockAtRequest || 0,
        request.status === "open" ? "Активен" : "Выполнен",
        request.createdAt,
        request.completedAt || "",
        request.createdBy || "local",
        request.updatedAt || request.createdAt,
        request.updatedBy || request.createdBy || "local",
      ])
    );
    const purchaseRows = state.requests.flatMap((request) =>
      (request.purchases || []).map((purchase) => [
        request.id, purchase.productId, purchase.quantity, purchase.price,
      ])
    );
    await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`, token, {
      method: "POST",
      body: JSON.stringify({ ranges: ["Продукты!A:H", "Запросы!A:K", "Покупки!A:E"] }),
    });
    await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, token, {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: [
          {
            range: "Продукты!A1:G",
            values: [["id", "Наименование", "Категория", "Единица", "Остаток", "Обновлён", "Кем обновлён"], ...state.products.map((item) =>
              [item.id, item.name, item.category, item.unit, item.quantity || 0, item.updatedAt || "", item.updatedBy || ""]
            )],
          },
          {
            range: "Запросы!A1:J",
            values: [["request_id", "product_id", "Запрошено", "Остаток", "Статус", "Создан", "Закрыт", "Автор", "Обновлён", "Кем обновлён"], ...requestRows],
          },
          {
            range: "Покупки!A1:D",
            values: [["request_id", "product_id", "Куплено", "Цена позиции"], ...purchaseRows],
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
      button.onclick = () => navigate("request-detail", button.dataset.id);
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
        <span class="status ${request.status}">${request.status === "open" ? "Активен" : money(requestTotal(request))}</span>
      </button>`;
  }

  function metric(label, value) {
    return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
  }

  function requestTotal(request) {
    return (request.purchases || []).reduce((sum, item) => sum + item.price, 0);
  }

  function requestSummary(request) {
    return request.items.map((item) => {
      const product = getProduct(item.productId);
      return `${product?.name || "Продукт"} — ${number(item.quantity)} ${product?.unit || ""}`;
    }).join("; ");
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

  function timestamp(value) {
    const result = Date.parse(value || "");
    return Number.isFinite(result) ? result : 0;
  }

  function updateProductQuantity(product, quantity) {
    product.quantity = Number(quantity) || 0;
    product.updatedAt = new Date().toISOString();
    product.updatedBy = state.user?.email || "local";
  }

  function getProduct(productId) {
    return state.products.find((product) => product.id === productId);
  }

  function getRequest(requestId) {
    return state.requests.find((request) => request.id === requestId);
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

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
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
  setInterval(() => queueAutoSync(0), 15 * 60 * 1000);
  if (state.spreadsheetId && state.user) queueAutoSync(1200);
})();
