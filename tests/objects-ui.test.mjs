import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { serveShell } from "../scripts/serve-objects.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotsDir = path.join(root, "output", "objects-shots");
const VIEWPORT = { width: 390, height: 844 };

let server;
let baseUrl;
let browser;

before(async () => {
  server = await serveShell(0);
  baseUrl = `http://127.0.0.1:${server.address().port}/objects.html`;
  browser = await chromium.launch();
  fs.rmSync(shotsDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(shotsDir, "full"), { recursive: true });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});

async function openApp({ colorScheme = "light", storageState, viewport = VIEWPORT } = {}) {
  const context = await browser.newContext({ viewport, colorScheme, storageState });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.locator("#screen > *").first().waitFor();
  return { context, page, errors };
}

// Layout defects a screenshot can hide: the page scrolling sideways, content
// past the right edge outside a scroller, and tap targets under 44 px.
async function audit(page, name) {
  const problems = await page.evaluate(() => {
    const out = [];
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > width + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${width}`);
    const inScroller = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll") return true;
      }
      return false;
    };
    const label = (el) => `${el.tagName.toLowerCase()}.${el.className || ""} «${(el.getAttribute("aria-label") || el.textContent || el.value || "").trim().slice(0, 30)}»`;
    for (const el of document.querySelectorAll("#screen *, #nav *, .sheet *")) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (rect.right > width + 1 && !inScroller(el)) out.push(`past the right edge: ${label(el)} right=${Math.round(rect.right)}`);
      const interactive = el.matches("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=switch], [role=checkbox]");
      if (interactive && getComputedStyle(el).visibility !== "hidden" && (rect.height < 43.5 || rect.width < 43.5)) out.push(`small tap target ${Math.round(rect.width)}x${Math.round(rect.height)}: ${label(el)}`);
    }
    return out;
  });
  assert.deepEqual(problems, [], `${name}: layout problems`);
}

// A viewport shot as the person sees it, and the whole page with the bottom
// navigation moved into the flow so it does not cover the middle.
async function shot(page, name) {
  await page.waitForTimeout(250);
  await audit(page, name);
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`) });
  const style = await page.addStyleTag({ content: ".nav { position: static !important; } .toasts { display: none !important; }" });
  await page.screenshot({ path: path.join(shotsDir, "full", `${name}.png`), fullPage: true });
  await style.evaluate((node) => node.remove());
}

const text = (locator) => locator.innerText().then((s) => s.replace(/\s+/g, " ").trim());
const rationWidget = (page) => page.locator('[data-widget="ration-today"]');
const eatenKcal = async (page) => Number((await text(rationWidget(page).locator(".metric-value"))).replace(/\s/g, ""));

async function back(page) {
  await page.getByRole("button", { name: "Назад" }).click();
}

async function tapNav(page, name) {
  await page.locator("#nav").getByText(name, { exact: true }).click();
}

test("a person starts from the example, marks a meal, builds a water tracker and buys from a request", async () => {
  const { context, page, errors } = await openApp();
  await page.getByRole("button", { name: "Начать с примера" }).waitFor();
  await shot(page, "first-run-light");
  await page.getByRole("button", { name: "Начать с примера" }).click();
  await rationWidget(page).waitFor();

  const mealName = await rationWidget(page).locator("article.meal.state-unmarked").first().getAttribute("data-meal");
  const meal = rationWidget(page).locator(`article.meal[data-meal="${mealName}"]`);
  const before = await eatenKcal(page);
  await shot(page, "home-light");
  await meal.getByRole("button", { name: "съедено", exact: true }).click();
  await page.waitForFunction((kcal) => document.querySelector('[data-widget="ration-today"] .metric-value')?.textContent.replace(/\s/g, "") !== String(kcal), before);
  const eaten = await eatenKcal(page);
  assert.ok(eaten > before, `marking ${mealName} eaten adds its kcal: ${before} → ${eaten}`);
  assert.equal(await meal.getByRole("button", { name: "съедено", exact: true }).getAttribute("aria-pressed"), "true");
  assert.match(await text(page.locator(".toast")), new RegExp(`${mealName}: съедено`));

  await page.locator(".toast").getByRole("button", { name: "Отменить" }).click();
  await page.waitForFunction((kcal) => document.querySelector('[data-widget="ration-today"] .metric-value')?.textContent.replace(/\s/g, "") === String(kcal), before);
  assert.equal(await meal.getByRole("button", { name: "съедено", exact: true }).getAttribute("aria-pressed"), "false", "undo clears the mark");
  assert.equal(await text(page.locator(".toast")), "Отменено");

  await page.getByRole("button", { name: "Создать" }).click();
  await shot(page, "create-sheet-light");
  await page.getByRole("button", { name: /Новый тип/ }).click();
  await page.getByPlaceholder("Например, Вода").fill("Вода");
  await page.getByLabel("Иконка").fill("💧");
  await page.getByRole("button", { name: "+ Связь" }).click();
  const sheet = page.locator(".sheet");
  await sheet.getByText("+ Новая связь").click();
  await sheet.getByPlaceholder("Например, Выпито").fill("Выпито");
  await sheet.locator("select").first().selectOption("number");
  await sheet.getByPlaceholder("мл, шаги, ₽").fill("мл");
  await shot(page, "new-relation-light");
  await sheet.getByRole("button", { name: "Добавить связь" }).click();
  assert.match(await text(page.locator("#screen")), /Выпито Число, мл · новая/);
  await shot(page, "new-type-light");
  await page.getByRole("button", { name: "Создать тип" }).click();
  await page.locator(".hero-title", { hasText: "Вода" }).waitFor();

  for (const ml of ["250", "300"]) {
    await page.getByRole("button", { name: "+ Новый" }).click();
    await page.getByLabel("Выпито").fill(ml);
    await page.getByLabel("Выпито").press("Enter");
    await page.locator(".toast", { hasText: "выпито" }).waitFor();
    if (ml === "300") await shot(page, "object-light");
    await back(page);
  }
  await page.locator(".hero", { hasText: "2 объекта" }).waitFor();
  assert.match(await text(page.locator(".totals")), /Выпито: 550 мл/);
  await shot(page, "type-water-light");
  await page.getByRole("tab", { name: "Таблица" }).click();
  await shot(page, "set-table-light");
  await page.getByRole("tab", { name: "Календарь" }).click();
  await shot(page, "set-calendar-light");

  await tapNav(page, "Главная");
  await page.getByRole("button", { name: "Изменить" }).click();
  await page.getByRole("button", { name: "+ Виджет" }).click();
  await sheet.getByLabel("Источник").selectOption({ label: "💧 Вода" });
  await sheet.getByRole("button", { name: "Число", exact: true }).click();
  await sheet.getByRole("button", { name: "Сумма", exact: true }).click();
  await sheet.getByRole("button", { name: "сегодня", exact: true }).click();
  await sheet.getByPlaceholder("Например, 2000").fill("2000");
  await sheet.getByPlaceholder("Как назвать виджет").fill("Вода сегодня");
  await shot(page, "widget-sheet-light");
  await sheet.getByRole("button", { name: "Добавить" }).click();
  await page.getByRole("button", { name: "Готово" }).click();
  const water = page.locator('[data-widget="set"]', { hasText: "Вода сегодня" });
  assert.equal(await text(water.locator(".metric-value")), "550");
  assert.match(await text(water.locator(".metric-of")), /из 2 000 мл/);
  await water.scrollIntoViewIfNeeded();
  await shot(page, "home-widgets-light");

  await page.locator('[data-widget="requests"] a.row').first().click();
  await page.locator("[data-item]").first().waitFor();
  const progress = await text(page.locator(".totals-card .metric-value"));
  const [boughtBefore, total] = progress.split(" из ").map(Number);
  const spent = async () => Number(/Потрачено ([\d\s]+) ₽/.exec(await text(page.locator(".totals-card")))[1].replace(/\s/g, ""));
  const spentBefore = await spent();
  await shot(page, "request-light");
  const item = page.locator("[data-item]").filter({ hasNot: page.locator(".check.is-on") }).first();
  const itemName = await item.getAttribute("data-item");
  await item.click();
  await sheet.getByLabel("Сумма").fill("120");
  await shot(page, "buy-sheet-light");
  await sheet.getByRole("button", { name: "Купил" }).click();
  await page.locator(".totals-card .metric-value", { hasText: `${boughtBefore + 1} из ${total}` }).waitFor();
  assert.equal(await spent(), spentBefore + 120, "the purchase adds its sum to the request");
  assert.equal(await page.locator(`[data-item="${itemName}"] .check`).getAttribute("aria-label"), "куплено");
  assert.match(await text(page.locator(".block", { hasText: "Покупки" })), new RegExp(`${itemName}.*120 ₽`));

  await page.goto(`${baseUrl}#/ration/${await page.evaluate(() => new Date().toLocaleDateString("sv-SE"))}`);
  await page.locator("article.meal").first().waitFor();
  await shot(page, "ration-day-light");
  await page.goto(`${baseUrl}#/sport/${await page.evaluate(() => new Date().toLocaleDateString("sv-SE"))}`);
  await page.locator(".date-nav").waitFor();
  await shot(page, "sport-day-light");
  await tapNav(page, "Библиотека");
  await shot(page, "library-light");
  await tapNav(page, "Поиск");
  await page.getByLabel("Поиск").fill("ов");
  await shot(page, "search-light");

  const storageState = await context.storageState();
  assert.deepEqual(errors, [], "no page errors in the light run");
  await context.close();

  const dark = await openApp({ colorScheme: "dark", storageState, viewport: { width: 360, height: 780 } });
  for (const [name, hash] of [["home", "#/"], ["library", "#/library"], ["ration-day", "#/ration/"], ["request", null], ["type-water", null]]) {
    if (hash) await dark.page.goto(`${baseUrl}${hash}`);
    if (name === "request") await dark.page.goto(`${baseUrl}#/`).then(() => dark.page.locator('[data-widget="requests"] a.row').first().click());
    if (name === "type-water") await dark.page.goto(`${baseUrl}#/library`).then(() => dark.page.getByRole("link", { name: /Вода ваш тип/ }).click());
    await dark.page.locator("#screen > *").first().waitFor();
    await shot(dark.page, `${name}-dark`);
  }
  assert.deepEqual(dark.errors, [], "no page errors in the dark run");
  await dark.context.close();
});

test("an empty space starts with an empty home and keeps a plan change undoable", async () => {
  const { context, page, errors } = await openApp();
  await page.getByRole("button", { name: "Пустое пространство" }).click();
  await page.locator('[data-widget="ration-today"]').waitFor();
  assert.match(await text(page.locator('[data-widget="ration-today"]')), /в Рационе ничего нет/);

  await page.getByRole("button", { name: "Создать" }).click();
  await page.getByRole("button", { name: /^Объект/ }).click();
  await page.locator(".sheet").getByRole("button", { name: /Продукт$/ }).click();
  await page.getByLabel("Название").fill("Гречка");
  await page.getByLabel("Название").press("Enter");
  await page.locator(".toast", { hasText: "Название «Гречка»" }).waitFor();
  await page.locator(".toast").getByRole("button", { name: "Отменить" }).click();
  await page.locator(".toast", { hasText: "Отменено" }).waitFor();
  assert.equal(await page.getByLabel("Название").inputValue(), "", "undo of a journaled change restores the name");
  assert.deepEqual(errors, []);
  await context.close();
});

test("day views edit today's plan, record a discrepancy and mark sport; sets switch layouts and filter", async () => {
  const { context, page, errors } = await openApp();
  const sheet = page.locator(".sheet");
  await page.getByRole("button", { name: "Начать с примера" }).click();
  await rationWidget(page).waitFor();
  const today = await page.evaluate(() => new Date().toLocaleDateString("sv-SE"));

  await page.goto(`${baseUrl}#/ration/${today}`);
  const firstMeal = page.locator("article.meal").first();
  const kcalBefore = await text(firstMeal.locator(".meal-kcal"));
  await page.getByRole("button", { name: "Изменить план этого дня" }).click();
  const amount = firstMeal.locator(".input-amount").first();
  await amount.fill("160");
  await amount.press("Enter");
  await page.locator(".toast", { hasText: "160" }).waitFor();
  await shot(page, "ration-edit-light");
  await page.getByRole("button", { name: "Готово" }).click();
  assert.notEqual(await text(page.locator("article.meal").first().locator(".meal-kcal")), kcalBefore, "a new amount changes the meal kcal");
  assert.match(await text(page.locator("#screen")), /У этого дня свой план/);

  const mealName = await page.locator("article.meal.state-unmarked").first().getAttribute("data-meal");
  const meal = page.locator(`article.meal[data-meal="${mealName}"]`);
  await meal.getByRole("button", { name: "Расхождение" }).click();
  await sheet.getByRole("button", { name: "не съедено", exact: true }).click();
  await shot(page, "discrepancy-sheet-light");
  await sheet.getByRole("button", { name: "Записать" }).click();
  await meal.locator(".discrepancies").waitFor();
  assert.match(await text(meal.locator(".discrepancies")), /не съедено: /);
  assert.equal(await meal.getByRole("button", { name: "изменено", exact: true }).getAttribute("aria-pressed"), "true", "a discrepancy marks the meal changed");

  await page.goto(`${baseUrl}#/sport/${today}`);
  const session = page.locator("article.meal").first();
  await session.getByRole("button", { name: "изменено", exact: true }).click();
  await sheet.getByLabel("Минут фактически").fill("25");
  await shot(page, "session-changed-sheet-light");
  await sheet.getByRole("button", { name: "Записать" }).click();
  await session.getByText("фактически 25 мин").waitFor();
  assert.equal(await text(page.locator(".day-card .metric-value")), "25");
  await page.getByRole("button", { name: "+ Активность" }).click();
  await sheet.getByRole("button", { name: "Ходьба", exact: true }).click();
  await sheet.getByLabel("Минут").fill("20");
  await sheet.getByRole("button", { name: "Записать" }).click();
  await page.locator(".day-card a.row", { hasText: "Ходьба" }).waitFor();
  assert.equal(await text(page.locator(".day-card .metric-value")), "45", "an activity adds its minutes");
  await shot(page, "sport-marked-light");

  await page.goto(`${baseUrl}#/library`);
  await page.getByRole("link", { name: /Запросы Запросы/ }).click();
  await page.locator(".kanban").waitFor();
  assert.match(await text(page.locator(".kanban")), /открыт.*закрыт/);
  await shot(page, "set-kanban-light");
  await page.getByRole("tab", { name: "Галерея" }).click();
  await page.locator(".gallery").first().waitFor();
  await shot(page, "set-gallery-light");

  await page.goto(`${baseUrl}#/library`);
  await page.getByRole("link", { name: /Продукты Продукты/ }).click();
  await page.locator(".table").waitFor();
  const allProducts = await page.locator(".table tbody tr").count();
  await page.getByRole("button", { name: "+ Фильтр" }).click();
  await sheet.getByLabel("Связь").selectOption({ label: "Ккал на 100" });
  await sheet.getByLabel("Значение").fill("300");
  await shot(page, "filter-sheet-light");
  await sheet.getByRole("button", { name: "Применить" }).click();
  await page.locator(".fchip", { hasText: "Ккал на 100 ≥ 300" }).waitFor();
  const dense = await page.locator(".table tbody tr").count();
  assert.ok(dense > 0 && dense < allProducts, `the filter keeps products of 300 kcal and more: ${dense} of ${allProducts}`);
  await page.getByRole("tab", { name: "Чек-лист" }).click();
  const check = page.locator('[role="checkbox"]').first();
  const was = await check.getAttribute("aria-checked");
  await check.click();
  await page.waitForFunction((before) => document.querySelector('[role="checkbox"]').getAttribute("aria-checked") !== before, was);
  await shot(page, "set-checklist-light");

  await page.getByRole("tab", { name: "Список" }).click();
  await page.locator(".set-body a.row").first().click();
  await page.getByText("Последняя цена").waitFor();
  await page.getByText("Ссылаются сюда").waitFor();
  await shot(page, "product-light");

  assert.deepEqual(errors, []);
  await context.close();
});
