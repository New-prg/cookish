(() => {
  "use strict";

  const STORAGE_KEY = "listok.android.data.v1";
  const defaultState = {
    products: [],
    requests: [],
    spreadsheetId: "",
    spreadsheetTitle: "",
    user: null,
  };

  let state = loadState();
  let route = "summary";
  let routeId = null;
  let draftItems = [];
  let accessToken = null;
  let authResolve = null;
  let toastTimer = null;

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
      navigate("request-new");
    } else if (route.includes("-new") || route === "request-detail" || route === "request-answer") {
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
      return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    nav.hidden = route.includes("-new") || route === "request-answer";
    document.body.style.paddingBottom = nav.hidden ? "env(safe-area-inset-bottom)" : "";
    configureHeader();

    if (route === "summary") renderSummary();
    else if (route === "products") renderProducts();
    else if (route === "product-new") renderProductForm();
    else if (route === "requests") renderRequests();
    else if (route === "request-new") renderRequestForm();
    else if (route === "request-detail") renderRequestDetail();
    else if (route === "request-answer") renderRequestAnswer();
    else if (route === "profile") renderProfile();
  }

  function configureHeader() {
    const config = {
      summary: ["Сводка", "", false],
      products: ["Продукты", "Добавить", false],
      "product-new": ["Новый продукт", "Отмена", true],
      requests: ["Запросы", "Создать", false],
      "request-new": ["Новый запрос", "Отмена", true],
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
    `;
    bindRequestRows();
  }

  function renderProducts() {
    app.innerHTML = state.products.length
      ? state.products.map((product) => `
          <div class="row">
            <div class="row-main">
              <strong>${escapeHtml(product.name)}</strong>
              <span>${escapeHtml(product.category || "Без категории")} · ${escapeHtml(product.unit)}</span>
            </div>
            <button class="text-button delete-product" data-id="${product.id}" type="button">Удалить</button>
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
  }

  function renderProductForm() {
    app.innerHTML = `
      <form id="product-form" class="form">
        <label class="field"><span>Наименование</span><input name="name" required autocomplete="off"></label>
        <label class="field"><span>Категория</span><input name="category" autocomplete="off"></label>
        <label class="field"><span>Единица измерения</span>
          <select name="unit">
            <option value="шт.">шт.</option>
            <option value="кг">кг</option>
            <option value="г">г</option>
            <option value="л">л</option>
            <option value="уп.">уп.</option>
          </select>
        </label>
        <button class="button full" type="submit">Сохранить</button>
      </form>
    `;
    document.getElementById("product-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      state.products.push({
        id: id("product"),
        name: data.get("name").trim(),
        category: data.get("category").trim(),
        unit: data.get("unit"),
      });
      saveState();
      navigate("products");
      showToast("Продукт добавлен.");
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
    if (!draftItems.length) draftItems = [{ key: id("item"), productId: state.products[0].id, quantity: 1 }];
    app.innerHTML = `
      <form id="request-form" class="form">
        <label class="field"><span>Наименование запроса</span><input name="title" required value="Закупка"></label>
        <div id="request-items">${draftItems.map(draftItemRow).join("")}</div>
        <button id="add-request-item" class="button secondary full" type="button">Добавить позицию</button>
        <button class="button full" style="margin-top:16px" type="submit">Создать запрос</button>
      </form>
    `;
    bindDraftItems();
    document.getElementById("add-request-item").onclick = () => {
      draftItems.push({ key: id("item"), productId: state.products[0].id, quantity: 1 });
      renderRequestForm();
    };
    document.getElementById("request-form").addEventListener("submit", (event) => {
      event.preventDefault();
      syncDraftFromForm();
      const data = new FormData(event.currentTarget);
      state.requests.push({
        id: id("request"),
        title: data.get("title").trim(),
        createdAt: new Date().toISOString(),
        status: "open",
        items: draftItems.map(({ productId, quantity }) => ({ productId, quantity: Number(quantity) })),
      });
      draftItems = [];
      saveState();
      navigate("requests");
      showToast("Запрос создан.");
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
        <label class="field"><span>Количество</span><input class="draft-quantity" type="number" min="0.01" step="0.01" value="${item.quantity}" required></label>
        <button class="icon-button remove-item" type="button" aria-label="Удалить">×</button>
      </div>`;
  }

  function bindDraftItems() {
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
            <span>Запрошено: ${number(item.quantity)} ${escapeHtml(product?.unit || "")}</span>
          </div>
          ${purchase ? `<div class="row-value">${money(purchase.quantity * purchase.price)}</div>` : ""}
        </div>`;
    }).join("");
    app.innerHTML = `
      <section class="section">
        <h2 style="margin:0 0 6px">${escapeHtml(request.title)}</h2>
        <span class="status ${request.status}">${request.status === "open" ? "Активен" : "Выполнен"}</span>
        <p class="muted">${date(request.createdAt)}</p>
      </section>
      <section>
        ${rows}
      </section>
      ${request.status === "open" ? `
        <section class="section"><button id="answer-request" class="button full" type="button">Заполнить закупку</button></section>
      ` : `
        <section class="section"><strong>Итого: ${money(requestTotal(request))}</strong></section>
      `}
    `;
    const button = document.getElementById("answer-request");
    if (button) button.onclick = () => navigate("request-answer", request.id);
  }

  function renderRequestAnswer() {
    const request = getRequest(routeId);
    if (!request) return navigate("requests");
    app.innerHTML = `
      <form id="answer-form" class="form">
        <p class="muted">Укажите фактически купленное количество и цену за единицу.</p>
        ${request.items.map((item) => {
          const product = getProduct(item.productId);
          return `
            <div class="section" style="padding-left:0;padding-right:0">
              <strong>${escapeHtml(product?.name || "Продукт")}</strong>
              <div class="button-row">
                <label class="field" style="flex:1;margin:0"><span>Куплено</span><input name="qty-${item.productId}" type="number" min="0" step="0.01" value="${item.quantity}" required></label>
                <label class="field" style="flex:1;margin:0"><span>Цена, ₽</span><input name="price-${item.productId}" type="number" min="0" step="0.01" required></label>
              </div>
            </div>`;
        }).join("")}
        <button class="button full" type="submit">Завершить закупку</button>
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
      request.completedAt = new Date().toISOString();
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
    document.getElementById("disconnect-sheet")?.addEventListener("click", () => {
      state.spreadsheetId = "";
      state.spreadsheetTitle = "";
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
    saveState();
    if (showSuccess) showToast("Вход выполнен.");
    return accessToken;
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
    await writeSpreadsheetData(token, spreadsheetId);
    state.spreadsheetTitle = metadata.properties.title;
    return metadata.properties.title;
  }

  async function writeSpreadsheetData(token, spreadsheetId) {
    const requestRows = state.requests.map((request) => [
      request.id, request.title, request.createdAt, request.status === "open" ? "Активен" : "Выполнен",
    ]);
    const purchaseRows = state.requests.flatMap((request) =>
      (request.purchases || []).map((purchase) => [
        request.id, purchase.productId, purchase.quantity, purchase.price, purchase.quantity * purchase.price,
      ])
    );
    await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`, token, {
      method: "POST",
      body: JSON.stringify({ ranges: ["Продукты!A:E", "Запросы!A:E", "Покупки!A:F"] }),
    });
    await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, token, {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: [
          {
            range: "Продукты!A1:D",
            values: [["id", "Наименование", "Категория", "Единица"], ...state.products.map((item) =>
              [item.id, item.name, item.category, item.unit]
            )],
          },
          {
            range: "Запросы!A1:D",
            values: [["id", "Наименование", "Дата", "Статус"], ...requestRows],
          },
          {
            range: "Покупки!A1:E",
            values: [["request_id", "product_id", "Количество", "Цена", "Сумма"], ...purchaseRows],
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
    return `
      <button class="row link-row request-link" data-id="${request.id}" type="button">
        <div class="row-main">
          <strong>${escapeHtml(request.title)}</strong>
          <span>${date(request.createdAt)} · ${request.items.length} поз.</span>
        </div>
        <span class="status ${request.status}">${request.status === "open" ? "Активен" : money(requestTotal(request))}</span>
      </button>`;
  }

  function metric(label, value) {
    return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
  }

  function requestTotal(request) {
    return (request.purchases || []).reduce((sum, item) => sum + item.quantity * item.price, 0);
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
})();
