// Кликабельный прототип Cookish: только демонстрация интерфейса.
// Данные примера, никакой работы с хранилищем.

const STATE_LABELS = {
  eaten: "съедено",
  changed: "изменено",
  skipped: "не съедено",
  unmarked: "не отмечено",
};

const SCREENS = {
  summary: { title: "Сводка", action: null, nav: "summary" },
  requests: { title: "Запросы", action: "Создать", nav: "requests" },
  "request-edit": { title: "29 августа", action: "Готово", nav: null, menu: true },
  ration: { title: "Рацион", action: null, nav: "ration" },
  products: { title: "Продукты", action: "Добавить", nav: "profile" },
  "product-form": { title: "Новый продукт", action: "Отмена", nav: null },
  profile: { title: "Профиль", action: null, nav: "profile" },
};

const app = document.getElementById("app");
const pageTitle = document.getElementById("page-title");
const headerAction = document.getElementById("header-action");
const nav = document.querySelector(".bottom-nav");
const menuWrap = document.getElementById("request-header-menu-wrap");
const menu = document.getElementById("request-header-menu");
const menuButton = document.getElementById("header-more");
const toast = document.getElementById("toast");
const toastMessage = document.getElementById("toast-message");
const mealDialog = document.getElementById("ration-meal-dialog");

let currentScreen = "summary";
let activeMeal = null;
let toastTimer = null;

function showToast(message) {
  toastMessage.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

function closeRationOverlays() {
  app.querySelectorAll(".ration-overlay").forEach((panel) => { panel.hidden = true; });
  app.querySelectorAll(".ration-rail-flag").forEach((flag) => flag.classList.remove("active"));
}

function showScreen(name) {
  if (!SCREENS[name]) return;
  currentScreen = name;
  closeRationOverlays();
  app.querySelectorAll(".screen").forEach((section) => {
    section.hidden = section.dataset.screen !== name;
  });
  const config = SCREENS[name];
  pageTitle.textContent = config.title;
  headerAction.textContent = config.action || "";
  headerAction.hidden = !config.action;
  menuWrap.hidden = !config.menu;
  menu.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
  nav.hidden = !config.nav;
  if (config.nav) {
    nav.querySelectorAll("button").forEach((button) => {
      const active = button.dataset.route === config.nav;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }
  app.scrollTop = 0;
}

// --- Делегированные переходы по экранам ---

document.addEventListener("click", (event) => {
  const navButton = event.target.closest("nav.bottom-nav button");
  if (navButton) {
    showScreen(navButton.dataset.route);
    return;
  }
  const link = event.target.closest("[data-nav]");
  if (link) {
    showScreen(link.dataset.nav);
    return;
  }
  if (!event.target.closest(".header-menu-wrap")) menu.hidden = true;
});

headerAction.addEventListener("click", () => {
  if (currentScreen === "requests") {
    showToast("Создан новый запрос.");
    showScreen("request-edit");
  } else if (currentScreen === "request-edit") {
    showToast("Запрос сохранён.");
    showScreen("requests");
  } else if (currentScreen === "products") {
    fillProductForm(null);
    showScreen("product-form");
  } else if (currentScreen === "product-form") {
    showScreen("products");
  }
});

menuButton.addEventListener("click", () => {
  const open = !menu.hidden;
  menu.hidden = open;
  menuButton.setAttribute("aria-expanded", String(!open));
});

document.getElementById("request-info-action").addEventListener("click", () => {
  menu.hidden = true;
  showToast("3 позиции · 2 товара подтверждены");
});

document.getElementById("request-delete-action").addEventListener("click", () => {
  menu.hidden = true;
  if (confirm("Удалить запрос?")) {
    showToast("Запрос удалён.");
    showScreen("requests");
  }
});

// --- Редактор запроса ---

document.getElementById("add-request-item").addEventListener("click", () => {
  const blank = app.querySelector(".request-item.is-blank");
  if (blank) {
    blank.querySelector(".request-line-editor")?.focus();
    return;
  }
  const template = app.querySelector(".request-item");
  const row = template.cloneNode(true);
  row.classList.remove("is-resolved", "is-bought");
  row.classList.add("is-blank");
  const editor = row.querySelector(".request-line-editor");
  if (editor) {
    editor.innerHTML = "";
    editor.setAttribute("data-placeholder", "Товар");
  }
  template.before(row);
  editor?.focus();
});

app.querySelectorAll(".keep-remove-item").forEach((cross) => {
  cross.addEventListener("click", (event) => {
    const row = event.currentTarget.closest(".request-item");
    const blank = row?.classList.contains("is-blank");
    const candidate = row?.querySelector(".product-candidate");
    if (blank || candidate) {
      row.remove();
      showToast("Позиция удалена.");
    } else {
      showToast("Купленные позиции удаляются свайпом.");
    }
  });
});

// --- Рацион: отметки и диалог приёма ---

function shiftTime(time, minutes) {
  const [hours, mins] = time.split(":").map(Number);
  const total = ((hours * 60 + mins + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function applyMealState(meal, stateKey) {
  meal.dataset.state = stateKey;
  meal.classList.remove("state-eaten", "state-changed", "state-skipped", "state-unmarked");
  meal.classList.add(`state-${stateKey}`);
  meal.querySelector(".ration-state-chip").textContent = STATE_LABELS[stateKey];
  const eatButton = meal.querySelector(".ration-eat-button");
  const eaten = stateKey === "eaten";
  eatButton.textContent = eaten ? "✓" : "Съесть";
  eatButton.classList.toggle("done", eaten);
  eatButton.setAttribute("aria-label", eaten ? "Снять отметку" : "Отметить съедено");
}

app.querySelectorAll(".ration-today-meal").forEach((meal) => {
  meal.querySelector(".ration-eat-button").addEventListener("click", () => {
    const nextState = meal.dataset.state === "eaten" ? "unmarked" : "eaten";
    applyMealState(meal, nextState);
    showToast(`«${meal.querySelector("strong").textContent}» — ${STATE_LABELS[nextState]}.`);
  });
  meal.querySelector(".ration-today-meal-open").addEventListener("click", () => {
    activeMeal = meal;
    document.getElementById("meal-dialog-name").textContent = meal.querySelector("strong").textContent;
    mealDialog.querySelectorAll(".ration-state-set").forEach((button) => {
      button.classList.toggle("active", button.dataset.state === meal.dataset.state);
    });
    mealDialog.showModal();
  });
});

mealDialog.querySelectorAll(".ration-state-set").forEach((button) => {
  button.addEventListener("click", () => {
    if (!activeMeal) return;
    applyMealState(activeMeal, button.dataset.state);
    mealDialog.querySelectorAll(".ration-state-set").forEach((other) => {
      other.classList.toggle("active", other === button);
    });
  });
});

mealDialog.querySelectorAll(".ration-transfer-button").forEach((button) => {
  button.addEventListener("click", () => {
    if (!activeMeal) return;
    const shifted = shiftTime(activeMeal.dataset.time, Number(button.dataset.delta));
    activeMeal.dataset.time = shifted;
    activeMeal.querySelector(".meal-event-time").textContent = shifted;
  });
});

document.getElementById("close-ration-meal").addEventListener("click", () => mealDialog.close());

// --- Оверлеи рациона ---

app.querySelectorAll(".ration-rail-flag").forEach((flag) => {
  flag.addEventListener("click", () => {
    const panel = app.querySelector(`.ration-overlay[data-overlay="${flag.dataset.overlay}"]`);
    const wasOpen = !panel.hidden;
    closeRationOverlays();
    if (!wasOpen) {
      panel.hidden = false;
      flag.classList.add("active");
    }
  });
});

app.querySelectorAll(".close-ration-overlay").forEach((button) => {
  button.addEventListener("click", closeRationOverlays);
});

app.querySelectorAll(".ration-overlay[data-overlay='plan'] .ration-overlay-day").forEach((day) => {
  day.addEventListener("click", () => {
    day.closest(".ration-overlay-days").querySelectorAll(".ration-overlay-day").forEach((other) => {
      other.classList.toggle("active", other === day);
    });
  });
});

document.getElementById("ration-plan-request").addEventListener("submit", (event) => {
  event.preventDefault();
  closeRationOverlays();
  showToast("Запрос создан из рациона.");
  showScreen("requests");
});

// --- История: состояния и «не ел» ---

app.querySelectorAll(".ration-history-meal").forEach((mealCard) => {
  const chip = mealCard.querySelector(".ration-state-chip");
  mealCard.querySelectorAll(".ration-state-set").forEach((button) => {
    button.addEventListener("click", () => {
      mealCard.querySelectorAll(".ration-state-set").forEach((other) => {
        other.classList.toggle("active", other === button);
      });
      chip.textContent = button.textContent;
    });
  });
  mealCard.querySelectorAll(".ration-history-exclude").forEach((button) => {
    button.addEventListener("click", () => {
      const item = button.closest("li");
      const nowOn = !item.classList.contains("excluded");
      item.classList.toggle("excluded", nowOn);
      button.classList.toggle("is-on", nowOn);
      button.textContent = nowOn ? "вернуть" : "не ел";
      const anyExcluded = mealCard.querySelectorAll("li.excluded").length > 0;
      if (anyExcluded) {
        chip.textContent = "изменено";
        mealCard.querySelectorAll(".ration-state-set").forEach((other) => {
          other.classList.toggle("active", other.textContent === "изменено");
        });
      }
    });
  });
});

// --- Продукты и карточка ---

const productForm = document.getElementById("product-form");

function fillProductForm(data) {
  productForm.elements.name.value = data?.name || "";
  productForm.elements.category.value = data?.category || "";
  productForm.elements.unit.value = data?.unit || "шт.";
  productForm.elements.calories.value = data?.kcal || "";
  productForm.elements.protein.value = data?.protein || "";
  productForm.elements.fat.value = data?.fat || "";
  productForm.elements.carbs.value = data?.carbs || "";
  productForm.elements.fiber.value = "";
}

app.querySelectorAll(".product-row").forEach((row) => {
  row.querySelector(".edit-product").addEventListener("click", () => {
    fillProductForm(row.dataset);
    showScreen("product-form");
  });
  row.querySelector(".delete-product").addEventListener("click", () => {
    if (confirm(`Удалить продукт «${row.dataset.name}»?`)) {
      row.remove();
      showToast(`Продукт «${row.dataset.name}» удалён.`);
    }
  });
});

productForm.addEventListener("submit", (event) => {
  event.preventDefault();
  showToast(productForm.elements.name.value ? "Продукт сохранён." : "Укажите наименование.");
  showScreen("products");
});

// --- Профиль ---

document.getElementById("check-app-update").addEventListener("click", () => {
  showToast("У вас последняя версия Cookish.");
});

document.getElementById("clear-data").addEventListener("click", () => {
  if (confirm("Удалить продукты, запросы и настройки с этого устройства?")) {
    showToast("Локальные данные удалены.");
    showScreen("summary");
  }
});

// --- Старт ---

showScreen("summary");

const hint = document.createElement("div");
hint.className = "prototype-hint";
hint.textContent = "Кликабельный прототип: нижняя навигация, приёмы пищи, оверлеи «План» и «История» работают.";
document.body.append(hint);
setTimeout(() => { hint.style.opacity = "0"; }, 4000);
setTimeout(() => { hint.remove(); }, 4600);
