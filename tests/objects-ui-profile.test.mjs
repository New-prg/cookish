import assert from "node:assert/strict";
import { test } from "node:test";
import { openApp, rationWidget, shot, text, useUi, waitText } from "./objects-ui-helpers.mjs";

useUi("objects-shots-profile");

const FAKE_KEY = "sk-test-0123456789abcdef";
const KEY_STORAGE = "cookish.ai.key.test";
const CONSENT_STORAGE = "cookish.ai.consent.v1";
const THEME_STORAGE = "cookish.theme";
const LEGACY_KEY = "cookish.android.data.v1";

async function startFromExample(options) {
  const app = await openApp(options);
  await app.page.getByRole("button", { name: "Начать с примера" }).click();
  await rationWidget(app.page).waitFor();
  return app;
}

async function openProfile(page) {
  await page.getByRole("link", { name: "Профиль" }).click();
  await page.getByRole("heading", { name: "Профиль", level: 1 }).waitFor();
}

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, *", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

// routerai.ru as the key check sees it: `answer(request)` picks the status.
async function fakeProvider(context, seen, answer = () => ({ status: 200, body: { data: { label: "test", usage: 0.1, limit: null } } })) {
  await context.route("https://routerai.ru/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers: cors }); return; }
    seen.push({ method: request.method(), url: request.url(), authorization: request.headers().authorization });
    const { status, body } = answer(request);
    await route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
  });
}

test("the profile opens from home; a target that breaks the calories shows the warning", async () => {
  const { page, errors } = await startFromExample();
  await openProfile(page);
  await page.getByLabel("Цель, ккал", { exact: true }).waitFor();
  assert.equal(await page.locator(".banner").count(), 0, "the example targets agree with the calories");
  await shot(page, "profile-light");

  await page.getByLabel("Цель, ккал", { exact: true }).fill("3200");
  await page.getByLabel("Цель, ккал", { exact: true }).press("Enter");
  const group = page.locator('[data-group="Цели на день"]');
  const warning = await waitText(group, /БЖУ расходятся с калориями больше чем на 15%/);
  assert.match(warning, /дают 2 400 ккал, а цель 3 200/);
  await shot(page, "profile-mismatch-light");

  await page.getByLabel("Цель, ккал", { exact: true }).fill("2400");
  await page.getByLabel("Цель, ккал", { exact: true }).press("Enter");
  await page.locator(".banner").waitFor({ state: "detached" });

  // The store keeps its bounds: a negative target is refused and not saved.
  await page.getByLabel("Цель, ккал", { exact: true }).fill("-5");
  await page.getByLabel("Цель, ккал", { exact: true }).press("Enter");
  await page.locator(".toast-error").waitFor();
  assert.deepEqual(errors, []);
});

test("the AI key: save, check against the provider, consent once, clear", async () => {
  const { context, page, errors } = await startFromExample();
  const seen = [];
  let status = 200;
  await fakeProvider(context, seen, () => (status === 200 ? { status, body: { data: { label: "test" } } } : { status, body: { error: "no" } }));
  await openProfile(page);
  const ai = page.locator(".profile-ai");
  await waitText(ai, /Ключ не задан/);
  assert.equal(await ai.getByRole("button", { name: "Удалить" }).isDisabled(), true, "nothing to delete yet");
  await shot(page, "profile-ai-empty-light");

  await ai.getByLabel("Ключ routerai.ru").fill(FAKE_KEY);
  await ai.getByRole("button", { name: "Сохранить" }).click();
  await waitText(ai, /Ключ сохранён на этом устройстве/);
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY_STORAGE), FAKE_KEY, "the same storage key as the current app");
  assert.equal(await ai.getByLabel("Ключ routerai.ru").inputValue(), "", "the field is emptied after saving");
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), CONSENT_STORAGE), null, "saving sends nothing, so no consent yet");
  assert.ok(!(await page.locator("body").innerText()).includes(FAKE_KEY), "the key is never shown");
  assert.ok(!(await page.content()).includes(FAKE_KEY), "the key is not in the markup");
  await shot(page, "profile-ai-saved-light");

  // The first check asks for the consent.
  await ai.getByRole("button", { name: "Проверить" }).click();
  const sheet = page.locator(".sheet");
  await waitText(sheet, /отправляет данные плана, профиля и статистики внешнему провайдеру routerai\.ru/);
  await shot(page, "profile-ai-consent-light");
  await sheet.getByRole("button", { name: "Понятно, продолжить" }).click();
  await waitText(ai, /Ключ работает/);
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), CONSENT_STORAGE), "1");
  assert.equal(seen.at(-1).url, "https://routerai.ru/api/v1/key");
  assert.equal(seen.at(-1).authorization, `Bearer ${FAKE_KEY}`);

  // The second check goes straight through; a rejected key is told plainly.
  status = 401;
  await ai.getByRole("button", { name: "Проверить" }).click();
  await waitText(ai, /Ключ не подошёл/);
  assert.equal(await page.locator(".sheet").count(), 0, "the consent is asked once");
  await shot(page, "profile-ai-rejected-light");

  // A typed key replaces the saved one and is checked in one tap.
  status = 200;
  await ai.getByLabel("Ключ routerai.ru").fill(`${FAKE_KEY}-2`);
  await ai.getByRole("button", { name: "Проверить" }).click();
  await waitText(ai, /Ключ работает/);
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY_STORAGE), `${FAKE_KEY}-2`);

  await ai.getByRole("button", { name: "Удалить" }).click();
  await waitText(sheet, /Удалить ключ ИИ с этого устройства/);
  await sheet.getByRole("button", { name: "Удалить ключ" }).click();
  await waitText(ai, /Ключ удалён/);
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY_STORAGE), null);
  assert.deepEqual(errors.filter((e) => !/401/.test(e)), []);
});

test("the theme switch forces light or dark and survives a reload", async () => {
  const { context, page, errors } = await startFromExample();
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme || null);
  await openProfile(page);
  const switchBar = page.getByRole("group", { name: "Тема" });
  assert.equal(await background(), "rgb(245, 244, 239)", "light system, system theme");

  await switchBar.getByRole("button", { name: "Тёмная" }).click();
  await waitText(switchBar.locator('[aria-pressed="true"]'), /Тёмная/);
  assert.equal(await theme(), "dark");
  assert.equal(await background(), "rgb(18, 20, 18)", "dark was forced over a light system");
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), THEME_STORAGE), "dark", "the key of the current app");
  await shot(page, "profile-forced-dark");

  await page.reload();
  await page.getByRole("heading", { name: "Профиль", level: 1 }).waitFor();
  assert.equal(await theme(), "dark", "persists across a reload");
  assert.equal(await background(), "rgb(18, 20, 18)");
  await waitText(page.getByRole("group", { name: "Тема" }).locator('[aria-pressed="true"]'), /Тёмная/);

  await page.getByRole("group", { name: "Тема" }).getByRole("button", { name: "Как в системе" }).click();
  await page.waitForFunction(() => !document.documentElement.dataset.theme);
  assert.equal(await background(), "rgb(245, 244, 239)");
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), THEME_STORAGE), null);
  assert.deepEqual(errors, []);
  await context.close();

  // A dark system with the light theme chosen stays light.
  const dark = await startFromExample({ colorScheme: "dark" });
  await dark.page.evaluate((k) => localStorage.setItem(k, "light"), THEME_STORAGE);
  await dark.page.reload();
  await dark.page.locator("#screen > *").first().waitFor();
  assert.equal(await dark.page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(245, 244, 239)");
  await dark.context.close();
});

test("the profile in dark mode", async () => {
  const { context, page, errors } = await startFromExample({ colorScheme: "dark", viewport: { width: 360, height: 780 } });
  await openProfile(page);
  await page.getByLabel("Цель, ккал", { exact: true }).fill("3200");
  await page.getByLabel("Цель, ккал", { exact: true }).press("Enter");
  await waitText(page.locator('[data-group="Цели на день"]'), /расходятся/);
  await shot(page, "profile-mismatch-dark");
  await page.getByRole("button", { name: "Удалить все данные прототипа" }).click();
  await page.locator(".sheet").waitFor();
  await shot(page, "profile-confirm-dark");
  assert.deepEqual(errors, []);
  await context.close();
});

test("re-import replaces the space; deleting the data returns to the first run and leaves Cookish alone", async () => {
  const { page, errors } = await startFromExample();
  // The current app's data, as the example would have written it.
  const legacy = await page.evaluate(async (key) => {
    const { demoLegacyState } = await import("/objects/core/migrate.js");
    const raw = JSON.stringify(demoLegacyState(new Date().toLocaleDateString("sv-SE")));
    localStorage.setItem(key, raw);
    return raw;
  }, LEGACY_KEY);

  await openProfile(page);
  const weight = page.getByLabel("Вес, кг", { exact: true });
  const original = await weight.inputValue();
  await weight.fill("95");
  await weight.press("Enter");
  await page.locator(".toast", { hasText: "вес" }).waitFor();
  assert.equal(await page.getByLabel("Вес, кг", { exact: true }).inputValue(), "95");

  await page.getByRole("button", { name: "Перенести заново из Cookish" }).click();
  const sheet = page.locator(".sheet");
  await waitText(sheet, /заменено данными из Cookish/);
  await shot(page, "profile-reimport-confirm-light");
  await sheet.getByRole("button", { name: "Отмена" }).click();
  assert.equal(await page.getByLabel("Вес, кг", { exact: true }).inputValue(), "95", "cancel changes nothing");

  await page.getByRole("button", { name: "Перенести заново из Cookish" }).click();
  await sheet.getByRole("button", { name: "Заменить данными Cookish" }).click();
  await rationWidget(page).waitFor();
  await openProfile(page);
  assert.equal(await page.getByLabel("Вес, кг", { exact: true }).inputValue(), original, "the import brought back the Cookish value");

  await shot(page, "profile-data-light");
  await page.getByRole("button", { name: "Удалить все данные прототипа" }).click();
  await waitText(sheet, /Данные Cookish не затрагиваются/);
  await shot(page, "profile-delete-confirm-light");
  await sheet.getByRole("button", { name: "Удалить всё" }).click();
  await page.getByRole("button", { name: "Начать с примера" }).waitFor();
  await shot(page, "first-run-after-delete-light");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), LEGACY_KEY), legacy, "Cookish data is untouched");
  assert.equal(await page.locator("#nav").isHidden(), true);

  await page.reload();
  await page.getByRole("button", { name: "Начать с примера" }).waitFor();
  assert.deepEqual(errors, []);
});

test("a Запрос from the plan holds the planned products; the days are the person's choice", async () => {
  const { page, errors } = await startFromExample();
  // What the plan puts on the next 7 days, read from the plan itself.
  const planned = await page.evaluate(async () => {
    const { requestFromPlanOps } = await import("/objects/core/domain.js");
    const { openObjectStore } = await import("/objects/core/store.js");
    const store = openObjectStore({ storage: localStorage });
    const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("sv-SE");
    const names = (dates) => requestFromPlanOps(store.state(), { dates, today: store.today() }).filter((op) => op.type === "request_item").map((op) => op.name);
    return { week: names(Array.from({ length: 7 }, (_, n) => day(n))), today: names([day(0)]) };
  });
  assert.ok(planned.week.length > 0);

  await page.getByRole("button", { name: "Запрос из плана" }).click();
  const sheet = page.locator(".sheet");
  await waitText(sheet, /Продуктов по плану: \d+/);
  assert.equal(await sheet.getByLabel("С", { exact: true }).inputValue(), await page.evaluate(() => new Date().toLocaleDateString("sv-SE")));
  assert.equal(await sheet.getByRole("button", { name: "7 дней" }).getAttribute("aria-pressed"), "true", "the default is the next 7 days");
  assert.match(await text(sheet), new RegExp(`Продуктов по плану: ${planned.week.length}\\b`));
  await shot(page, "request-from-plan-light");

  await sheet.getByRole("button", { name: "Сегодня", exact: true }).click();
  await waitText(sheet, new RegExp(`Продуктов по плану: ${planned.today.length}\\b`));
  await sheet.getByRole("button", { name: "7 дней" }).click();
  await waitText(sheet, new RegExp(`Продуктов по плану: ${planned.week.length}\\b`));

  await sheet.getByRole("button", { name: "Создать запрос" }).click();
  await page.locator("[data-item]").first().waitFor();
  const names = await page.locator("[data-item]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-item")));
  assert.deepEqual([...names].sort(), [...planned.week].sort(), "one item per planned product");
  assert.match(await text(page.locator(".totals-card")), new RegExp(`0 из ${planned.week.length} куплено`));
  assert.match(await page.locator(".title-input").inputValue(), /^Запрос на /);
  await shot(page, "request-new-from-plan-light");

  // The same action on the request page, for a range the plan does not cover.
  await page.getByRole("button", { name: "Запрос из плана" }).click();
  await sheet.getByLabel("С", { exact: true }).fill("2001-01-01");
  await sheet.getByLabel("По", { exact: true }).fill("2001-01-03");
  await waitText(sheet, /нет продуктов/);
  assert.equal(await sheet.getByRole("button", { name: "Создать запрос" }).isDisabled(), true);
  await shot(page, "request-from-plan-empty-light");
  assert.deepEqual(errors, []);
});

test("«Купил другое» records a purchase of another product against the item", async () => {
  const { page, errors } = await startFromExample();
  await page.locator('[data-widget="requests"] a.row').first().click();
  await page.locator("[data-item]").first().waitFor();
  const item = page.locator("[data-item]").filter({ hasNot: page.locator(".check.is-on") }).first();
  const planned = await item.getAttribute("data-item");
  const [boughtBefore, total] = (await text(page.locator(".totals-card .metric-value"))).split(" из ").map(Number);
  await item.click();
  const sheet = page.locator(".sheet");
  await sheet.getByRole("button", { name: "Купил другое" }).click();
  await shot(page, "buy-other-pick-light");
  const pick = page.locator(".sheet").last();
  const rows = pick.locator(".pick-list .row-btn");
  await rows.first().waitFor();
  const names = await rows.locator(".row-title").allInnerTexts();
  const other = names.find((n) => n !== planned);
  await pick.getByPlaceholder("Найти").fill(other);
  await pick.locator(".pick-list .row-btn", { hasText: other }).first().click();
  await waitText(sheet, new RegExp(`Вместо этого: ${other}`));
  await sheet.getByLabel("Сумма").fill("210");
  await shot(page, "buy-other-sheet-light");
  await sheet.getByRole("button", { name: "Купил", exact: true }).click();

  await page.locator(".totals-card .metric-value", { hasText: `${boughtBefore + 1} из ${total}` }).waitFor();
  assert.equal(await page.locator(`[data-item="${planned}"] .check`).getAttribute("aria-label"), "куплено", "the other product still ticks the item");
  const purchases = page.locator(".block", { hasText: "Покупки" });
  const row = await waitText(purchases, new RegExp(`${other}.*вместо «${planned}».*210 ₽`));
  assert.ok(row);
  await shot(page, "request-bought-other-light");
  assert.deepEqual(errors, []);
});
