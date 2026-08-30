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

// --- Редактор запроса: свайпы как в приложении ---

const purchaseDialog = document.getElementById("answer-action-dialog");
const purchasePrice = document.getElementById("purchase-price");
const purchaseQuantity = document.getElementById("purchase-quantity");
const purchaseStatus = document.getElementById("purchase-status");
let purchaseRow = null;

function refreshSpentTotal() {
  const total = [...app.querySelectorAll(".request-item.is-bought")]
    .reduce((sum, row) => sum + (Number(row.dataset.price) || 0), 0);
  const note = app.querySelector(".keep-note-meta strong");
  if (note) note.textContent = `${total} ₽`;
}

function openPurchaseDialog(row) {
  const editor = row.querySelector(".request-line-editor");
  const name = row.querySelector(".product-chip")?.textContent
    || row.querySelector(".product-candidate")?.textContent || "Позиция";
  purchaseRow = row;
  purchaseDialog.dataset.productName = name;
  purchaseStatus.hidden = true;
  const previousPrice = Number(row.dataset.price) || 0;
  purchasePrice.value = previousPrice > 0 ? String(previousPrice) : "";
  purchaseQuantity.value = Number(row.dataset.quantity) > 0 ? row.dataset.quantity : "1";
  purchaseDialog.showModal();
  requestAnimationFrame(() => purchasePrice.focus({ preventScroll: true }));
}

function markRowBought(row, { quantity, price }) {
  row.classList.add("is-resolved", "is-bought");
  row.dataset.price = price > 0 ? String(price) : "";
  row.dataset.quantity = String(quantity);
  const editor = row.querySelector(".request-line-editor");
  const chip = row.querySelector(".product-chip");
  const name = chip?.textContent || row.querySelector(".product-candidate")?.textContent || "Позиция";
  if (!chip) {
    editor.innerHTML = "";
    const chipNode = document.createElement("span");
    chipNode.className = "product-chip";
    chipNode.dataset.product = name;
    chipNode.textContent = name;
    const tail = document.createElement("span");
    tail.className = "request-line-tail";
    editor.append(chipNode, tail);
  }
  const tail = row.querySelector(".request-line-tail");
  if (tail) {
    const unit = unitForProduct(name);
    const prettyQty = String(quantity).replace(".", ",");
    tail.textContent = ` куплено — ${prettyQty} ${unit}${price > 0 ? `, ${price} ₽` : ""}`;
  }
  refreshSpentTotal();
}

function unmarkRowBought(row) {
  row.classList.remove("is-bought");
  delete row.dataset.price;
  delete row.dataset.quantity;
  const tail = row.querySelector(".request-line-tail");
  if (tail) tail.textContent = "";
  const label = row.querySelector(".request-swipe-label");
  if (label) label.textContent = "Заполнить";
  refreshSpentTotal();
}

function unitForProduct(name) {
  const row = [...app.querySelectorAll(".product-row")]
    .find((item) => item.dataset.name === name);
  return row?.dataset.unit || "шт.";
}

function deleteRequestRow(row) {
  if (row.classList.contains("is-bought")) {
    showToast("Покупку сначала нужно снять свайпом влево.");
    return;
  }
  row.remove();
  showToast("Позиция удалена.");
}

document.getElementById("save-purchase-item").addEventListener("click", () => {
  if (!purchaseRow) return purchaseDialog.close();
  const quantity = Math.max(0.01, Number(purchaseQuantity.value) || 1);
  const price = Math.max(0, Number(purchasePrice.value) || 0);
  markRowBought(purchaseRow, { quantity, price });
  purchaseRow = null;
  purchaseDialog.close();
  showToast("Покупка отмечена.");
  refreshSpentTotal();
});

document.getElementById("scan-purchase-barcode").addEventListener("click", () => {
  purchaseStatus.textContent = "Сканирование доступно в Android-приложении.";
  purchaseStatus.hidden = false;
});

function bindRowGestures(row) {
  if (row.dataset.swipeBound === "1") return;
  if (row.classList.contains("is-blank")) return;
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
    setOffset(-threshold(), { animate: true });
    try { navigator.vibrate?.(12); } catch {}
    window.setTimeout(() => {
      if (!row.isConnected) return;
      if (row.classList.contains("is-bought")) {
        unmarkRowBought(row);
        const label = row.querySelector(".request-swipe-label");
        if (label) label.textContent = "Заполнить";
        showToast("Покупка снята.");
      } else {
        openPurchaseDialog(row);
      }
      resetSurface({ animate: true });
    }, 160);
  };

  const deleteRow = () => {
    setOffset(threshold(), { animate: true });
    try { navigator.vibrate?.(12); } catch {}
    window.setTimeout(() => {
      if (row.isConnected) deleteRequestRow(row);
    }, 160);
  };

  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    tracking = true;
    horizontal = false;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    currentX = 0;
    surface.classList.add("is-dragging");
    try { surface.setPointerCapture?.(event.pointerId); } catch {}
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
    const pull = Math.max(-maxPull(), Math.min(maxPull(), dx));
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
      row.dataset.swiped = "";
      const chip = row.querySelector(".product-chip");
      if (chip) chip.dataset.suppressClick = "";
    }, 0);
  };

  const onPointerCancel = (event) => {
    if (!tracking || (pointerId != null && event.pointerId !== pointerId)) return;
    tracking = false;
    pointerId = null;
    resetSurface({ animate: true });
    window.setTimeout(() => {
      row.dataset.swiped = "";
      const chip = row.querySelector(".product-chip");
      if (chip) chip.dataset.suppressClick = "";
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
      if (!icon || (event.pointerType === "mouse" && event.button !== 0)) return;
      clearTapPreview();
      void surface.offsetWidth;
      icon.classList.add("is-tap-bouncing");
      row.classList.add(previewClass);
      surface.classList.add(previewClass);
      tapPreviewTimer = window.setTimeout(clearTapPreview, 1050);
    });
  });

  // Тап по стрелке — открыть детали покупки, тап по крестику — удалить.
  row.querySelector(".request-swipe-handle")?.addEventListener("click", (event) => {
    if (row.dataset.swiped === "1") return;
    event.stopPropagation();
    if (row.classList.contains("is-bought")) {
      unmarkRowBought(row);
      showToast("Покупка снята.");
    } else {
      openPurchaseDialog(row);
    }
  });
  row.querySelector(".keep-remove-item")?.addEventListener("click", (event) => {
    if (row.dataset.swiped === "1") return;
    event.stopPropagation();
    deleteRequestRow(row);
  });
}

// Пустые строки не участвуют в свайпах (как в приложении) — удаляются крестиком.
app.addEventListener("click", (event) => {
  const crossArea = event.target.closest(".keep-remove-item");
  if (!crossArea) return;
  const row = crossArea.closest(".request-item");
  if (row?.classList.contains("is-blank")) {
    row.remove();
    showToast("Позиция удалена.");
  }
});

// Тап по чипу — карточка продукта (как в приложении).
app.querySelectorAll(".request-item").forEach((row) => {
  bindRowGestures(row);
  const chip = row.querySelector(".product-chip");
  chip?.addEventListener("click", () => {
    if (chip.dataset.suppressClick === "1") return;
    const source = [...app.querySelectorAll(".product-row")]
      .find((item) => item.dataset.name === chip.textContent.trim());
    fillProductForm(source?.dataset || { name: chip.textContent.trim() });
    showScreen("product-form");
  });
});

// Ввод в строке: Enter превращает текст в товар, если он есть в каталоге.
function confirmRequestLine(editor) {
  const text = editor.textContent.trim();
  if (!text) return;
  const row = editor.closest(".request-item");
  const match = [...app.querySelectorAll(".product-row")]
    .find((item) => item.dataset.name.toLowerCase().startsWith(text.toLowerCase()));
  editor.innerHTML = "";
  if (match) {
    row.classList.remove("is-blank");
    row.classList.add("is-resolved");
    const chipNode = document.createElement("span");
    chipNode.className = "product-chip";
    chipNode.dataset.product = match.dataset.name;
    chipNode.textContent = match.dataset.name;
    const tail = document.createElement("span");
    tail.className = "request-line-tail";
    editor.append(chipNode, tail);
    bindRowGestures(row);
    showToast(`«${match.dataset.name}» добавлен.`);
  } else {
    const candidate = document.createElement("span");
    candidate.className = "product-candidate";
    candidate.textContent = text;
    editor.append(candidate);
    bindRowGestures(row);
  }
}

app.querySelectorAll(".request-line-editor").forEach((editor) => {
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmRequestLine(editor);
    }
  });
});

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
  row.removeAttribute("data-price");
  row.removeAttribute("data-quantity");
  row.dataset.swipeBound = "";
  delete row.dataset.swipeBound;
  const editor = row.querySelector(".request-line-editor");
  if (editor) {
    editor.innerHTML = "";
    editor.setAttribute("data-placeholder", "Товар");
  }
  template.before(row);
  editor?.focus();
});

refreshSpentTotal();

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
