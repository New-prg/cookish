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
// Coordinates come from the viewport: while the previous page still slides in,
// <main> is shifted and its box would put the start into the edge zone.
async function swipePage(page, step, { from } = {}) {
  await page.waitForFunction(() => document.getElementById("app").getAnimations().every((animation) => animation.playState !== "running"));
  const box = await page.locator("main").boundingBox();
  const { width } = page.viewportSize();
  const y = from?.y ?? box.y + Math.min(box.height / 2, 240);
  const x = from?.x ?? width / 2 + step * 90;
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

// Opens a meal row of Рацион Учёт; a past day first gets its row in the feed.
async function openMealRow(page, date, mealId) {
  if (date !== dateKey(0)) {
    for (let step = 0; step < 3 && !await page.locator(`.feed-day[data-date="${date}"]`).count(); step += 1) await page.click(".feed-more");
  }
  const day = page.locator(`.feed-day[data-date="${date}"]`);
  if (await day.count() && !await day.evaluate((node) => node.classList.contains("open"))) await day.locator(".feed-day-toggle").click();
  const row = page.locator(`.meal-row[data-date="${date}"][data-meal-id="${mealId}"]`);
  if (!await row.evaluate((node) => node.classList.contains("open"))) await row.locator(".meal-row-toggle").click();
  return page.locator(`.meal-row.open[data-date="${date}"][data-meal-id="${mealId}"]`);
}

// The full meal card (state, transfer, discrepancies) opens from «Подробнее».
async function openMealDetails(page, date, mealId) {
  const row = await openMealRow(page, date, mealId);
  await row.locator(".meal-details").click();
  await page.waitForSelector("#ration-meal-dialog[open]");
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

test("smoke: Рацион opens in Учёт on «Сегодня»; the button below adds 3 days, 3 more, then the history", async () => {
  const { context, page } = await openPage();
  try {
    await seedState(page, planState(dateKey(-40), {
      meals: [{ id: "meal_1", name: "Завтрак", time: "08:00", items: [] }],
    }));
    await openRoute(page, "ration");
    await page.waitForSelector(".ration-today");
    assert.equal(await page.locator(".ration-rail, .ration-overlay").count(), 0, "the flags and overlays are gone");
    assert.equal(await page.locator("#page-title").innerText(), "Учёт", "the header names the mode");
    assert.equal(await page.locator(".feed-head h2").innerText(), "Сегодня");
    assert.equal(await page.locator(".feed-day").count(), 0, "the page opens on one day");

    const bodyText = await page.locator("#app").innerText();
    assert.doesNotMatch(bodyText, /Цикл|Версия/);
    assert.match(bodyText, /не отмечено/);

    await page.click(".feed-more");
    const rows = page.locator(".feed-day");
    assert.equal(await rows.count(), 4, "«Показать вчера и раньше» adds 3 days");
    assert.equal(await rows.nth(0).getAttribute("data-date"), dateKey(0));
    assert.match(await rows.nth(0).innerText(), /Сегодня/);
    assert.match(await rows.nth(1).innerText(), /Вчера/);
    assert.equal(await page.locator(".ration-today-meal").count(), 0, "today folds into a row like the other days");
    await page.click(`.feed-day-toggle[data-date="${dateKey(-1)}"]`);
    assert.equal(await page.locator(`.feed-day[data-date="${dateKey(-1)}"] .ration-today-meal`).count(), 1, "a row opens its meals");
    await page.click(".feed-more");
    assert.equal(await rows.count(), 7);
    await page.click(".feed-more");
    assert.equal(await rows.count(), 41, "then the whole history back to the plan start");
    assert.equal(await page.locator(".feed-more").count(), 0);
    await page.click(".feed-less");
    assert.equal(await rows.count(), 0, "«Свернуть» returns to today");

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

test("smoke: План starts with tomorrow, edits a future day and requests a range", async () => {
  const { context, page } = await openPage();
  try {
    await openRoute(page, "ration");
    await page.click("#page-slider");
    await page.waitForSelector(".ration-plan-day");
    assert.equal(await page.locator("#page-title").innerText(), "План");
    const days = page.locator(".ration-plan-day");
    assert.equal(await days.count(), 1, "План opens on one day");
    assert.equal(await days.first().getAttribute("data-date"), dateKey(1));
    assert.equal(await page.locator(".feed-head h2").innerText(), "Завтра");
    assert.equal(await page.locator(".ration-today, .ration-past-day").count(), 0, "План shows no past and no «Сегодня»");

    await days.first().locator(".ration-plan-edit").click();
    await page.waitForSelector(".ration-plan-day.expanded .add-ration-meal");
    await page.click(".ration-plan-day.expanded .add-ration-meal");
    await page.waitForSelector(".ration-plan-day.expanded .add-ration-food");
    await page.click(".ration-plan-day.expanded .add-ration-food");
    const input = page.locator(".ration-plan-day.expanded .ration-food-input").last();
    await input.fill("Крупа");
    await page.locator(".ration-plan-day.expanded .save-ration-food").last().click();
    await page.waitForTimeout(80);
    assert.equal(await page.locator("#ration-meal-dialog").count(), 0, "a plan edit never opens today's meal card");

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cookish.android.data.v1")));
    const specialDates = Object.keys(stored.ration.specialDays);
    assert.deepEqual(specialDates, [`local|${dateKey(1)}`]);
    assert.match(await days.first().innerText(), /Особый день/);

    await page.click(".feed-request");
    await page.waitForSelector("#ration-request-dialog[open]");
    await page.click("#ration-plan-request button[type=submit]");
    await page.waitForSelector("#request-items");
    const afterRequest = await page.evaluate(() => JSON.parse(localStorage.getItem("cookish.android.data.v1")));
    assert.equal(afterRequest.requests.length, 1);
    assert.equal(afterRequest.requests[0].items[0].unit, "уп.");
  } finally {
    await context.close();
  }
});

test("smoke: empty days stay quiet in Учёт and План", async () => {
  const { context, page } = await openPage();
  try {
    await openRoute(page, "ration");
    await page.waitForSelector(".ration-today");
    assert.match(await page.locator(".feed-empty").innerText(), /рацион пуст/);
    assert.equal(await page.locator(".feed-more, .ration-today-totals").count(), 0, "no history to show and no zero totals");

    await page.click("#page-slider");
    await page.waitForSelector(".ration-plan-day");
    assert.match(await page.locator(".feed-empty").innerText(), /план пуст/);
    assert.equal(await page.locator(".feed-more").count(), 0, "an empty plan has no more days to show");
    await page.click("#page-slider");

    // A plan from 9 days ago with three empty days: their rows say so.
    const state = planState(dateKey(-9), { meals: [{ id: "meal_1", name: "Завтрак", time: "08:00", items: [] }] });
    state.ration.specialDays = Object.fromEntries([-2, -3, -4].map((offset) => [`local|${dateKey(offset)}`, { date: dateKey(offset), meals: [] }]));
    await seedState(page, state);
    await page.waitForSelector(".ration-today");
    await page.click(".feed-more");
    assert.match(await page.locator(`.feed-day[data-date="${dateKey(-2)}"]`).innerText(), /не было/);
    await page.click(".feed-more");
    await page.click(".feed-more");
    assert.equal(await page.locator(".feed-day").count(), 10, "nothing before the plan starts");
    assert.equal(await page.locator(".feed-more").count(), 0);
  } finally {
    await context.close();
  }
});

test("smoke: a Спорт day row opens to add an activity to that day", async () => {
  const { context, page } = await openPage();
  try {
    await seedState(page, sportState());
    await openRoute(page, "sport");
    await page.waitForSelector(".sport-today");
    await page.click(".feed-more");
    assert.equal(await page.locator(".feed-day").count(), 4);
    assert.match(await page.locator(`.feed-day[data-date="${dateKey(-2)}"]`).innerText(), /Бег 40 мин/);
    await page.click(`.feed-day-toggle[data-date="${dateKey(-2)}"]`);
    await page.waitForSelector(`.feed-day[data-date="${dateKey(-2)}"] .sport-add-past`);
  } finally {
    await context.close();
  }
});

test("smoke: each ration mode keeps its scroll position for the session", async () => {
  const { context, page } = await openPage({ width: 412, height: 600 });
  try {
    await seedState(page, planState(dateKey(-40), {
      meals: [{ id: "meal_1", name: "Завтрак", time: "08:00", items: [] }],
    }));
    const main = page.locator("main");
    for (let step = 0; step < 3; step += 1) await page.click(".feed-more");
    await main.evaluate((node) => node.scrollTo(0, 400));
    await page.click("#page-slider");
    await page.waitForSelector(".ration-plan-day");
    assert.equal(await main.evaluate((node) => node.scrollTop), 0, "План opens on tomorrow");
    for (let step = 0; step < 3; step += 1) await page.click(".feed-more");
    await main.evaluate((node) => node.scrollTo(0, 250));
    await page.click("#page-slider");
    await page.waitForSelector(".ration-today");
    assert.equal(await main.evaluate((node) => node.scrollTop), 400);
    await openRoute(page, "sport");
    await openRoute(page, "ration");
    assert.equal(await main.evaluate((node) => node.scrollTop), 400, "the position survives leaving the page");
    await page.click("#page-slider");
    assert.equal(await main.evaluate((node) => node.scrollTop), 250);
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
    await page.click("#ration-add-meal");
    await page.click("#close-ration-meal");
    // Closing the card re-renders the feed; measure the new button.
    await page.waitForSelector("#ration-meal-dialog", { state: "detached" });
    const eat = await page.locator(".ration-eat-button").first().boundingBox();
    assert.ok(eat.x + eat.width <= 360, "the eat action must fit at 360 px");
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

test("smoke: Учёт corrects the state of a past meal, not today", async () => {
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
    const pastDate = dateKey(-2);
    await openMealDetails(page, pastDate, "meal_1");
    assert.equal(await page.locator("#ration-meal-dialog .ration-food-input, #ration-meal-dialog .ration-transfer-button").count(), 0, "the past plan is read-only");
    await page.click('#ration-meal-dialog .ration-state-set[data-state="skipped"]');
    await page.waitForTimeout(80);

    const { history } = (await storedState(page)).ration;
    assert.deepEqual(Object.keys(history), [`local|${pastDate}`]);
    assert.equal(history[`local|${pastDate}`].meals.meal_1.state, "skipped");
    await page.click("#close-ration-meal");
    assert.match(await page.locator(`.meal-row[data-date="${pastDate}"]`).innerText(), /не съедено/);
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
    await openMealDetails(page, today, "meal_1");
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
    await seedState(page, planState(dateKey(0), { meals: [{ id: "meal_1", name: "Завтрак", time: "08:00", items: [] }] }));
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

    assert.match(await page.locator(".ration-today-totals").innerText(), /из 2[\s ]?100 ккал съедено/);
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

test("smoke: План shows КБЖУ and repeats a day with undo", async () => {
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
    await page.click("#page-slider");
    const first = page.locator(".ration-plan-day").first();
    assert.match(await first.innerText(), /350 ккал/);
    assert.match(await first.locator(".day-summary").innerText(), /350\s*ккал по плану[\s\S]*12/);

    await first.locator(".ration-plan-edit").click();
    await page.click('.ration-repeat-button[data-length="1"]');
    await page.click("#app-confirm-ok");
    await page.waitForTimeout(80);
    await page.click(".feed-more");
    await page.click(".feed-more");
    assert.match(await page.locator(`.feed-day[data-date="${dateKey(6)}"]`).innerText(), /Завтрак.*350 ккал/s);
    assert.doesNotMatch(await page.locator(".ration-feed").innerText(), /Цикл|Версия/);
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
    await openMealDetails(page, dateKey(0), "meal_1");
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
    const pastDate = dateKey(-1);
    await openMealDetails(page, pastDate, "meal_1");
    const pastForm = page.locator("#ration-meal-dialog .ration-discrepancy-form");
    await pastForm.locator("[name=kind]").selectOption("replaced");
    await pastForm.locator("[name=name]").fill("Кофе");
    await pastForm.locator("button[type=submit]").click();
    await page.waitForTimeout(80);
    const past = (await storedState(page)).ration.history[`local|${pastDate}`].meals.meal_1;
    assert.deepEqual(past.discrepancies, [{ kind: "replaced", productId: "product_tea", name: "Чай", replacedName: "Кофе" }]);
    assert.match(await page.locator("#ration-meal-dialog .ration-history-discrepancies").innerText(), /Заменён: Чай → Кофе/);
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
    await page.click("#page-slider");
    await page.locator(".ration-plan-edit").first().click();
    await page.click("#page-slider");
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

test("smoke: Android back on Рацион closes the request dialog, then leaves the app in any mode", async () => {
  const { context, page } = await openPage();
  try {
    const back = () => page.evaluate(() => window.__handleNativeBack());
    await seedState(page, planState(dateKey(0), { meals: [{ id: "meal_1", name: "Завтрак", time: "08:00", items: [] }] }));
    await openRoute(page, "ration");
    await page.click("#page-slider");
    await page.click(".feed-request");
    await page.waitForSelector("#ration-request-dialog[open]");
    assert.equal(await back(), true);
    assert.equal(await page.locator("#ration-request-dialog[open]").count(), 0);
    assert.equal(await back(), false, "План is a mode, not an overlay");
    assert.equal(await page.locator("#page-title").innerText(), "План");
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
    assert.match(await page.locator(".sport-feed .feed-head").innerText(), /Сегодня/);
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
    const activeMode = () => page.locator("#page-title").innerText();
    assert.equal(await activeMode(), "Учёт");
    await slider.click();
    assert.equal(await activeMode(), "План");
    assert.equal(await currentPage(page), "ration", "the slider does not switch pages");

    await openRoute(page, "sport");
    assert.equal(await activeMode(), "Учёт", "every page keeps its own mode");
    assert.equal(await page.evaluate(() => document.body.dataset.mode), "log", "Учёт colors the page green");

    await openRoute(page, "requests");
    assert.equal(await activeMode(), "Покупки");
    assert.equal(await slider.getAttribute("aria-disabled"), "true");
    await slider.click({ force: true });
    assert.equal(await currentPage(page), "requests");
    assert.equal(await activeMode(), "Покупки");

    await openRoute(page, "ration");
    assert.equal(await activeMode(), "План", "the mode lasts for the session");
    assert.equal(await page.evaluate(() => document.body.dataset.mode), "plan", "План colors the page blue");
    await page.reload({ waitUntil: "load" });
    assert.equal(await activeMode(), "Учёт", "a new launch opens Рацион in Учёт");
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

test("smoke: an open meal row edits what was eaten and recounts ккал at once", async () => {
  const { context, page } = await openPage();
  try {
    await seedState(page, planState(dateKey(-5), {
      products: [
        { id: "product_oats", name: "Овсянка", unit: "г", nutrition: { calories: 350, protein: 12, fat: 6, carbs: 60, fiber: 10 } },
        { id: "product_kefir", name: "Кефир", unit: "мл", nutrition: { calories: 50, protein: 3, fat: 2.5, carbs: 4, fiber: 0 } },
      ],
      meals: [{ id: "meal_1", name: "Завтрак", time: "08:00", items: [
        { id: "item_1", productId: "product_oats", name: "Овсянка", portionSize: 100 },
        { id: "item_2", productId: "product_kefir", name: "Кефир", portionSize: 200 },
      ] }],
    }));
    await openRoute(page, "ration");
    const eaten = () => page.locator(".day-summary-main strong").innerText();
    assert.equal(await eaten(), "0");
    let row = await openMealRow(page, dateKey(0), "meal_1");
    await row.locator(".meal-all-eaten").click();
    assert.equal(await eaten(), "450", "everything eaten: 350 + 100 ккал");
    assert.match(await page.locator(".meal-row .ration-state-chip").innerText(), /^съедено$/);

    row = page.locator(".meal-row.open");
    await row.locator('.meal-amount-step[data-item-id="item_1"][data-step="1"]').click();
    assert.equal(await eaten(), "485", "10 г more oats add 35 ккал");
    assert.match(await page.locator(".meal-row .ration-state-chip").innerText(), /изменено · по плану 450/);

    await page.locator('.meal-row.open .meal-product-check[data-item-id="item_2"]').click();
    assert.equal(await eaten(), "385", "unchecked kefir is not counted");

    await page.locator(".meal-row.open .meal-extra-add").click();
    await page.fill(".meal-extra-form [name=name]", "Овсянка");
    await page.fill(".meal-extra-form [name=amount]", "20");
    await page.click(".meal-extra-form button[type=submit]");
    assert.equal(await eaten(), "455", "food outside the plan adds its ккал");
    let meal = (await storedState(page)).ration.history[`local|${dateKey(0)}`].meals.meal_1;
    assert.equal(meal.state, "changed");
    assert.deepEqual(meal.discrepancies.map((item) => item.kind).sort(), ["added", "amount", "excluded"]);

    await page.locator(".meal-row.open .meal-skip").click();
    assert.equal(await eaten(), "0");
    meal = (await storedState(page)).ration.history[`local|${dateKey(0)}`].meals.meal_1;
    assert.equal(meal.state, "skipped");
    assert.equal(meal.discrepancies.length, 0);
    await page.locator(".meal-row.open .meal-all-eaten").click();
    assert.equal(await eaten(), "450");
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
    await openMealDetails(page, dateKey(0), "meal_1");
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
    await page.click("#page-slider");
    await page.locator(".ration-plan-edit").first().click();
    await page.waitForSelector(".ration-plan-day.expanded .ration-food-row");
    assert.equal(await page.locator(".ration-feed .ration-item-check").count(), 0);
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

// routerai.ru stand-in for the browser tests: answers the CORS preflight and
// passes every other request to `handler(request)` → { status, body }.
async function routeAi(context, handler) {
  const calls = [];
  await context.route("https://routerai.ru/**", async (route) => {
    const request = route.request();
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    calls.push({ method: request.method(), url: request.url(), headers: request.headers(), body: request.postDataJSON?.() ?? null });
    const answer = await handler(request, calls.length - 1);
    return route.fulfill({ status: answer.status || 200, headers: cors, contentType: "application/json", body: JSON.stringify(answer.body ?? {}) });
  });
  return calls;
}

test("smoke: Profile keeps the AI key on the device, checks it after one warning and deletes it", async () => {
  const { context, page } = await openPage();
  try {
    const calls = await routeAi(context, (request) => request.headers().authorization === "Bearer good-key"
      ? { status: 200, body: { data: { label: "test" } } }
      : { status: 401, body: { error: { message: "Invalid key bad-key" } } });
    await openRoute(page, "profile");
    assert.match(await page.locator(".profile-ai").innerText(), /Ключ ИИ \(тест\)/);
    assert.match(await page.locator("#ai-key-status").innerText(), /не задан/);
    assert.equal(await page.locator("#ai-key-input").getAttribute("type"), "password");
    assert.equal(await page.locator("#ai-key-delete").isDisabled(), true);

    await page.fill("#ai-key-input", "bad-key");
    await page.click("#ai-key-check");
    await page.waitForSelector("#app-confirm-dialog[open]");
    assert.match(await page.locator("#app-confirm-message").innerText(), /routerai\.ru/);
    await page.click("#app-confirm-ok");
    await page.waitForFunction(() => /не подошёл/.test(document.getElementById("ai-key-status").textContent));
    assert.doesNotMatch(await page.locator("#app").innerText(), /bad-key/);

    await page.fill("#ai-key-input", "good-key");
    await page.click("#ai-key-check");
    await page.waitForFunction(() => /Ключ работает/.test(document.getElementById("ai-key-status").textContent));
    assert.equal(await page.locator("#app-confirm-dialog[open]").count(), 0, "the warning shows only once");
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.method === "GET" && call.url === "https://routerai.ru/api/v1/key"));
    const stored = await page.evaluate(() => ({
      key: localStorage.getItem("cookish.ai.key.test"),
      data: localStorage.getItem("cookish.android.data.v1") || "",
    }));
    assert.equal(stored.key, "good-key");
    assert.doesNotMatch(stored.data, /good-key/);
    assert.equal(await page.locator("#ai-key-input").inputValue(), "", "the saved key is not shown back");

    await page.click("#ai-key-delete");
    await page.click("#app-confirm-ok");
    await page.waitForFunction(() => /удалён/.test(document.getElementById("ai-key-status").textContent));
    assert.equal(await page.evaluate(() => localStorage.getItem("cookish.ai.key.test")), null);
  } finally {
    await context.close();
  }
});

const aiMessage = (message) => ({ status: 200, body: { choices: [{ message }] } });
const aiToolCall = (name, args, id) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

function assistantPlanState() {
  return {
    schemaVersion: 13,
    products: [
      { id: "product_oats", name: "Овсянка", unit: "г", nutrition: { calories: 350, protein: 12, fat: 6, carbs: 60, fiber: 10 } },
      { id: "product_curd", name: "Творог", unit: "г", nutrition: { calories: 121, protein: 17, fat: 5, carbs: 2, fiber: 0 } },
    ],
    requests: [],
    ration: {
      versions: [{
        id: "version_1",
        owner: "local",
        effectiveFrom: dateKey(-3),
        cycle: { anchor: dateKey(-3), weekdayBinding: false, days: [{ id: "cycle_1", meals: [
          { id: "meal_1", name: "Завтрак", time: "08:00", items: [{ id: "item_1", productId: "product_oats", name: "Овсянка", portionSize: 150 }] },
          { id: "meal_2", name: "Ужин", time: "19:00", items: [{ id: "item_2", productId: "product_curd", name: "Творог", portionSize: 300 }] },
        ] }] },
      }],
      specialDays: {},
      history: {},
    },
  };
}

const bigDay = [
  { name: "Завтрак", time: "08:00", items: [{ product: "Овсянка", amount: 200 }] },
  { name: "Ужин", time: "19:00", items: [{ product: "Творог", amount: 500 }] },
];

async function withAssistantKey(page, state = assistantPlanState()) {
  await page.evaluate(() => {
    localStorage.setItem("cookish.ai.key.test", "test-key");
    localStorage.setItem("cookish.ai.consent.v1", "1");
  });
  await seedState(page, state);
}

async function askAssistant(page, text) {
  await page.click("#assistant-handle");
  await page.waitForSelector("#assistant-dialog[open]");
  await page.fill("#assistant-input", text);
  await page.click("#assistant-send");
}

test("smoke: the assistant handle opens the chat on every root page with its context", async () => {
  const { context, page } = await openPage();
  try {
    const calls = await routeAi(context, () => ({ status: 500 }));
    await withAssistantKey(page);
    const viewport = page.viewportSize();
    const titles = { ration: "Рацион · Учёт", sport: "Спорт · Учёт", requests: "Покупки" };
    let handleTop = null;
    for (const route of ROOT_PAGES) {
      await openRoute(page, route);
      const handle = await page.locator("#assistant-handle").boundingBox();
      assert.ok(handle.height <= 200, "the handle is at most 200 dp tall");
      assert.ok(Math.abs(handle.x + handle.width - viewport.width) <= 1, "the handle sits at the right edge");
      handleTop ??= handle.y;
      assert.equal(handle.y, handleTop, "the handle keeps one height on every page");
      await page.click("#assistant-handle");
      await page.waitForSelector("#assistant-dialog[open]");
      assert.equal(await page.locator("#assistant-title").innerText(), titles[route]);
      const suggestions = await page.locator(".assistant-suggestion").count();
      assert.ok(suggestions >= 2 && suggestions <= 3, `2–3 suggestions on ${route}`);
      assert.equal(await page.locator("#assistant-input").inputValue(), "");
      assert.equal(await page.locator("#assistant-handle").isVisible(), false);
      await page.click("#assistant-close");
      assert.equal(await page.locator("#assistant-dialog[open]").count(), 0);
    }

    await openRoute(page, "ration");
    await page.click("#page-slider");
    const box = await page.locator("#assistant-handle").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 80, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForSelector("#assistant-dialog[open]");
    assert.equal(await page.locator("#assistant-title").innerText(), "Рацион · План", "a pull opens the chat too");
    await page.locator(".assistant-suggestion").first().click();
    assert.notEqual(await page.locator("#assistant-input").inputValue(), "", "a suggestion fills the input");
    assert.equal(await page.evaluate(() => window.__handleNativeBack()), true, "Android back closes the chat");
    assert.equal(await page.locator("#assistant-dialog[open]").count(), 0);
    assert.equal(calls.length, 0, "no LLM call until a message is sent");
  } finally {
    await context.close();
  }
});

test("smoke: «Применить все» writes one journal set and a card can undo it", async () => {
  const { context, page } = await openPage();
  try {
    const calls = await routeAi(context, (request, index) => index === 0
      ? aiMessage({ role: "assistant", content: "", tool_calls: [
        aiToolCall("get_plan", { from: dateKey(1), to: dateKey(2) }, "c1"),
        aiToolCall("set_special_day", { date: dateKey(1), meals: bigDay }, "c2"),
        aiToolCall("set_special_day", { date: dateKey(2), meals: bigDay }, "c3"),
      ] })
      : aiMessage({ role: "assistant", content: "Предлагаю два дня с большими порциями." }));
    await withAssistantKey(page);
    await askAssistant(page, "Увеличь порции на два дня");
    await page.waitForSelector(".assistant-proposal >> nth=1");
    await page.waitForSelector(".assistant-message.from-assistant");
    assert.match(await page.locator(".assistant-progress").first().innerText(), /Читаю план/);
    const card = page.locator(".assistant-proposal").first();
    assert.match(await card.innerText(), /Особый день/);
    assert.match(await card.innerText(), /Было: 08:00 · Овсянка 150 г/);
    assert.match(await card.innerText(), /Стало: 08:00 · Овсянка 200 г/);
    assert.match(await card.innerText(), /Δ \+/);
    assert.equal((await storedState(page)).journal?.length ?? 0, 0, "proposals write nothing");
    const system = calls[0].body.messages[0].content;
    assert.match(system, /«Рацион · Учёт»/);
    assert.ok(calls[0].body.tools.some((tool) => tool.function.name === "set_special_day"));

    await page.click("#assistant-apply-all");
    await page.waitForSelector(".assistant-proposal.status-applied >> nth=1");
    const stored = await storedState(page);
    assert.equal(stored.journal.length, 1);
    assert.equal(stored.journal[0].actor, "ai");
    assert.deepEqual(Object.keys(stored.ration.specialDays).sort(), [`local|${dateKey(1)}`, `local|${dateKey(2)}`]);
    assert.equal(await page.locator("#assistant-apply-bar").isVisible(), false);

    await card.locator('[data-proposal-action="undo"]').click();
    await page.waitForSelector(".assistant-proposal.status-reverted >> nth=1");
    const undone = await storedState(page);
    assert.deepEqual(undone.ration.specialDays, {});
    assert.equal(undone.journal.length, 2);
  } finally {
    await context.close();
  }
});

test("smoke: closing the chat with unapplied proposals asks to apply or discard them", async () => {
  const { context, page } = await openPage();
  try {
    let turn = 0;
    await routeAi(context, () => (turn++ % 2 === 0)
      ? aiMessage({ role: "assistant", content: "", tool_calls: [aiToolCall("set_special_day", { date: dateKey(1), meals: bigDay }, `c${turn}`)] })
      : aiMessage({ role: "assistant", content: "Готово." }));
    await withAssistantKey(page);
    await askAssistant(page, "Больше еды завтра");
    await page.waitForSelector(".assistant-proposal");
    await page.waitForSelector(".assistant-message.from-assistant");

    await page.click("#assistant-close");
    await page.waitForSelector("#app-choice-dialog[open]");
    assert.match(await page.locator("#app-choice-options").innerText(), /Применить 1/);
    assert.match(await page.locator("#app-choice-options").innerText(), /Отбросить/);
    assert.equal(await page.evaluate(() => window.__handleNativeBack()), true, "back closes the question first");
    assert.equal(await page.locator("#assistant-dialog[open]").count(), 1, "the chat stays open");

    await page.click("#assistant-close");
    await page.click('#app-choice-options button:has-text("Отбросить")');
    assert.equal(await page.locator("#assistant-dialog[open]").count(), 0);
    assert.equal((await storedState(page)).journal?.length ?? 0, 0);
    await page.click("#assistant-handle");
    assert.equal(await page.locator(".assistant-proposal").count(), 0, "a closed thread is gone");
    assert.ok(await page.locator(".assistant-suggestion").count() > 0);

    await page.fill("#assistant-input", "Больше еды завтра");
    await page.click("#assistant-send");
    await page.waitForSelector(".assistant-message.from-assistant");
    assert.equal(await page.evaluate(() => window.__handleNativeBack()), true);
    await page.click('#app-choice-options button:has-text("Применить 1")');
    await page.waitForFunction(() => !document.getElementById("assistant-dialog").open);
    const stored = await storedState(page);
    assert.equal(stored.journal.length, 1);
    assert.deepEqual(Object.keys(stored.ration.specialDays), [`local|${dateKey(1)}`]);
  } finally {
    await context.close();
  }
});

test("smoke: without a key the handle says the AI is unavailable and nothing is sent", async () => {
  const { context, page } = await openPage();
  try {
    const calls = await routeAi(context, () => ({ status: 200, body: {} }));
    await openRoute(page, "ration");
    assert.equal(await page.locator("#assistant-handle").getAttribute("aria-label"), "ИИ недоступен: добавьте ключ в Профиле");
    await page.click("#assistant-handle");
    await page.waitForSelector("#assistant-dialog[open]");
    assert.match(await page.locator("#assistant-feed").innerText(), /ИИ недоступен: добавьте ключ в Профиле/);
    assert.equal(await page.locator("#assistant-form").isVisible(), false);
    await page.click("#assistant-open-profile");
    await page.waitForSelector(".profile-ai");
    assert.equal(calls.length, 0);
  } finally {
    await context.close();
  }
});

test("smoke: a Тычок notice shows a badge and a teaser and opens the chat as its first message", async () => {
  const { context, page } = await openPage();
  try {
    const calls = await routeAi(context, () => ({ status: 500 }));
    const state = assistantPlanState();
    state.assistant = { settings: { strictness: "any", howToReact: "" }, nudges: [], notice: { text: "Ужин вчера пропущен. Перенести творог на завтрак?", createdAt: new Date().toISOString() } };
    await withAssistantKey(page, state);
    assert.equal(await page.locator("#assistant-handle-badge").isVisible(), true);
    assert.match(await page.locator("#assistant-teaser").innerText(), /Ужин вчера пропущен/);
    await openRoute(page, "sport");
    assert.equal(await page.locator("#assistant-teaser").isVisible(), true, "the notice waits on every root page");

    await page.click("#assistant-teaser");
    await page.waitForSelector("#assistant-dialog[open]");
    assert.match(await page.locator(".assistant-message.from-assistant").first().innerText(), /Ужин вчера пропущен/);
    assert.equal((await storedState(page)).assistant.notice, null, "the notice is read");
    await page.click("#assistant-close");
    assert.equal(await page.locator("#assistant-handle-badge").isVisible(), false);
    assert.equal(await page.locator("#assistant-teaser").isVisible(), false);
    assert.equal(calls.length, 0, "showing the notice calls nothing");
  } finally {
    await context.close();
  }
});

test("smoke: marking a meal «не съедено» queues a Тычок, and Profile sets the strictness", async () => {
  const { context, page } = await openPage();
  try {
    await seedState(page, assistantPlanState());
    await openRoute(page, "ration");
    await openMealDetails(page, dateKey(0), "meal_2");
    await page.click('#ration-meal-dialog .ration-state-set[data-state="skipped"]');
    await page.waitForTimeout(80);
    const { nudges } = (await storedState(page)).assistant;
    assert.equal(nudges.length, 1);
    assert.equal(nudges[0].kind, "meal_skipped");

    await page.click("#close-ration-meal");
    await openRoute(page, "profile");
    assert.equal(await page.locator('.profile-strictness input[value="any"]').isChecked(), true);
    await page.locator('.profile-strictness input[value="notable"]').check();
    await page.fill("#ai-how-to-react", "Коротко");
    await page.locator("#ai-how-to-react").blur();
    await page.waitForTimeout(80);
    assert.deepEqual((await storedState(page)).assistant.settings, { strictness: "notable", howToReact: "Коротко" });
  } finally {
    await context.close();
  }
});

function proposingAi(context) {
  let turn = 0;
  return routeAi(context, () => (turn++ % 2 === 0)
    ? aiMessage({ role: "assistant", content: "", tool_calls: [aiToolCall("set_special_day", { date: dateKey(1), meals: bigDay }, `c${turn}`)] })
    : aiMessage({ role: "assistant", content: "Предлагаю больше еды завтра." }));
}

test("smoke: a thread without a bookmark is gone; a bookmark keeps it across a restart", async () => {
  const { context, page } = await openPage();
  try {
    await proposingAi(context);
    await withAssistantKey(page);
    await askAssistant(page, "Больше еды завтра");
    await page.waitForSelector(".assistant-message.from-assistant");
    await page.click("#assistant-close");
    const options = page.locator("#app-choice-options");
    assert.match(await options.innerText(), /Применить 1[\s\S]*Отбросить[\s\S]*В закладки/);
    await page.click('#app-choice-options button:has-text("Отбросить")');
    assert.deepEqual((await storedState(page)).assistant?.bookmarks ?? [], [], "a closed thread is not saved");

    await askAssistant(page, "Больше еды завтра, сохраню");
    await page.waitForSelector(".assistant-message.from-assistant");
    await page.click("#assistant-close");
    await page.click('#app-choice-options button:has-text("В закладки")');
    await page.waitForFunction(() => !document.getElementById("assistant-dialog").open);
    let [saved] = (await storedState(page)).assistant.bookmarks;
    assert.equal(saved.title, "Больше еды завтра, сохраню");
    assert.equal(saved.proposals.length, 1);
    assert.ok(saved.messages.length >= 3);

    await page.reload({ waitUntil: "load" });
    await page.click("#assistant-handle");
    await page.click("#assistant-bookmarks");
    assert.match(await page.locator(".assistant-bookmark").innerText(), /Больше еды завтра, сохраню/);
    await page.click(".assistant-bookmark-open");
    assert.match(await page.locator(".assistant-message.from-user").innerText(), /сохраню/);
    assert.equal(await page.locator(".assistant-proposal.status-pending").count(), 1);
    assert.equal(await page.locator("#assistant-bookmark-save.saved").count(), 1);

    // A bookmarked thread is saved again on close without a question.
    await page.click(".assistant-proposal [data-proposal-action=apply]");
    await page.click("#assistant-close");
    assert.equal(await page.locator("#app-choice-dialog[open]").count(), 0);
    [saved] = (await storedState(page)).assistant.bookmarks;
    assert.equal(saved.proposals.length, 0, "an applied proposal leaves the bookmark");

    await page.click("#assistant-handle");
    await page.click("#assistant-bookmarks");
    await page.click(".assistant-bookmark-remove");
    await page.click("#app-confirm-ok");
    await page.waitForFunction(() => !document.querySelector(".assistant-bookmark"));
    assert.deepEqual((await storedState(page)).assistant.bookmarks, []);
  } finally {
    await context.close();
  }
});

test("smoke: a stale proposal from a bookmark shows a conflict instead of applying", async () => {
  const { context, page } = await openPage();
  try {
    await proposingAi(context);
    await withAssistantKey(page);
    await askAssistant(page, "Больше еды завтра");
    await page.waitForSelector(".assistant-message.from-assistant");
    await page.click("#assistant-bookmark-save");
    await page.click("#assistant-close");

    // The person edits tomorrow by hand in План.
    await page.click("#page-slider");
    await page.locator(".ration-plan-edit").first().click();
    await page.click(".ration-plan-day.expanded .add-ration-meal");
    await page.waitForTimeout(80);

    await page.click("#assistant-handle");
    await page.click("#assistant-bookmarks");
    await page.click(".assistant-bookmark-open");
    const card = page.locator(".assistant-proposal");
    assert.match(await card.innerText(), /Конфликт/);
    assert.equal(await card.locator("[data-proposal-action=apply]").count(), 0);
    assert.match(await page.locator("#toast-message").innerText(), /устарело/);
    const stored = await storedState(page);
    assert.equal(stored.journal.filter((set) => set.actor === "ai").length, 0, "nothing applied silently");
  } finally {
    await context.close();
  }
});

function sportState({ weightKg = 80 } = {}) {
  return {
    schemaVersion: 14,
    products: [],
    requests: [],
    ration: { versions: [], specialDays: {}, history: {}, profile: weightKg ? { weightKg } : {} },
    sport: {
      versions: [{
        id: "sport_version_1",
        owner: "local",
        effectiveFrom: dateKey(-10),
        cycle: { anchor: dateKey(-10), weekdayBinding: false, days: [{ id: "d1", sessions: [{ id: "s1", type: "run", time: "07:30", durationMin: 40, intensity: "medium", note: "" }] }] },
      }],
      specialDays: {},
      log: {},
    },
  };
}

test("smoke: Спорт Учёт marks a session and records unplanned activity offline", async () => {
  const { context, page } = await openPage();
  try {
    const external = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "127.0.0.1") return route.continue();
      external.push(url.hostname);
      return route.abort();
    });
    await seedState(page, sportState());
    await openRoute(page, "sport");
    const today = page.locator(".sport-today");
    assert.match(await today.innerText(), /Бег/);
    assert.match(await today.innerText(), /не отмечено/);
    assert.match(await today.locator(".sport-energy").innerText(), /0 ккал/);

    await today.locator('.sport-mark[data-state="done"]').click();
    await page.waitForTimeout(80);
    let stored = await storedState(page);
    assert.equal(stored.sport.log[`local|${dateKey(0)}`].sessions.s1.state, "done");
    assert.match(await page.locator(".sport-today .ration-state-chip").innerText(), /выполнено/);
    assert.match(await page.locator(".sport-today .sport-energy").innerText(), /\d+ ккал/);

    await page.click(".sport-today .sport-add-activity");
    await page.waitForSelector("#sport-session-dialog[open]");
    await page.selectOption("#sport-session-form [name=type]", "walk");
    await page.fill("#sport-session-form [name=durationMin]", "30");
    await page.click("#sport-session-form button[type=submit]");
    await page.waitForTimeout(80);
    stored = await storedState(page);
    const entry = stored.sport.log[`local|${dateKey(0)}`];
    assert.equal(entry.unplanned.length, 1);
    assert.equal(entry.unplanned[0].type, "walk");
    assert.equal(entry.unplanned[0].durationMin, 30);
    assert.match(await page.locator(".sport-unplanned").innerText(), /Ходьба/);
    assert.equal(stored.journal?.length ?? 0, 0, "the log is not journaled");

    // A past session is corrected from its card with actual values.
    await page.click(".feed-more");
    await page.click(`.feed-day-toggle[data-date="${dateKey(-1)}"]`);
    await page.click(`.sport-past-session[data-date="${dateKey(-1)}"]`);
    await page.waitForSelector("#sport-session-dialog[open]");
    await page.click('#sport-session-states [data-state="changed"]');
    await page.fill("#sport-session-form [name=durationMin]", "25");
    await page.click("#sport-session-form button[type=submit]");
    await page.waitForTimeout(80);
    stored = await storedState(page);
    assert.deepEqual(stored.sport.log[`local|${dateKey(-1)}`].sessions.s1, { state: "changed", actualDurationMin: 25, actualIntensity: "medium" });
    assert.deepEqual(external, [], "Спорт works offline");
  } finally {
    await context.close();
  }
});

test("smoke: Спорт План edits one date as a Особый день and the week schedule from a date", async () => {
  const { context, page } = await openPage();
  try {
    await seedState(page, sportState());
    await openRoute(page, "sport");
    await page.click("#page-slider");
    const first = page.locator(".sport-plan-day").first();
    assert.equal(await first.getAttribute("data-date"), dateKey(1));
    assert.equal(await page.locator(".sport-week-open").innerText(), "Расписание недели");

    await first.locator(".sport-plan-add").click();
    await page.waitForSelector("#sport-session-dialog[open]");
    await page.selectOption("#sport-session-form [name=type]", "swim");
    await page.fill("#sport-session-form [name=durationMin]", "30");
    await page.click("#sport-session-form button[type=submit]");
    await page.waitForTimeout(80);
    let stored = await storedState(page);
    assert.deepEqual(Object.keys(stored.sport.specialDays), [`local|${dateKey(1)}`]);
    assert.deepEqual(stored.sport.specialDays[`local|${dateKey(1)}`].sessions.map((session) => session.type), ["run", "swim"]);
    assert.match(await first.innerText(), /Особый день/);
    assert.equal(stored.journal.length, 1);
    assert.equal(stored.journal[0].page, "sport");

    await page.click(".sport-week-open");
    await page.waitForSelector("#sport-week-dialog[open]");
    const from = dateKey(3);
    await page.fill("#sport-week-from", from);
    const weekday = new Date(`${from}T12:00:00`).getDay();
    await page.click(`.sport-week-remove[data-weekday="${weekday}"]`);
    await page.click(`.sport-week-add[data-weekday="${weekday}"]`);
    await page.waitForSelector("#sport-session-dialog[open]");
    await page.selectOption("#sport-session-form [name=type]", "strength");
    await page.fill("#sport-session-form [name=durationMin]", "60");
    await page.click("#sport-session-form button[type=submit]");
    assert.match(await page.locator(`.sport-week-day[data-weekday="${weekday}"]`).innerText(), /Силовая/);
    await page.click("#sport-week-form button[type=submit]");
    await page.waitForTimeout(80);

    stored = await storedState(page);
    assert.equal(stored.sport.versions.length, 2);
    const version = stored.sport.versions[1];
    assert.equal(version.effectiveFrom, from);
    assert.equal(version.cycle.weekdayBinding, true);
    assert.deepEqual(version.cycle.days[0].sessions.map((session) => session.type), ["strength"]);
    await page.click(".feed-more");
    assert.match(await page.locator(`.feed-day[data-date="${from}"]`).innerText(), /Силовая/);
    assert.match(await page.locator(`.feed-day[data-date="${dateKey(2)}"]`).innerText(), /Бег/, "days before the date keep the old schedule");
    assert.match(await page.locator(`.feed-day[data-date="${dateKey(1)}"]`).innerText(), /Плавание/, "the Особый день stays");
  } finally {
    await context.close();
  }
});

test("smoke: Спорт asks for the weight before estimating energy", async () => {
  const { context, page } = await openPage();
  try {
    await seedState(page, sportState({ weightKg: 0 }));
    await openRoute(page, "sport");
    assert.match(await page.locator(".sport-today .sport-energy-hint").innerText(), /укажите вес/);
    assert.equal(await page.locator(".sport-today .sport-energy").count(), 0);
    await page.click(".sport-today .sport-set-weight");
    await page.waitForSelector("#ration-profile-form");
    await page.fill("#ration-profile-form [name=weightKg]", "70");
    await page.click("#header-action");
    await page.waitForSelector(".sport-today");
    assert.match(await page.locator(".sport-today .sport-energy").innerText(), /ккал/);
  } finally {
    await context.close();
  }
});

test("smoke: on Спорт the assistant proposes a workout change and applying it updates План", async () => {
  const { context, page } = await openPage();
  try {
    const calls = await routeAi(context, (request, index) => index === 0
      ? aiMessage({ role: "assistant", content: "", tool_calls: [
        aiToolCall("set_sport_special_day", { date: dateKey(1), sessions: [{ type: "bike", time: "10:00", duration_min: 60, intensity: "low" }] }, "c1"),
      ] })
      : aiMessage({ role: "assistant", content: "Завтра лёгкий велосипед вместо бега." }));
    await page.evaluate(() => {
      localStorage.setItem("cookish.ai.key.test", "test-key");
      localStorage.setItem("cookish.ai.consent.v1", "1");
    });
    await seedState(page, sportState());
    await openRoute(page, "sport");
    await page.click("#page-slider");
    await askAssistant(page, "Сделай завтра полегче");
    await page.waitForSelector(".assistant-message.from-assistant");
    assert.equal(await page.locator("#assistant-title").innerText(), "Спорт · План");
    assert.match(calls[0].body.messages[0].content, /«Спорт · План»/);
    const card = page.locator(".assistant-proposal");
    assert.match(await card.innerText(), /Было: 07:30 Бег 40 мин, средняя/);
    assert.match(await card.innerText(), /Стало: 10:00 Велосипед 60 мин, низкая/);
    assert.match(await card.innerText(), /Δ расход/);
    await card.locator("[data-proposal-action=apply]").click();
    await page.waitForSelector(".assistant-proposal.status-applied");
    await page.click("#assistant-close");
    assert.match(await page.locator(`.sport-plan-day[data-date="${dateKey(1)}"]`).innerText(), /Велосипед[\s\S]*Особый день|Особый день[\s\S]*Велосипед/);
    const stored = await storedState(page);
    assert.equal(stored.journal.at(-1).page, "sport");
    assert.equal(stored.journal.at(-1).actor, "ai");
  } finally {
    await context.close();
  }
});
