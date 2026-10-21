// The product catalog and the Заполнитель КБЖУ on objects.html, at 390 px.
// Open Food Facts and routerai.ru are answered by Playwright routes, so the
// page runs its real services against scripted replies.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { baseUrl, openApp, shot, text, useUi, waitText } from "./objects-ui-helpers.mjs";

useUi("objects-shots-catalog");

const KEY = "cookish.objects.v1";
const AT = "2026-10-01T09:00:00.000Z";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

const PRODUCTS = [
  ["buck", "Гречка", {}],
  ["millet", "Пшено", {}],
  ["milkoff", "Молоко Простоквашино 2,5%", {}],
  ["milk", "Молоко", {}],
  ["elixir", "Эликсир бодрости", {}],
  ["flakes", "Овсяные хлопья", {}],
  ["oatmeal", "Овсянка", { kcal100: 300, protein100: 10, fat100: 5, carbs100: 50 }],
];

// A space with seven products; the AI key and the consent are set unless asked otherwise.
function seeded({ key = true, consent = true } = {}) {
  const objects = Object.fromEntries(PRODUCTS.map(([id, name, props]) => [id, { id, type: "product", name, props: { unit: "г", ...props }, createdAt: AT, updatedAt: AT, createdBy: "import", updatedBy: "import" }]));
  const space = { schemaVersion: 1, customRelations: {}, customTypes: {}, objects, journal: [], meta: { home: null, importedAt: null } };
  return { cookies: [], origins: [{ origin: new URL(baseUrl).origin, localStorage: [{ name: KEY, value: JSON.stringify(space) }, ...(key ? [{ name: "cookish.ai.key.test", value: "test-key" }] : []), ...(key && consent ? [{ name: "cookish.ai.consent.v1", value: "1" }] : [])] }] };
}

// Locators that find nothing fail after 8 s, not the default 30 s.
async function open(options) {
  const app = await openApp({ storageState: seeded(options), ...options });
  app.page.setDefaultTimeout(8000);
  return app;
}

const BUCKWHEAT = {
  code: "4601234567890",
  product_name_ru: "Гречка ядрица быстроразваривающаяся",
  brands: "Увелка",
  quantity: "800 г",
  nutriments: { "energy-kcal_100g": 330, proteins_100g: 12.6, fat_100g: 3.3, carbohydrates_100g: 62 },
};
const MILK = {
  code: "4607050690021",
  product_name_ru: "Молоко питьевое 2,5%",
  brands: "Простоквашино",
  quantity: "930 мл",
  nutriments: { "energy-kcal_100g": 54, proteins_100g: 3, fat_100g: 2.5, carbohydrates_100g: 4.7 },
};

async function fakeOpenFoodFacts(context, seen = []) {
  await context.route("https://world.openfoodfacts.org/**", async (route) => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: CORS }); return; }
    const url = new URL(route.request().url());
    seen.push(url.pathname + url.search);
    const byCode = url.pathname.match(/\/api\/v2\/product\/(\d+)\.json/);
    const term = url.searchParams.get("search_terms") || "";
    const pool = [BUCKWHEAT, MILK];
    const body = byCode
      ? { status: pool.some((p) => p.code === byCode[1]) ? 1 : 0, product: pool.find((p) => p.code === byCode[1]) }
      : { products: /гречк/i.test(term) ? [BUCKWHEAT] : /молоко|простокваш/i.test(term) ? [MILK] : [] };
    await route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });
  });
}

let callId = 0;
const toolCall = (name, args) => ({ id: `call_${callId += 1}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const find = (query) => toolCall("find_reference", { query });
const upsert = (name, args) => toolCall("upsert_product", { name, ...args });

// What the model says for one product at one step of the Заполнитель's loop.
function script(product, step) {
  const { name, hint } = product;
  if (name === "Пшено") return step === 0 ? [find("пшено")] : [upsert(name, { source: "reference", source_ref: "millet" })];
  if (name === "Молоко Простоквашино 2,5%") return step === 0 ? [toolCall("search_food", { query: "Простоквашино молоко 2,5%" })] : [upsert(name, { source: "off", source_ref: MILK.code })];
  if (name === "Молоко" && hint) return step === 0 ? [upsert(name, { source: "reference", source_ref: "milk-3-2" })] : [];
  if (name === "Молоко") return step === 0 ? [find("молоко")] : [upsert(name, { source: "reference", source_ref: "milk-2" })];
  if (name === "Эликсир бодрости") return step === 0 ? [upsert(name, { source: "estimate", calories: 250, protein: 5, fat: 10, carbs: 33 })] : [];
  if (name === "Овсянка") return step === 0 ? [find("овсяные хлопья")] : [upsert(name, { source: "reference", source_ref: "oats" })];
  return [];
}

// routerai.ru as the Заполнитель meets it: every request is one step of its
// tool loop. `runs` collects the products of each run.
async function fakeProvider(context, runs = []) {
  await context.route("https://routerai.ru/**", async (route) => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: CORS }); return; }
    const body = route.request().postDataJSON();
    assert.equal(route.request().headers().authorization, "Bearer test-key", "the key goes in the header");
    assert.doesNotMatch(JSON.stringify(body), /test-key/, "and never in the text");
    const products = JSON.parse(body.messages.find((m) => m.role === "user").content.replace(/^Продукты: /, ""));
    const step = body.messages.filter((m) => m.role === "assistant").length;
    if (step === 0) runs.push(products.map((p) => p.name));
    const calls = step > 1 ? [] : products.flatMap((product) => script(product, step));
    const message = calls.length ? { role: "assistant", content: "", tool_calls: calls } : { role: "assistant", content: "Готово." };
    await route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ choices: [{ message }], usage: {} }) });
  });
}

// The Android scanner answers through a global callback.
async function withScanner(context, page) {
  await context.addInitScript(() => {
    window.NativeCookish = { scanBarcode() { setTimeout(() => window.__onNativeBarcodeScan(JSON.stringify(window.__scan || { ok: false, cancelled: true })), 30); } };
  });
  await page.reload({ waitUntil: "load" });
  await page.locator("#screen > *").first().waitFor();
}

const products = (page) => page.evaluate((key) => {
  const space = JSON.parse(localStorage.getItem(key));
  return Object.fromEntries(Object.values(space.objects).filter((o) => o.type === "product" && !o.archivedAt).map((o) => [o.name, o.props]));
}, KEY);

// A write lands a task after the click: poll the stored space.
async function eventually(page, read, expected, what, timeout = 10000) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    last = read(await products(page));
    if (isDeepStrictEqual(last, expected)) return;
    if (Date.now() > end) assert.deepEqual(last, expected, what);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const goTo = async (page, hash) => {
  await page.goto(`${baseUrl}#/${hash}`);
  await page.locator("#screen > *").first().waitFor();
};
const sheet = (page) => page.locator(".sheet");
const toast = (page) => page.locator(".toast");
const undo = async (page) => {
  await toast(page).getByRole("button", { name: "Отменить" }).click();
  await toast(page).filter({ hasText: "Отменено" }).waitFor();
};
const fillerCard = (page, id) => page.locator(`[data-filler="${id}"]`);

test("«Найти КБЖУ»: results of the reference and Open Food Facts, a pick fills the product, undo takes it back", async () => {
  const { context, page, errors } = await open();
  const seen = [];
  await fakeOpenFoodFacts(context, seen);
  await goTo(page, "object/buck");
  assert.equal(await page.getByRole("button", { name: "Сканировать штрихкод" }).count(), 0, "no scanner in a browser");

  await page.getByRole("button", { name: "Найти КБЖУ" }).click();
  const rows = sheet(page).locator(".pick-list .row-btn");
  await waitText(sheet(page), /Гречка ядрица.*Справочник.*Увелка.*Open Food Facts/);
  assert.match(await text(rows.first()), /Гречка ядрица 346 ккал · Б 11,7 · Ж 2,7 · У 64,7 · Справочник/);
  assert.match(await text(rows.filter({ hasText: "Увелка" })), /330 ккал · Б 12,6 · Ж 3,3 · У 62 · Open Food Facts/);
  assert.equal(seen.length, 1, "one Open Food Facts search for the opening query");
  await shot(page, "catalog-find-light");

  await rows.first().click();
  await eventually(page, (all) => all["Гречка"], { unit: "г", kcal100: 346, protein100: 11.7, fat100: 2.7, carbs100: 64.7, fiber100: 10.3, nutritionSource: "reference", confirmed: true }, "reference pick");
  await waitText(toast(page), /КБЖУ «Гречка» · Справочник/);
  await undo(page);
  await eventually(page, (all) => all["Гречка"], { unit: "г" }, "undo clears it");

  await page.getByRole("button", { name: "Найти КБЖУ" }).click();
  await sheet(page).locator(".pick-list .row-btn", { hasText: "Увелка" }).click();
  await eventually(page, (all) => all["Гречка"], { unit: "г", kcal100: 330, protein100: 12.6, fat100: 3.3, carbs100: 62, nutritionSource: "off", confirmed: true, brand: "Увелка", barcode: BUCKWHEAT.code }, "Open Food Facts pick");
  const source = page.locator(".prop", { hasText: "Источник КБЖУ" });
  await waitText(source, /Open Food Facts/);
  assert.equal(await source.getByRole("button", { name: "Open Food Facts" }).getAttribute("aria-pressed"), "true");
  await shot(page, "catalog-product-filled-light");
  assert.deepEqual(errors, []);
  await context.close();
});

test("a search that Open Food Facts cannot answer keeps the reference results and says why", async () => {
  const { context, page, errors } = await open();
  await context.route("https://world.openfoodfacts.org/**", (route) => route.abort());
  await goTo(page, "object/millet");
  await page.getByRole("button", { name: "Найти КБЖУ" }).click();
  await waitText(sheet(page), /Пшено.*Справочник.*Нет связи с Open Food Facts/);
  assert.equal(await sheet(page).locator(".pick-list .row-btn").first().isEnabled(), true);
  await shot(page, "catalog-find-offline-light");
  assert.deepEqual(errors.filter((e) => !/net::ERR_FAILED/.test(e)), []);
  await context.close();
});

test("«Добавить из каталога»: a new name makes a product, a name that exists offers the existing one", async () => {
  const { context, page, errors } = await open();
  await fakeOpenFoodFacts(context);
  await goTo(page, "type/product");
  await waitText(page.locator(".hero-set"), /7 объектов/);
  await shot(page, "catalog-type-header-light");

  await page.getByRole("button", { name: "Каталог" }).click();
  await waitText(sheet(page), /Добавить из каталога.*Заполнить КБЖУ с ИИ.*Без КБЖУ: 6/);
  await shot(page, "catalog-menu-light");
  await sheet(page).getByRole("button", { name: /Добавить из каталога/ }).click();

  // «Овсяные хлопья» is a product already: no duplicate.
  await sheet(page).getByLabel("Название или штрихкод").fill("овсяные хлопья");
  await sheet(page).getByRole("button", { name: "Найти", exact: true }).click();
  await waitText(sheet(page), /«Овсяные хлопья» уже есть в продуктах/);
  await sheet(page).locator(".pick-list .row-btn", { hasText: "379 ккал" }).click();
  const clash = sheet(page).getByRole("group", { name: "Такой продукт уже есть" });
  await waitText(clash, /«Овсяные хлопья» уже есть в продуктах.*Новый не создаём/);
  await shot(page, "catalog-clash-light");
  await clash.getByRole("button", { name: "Обновить КБЖУ" }).click();
  await eventually(page, (all) => [Object.keys(all).length, all["Овсяные хлопья"]?.kcal100, all["Овсяные хлопья"]?.nutritionSource], [7, 379, "reference"], "the existing product is updated, none is added");

  // «Кускус» is new: it is made and opened.
  await page.getByRole("button", { name: "Каталог" }).click();
  await sheet(page).getByRole("button", { name: /Добавить из каталога/ }).click();
  await sheet(page).getByLabel("Название или штрихкод").fill("кускус");
  await sheet(page).getByRole("button", { name: "Найти", exact: true }).click();
  await sheet(page).locator(".pick-list .row-btn", { hasText: "376 ккал" }).click();
  await eventually(page, (all) => [Object.keys(all).length, all["Кускус"]?.kcal100, all["Кускус"]?.unit, all["Кускус"]?.confirmed], [8, 376, "г", true], "a new product");
  await page.waitForFunction(() => location.hash.startsWith("#/object/"));
  assert.equal(await page.getByLabel("Название", { exact: true }).inputValue(), "Кускус");
  assert.deepEqual(errors, []);
  await context.close();
});

test("a barcode scan looks the product up in Open Food Facts; a cancelled scan does nothing", async () => {
  const { context, page, errors } = await open();
  await fakeOpenFoodFacts(context);
  await withScanner(context, page);
  await goTo(page, "object/milkoff");

  await page.getByRole("button", { name: "Сканировать штрихкод" }).click();
  await page.waitForTimeout(300);
  assert.equal(await sheet(page).count(), 0, "a cancelled scan opens nothing");

  await page.evaluate((code) => { window.__scan = { ok: true, barcode: code }; }, MILK.code);
  await page.getByRole("button", { name: "Сканировать штрихкод" }).click();
  await waitText(sheet(page), /Молоко питьевое 2,5%.*54 ккал.*Open Food Facts/);
  assert.equal(await sheet(page).getByLabel("Название или штрихкод").inputValue(), MILK.code);
  assert.equal(await sheet(page).locator(".pick-list .row-btn").count(), 1, "a barcode finds one card");
  await shot(page, "catalog-scan-result-light");
  await sheet(page).locator(".pick-list .row-btn").click();
  await eventually(page, (all) => [all["Молоко Простоквашино 2,5%"].kcal100, all["Молоко Простоквашино 2,5%"].barcode, all["Молоко Простоквашино 2,5%"].brand], [54, MILK.code, "Простоквашино"], "scanned card applied");
  assert.deepEqual(errors, []);
  await context.close();
});

test("«Заполнить с ИИ» for one product: consent first, a found card is written with an undo, an estimate waits and a rejected one writes nothing", async () => {
  const { context, page, errors } = await open({ consent: false });
  await fakeOpenFoodFacts(context);
  const runs = [];
  await fakeProvider(context, runs);

  await goTo(page, "object/millet");
  await page.getByRole("button", { name: "Заполнить с ИИ" }).click();
  await page.getByRole("dialog", { name: "Данные уходят провайдеру" }).waitFor();
  assert.deepEqual(runs, [], "nothing leaves the device before the consent");
  await page.getByRole("button", { name: "Понятно, продолжить" }).click();
  await waitText(toast(page), /КБЖУ заполнены: «Пшено»/);
  await eventually(page, (all) => all["Пшено"], { unit: "г", kcal100: 378, protein100: 11, fat100: 4.2, carbs100: 64.4, fiber100: 8.5, nutritionSource: "reference" }, "found card written");
  assert.deepEqual(runs, [["Пшено"]]);
  await undo(page);
  await eventually(page, (all) => all["Пшено"], { unit: "г" }, "undo");

  await goTo(page, "object/elixir");
  await page.getByRole("button", { name: "Заполнить с ИИ" }).click();
  const card = fillerCard(page, "elixir");
  await waitText(card, /Оценка ИИ.*Сейчас: нет КБЖУ.*Станет: 250 ккал · Б 5 · Ж 10 · У 33.*оценил КБЖУ сам/);
  assert.deepEqual((await products(page))["Эликсир бодрости"], { unit: "г" }, "an estimate is only shown");
  await shot(page, "catalog-estimate-light");

  await card.getByRole("button", { name: "Убрать" }).click();
  await card.waitFor({ state: "detached" });
  assert.deepEqual((await products(page))["Эликсир бодрости"], { unit: "г" }, "a rejected estimate writes nothing");

  await page.getByRole("button", { name: "Заполнить с ИИ" }).click();
  await fillerCard(page, "elixir").getByRole("button", { name: "Применить" }).click();
  await eventually(page, (all) => all["Эликсир бодрости"], { unit: "г", kcal100: 250, protein100: 5, fat100: 10, carbs100: 33, nutritionSource: "estimate", confirmed: false }, "applied estimate");
  await waitText(toast(page), /КБЖУ «Эликсир бодрости» · Оценка ИИ/);
  await fillerCard(page, "elixir").waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  await context.close();
});

test("the Заполнитель asks which product: an answer in words runs it again with that hint", async () => {
  const { context, page, errors } = await open();
  await fakeOpenFoodFacts(context);
  const runs = [];
  await fakeProvider(context, runs);
  await goTo(page, "object/milk");
  await page.getByRole("button", { name: "Заполнить с ИИ" }).click();
  const card = fillerCard(page, "milk");
  await waitText(card, /Какой именно продукт «Молоко»\?.*Молоко 1%.*Молоко 2%.*Молоко 3,2%/);
  assert.deepEqual((await products(page))["Молоко"], { unit: "г" }, "nothing is written before the answer");
  await shot(page, "catalog-question-light");

  await card.getByLabel("Ответ своими словами").fill("3,2%");
  await card.getByRole("button", { name: "Ответить" }).click();
  await eventually(page, (all) => [all["Молоко"].kcal100, all["Молоко"].nutritionSource], [61, "reference"], "the second run found it");
  assert.equal(runs.length, 2);
  await card.waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  await context.close();
});

test("КБЖУ typed by the person are replaced only when they say so", async () => {
  const { context, page, errors } = await open();
  await fakeOpenFoodFacts(context);
  await fakeProvider(context);
  await goTo(page, "object/oatmeal");
  await page.getByRole("button", { name: "Заполнить с ИИ" }).click();
  const card = fillerCard(page, "oatmeal");
  await waitText(card, /Вы вводили КБЖУ «Овсянка» сами.*Станет: 379 ккал/);
  await shot(page, "catalog-replace-light");

  await card.getByRole("button", { name: "Оставить мои" }).click();
  await card.waitFor({ state: "detached" });
  assert.equal((await products(page))["Овсянка"].kcal100, 300, "kept");

  await page.getByRole("button", { name: "Заполнить с ИИ" }).click();
  await fillerCard(page, "oatmeal").getByRole("button", { name: "Заменить" }).click();
  await eventually(page, (all) => [all["Овсянка"].kcal100, all["Овсянка"].nutritionSource], [379, "reference"], "replaced on request");
  assert.deepEqual(errors, []);
  await context.close();
});

test("without a key the Заполнитель does not start", async () => {
  const { context, page, errors } = await open({ key: false });
  await goTo(page, "object/millet");
  await waitText(page.locator("#screen"), /Нужен ключ ИИ/);
  assert.equal(await page.getByRole("button", { name: "Заполнить с ИИ" }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Найти КБЖУ" }).isEnabled(), true, "the catalog needs no key");
  assert.deepEqual(errors, []);
  await context.close();
});

test("bulk: all products without КБЖУ in batches of five; found cards are written, the rest waits for answers", async () => {
  const { context, page, errors } = await open({ colorScheme: "dark" });
  await fakeOpenFoodFacts(context);
  const runs = [];
  await fakeProvider(context, runs);
  await goTo(page, "type/product");
  await page.getByRole("button", { name: "Каталог" }).click();
  await sheet(page).getByRole("button", { name: /Заполнить КБЖУ с ИИ/ }).click();
  await waitText(sheet(page), /Без КБЖУ: 6.*Заполнить с ИИ \(6\)/);
  await shot(page, "catalog-bulk-start-dark");

  await sheet(page).getByRole("button", { name: /Заполнить с ИИ \(6\)/ }).click();
  await waitText(toast(page), /КБЖУ заполнены: «Молоко Простоквашино 2,5%», «Пшено»\..*Ждут вашего ответа.*Не нашлось: 2\./);
  assert.deepEqual(runs, [["Гречка", "Молоко", "Молоко Простоквашино 2,5%", "Овсяные хлопья", "Пшено"], ["Эликсир бодрости"]]);
  await eventually(page, (all) => [all["Пшено"].kcal100, all["Молоко Простоквашино 2,5%"].barcode, all["Гречка"].kcal100, all["Молоко"].kcal100, all["Эликсир бодрости"].kcal100], [378, MILK.code, undefined, undefined, undefined], "found cards written, the rest not");

  await waitText(sheet(page), /Молоко.*Вопрос.*Эликсир бодрости.*Оценка ИИ/);
  assert.equal(await sheet(page).locator("[data-filler]").count(), 2);
  await shot(page, "catalog-bulk-pending-dark");

  await fillerCard(page, "milk").locator(".row-btn", { hasText: "Молоко 2%" }).click();
  await eventually(page, (all) => [all["Молоко"].kcal100, all["Молоко"].confirmed], [50, undefined], "the chosen candidate");
  await fillerCard(page, "elixir").getByRole("button", { name: "Применить" }).click();
  await eventually(page, (all) => all["Эликсир бодрости"].nutritionSource, "estimate", "the applied estimate");
  await waitText(sheet(page), /Без КБЖУ: 2/);
  assert.equal(await sheet(page).locator("[data-filler]").count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});
