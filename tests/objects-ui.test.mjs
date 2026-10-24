import assert from "node:assert/strict";
import { test } from "node:test";
import { back, baseUrl, eatenKcal, openApp, rationWidget, shot, tapNav, text, useUi, waitText } from "./objects-ui-helpers.mjs";

useUi();

// Screens re-render a task after the click that changed the store, so a read
// that follows a click waits for the value it expects.
async function until(read, ok, what, timeout = 10000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await read().catch(() => undefined);
    if (value !== undefined && ok(value)) return value;
    if (Date.now() > end) assert.fail(`${what}: never became right, last ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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
  await until(() => meal.getByRole("button", { name: "съедено", exact: true }).getAttribute("aria-pressed"), (value) => value === "true", "the meal is pressed");
  assert.match(await text(page.locator(".toast")), new RegExp(`${mealName}: съедено`));

  await page.locator(".toast").getByRole("button", { name: "Отменить" }).click();
  await page.waitForFunction((kcal) => document.querySelector('[data-widget="ration-today"] .metric-value')?.textContent.replace(/\s/g, "") === String(kcal), before);
  await until(() => meal.getByRole("button", { name: "съедено", exact: true }).getAttribute("aria-pressed"), (value) => value === "false", "undo clears the mark");
  await waitText(page.locator(".toast"), /^Отменено$/);

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
  await waitText(page.locator("#screen"), /Выпито Число, мл · новая/);
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
  await waitText(page.locator(".totals"), /Выпито: 550 мл/);
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
  await waitText(water.locator(".metric-value"), /^550$/);
  await waitText(water.locator(".metric-of"), /из 2 000 мл/);
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
  await sheet.getByRole("button", { name: "Купил", exact: true }).click();
  await page.locator(".totals-card .metric-value", { hasText: `${boughtBefore + 1} из ${total}` }).waitFor();
  await until(spent, (value) => value === spentBefore + 120, "the purchase adds its sum to the request");
  await until(() => page.locator(`[data-item="${itemName}"] .check`).getAttribute("aria-label"), (value) => value === "куплено", "the item is bought");
  await waitText(page.locator(".block", { hasText: "Покупки" }), new RegExp(`${itemName}.*120 ₽`));

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
  await waitText(page.locator('[data-widget="ration-today"]'), /в Рационе ничего нет/);

  await page.getByRole("button", { name: "Создать" }).click();
  await page.getByRole("button", { name: /^Объект/ }).click();
  await page.locator(".sheet").getByRole("button", { name: /Продукт$/ }).click();
  await page.getByLabel("Название").fill("Гречка");
  await page.getByLabel("Название").press("Enter");
  await page.locator(".toast", { hasText: "Название «Гречка»" }).waitFor();
  await page.locator(".toast").getByRole("button", { name: "Отменить" }).click();
  await page.locator(".toast", { hasText: "Отменено" }).waitFor();
  await until(() => page.getByLabel("Название").inputValue(), (value) => value === "", "undo of a journaled change restores the name");
  assert.deepEqual(errors, []);
  await context.close();
});

// The Сборщик's answers as routerai.ru would send them, picked by the last
// request; the page fetches the provider directly, so CORS headers matter.
const builderAnswer = (request) => {
  if (/инсулин/i.test(request)) return { reply: "Дозу инсулина подбирает врач. Могу собрать дневник сахара, если хотите." };
  const limit = /пять/.test(request) ? 5 : 4;
  return {
    reply: `Собрал «Чай»: шкала чашек до предела ${limit} и кнопка «+1 чашка» на главной.`,
    v: 2,
    name: "Чай",
    tracks: [{ key: "tea", name: "Чай", kind: "log", icon: "🍵", fields: [{ key: "cups", name: "Чашек", type: "number", unit: "шт.", min: 1, max: 10, goal: limit, goalType: "max", goalPer: "day" }] }],
    screens: [{ key: "home", cards: [{ key: "tea_today", title: "Чай сегодня", body: [{ el: "meter", of: "tea", value: "cups" }, { el: "quick", of: "tea", values: { cups: 1 }, label: "+1 чашка" }] }] }],
  };
};

async function fakeProvider(context, sent) {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
  await context.route("https://routerai.ru/**", async (route) => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: cors }); return; }
    const body = route.request().postDataJSON();
    sent.push(body);
    const answer = builderAnswer(body.messages.at(-1).content);
    await route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify(answer) } }], usage: {} }) });
  });
}

test("the Сборщик builds a tracker from words: refine, apply, undo, and a refusal", async () => {
  const { context, page, errors } = await openApp();
  await page.getByRole("button", { name: "Начать с примера" }).click();
  await rationWidget(page).waitFor();
  const openBuilder = async () => {
    await page.getByRole("button", { name: "Создать" }).click();
    await page.getByRole("button", { name: /Собрать с ИИ/ }).click();
  };

  await openBuilder();
  await page.locator(".sheet", { hasText: "нужен ключ ИИ" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Собрать", exact: true }).isDisabled(), true, "no key, no request");
  await page.keyboard.press("Escape");

  const sent = [];
  await fakeProvider(context, sent);
  await page.evaluate(() => localStorage.setItem("cookish.ai.key.test", "test-key"));
  await openBuilder();
  await shot(page, "builder-sheet-light");
  await page.getByLabel("Что отслеживать").fill("Хочу считать чай, не больше четырёх чашек в день");
  await page.getByRole("button", { name: "Собрать", exact: true }).click();
  const changes = page.getByRole("region", { name: "Что добавится" });
  await changes.waitFor();
  assert.match(await text(changes), /Чай.*Трек.*лимит 4 в день.*Чай сегодня.*Новая карточка.*экран «Главная»/);
  assert.equal(await page.locator('[data-card="tea_today"]').count(), 0, "nothing is written before the person applies");

  await page.getByLabel("Что отслеживать").fill("Лимит пять чашек");
  await page.getByRole("button", { name: "Уточнить" }).click();
  await changes.filter({ hasText: /лимит 5 в день/ }).waitFor();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].messages.slice(1).map((m) => m.role), ["user", "assistant", "user"], "the refinement carries the first request and answer");
  assert.doesNotMatch(JSON.stringify(sent), /Овсяные хлопья|Куриная грудка|Творог/, "the text of objects never leaves the device");
  await shot(page, "builder-proposal-light");

  await page.getByRole("button", { name: "Добавить" }).click();
  const card = page.locator('[data-card="tea_today"]');
  await card.waitFor();
  assert.match(await text(card), /Чай сегодня/);
  assert.match(await text(card), /\+1 чашка/);
  await page.locator(".toast").getByRole("button", { name: "Отменить" }).click();
  await page.locator(".toast", { hasText: "Отменено" }).waitFor();
  await until(() => card.count(), (count) => count === 0, "undo removes the card");
  assert.equal(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("cookish.objects.v1")).customTypes || {}).length), 0, "and the type");

  await openBuilder();
  await page.getByLabel("Что отслеживать").fill("Сколько инсулина колоть на 60 г углеводов");
  await page.getByRole("button", { name: "Собрать", exact: true }).click();
  await page.locator(".builder-reply", { hasText: "подбирает врач" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Добавить" }).count(), 0, "a refusal offers nothing to apply");
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
  await waitText(page.locator("#screen"), /У этого дня свой план/);
  await until(() => text(page.locator("article.meal").first().locator(".meal-kcal")), (value) => value !== kcalBefore, "a new amount changes the meal kcal");

  const mealName = await page.locator("article.meal.state-unmarked").first().getAttribute("data-meal");
  const meal = page.locator(`article.meal[data-meal="${mealName}"]`);
  await meal.getByRole("button", { name: "Расхождение" }).click();
  await sheet.getByRole("button", { name: "не съедено", exact: true }).click();
  await shot(page, "discrepancy-sheet-light");
  await sheet.getByRole("button", { name: "Записать" }).click();
  await meal.locator(".discrepancies").waitFor();
  assert.match(await text(meal.locator(".discrepancies")), /не съедено: /);
  await until(() => meal.getByRole("button", { name: "изменено", exact: true }).getAttribute("aria-pressed"), (value) => value === "true", "a discrepancy marks the meal changed");

  await page.goto(`${baseUrl}#/sport/${today}`);
  const session = page.locator("article.meal").first();
  await session.getByRole("button", { name: "изменено", exact: true }).click();
  await sheet.getByLabel("Минут фактически").fill("25");
  await shot(page, "session-changed-sheet-light");
  await sheet.getByRole("button", { name: "Записать" }).click();
  await session.getByText("фактически 25 мин").waitFor();
  await waitText(page.locator(".day-card .metric-value"), /^25$/);
  await page.getByRole("button", { name: "+ Активность" }).click();
  await sheet.getByRole("button", { name: "Ходьба", exact: true }).click();
  await sheet.getByLabel("Минут").fill("20");
  await sheet.getByRole("button", { name: "Записать" }).click();
  await page.locator(".day-card a.row", { hasText: "Ходьба" }).waitFor();
  await waitText(page.locator(".day-card .metric-value"), /^45$/);
  await shot(page, "sport-marked-light");

  await page.goto(`${baseUrl}#/library`);
  await page.getByRole("link", { name: /Запросы Запросы/ }).click();
  await page.locator(".kanban").waitFor();
  await waitText(page.locator(".kanban"), /открыт.*закрыт/);
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
  const dense = await until(() => page.locator(".table tbody tr").count(), (count) => count > 0 && count < allProducts, "the filter keeps products of 300 kcal and more");
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

// A small state of the current app: a breakfast whose first portion counts
// pieces, a meal time the object model refuses, and a Profile with the edges
// the current app accepts.
const legacyFixture = {
  schemaVersion: 14,
  user: null,
  onboardingCompleted: true,
  products: [
    { id: "p_egg", name: "Яйцо", unit: "шт.", category: "Другое", nutrition: { calories: 157, protein: 12.7, fat: 11.5, carbs: 0.7 } },
    { id: "p_yog", name: "Йогурт", unit: "г", category: "Молочное", nutrition: { calories: 66, protein: 5, fat: 2, carbs: 4 } },
  ],
  requests: [],
  sport: { versions: [], specialDays: {}, log: {} },
  ration: {
    versions: [{
      id: "v1", owner: "local", effectiveFrom: "2020-01-01", createdAt: "2020-01-01T08:00:00.000Z",
      cycle: { anchor: "2020-01-01", weekdayBinding: false, days: [{ id: "d1", meals: [{ id: "m1", name: "Завтрак", time: "8:00", items: [{ id: "i1", productId: "p_egg", name: "Яйцо", portionSize: 2, measureUnit: "шт." }] }] }] },
    }],
    specialDays: {},
    history: {},
    profile: { ageGroup: "Взрослый", goal: "Поддержание веса", heightCm: 175, weightKg: 18, mealsPerDay: 12, targetCalories: 1100 },
  },
};

test("an import lists what did not fit; an added product gets its own unit", async () => {
  const { context, page, errors } = await openApp();
  await page.evaluate((legacy) => localStorage.setItem("cookish.android.data.v1", JSON.stringify(legacy)), legacyFixture);
  await page.reload();
  await page.getByRole("button", { name: "Перенести мои данные из Cookish" }).click();
  const issues = page.getByRole("dialog", { name: /не подошл/ });
  const listed = await waitText(issues, /не подошл/);
  assert.match(listed, /Время.*8:00/, "the refused value is named");
  assert.doesNotMatch(listed, /Вес|Цель|Приёмов/, "weight 18, target 1100 and 12 meals a day are kept");
  await shot(page, "import-issues-light");
  await issues.getByRole("button", { name: "Понятно" }).click();
  await page.locator('[data-widget="ration-today"]').waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);

  const today = await page.evaluate(() => new Date().toLocaleDateString("sv-SE"));
  await page.goto(`${baseUrl}#/ration/${today}`);
  await page.locator("article.meal").first().getByRole("button", { name: "Расхождение" }).click();
  const sheet = page.getByRole("dialog", { name: /Расхождение/ });
  await sheet.getByRole("button", { name: "добавлено", exact: true }).click();
  const unit = sheet.locator(".with-unit .unit");
  const pick = async (name) => {
    await sheet.locator(".chip-add").click();
    await page.getByRole("dialog", { name: "Продукт" }).getByRole("button", { name: new RegExp(name) }).click();
  };
  await pick("Йогурт");
  await waitText(unit, /^г$/);
  await pick("Яйцо");
  await waitText(unit, /^шт\.$/);
  await pick("Йогурт");
  await waitText(unit, /^г$/);
  await sheet.getByLabel("Количество").fill("150");
  await sheet.getByRole("button", { name: "Записать" }).click();
  await waitText(page.locator("article.meal .discrepancies"), /добавлено: Йогурт, 150 г/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("the edit mode of a day ends with the Особый день that undo takes away", async () => {
  const { context, page, errors } = await openApp();
  await page.getByRole("button", { name: "Начать с примера" }).click();
  await rationWidget(page).waitFor();
  const today = await page.evaluate(() => new Date().toLocaleDateString("sv-SE"));
  await page.goto(`${baseUrl}#/ration/${today}`);
  const edit = page.getByRole("button", { name: "Изменить план этого дня" });
  await edit.click();
  await page.locator(".input-amount").first().waitFor();
  await page.locator(".toast").getByRole("button", { name: "Отменить" }).click();
  await until(() => page.getByRole("button", { name: "Изменить план этого дня" }).count(), (count) => count === 1, "the cycle day is offered for editing again");
  assert.equal(await page.locator(".input-amount").count(), 0, "no edit inputs over the locked cycle day");
  await edit.click();
  await page.locator(".input-amount").first().waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test("a malformed address or an impossible date falls back instead of breaking the screen", async () => {
  const { context, page, errors } = await openApp();
  await page.getByRole("button", { name: "Начать с примера" }).click();
  await rationWidget(page).waitFor();
  for (const hash of ["#/ration/2026-13-45", "#/sport/2026-02-30", "#/ration/not-a-date"]) {
    await page.goto(`${baseUrl}${hash}`);
    await waitText(page.locator(".date-nav-title"), /^Сегодня$/);
  }
  for (const hash of ["#/object/%E0%A4%A", "#/set/%", "#/%zz"]) {
    await page.goto(`${baseUrl}${hash}`);
    await rationWidget(page).waitFor();
  }
  assert.deepEqual(errors, []);
  await context.close();
});
