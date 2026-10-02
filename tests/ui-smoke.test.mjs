import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shellDir = path.join(root, "mobile-shell");

let server;
let baseUrl;
let browser;

before(async () => {
  server = http.createServer((request, response) => {
    const url = request.url === "/" ? "/index.html" : request.url.split("?")[0];
    const file = path.join(shellDir, decodeURIComponent(url));
    fs.readFile(file, (error, data) => {
      if (error) {
        response.writeHead(404);
        response.end();
        return;
      }
      const type = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      }[path.extname(file)] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
      response.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});

async function openPage(viewport = { width: 412, height: 915 }, { hasTouch = false } = {}) {
  const context = await browser.newContext({ viewport, hasTouch });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    throw new Error(`Unhandled page error: ${error.message}`);
  });
  await page.goto(baseUrl, { waitUntil: "load" });
  return { context, page };
}

const ROOT_PAGES = ["ration", "sport", "requests"];
const PAGE_TITLES = ["Рацион", "Спорт", "Покупки"];

// Drags the content of a root page horizontally; step 1 moves to the next page.
async function swipePage(page, step, { from } = {}) {
  const box = await page.locator("main").boundingBox();
  const y = from?.y ?? box.y + Math.min(box.height / 2, 240);
  const x = from?.x ?? box.x + box.width / 2 + step * 90;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - step * 200, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}

async function currentPage(page) {
  if (await page.locator("#page-slider").isHidden()) return "";
  return ROOT_PAGES[PAGE_TITLES.indexOf(await page.locator("#page-slider-current").innerText())];
}

// Under load the page may handle the last swipe a little later than the
// fixed pause in swipePage, so wait for the expected page before asserting.
async function expectPage(page, route, message) {
  await page.waitForFunction((title) => {
    const slider = document.getElementById("page-slider");
    return !slider.hidden && document.getElementById("page-slider-current").textContent === title;
  }, PAGE_TITLES[ROOT_PAGES.indexOf(route)], { timeout: 3000 }).catch(() => {});
  assert.equal(await currentPage(page), route, message);
}

async function openRoute(page, route) {
  // Screens over a page have no swipe: leave them through the header first.
  while (!await currentPage(page)) {
    await page.click("#header-back");
    await page.waitForTimeout(50);
  }
  if (route === "profile") {
    await page.click("#header-profile");
    await page.waitForTimeout(50);
    return;
  }
  const target = ROOT_PAGES.indexOf(route);
  let index = ROOT_PAGES.indexOf(await currentPage(page));
  while (index !== target) {
    const step = Math.sign(target - index);
    await swipePage(page, step);
    index += step;
    await expectPage(page, ROOT_PAGES[index]);
  }
}

// A product card opens only from a chip of a request line. The request row
// captures the pointer, so the chip answers a finger tap, not a mouse click;
// open the page with { hasTouch: true }.
async function openProductCard(page, productId) {
  const now = new Date().toISOString();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cookish.android.data.v1") || "null"));
  await seedState(page, {
    schemaVersion: 12,
    products: stored?.products?.length ? stored.products : [{ id: productId, name: "Чай", unit: "г" }],
    requests: [{ id: "request_card", status: "open", createdAt: now, updatedAt: now, items: [{ productId, quantity: 1 }], responses: [] }],
  });
  await openRoute(page, "requests");
  await page.locator(".request-link").first().click();
  await page.tap(`#request-items .product-chip[data-product-id="${productId}"]`);
  await page.waitForSelector("#product-form");
}

test("smoke: request with two items and one purchase mark", async () => {
  const { context, page } = await openPage();
  try {
    await openRoute(page, "requests");
    await page.click("#requests-empty-add");
    await page.waitForSelector("#request-items .request-line-editor");
    const first = page.locator("#request-items .request-line-editor").first();
    await first.click();
    await first.fill("Хлеб");
    await first.press("Enter");
    await page.waitForTimeout(120);
    assert.equal(await page.locator("#request-items .request-item.is-resolved").count(), 1);
    await page.click("#add-request-item");
    await page.waitForTimeout(80);
    const second = page.locator("#request-items .request-line-editor").nth(1);
    await second.click();
    await second.fill("Молоко");
    await second.press("Enter");
    await page.waitForTimeout(120);
    assert.equal(await page.locator("#request-items .request-item.is-resolved").count(), 2);

    await page.click("#header-action");
    await page.waitForTimeout(120);
    await page.locator(".request-link").first().click();
    await page.waitForSelector("#request-items .request-line-editor");

    const firstRow = page.locator("#request-items .request-item:not(.is-blank)").first();
    const box = await firstRow.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 160, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForSelector("#answer-action-dialog[open]", { timeout: 3000 });
    await page.click("#save-purchase-item");
    await page.waitForTimeout(120);

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cookish.android.data.v1")));
    const request = stored.requests[0];
    assert.equal(request.items.length, 2);
    const boughtLines = request.responses.filter((response) => !response.deletedAt)
      .flatMap((response) => response.items);
    assert.equal(boughtLines.length, 1);
    assert.ok(boughtLines[0].quantity > 0);
  } finally {
    await context.close();
  }
});

test("smoke: ration opens the today screen with states and rail", async () => {
  const { context, page } = await openPage();
  try {
    await openRoute(page, "ration");
    await page.waitForSelector(".ration-today");
    assert.ok(await page.locator(".ration-rail-flag").count() === 2);
    assert.equal(await page.locator("#ration-view-button").count(), 0);

    const bodyText = await page.locator("#app").innerText();
    assert.doesNotMatch(bodyText, /Цикл|Версия/);
    assert.match(bodyText, /не отмечено|На сегодня приёмов пока нет/);

    await page.click("#ration-add-meal");
    await page.waitForSelector("#ration-meal-dialog[open]");
    assert.ok(await page.locator("#ration-meal-dialog .ration-state-set").count() >= 4);
    await page.click("#close-ration-meal");
    await page.waitForTimeout(80);

    const meal = page.locator(".ration-today-meal").first();
    await meal.locator(".ration-eat-button").click();
    await page.waitForTimeout(80);
    const chip = await page.locator(".ration-today-meal .ration-state-chip").first().innerText();
    assert.equal(chip, "съедено");
    assert.ok((await page.locator(".ration-today-meal.state-eaten").count()) === 1);
  } finally {
    await context.close();
  }
});

test("smoke: ration plan overlay edits a future day and creates a request", async () => {
  const { context, page } = await openPage();
  try {
    await openRoute(page, "ration");
    await page.click('.ration-rail-flag[data-overlay="plan"]');
    await page.waitForSelector(".ration-overlay");
    const days = page.locator(".ration-overlay-day");
    assert.equal(await days.count(), 14);
    await days.nth(0).click();
    await page.waitForSelector(".ration-overlay-editor");
    await page.click(".ration-overlay-editor .add-ration-meal");
    await page.waitForSelector(".ration-overlay-editor .add-ration-food");
    await page.click(".ration-overlay-editor .add-ration-food");
    const input = page.locator(".ration-overlay-editor .ration-food-input").last();
    await input.fill("Крупа");
    await page.locator(".ration-overlay-editor .save-ration-food").last().click();
    await page.waitForTimeout(80);

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cookish.android.data.v1")));
    const specialDates = Object.keys(stored.ration.specialDays);
    assert.equal(specialDates.length, 1);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const key = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    assert.ok(specialDates[0].endsWith(key));

    await page.click("#ration-plan-request button[type=submit]");
    await page.waitForTimeout(150);
    const afterRequest = await page.evaluate(() => JSON.parse(localStorage.getItem("cookish.android.data.v1")));
    assert.equal(afterRequest.requests.length, 1);
    assert.equal(afterRequest.requests[0].items[0].unit, "уп.");
  } finally {
    await context.close();
  }
});

test("smoke: the slider stays pinned on root pages and Profile opens from the header", async () => {
  const { context, page } = await openPage();
  try {
    for (const route of ROOT_PAGES) {
      await openRoute(page, route);
      const slider = await page.locator("#page-slider").boundingBox();
      const viewport = page.viewportSize();
      assert.ok(slider, `slider must exist on ${route}`);
      assert.ok(slider.y > 0 && slider.y + slider.height <= viewport.height + 1, `slider must stay pinned on ${route}`);
      assert.ok(slider.width < viewport.width / 2, `slider must stay narrow on ${route}`);
      assert.ok((await page.locator("#app").innerText()).length > 0, `main must render on ${route}`);
      assert.equal(await page.locator("#header-profile").isVisible(), true);
    }
    await openRoute(page, "profile");
    assert.equal(await page.locator("#page-slider").isVisible(), false);
    assert.equal(await page.locator("#header-profile").isVisible(), false);
    const text = await page.locator("#app").innerText();
    assert.match(text, /Обнов/);
    assert.doesNotMatch(text, /Открыть продукты|Сумма трат|Всего запросов/);
    await page.click("#header-back");
    assert.equal(await currentPage(page), "requests");
  } finally {
    await context.close();
  }
});

test("smoke: action elements stay visible at 360 px width", async () => {
  const { context, page } = await openPage({ width: 360, height: 780 });
  try {
    await openRoute(page, "ration");
    await page.waitForSelector(".ration-today-meal, .ration-today");
    const scrollWidth = await page.evaluate(() => document.scrollingElement.scrollWidth);
    assert.ok(scrollWidth <= 360, `no horizontal overflow at 360 px, got ${scrollWidth}`);
    const rail = await page.locator(".ration-rail").boundingBox();
    assert.ok(rail && rail.x + rail.width <= 360);
    const eatButton = page.locator(".ration-eat-button").first();
    if (await eatButton.count()) {
      const eat = await eatButton.boundingBox();
      assert.ok(eat.x + eat.width <= rail.x + 1, "eat action must not be covered by the rail");
    }
    const slider = await page.locator("#page-slider").boundingBox();
    assert.ok(slider.x >= 0 && slider.x + slider.width <= 360, "slider must fit at 360 px");
    await openRoute(page, "requests");
    assert.ok(await page.locator("#page-slider").isVisible());
  } finally {
    await context.close();
  }
});

function dateKey(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function seedState(page, state) {
  await page.evaluate((value) => localStorage.setItem("cookish.android.data.v1", JSON.stringify(value)), state);
  await page.reload({ waitUntil: "load" });
}

function storedState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("cookish.android.data.v1")));
}

test("smoke: history overlay marks the selected past day, not today", async () => {
  const { context, page } = await openPage();
  try {
    const anchor = dateKey(-30);
    await seedState(page, {
      schemaVersion: 12,
      products: [],
      requests: [],
      ration: {
        versions: [{
          id: "version_1",
          owner: "local",
          effectiveFrom: anchor,
          cycle: { anchor, weekdayBinding: false, days: [{ id: "cycle_1", meals: [{ id: "meal_1", name: "Завтрак", time: "08:00", items: [] }] }] },
        }],
        specialDays: {},
        history: {},
      },
    });
    await openRoute(page, "ration");
    await page.click('.ration-rail-flag[data-overlay="history"]');
    const pastDay = page.locator(".ration-overlay-day").nth(2);
    const pastDate = await pastDay.getAttribute("data-date");
    await pastDay.click();
    await page.click('.ration-overlay-editor .ration-state-set[data-state="skipped"]');
    await page.waitForTimeout(80);

    const { history } = (await storedState(page)).ration;
    assert.deepEqual(Object.keys(history), [`local|${pastDate}`]);
    assert.equal(history[`local|${pastDate}`].meals.meal_1.state, "skipped");
  } finally {
    await context.close();
  }
});

test("smoke: saving an empty ration product shows a reason instead of crashing", async () => {
  const { context, page } = await openPage();
  try {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openRoute(page, "ration");
    await page.click("#ration-add-meal");
    await page.waitForSelector("#ration-meal-dialog[open]");
    await page.click("#ration-meal-dialog .add-ration-food");
    await page.locator("#ration-meal-dialog .save-ration-food").last().click();
    await page.waitForTimeout(80);

    assert.deepEqual(errors, []);
    assert.match(await page.locator("#toast-message").innerText(), /Название продукта не заполнено/);
  } finally {
    await context.close();
  }
});

test("smoke: barcode lookup fills the product form from Open Food Facts", async () => {
  const { context, page } = await openPage(undefined, { hasTouch: true });
  try {
    await page.route("https://world.openfoodfacts.org/**", (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: 1,
        product: {
          code: "4600000000001",
          product_name_ru: "Кефир 1%",
          quantity: "900 мл",
          categories_tags: ["en:fermented-milks"],
          nutriments: { "energy-kcal_100g": 40, proteins_100g: 3, fat_100g: 1, carbohydrates_100g: 4 },
          ingredients_text_ru: "молоко нормализованное",
        },
      }),
    }));
    await openProductCard(page, "product_tea");
    await page.fill("#product-form [name=barcode]", "4600000000001");
    await page.click("#lookup-barcode");
    await page.waitForFunction(() => /Найдено/.test(document.getElementById("barcode-status").textContent));

    const form = page.locator("#product-form");
    assert.equal(await form.locator("[name=name]").inputValue(), "Кефир 1%");
    assert.equal(await form.locator("[name=category]").inputValue(), "Молочные продукты");
    assert.equal(await form.locator("[name=unit]").inputValue(), "л");
    assert.equal(await form.locator("[name=calories]").inputValue(), "40");
    assert.equal(await form.locator("[name=ingredients]").inputValue(), "молоко нормализованное");
    assert.doesNotMatch(await page.locator("#barcode-status").innerText(), /not defined/);
  } finally {
    await context.close();
  }
});

test("smoke: a full device storage shows a reason and keeps the screen unchanged", async () => {
  const { context, page } = await openPage();
  try {
    await openRoute(page, "ration");
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("full", "QuotaExceededError");
      };
    });
    await page.click("#ration-add-meal");
    await page.waitForTimeout(80);

    assert.match(await page.locator("#toast-message").innerText(), /Память приложения заполнена/);
    assert.equal(await page.locator(".ration-today-meal").count(), 0);
    assert.equal(await page.locator("#ration-meal-dialog[open]").count(), 0);
  } finally {
    await context.close();
  }
});

test("smoke: undo after removing a ration product returns the day to its plan", async () => {
  const { context, page } = await openPage();
  try {
    const today = dateKey(0);
    await seedState(page, {
      schemaVersion: 12,
      products: [{ id: "product_tea", name: "Чай", unit: "г" }],
      requests: [],
      ration: {
        versions: [{
          id: "version_1",
          owner: "local",
          effectiveFrom: today,
          cycle: {
            anchor: today,
            weekdayBinding: false,
            days: [{ id: "cycle_1", meals: [{ id: "meal_1", name: "Завтрак", time: "08:00", items: [{ id: "item_1", productId: "product_tea", name: "Чай" }] }] }],
          },
        }],
        specialDays: {},
        history: {},
      },
    });
    await openRoute(page, "ration");
    await page.click('.ration-today-meal-open[data-meal-id="meal_1"]');
    await page.waitForSelector("#ration-meal-dialog[open]");
    await page.click('#ration-meal-dialog .ration-food-row[data-item-id="item_1"] .remove-ration-food');
    await page.waitForTimeout(80);
    assert.equal(Object.keys((await storedState(page)).ration.specialDays).length, 1);

    await page.click("#toast-action");
    await page.waitForTimeout(80);
    const { ration } = await storedState(page);
    assert.deepEqual(ration.specialDays, {});
    assert.equal(await page.locator('#ration-meal-dialog .ration-food-row[data-item-id="item_1"]').count(), 1);
  } finally {
    await context.close();
  }
});

function planState(fromKey, { products = [], meals } = {}) {
  return {
    schemaVersion: 12,
    products,
    requests: [],
    ration: {
      versions: [{
        id: "version_1",
        owner: "local",
        effectiveFrom: fromKey,
        cycle: { anchor: fromKey, weekdayBinding: false, days: [{ id: "cycle_1", meals }] },
      }],
      specialDays: {},
      history: {},
    },
  };
}

test("smoke: ration profile form saves targets and the today screen shows the goal", async () => {
  const { context, page } = await openPage();
  try {
    await openRoute(page, "ration");
    await page.click("#ration-set-goal");
    await page.waitForSelector("#ration-profile-form");
    assert.equal(await page.locator("nav.bottom-nav").isVisible(), false);

    await page.fill("#ration-profile-form [name=heightCm]", "400");
    await page.click("#header-action");
    assert.equal(await page.locator("#ration-profile-form [name=heightCm]").evaluate((input) => input.validity.rangeOverflow), true);
    assert.equal((await storedState(page))?.ration?.profile?.heightCm ?? null, null);

    await page.fill("#ration-profile-form [name=heightCm]", "176");
    await page.fill("#ration-profile-form [name=targetCalories]", "2100");
    await page.fill("#ration-profile-form [name=targetProtein]", "10");
    await page.fill("#ration-profile-form [name=targetFat]", "10");
    await page.fill("#ration-profile-form [name=targetCarbs]", "10");
    await page.click("#header-action");
    assert.match(await page.locator("#ration-profile-status").innerText(), /БЖУ расходятся с калориями/);
    for (const name of ["targetProtein", "targetFat", "targetCarbs"]) await page.fill(`#ration-profile-form [name=${name}]`, "");

    await page.selectOption("#ration-profile-form [name=goal]", "Поддержание веса");
    await page.fill("#ration-profile-form [name=targetCalories]", "2100");
    await page.fill("#ration-profile-form [name=excludedProducts]", "арахис, кинза");
    await page.click("#header-action");
    await page.waitForSelector(".ration-today");

    assert.match(await page.locator(".ration-today-totals").innerText(), /Цель 2[\s ]?100 ккал/);
    const { profile } = (await storedState(page)).ration;
    assert.equal(profile.heightCm, 176);
    assert.equal(profile.goal, "Поддержание веса");
    assert.deepEqual(profile.excludedProducts, ["арахис", "кинза"]);

    await openRoute(page, "profile");
    assert.match(await page.locator(".profile-ration").innerText(), /Цель 2[\s ]?100 ккал/);
  } finally {
    await context.close();
  }
});

test("smoke: plan overlay shows КБЖУ and repeats a day with undo", async () => {
  const { context, page } = await openPage();
  try {
    const tomorrow = dateKey(1);
    await seedState(page, {
      schemaVersion: 12,
      products: [{ id: "product_oats", name: "Овсянка", unit: "г", nutrition: { calories: 350, protein: 12, fat: 6, carbs: 60, fiber: 10 } }],
      requests: [],
      ration: {
        versions: [],
        specialDays: {
          [`local|${tomorrow}`]: {
            date: tomorrow,
            owner: "local",
            meals: [{ id: "meal_1", name: "Завтрак", time: "08:00", items: [{ id: "item_1", productId: "product_oats", name: "Овсянка", portionSize: 100 }] }],
          },
        },
        history: {},
      },
    });
    await openRoute(page, "ration");
    await page.click('.ration-rail-flag[data-overlay="plan"]');
    const first = page.locator(".ration-overlay-day").first();
    assert.match(await first.innerText(), /350 ккал/);
    assert.doesNotMatch(await page.locator(".ration-overlay-day").nth(1).innerText(), /ккал/);

    await first.click();
    assert.match(await page.locator(".ration-overlay-nutrition").innerText(), /350 ккал · Б 12/);
    await page.click('.ration-repeat-button[data-length="1"]');
    await page.click("#app-confirm-ok");
    await page.waitForTimeout(80);
    assert.match(await page.locator(".ration-overlay-day").nth(5).innerText(), /Завтрак.*350 ккал/s);
    assert.doesNotMatch(await page.locator(".ration-overlay").innerText(), /Цикл|Версия/);
    const repeated = (await storedState(page)).ration;
    assert.equal(repeated.versions.length, 1);
    assert.deepEqual(repeated.specialDays, {});

    await page.click("#toast-action");
    await page.waitForTimeout(80);
    const undone = (await storedState(page)).ration;
    assert.equal(undone.versions.length, 0);
    assert.deepEqual(Object.keys(undone.specialDays), [`local|${tomorrow}`]);
  } finally {
    await context.close();
  }
});

test("smoke: meal card records and removes discrepancies; History corrects a past day", async () => {
  const { context, page } = await openPage();
  try {
    await seedState(page, planState(dateKey(-5), {
      products: [{ id: "product_tea", name: "Чай", unit: "г" }],
      meals: [{ id: "meal_1", name: "Завтрак", time: "08:00", items: [{ id: "item_1", productId: "product_tea", name: "Чай" }] }],
    }));
    await openRoute(page, "ration");
    await page.click('.ration-today-meal-open[data-meal-id="meal_1"]');
    await page.waitForSelector("#ration-meal-dialog[open]");
    const form = page.locator("#ration-meal-dialog .ration-discrepancy-form");
    await form.locator("[name=kind]").selectOption("amount");
    await form.locator("[name=amount]").fill("50");
    await form.locator("button[type=submit]").click();
    await page.waitForTimeout(80);
    await form.locator("[name=kind]").selectOption("added");
    assert.equal(await form.locator("[name=itemId]").isVisible(), false);
    await form.locator("[name=name]").fill("Печенье");
    await form.locator("button[type=submit]").click();
    await page.waitForTimeout(80);

    const list = page.locator("#ration-meal-dialog .ration-history-discrepancies li");
    assert.equal(await list.count(), 2);
    assert.match(await list.nth(0).innerText(), /Съедено 50 г вместо порции: Чай/);
    assert.match(await list.nth(1).innerText(), /Добавлен: Печенье/);
    await list.nth(0).locator(".ration-discrepancy-remove").click();
    await page.waitForTimeout(80);
    assert.equal(await page.locator("#ration-meal-dialog .ration-history-discrepancies li").count(), 1);
    const today = (await storedState(page)).ration.history[`local|${dateKey(0)}`].meals.meal_1;
    assert.deepEqual(today.discrepancies.map((item) => item.kind), ["added"]);
    assert.equal(today.state, "changed");

    await page.click("#close-ration-meal");
    await page.click('.ration-rail-flag[data-overlay="history"]');
    const pastDay = page.locator(".ration-overlay-day").first();
    const pastDate = await pastDay.getAttribute("data-date");
    await pastDay.click();
    const pastForm = page.locator(".ration-overlay-editor .ration-discrepancy-form");
    await pastForm.locator("[name=kind]").selectOption("replaced");
    await pastForm.locator("[name=name]").fill("Кофе");
    await pastForm.locator("button[type=submit]").click();
    await page.waitForTimeout(80);
    const past = (await storedState(page)).ration.history[`local|${pastDate}`].meals.meal_1;
    assert.deepEqual(past.discrepancies, [{ kind: "replaced", productId: "product_tea", name: "Чай", replacedName: "Кофе" }]);
  } finally {
    await context.close();
  }
});

test("smoke: without an account the app only talks to the product catalog", async () => {
  const { context, page } = await openPage();
  try {
    const external = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "127.0.0.1") return route.continue();
      external.push(url.hostname);
      return route.abort();
    });
    await openRoute(page, "ration");
    await page.click("#ration-add-meal");
    await page.waitForSelector("#ration-meal-dialog[open]");
    await page.click("#ration-meal-dialog .add-ration-food");
    await page.locator("#ration-meal-dialog .ration-food-input").last().fill("Гречка");
    await page.locator("#ration-meal-dialog .save-ration-food").last().click();
    await page.waitForTimeout(80);
    await page.click("#close-ration-meal");
    await page.click('.ration-rail-flag[data-overlay="plan"]');
    await page.locator(".ration-overlay-day").first().click();
    await page.click("#close-ration-overlay");
    await page.click('.ration-rail-flag[data-overlay="history"]');
    await page.click("#close-ration-overlay");
    await openRoute(page, "profile");
    await page.click("#edit-ration-profile");
    await page.click("#header-action");
    assert.deepEqual(external, [], "ration and profile flows must stay on the device");

    await openRoute(page, "requests");
    await page.click("#requests-empty-add");
    const line = page.locator("#request-items .request-line-editor").first();
    await line.click();
    await line.fill("Кефир");
    await page.waitForTimeout(900);
    assert.ok(external.every((host) => host === "world.openfoodfacts.org"), `unexpected hosts: ${external.join(", ")}`);
  } finally {
    await context.close();
  }
});

test("smoke: Android back closes an open ration overlay instead of leaving the app", async () => {
  const { context, page } = await openPage();
  try {
    await openRoute(page, "ration");
    await page.click('.ration-rail-flag[data-overlay="plan"]');
    await page.waitForSelector(".ration-overlay");
    assert.equal(await page.evaluate(() => window.__handleNativeBack()), true);
    assert.equal(await page.locator(".ration-overlay").count(), 0);
    assert.equal(await page.evaluate(() => window.__handleNativeBack()), false);
  } finally {
    await context.close();
  }
});

test("smoke: launch opens Рацион and a swipe moves Рацион → Спорт → Покупки", async () => {
  const { context, page } = await openPage();
  try {
    assert.equal(await currentPage(page), "ration");
    await page.waitForSelector(".ration-today");
    assert.equal(await page.locator("nav.bottom-nav").count(), 0);
    assert.equal(await page.locator("#page-slider-prev").innerText(), "");
    assert.equal(await page.locator("#page-slider-next").innerText(), "Спорт");

    // Past the first page the swipe does nothing.
    await swipePage(page, -1);
    await expectPage(page, "ration");

    await swipePage(page, 1);
    await expectPage(page, "sport");
    assert.match(await page.locator("#app").innerText(), /Скоро/);
    assert.equal(await page.locator("#page-slider-prev").innerText(), "Рацион");
    assert.equal(await page.locator("#page-slider-next").innerText(), "Покупки");

    await swipePage(page, 1);
    await expectPage(page, "requests");
    assert.equal(await page.locator("#page-title").innerText(), "Покупки");
    assert.equal(await page.locator("#header-action").innerText(), "Создать");
    await swipePage(page, 1);
    await expectPage(page, "requests");

    await swipePage(page, -1);
    await expectPage(page, "sport");

    // A short vertical drag scrolls instead of switching pages.
    const box = await page.locator("main").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + 40, { steps: 6 });
    await page.mouse.up();
    assert.equal(await currentPage(page), "sport");
  } finally {
    await context.close();
  }
});

test("smoke: a tap on the slider switches the mode on Рацион and does nothing on Покупки", async () => {
  const { context, page } = await openPage();
  try {
    const slider = page.locator("#page-slider");
    const activeMode = () => page.locator("#page-slider-modes .active").innerText();
    assert.equal(await activeMode(), "учёт");
    await slider.click();
    assert.equal(await activeMode(), "план");
    assert.equal(await currentPage(page), "ration", "the slider does not switch pages");

    await openRoute(page, "sport");
    assert.equal(await activeMode(), "учёт", "every page keeps its own mode");

    await openRoute(page, "requests");
    assert.equal(await page.locator("#page-slider-modes").isVisible(), false);
    assert.equal(await slider.getAttribute("aria-disabled"), "true");
    await slider.click({ force: true });
    assert.equal(await currentPage(page), "requests");
    assert.equal(await page.locator("#page-slider-modes").isVisible(), false);

    await openRoute(page, "ration");
    assert.equal(await activeMode(), "план", "the mode lasts for the session");
    await page.reload({ waitUntil: "load" });
    assert.equal(await activeMode(), "учёт", "a new launch opens Рацион in Учёт");
  } finally {
    await context.close();
  }
});

test("smoke: a swipe inside a request note does not switch pages", async () => {
  const { context, page } = await openPage();
  try {
    const now = new Date().toISOString();
    await seedState(page, {
      schemaVersion: 12,
      products: [{ id: "product_milk", name: "Молоко", unit: "л" }],
      requests: [{ id: "request_1", status: "open", createdAt: now, updatedAt: now, items: [{ productId: "product_milk", quantity: 1 }], responses: [] }],
    });
    await openRoute(page, "requests");
    await page.locator(".request-link").first().click();
    await page.waitForSelector("#request-items");
    assert.equal(await page.locator("#page-slider").isVisible(), false);
    assert.equal(await page.locator("#header-profile").isVisible(), false);

    const list = await page.locator("#request-items").boundingBox();
    await swipePage(page, 1, { from: { x: list.x + list.width / 2 + 90, y: list.y + list.height + 60 } });
    await swipePage(page, -1, { from: { x: list.x + list.width / 2 - 90, y: list.y + list.height + 60 } });
    assert.ok(await page.locator("#request-items").isVisible(), "the note stays open");
    assert.equal((await storedState(page)).requests[0].items.length, 1);

    await page.click("#header-action");
    assert.equal(await currentPage(page), "requests");
  } finally {
    await context.close();
  }
});

test("smoke: Android back returns Спорт and Покупки to Рацион and leaves the app from Рацион", async () => {
  const { context, page } = await openPage();
  try {
    const back = () => page.evaluate(() => window.__handleNativeBack());
    await openRoute(page, "requests");
    assert.equal(await back(), true);
    assert.equal(await currentPage(page), "ration");
    assert.equal(await back(), false);

    await openRoute(page, "sport");
    await openRoute(page, "profile");
    assert.equal(await back(), true);
    assert.equal(await currentPage(page), "sport", "Profile returns to the page it was opened from");
    assert.equal(await back(), true);
    assert.equal(await currentPage(page), "ration");
  } finally {
    await context.close();
  }
});

test("smoke: a tap on the check marks a request line bought and a second tap unmarks it", async () => {
  const { context, page } = await openPage();
  try {
    const now = new Date().toISOString();
    await seedState(page, {
      schemaVersion: 12,
      products: [{ id: "product_milk", name: "Молоко", unit: "л" }],
      requests: [{ id: "request_1", status: "open", createdAt: now, updatedAt: now, items: [{ productId: "product_milk", quantity: 2, unit: "л" }], responses: [] }],
    });
    await openRoute(page, "requests");
    await page.locator(".request-link").first().click();
    const check = page.locator('#request-items .request-item:not(.is-blank) .request-swipe-handle[role="checkbox"]');
    assert.equal(await check.getAttribute("aria-checked"), "false");
    await check.click();
    await page.waitForTimeout(120);
    assert.equal(await check.getAttribute("aria-checked"), "true");
    assert.equal(await page.locator("#answer-action-dialog[open]").count(), 0);
    let stored = await storedState(page);
    let lines = stored.requests[0].responses.filter((response) => !response.deletedAt).flatMap((response) => response.items);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].quantity, 2);

    await check.click();
    await page.waitForTimeout(120);
    assert.equal(await check.getAttribute("aria-checked"), "false");
    stored = await storedState(page);
    lines = stored.requests[0].responses.filter((response) => !response.deletedAt).flatMap((response) => response.items);
    assert.equal(lines.length, 0);

    await page.click("#toast-action");
    await page.waitForTimeout(120);
    assert.equal(await check.getAttribute("aria-checked"), "true");
  } finally {
    await context.close();
  }
});

test("smoke: opening another screen starts it from the top", async () => {
  const { context, page } = await openPage({ width: 412, height: 400 });
  try {
    await openRoute(page, "profile");
    await page.locator("main").evaluate((main) => main.scrollTo(0, 9999));
    assert.ok(await page.locator("main").evaluate((main) => main.scrollTop) > 0);
    await page.click("#edit-ration-profile");
    await page.waitForTimeout(80);
    assert.equal(await page.locator("main").evaluate((main) => main.scrollTop), 0);
  } finally {
    await context.close();
  }
});

test("smoke: unchecking a product in the meal card records that it was not eaten", async () => {
  const { context, page } = await openPage();
  try {
    await seedState(page, planState(dateKey(-5), {
      products: [{ id: "product_tea", name: "Чай", unit: "г" }],
      meals: [{ id: "meal_1", name: "Завтрак", time: "08:00", items: [{ id: "item_1", productId: "product_tea", name: "Чай" }] }],
    }));
    await openRoute(page, "ration");
    await page.click('.ration-today-meal-open[data-meal-id="meal_1"]');
    await page.waitForSelector("#ration-meal-dialog[open]");
    const check = () => page.locator('#ration-meal-dialog .ration-food-row[data-item-id="item_1"] .ration-item-check');
    assert.equal(await check().isChecked(), true);
    await check().uncheck();
    await page.waitForTimeout(80);
    let meal = Object.values((await storedState(page)).ration.history)[0].meals.meal_1;
    assert.deepEqual(meal.discrepancies.map((item) => [item.kind, item.productId]), [["excluded", "product_tea"]]);
    assert.equal(await check().isChecked(), false);
    await check().check();
    await page.waitForTimeout(80);
    meal = Object.values((await storedState(page)).ration.history)[0].meals.meal_1;
    assert.equal(meal.discrepancies.length, 0);

    await page.click("#close-ration-meal");
    await page.click('.ration-rail-flag[data-overlay="plan"]');
    await page.waitForSelector(".ration-overlay");
    assert.equal(await page.locator(".ration-overlay .ration-item-check").count(), 0);
  } finally {
    await context.close();
  }
});

test("smoke: product form saves from the header and asks before leaving unsaved changes", async () => {
  const { context, page } = await openPage(undefined, { hasTouch: true });
  try {
    await openProductCard(page, "product_tea");
    assert.equal(await page.locator("#header-action").innerText(), "Сохранить");
    assert.equal(await page.locator("#header-back").isVisible(), true);
    assert.equal(await page.locator("#delete-product").count(), 0);

    await page.fill("#product-form [name=name]", "Гречка");
    await page.click("#header-back");
    await page.waitForSelector("#app-confirm-dialog[open]");
    await page.click("#app-confirm-cancel");
    assert.equal(await page.locator("#product-form [name=name]").inputValue(), "Гречка");

    await page.click("#header-action");
    await page.waitForSelector("#request-items");
    const chip = page.locator('#request-items .product-chip[data-product-id="product_tea"]');
    assert.equal(await chip.innerText(), "Гречка");

    await chip.tap();
    await page.waitForSelector("#product-form");
    await page.fill("#product-form [name=name]", "Гречка ядрица");
    assert.equal(await page.evaluate(() => window.__handleNativeBack()), true);
    await page.click("#app-confirm-ok");
    await page.waitForSelector("#request-items");
    assert.equal(await chip.innerText(), "Гречка");
  } finally {
    await context.close();
  }
});

test("smoke: swiping a request line away says which item was removed", async () => {
  const { context, page } = await openPage();
  try {
    const now = new Date().toISOString();
    await seedState(page, {
      schemaVersion: 12,
      products: [{ id: "product_milk", name: "Молоко", unit: "л" }, { id: "product_bread", name: "Хлеб", unit: "шт." }],
      requests: [{ id: "request_1", status: "open", createdAt: now, updatedAt: now, items: [{ productId: "product_milk", quantity: 1 }, { productId: "product_bread", quantity: 1 }], responses: [] }],
    });
    await openRoute(page, "requests");
    await page.locator(".request-link").first().click();
    const row = page.locator("#request-items .request-item:not(.is-blank)").first();
    const box = await row.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 180, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#toast-message").innerText(), "Позиция «Молоко» удалена.");
    assert.deepEqual((await storedState(page)).requests[0].items.map((item) => item.productId), ["product_bread"]);
  } finally {
    await context.close();
  }
});
