// The screens of a kit-built app on objects.html: cards, inputs, the follow
// control under a meal, the markup of a card and its validation. The space is
// seeded by hand per synthesis §2 (tracks as custom types and relations, items,
// marks and entries as objects, screens and cards as kit_screen / kit_card), so
// the screens are tested without the pipeline that normally writes it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { baseUrl, openApp, shot, text, useUi, waitText } from "./objects-ui-helpers.mjs";
import { bundleFromMarkup, bundleToMarkup, cardMarkup, checkCardMarkup } from "../mobile-shell/objects/kit/markup.js";
import { validateMarkup } from "../mobile-shell/objects/viz/validate.js";

useUi("primitives/shots/k3");

const KEY = "cookish.objects.v1";
const TODAY = "2026-10-24";
const AT = "2026-10-10T08:00:00.000Z";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// -- the seeded space ------------------------------------------------------------------------
const obj = (id, type, name, props, at = AT) => ({ id, type, name, props, createdAt: at, updatedAt: at, createdBy: "human", updatedBy: "human" });
const day = (date, hour = 10) => `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const dates = (from, to) => {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86400000)) out.push(d.toISOString().slice(0, 10));
  return out;
};

const relation = (track, f) => ({
  key: `tr_${track}__${f.key}`, name: f.name, format: f.format, system: false, hidden: true,
  ...(f.unit ? { unit: f.unit } : {}), ...(f.dimension ? { dimension: f.dimension } : {}),
  ...(f.min != null ? { min: f.min } : {}), ...(f.max != null ? { max: f.max } : {}),
  ...(f.formula ? { formula: f.formula } : {}), ...(f.types ? { types: f.types } : {}),
  kit: { track, field: f.key, type: f.type, ...f.kit },
});
const trackType = (track, name, icon, kit, relations, fact = true) => ({
  key: `tr_${track}`, name, plural: name, icon, fact, layout: fact ? "entry" : "basic", system: false, relations, kit: { track, ...kit },
});

async function seededSpace() {
  const { legacyToObjects, demoLegacyState } = await import("../mobile-shell/objects/core/migrate.js");
  const base = legacyToObjects(demoLegacyState(TODAY), { today: TODAY });
  const customRelations = Object.fromEntries(Object.values(base.relations).filter((r) => !r.system).map((r) => [r.key, r]));
  const customTypes = Object.fromEntries(Object.values(base.types).filter((t) => !t.system).map((t) => [t.key, t]));
  const objects = { ...base.objects };
  const addRelations = (track, list) => { for (const f of list) customRelations[`tr_${track}__${f.key}`] = relation(track, f); };
  const add = (o) => { objects[o.id] = o; };

  // water: a log with a goal, presets 250 and 500
  addRelations("water", [{ key: "ml", name: "Выпито", format: "number", type: "number", unit: "мл", dimension: "volume", min: 1, max: 5000, kit: { goal: 2000, goalType: "min", goalPer: "day" } }]);
  customTypes.tr_water = trackType("water", "Вода", "💧", { kind: "log", app: "voda" }, ["date", "tr_water__ml"]);
  const water = { "2026-10-18": [900, 900], "2026-10-19": [1000, 1100], "2026-10-20": [1500], "2026-10-21": [1000, 1000], "2026-10-22": [1750], "2026-10-23": [1250, 1000] };
  for (const [date, list] of Object.entries(water)) list.forEach((ml, i) => add(obj(`w_${date}_${i}`, "tr_water", "Вода", { date, tr_water__ml: ml }, day(date, 9 + i))));

  // vitamins: a habit with two items; a run of 7 days, two missed, a run of 5
  customTypes.tr_vitamins = trackType("vitamins", "Витамины", "💊", { kind: "habit", states: ["done", "skipped"], labels: { done: "принял", skipped: "пропустил" }, unmarked: "ignore", app: "vitaminy" }, ["date", "kit_item", "kit_state"]);
  const items = [["vit_d", "Витамин D", "morning"], ["magnesium", "Магний", "evening"]];
  for (const [key, name, at] of items) add(obj(`ti_vitamins_${key}`, "track_item", name, { kit_track: "vitamins", kit_key: key, kit_every: "day", kit_at: at, kit_from: "2026-10-10" }));
  for (const date of dates("2026-10-10", "2026-10-23")) {
    const state = date === "2026-10-17" || date === "2026-10-18" ? "skipped" : "done";
    for (const [key, name] of items) add(obj(`m_${key}_${date}`, "tr_vitamins", name, { date, kit_item: `ti_vitamins_${key}`, kit_state: state }, day(date)));
  }

  // sleep: a log with two time fields and a computed one
  addRelations("sleep", [
    { key: "lay", name: "Лёг", format: "time", type: "time", kit: { required: true } },
    { key: "woke", name: "Встал", format: "time", type: "time", kit: { required: true } },
    { key: "hours", name: "Спал", format: "formula", type: "calc", unit: "ч", dimension: "duration", formula: "spanHours(tr_sleep__lay, tr_sleep__woke)", kit: { calc: "spanHours(lay, woke)" } },
  ]);
  customTypes.tr_sleep = trackType("sleep", "Сон", "😴", { kind: "log", app: "son" }, ["date", "tr_sleep__lay", "tr_sleep__woke", "tr_sleep__hours"]);
  [["2026-10-21", "00:10", "07:40"], ["2026-10-22", "23:45", "07:15"], ["2026-10-23", "23:30", "07:00"]].forEach(([date, lay, woke]) => add(obj(`s_${date}`, "tr_sleep", "Сон", { date, tr_sleep__lay: lay, tr_sleep__woke: woke }, day(date))));

  // exercises: a catalog; bench: a log whose sets link to it
  customTypes.tr_exercises = trackType("exercises", "Упражнения", "📖", { kind: "catalog", app: "zal" }, [], false);
  add(obj("ti_exercises_bench", "track_item", "Жим лёжа", { kit_track: "exercises", kit_key: "bench", kit_from: "2026-10-10" }));
  add(obj("ti_exercises_squat", "track_item", "Присед", { kit_track: "exercises", kit_key: "squat", kit_from: "2026-10-10" }));
  addRelations("bench", [
    { key: "exercise", name: "Упражнение", format: "object", type: "link", types: ["track_item"], kit: { to: "exercises", required: true } },
    { key: "sets", name: "Подходы", format: "number", type: "number", min: 1, max: 20, kit: {} },
    { key: "reps", name: "Повторы", format: "number", type: "number", min: 1, max: 100, kit: {} },
    { key: "weight", name: "Вес", format: "number", type: "number", unit: "кг", dimension: "mass", min: 0, max: 500, kit: {} },
    { key: "volume", name: "Тоннаж", format: "formula", type: "calc", unit: "кг", dimension: "mass", formula: "((tr_bench__sets * tr_bench__reps) * tr_bench__weight)", kit: { calc: "sets * reps * weight" } },
  ]);
  customTypes.tr_bench = trackType("bench", "Жим лёжа", "🏋", { kind: "log", app: "zal" }, ["date", "tr_bench__exercise", "tr_bench__sets", "tr_bench__reps", "tr_bench__weight", "tr_bench__volume"]);
  [["2026-10-17", "bench", 80], ["2026-10-20", "bench", 82.5], ["2026-10-22", "squat", 100], ["2026-10-23", "bench", 85]].forEach(([date, ex, weight]) => add(obj(`b_${date}`, "tr_bench", "Жим лёжа", { date, tr_bench__exercise: `ti_exercises_${ex}`, tr_bench__sets: 3, tr_bench__reps: 8, tr_bench__weight: weight }, day(date))));

  // satiety: a follow track on the meals of the Рацион
  addRelations("satiety", [{ key: "level", name: "Насколько сыт", format: "number", type: "scale", min: 1, max: 5, kit: { labels: ["голоден", "", "норма", "", "переел"], hint: "1 — голоден, 5 — объелся" } }]);
  customTypes.tr_satiety = trackType("satiety", "Сытость", "😌", { kind: "follow", follows: "ration", states: ["done"], app: "sytost" }, ["date", "tr_satiety__level", "kit_slot", "kit_state"]);

  // shop: a list of open items; a purchase asks for the price
  addRelations("shop", [{ key: "price", name: "Сумма", format: "number", type: "number", unit: "₽", dimension: "money", min: 0, max: 1000000, kit: {} }]);
  customTypes.tr_shop = trackType("shop", "Покупки", "🛒", { kind: "list", states: ["done"], labels: { done: "куплено" }, unmarked: "ignore", app: "pokupki" }, ["date", "tr_shop__price", "kit_item", "kit_state"]);
  for (const [key, name] of [["milk", "Молоко"], ["bread", "Хлеб"]]) add(obj(`ti_shop_${key}`, "track_item", name, { kit_track: "shop", kit_key: key, kit_every: "open", kit_from: "2026-10-20" }));

  // recipes: a catalog whose rows carry a time and a note
  addRelations("recipes", [
    { key: "mins", name: "Минут", format: "number", type: "number", unit: "мин", dimension: "duration", min: 1, max: 600, kit: {} },
    { key: "note", name: "Заметка", format: "text", type: "text", kit: {} },
  ]);
  customTypes.tr_recipes = trackType("recipes", "Рецепты", "🍲", { kind: "catalog", app: "recepty" }, ["tr_recipes__mins", "tr_recipes__note"], false);
  add(obj("ti_recipes_borsch", "track_item", "Борщ", { kit_track: "recipes", kit_key: "borsch", kit_from: "2026-10-10", kit_plan: { mins: 90 } }));

  // screens and cards
  const screens = [["home", "Главная", "", 0], ["water", "Вода", "💧", 1], ["vitamins", "Витамины", "💊", 2], ["bench", "Жим лёжа", "🏋", 3], ["shop", "Покупки", "🛒", 4], ["recipes", "Рецепты", "🍲", 5]];
  for (const [key, name, icon, order] of screens) add(obj(`sc_${key}`, "kit_screen", name, { kit_key: key, kit_order: order, ...(icon ? { kit_icon: icon } : {}) }));
  const cards = [
    ["home", "water_today", "Вода сегодня", "full", [{ el: "meter", of: "water", value: "ml" }, { el: "quick", of: "water", values: { ml: 250 } }, { el: "quick", of: "water", values: { ml: 500 } }]],
    ["home", "vitamins_today", "Витамины сегодня", "full", [{ el: "marks", of: "vitamins" }]],
    ["home", "sleep_add", "Сон за ночь", "full", [{ el: "form", of: "sleep", fields: ["lay", "woke"] }]],
    ["water", "water_week", "Вода по дням", "full", [{ el: "bars", of: "water", value: "ml", fn: "sum", range: "@last7d" }]],
    ["water", "water_gauge", "Стрелка воды", "full", [{ el: "gauge", of: "water", value: "ml" }]],
    ["water", "water_sum", "Выпито за неделю", "half", [{ el: "stat", of: "water", value: "ml", fn: "sum", range: "@last7d" }]],
    ["water", "water_count", "Записей за неделю", "half", [{ el: "stat", of: "water", fn: "count", range: "@last7d" }]],
    ["vitamins", "vitamins_streak", "Серия", "full", [{ el: "streak", of: "vitamins" }]],
    ["vitamins", "vitamins_marks", "Отметки", "full", [{ el: "marks", of: "vitamins" }]],
    ["bench", "bench_add", "Записать жим", "full", [{ el: "form", of: "bench", fields: ["exercise", "sets", "reps", "weight"] }]],
    ["bench", "bench_best", "Лучший вес жима", "half", [{ el: "stat", of: "bench", value: "weight", fn: "max", range: "@last30d", where: { exercise: "bench" } }]],
    ["bench", "bench_volume", "Тоннаж", "half", [{ el: "spark", of: "bench", value: "volume", fn: "sum", range: "@last30d" }]],
    ["bench", "bench_last", "Последние тренировки", "full", [{ el: "table", of: "bench", columns: ["date", "exercise", "sets", "reps", "weight"], limit: 6, range: "@last90d" }]],
    ["bench", "bench_sport", "Спорт сегодня", "full", [{ el: "embed", what: "sport-today" }]],
    ["shop", "shop_list", "Список", "full", [{ el: "marks", of: "shop", add: true }]],
    ["shop", "shop_bought", "Купленное", "full", [{ el: "list", of: "shop", columns: ["date", "item", "price"], limit: 5, range: "@last30d", add: true }]],
    ["recipes", "recipes_all", "Рецепты", "full", [{ el: "list", of: "recipes", columns: ["name", "mins", "note"], limit: 10, add: true }]],
  ];
  cards.forEach(([screen, key, title, size, body], i) => add(obj(`cd_${key}`, "kit_card", title, { kit_key: key, kit_screen: `sc_${screen}`, kit_size: size, kit_order: 100 + i, kit_body: body })));

  return { schemaVersion: 1, customRelations, customTypes, objects, journal: [], meta: base.meta };
}

let spaceJson;
async function storage() {
  spaceJson ??= JSON.stringify(await seededSpace());
  return { cookies: [], origins: [{ origin: new URL(baseUrl).origin, localStorage: [{ name: KEY, value: spaceJson }] }] };
}

// The page runs on a fixed Saturday, whatever day the test runs.
async function open({ colorScheme = "light", width = 390, hash = "" } = {}) {
  const app = await openApp({ colorScheme, storageState: await storage(), viewport: { width, height: 844 } });
  await app.context.clock.setFixedTime(new Date(2026, 9, 24, 12, 0, 0));
  await app.page.goto(`${baseUrl}#/${hash}`, { waitUntil: "load" });
  await app.page.reload({ waitUntil: "load" });
  await app.page.locator("#screen > *").first().waitFor();
  app.page.setDefaultTimeout(8000);
  return app;
}

const space = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
const live = async (page, type) => Object.values((await space(page)).objects).filter((o) => o.type === type && !o.archivedAt);

async function until(read, ok, what, timeout = 8000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await read().catch(() => undefined);
    if (value !== undefined && ok(value)) return value;
    if (Date.now() > end) assert.fail(`${what}: never became right, last ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const plain = (list) => list.map((t) => t.replace(/\s+/g, " ").trim());
const card = (page, title) => page.locator(`c-card[data-title="${title}"]`);
// The kit's own part of the page: the classic widgets of the home carry no element names and are not under test.
const audit = (page, scope = ".kit-home, .kit-screen, .kit-follow") => page.evaluate(async (selector) => {
  const { auditRendered } = await import("/objects/viz/audit.js");
  const roots = [...document.querySelectorAll(selector)];
  return roots.length ? roots.flatMap((root) => auditRendered(root)) : auditRendered(document.querySelector("#screen"));
}, scope);
const go = async (page, hash) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.locator("#screen > *").first().waitFor();
  await page.waitForTimeout(150);
};

// -- markup of a card and surface S2 (no browser) ---------------------------------------------
test("a card becomes closed markup, and what the validator refuses never gets through", () => {
  const water = { title: "Вода сегодня", caption: "Цель на день", body: [{ el: "meter", of: "water", value: "ml" }, { el: "quick", of: "water", values: { ml: 250 } }, { el: "marks", of: "vitamins", add: true }, { el: "p", text: "Тихо & спокойно <ok>" }] };
  assert.equal(cardMarkup(water), '<c-card title="Вода сегодня" caption="Цель на день"><c-meter of="water" value="ml"></c-meter><c-quick of="water" values="ml=250"></c-quick><c-marks of="vitamins" add="yes"></c-marks><p>Тихо &amp; спокойно &lt;ok&gt;</p></c-card>');
  assert.deepEqual(checkCardMarkup(water).problems, []);

  const attack = { title: 'a" onclick="x"', body: [{ el: "meter", of: "water", value: "ml", onclick: "alert(1)" }] };
  assert.equal(cardMarkup(attack), '<c-card title="a&quot; onclick=&quot;x&quot;"><c-meter of="water" value="ml" onclick="alert(1)"></c-meter></c-card>');
  const refused = checkCardMarkup(attack);
  assert.deepEqual(refused.problems.map((p) => [p.path, p.rule]), [["c-card[0] > c-meter[0]@onclick", "unknown-attr"]]);

  const gauge = checkCardMarkup({ title: "Стрелка", body: [{ el: "gauge", of: "water", value: "ml" }] });
  assert.deepEqual(gauge.problems.map((p) => [p.path, p.rule]), [["c-card[0] > c-gauge[0]", "unknown-tag"]]);
  const weird = checkCardMarkup({ title: "x", body: [{ el: "meter of=water><script", of: "water", value: "ml" }] });
  assert.equal(weird.ok, false, "a name that is not a tag cannot be smuggled into the markup");
  assert.equal(cardMarkup({ title: "x", body: [{ el: "meter of=water><script" }] }).includes("<script"), false);

  const rules = (card) => checkCardMarkup(card).problems.map((p) => p.rule);
  assert.deepEqual(rules({ title: "x", body: [] }), ["empty-card"]);
  assert.deepEqual(rules({ title: "x", body: Array.from({ length: 5 }, () => ({ el: "streak", of: "water" })) }), ["too-many-elements"]);
  assert.deepEqual(rules({ title: "x", body: [{ el: "quick", of: "water" }] }), ["missing-attr"]);
  assert.deepEqual(rules({ title: "x", body: [{ el: "embed", what: "weather" }] }), ["bad-value"]);
  assert.deepEqual(rules({ title: "x", body: [{ el: "bars", of: "water", value: "ml", range: "@today" }] }), ["range-too-short"]);
  assert.deepEqual(rules({ title: "Пить 8 стаканов", body: [{ el: "meter", of: "water", value: "ml" }] }), [], "the numbers of a title are judged with the request, in validateBundle; a card drawn later is not refused for them");
  assert.deepEqual(rules({ title: "Плюс 250", body: [{ el: "quick", of: "water", values: { ml: 250 } }] }), [], "a number that stands in a binding is allowed");
  // the card source is a card, and the old panels keep their own vocabulary
  assert.equal(validateMarkup("<c-dashboard v=\"1\"><c-card title=\"a\"><c-quick of=\"water\" values=\"ml=250\"></c-quick></c-card></c-dashboard>").ok, false, "c-quick is not part of a panel");
  assert.equal(validateMarkup("<c-card title=\"a\"><c-bars set=\"set_water\" value=\"drunk\"></c-bars></c-card>", { kit: true }).problems[0].rule, "unknown-attr", "a card binds by `of`, not by `set`");
});

test("surface S2 prints and reads back the same bundle, and reports what it cannot read", () => {
  const dir = path.join(root, "mobile-shell", "objects", "kit", "examples");
  const own = {
    v: 2, name: "Сытость", reply: "Добавил вопрос после еды.",
    tracks: [
      { key: "satiety", name: "Сытость", kind: "follow", follows: "ration", icon: "😌", states: ["done"], labels: { done: "записал" }, fields: [{ key: "level", name: "Насколько сыт", type: "scale", min: 1, max: 5, labels: ["голоден", "", "норма", "", "переел"], hint: "1 — голоден, 5 — объелся", required: true }] },
      { key: "vitamins", name: "Витамины", kind: "habit", avoid: true, grace: 2, times: 3, per: "week", items: [{ name: "Витамин D", key: "vit_d", every: "mon,wed,fri", at: "07:30", from: "2026-10-24", plan: { dose: 1 } }] },
      { key: "sleep", name: "Сон", kind: "log", fields: [{ key: "mood", name: "Самочувствие", type: "choice", options: ["бодро", "устал"], on: ["done", "changed"], goal: 7.5, goalType: "min", goalPer: "week", planned: true }] },
    ],
    screens: [{ key: "home", cards: [{ key: "sat", title: "Сытость после еды", caption: "Отмечайте сразу", size: "half", body: [{ el: "marks", of: "satiety" }, { el: "line", of: "satiety", value: "level", fn: "avg", range: "@last30d", area: true, where: { level: 3 } }, { el: "table", of: "sleep", columns: ["date", "mood"], limit: 5, order: "desc", range: "@last90d" }, { el: "empty", text: "Записей пока нет" }] }] }, { key: "water", name: "Вода", icon: "💧" }],
    remove: [{ card: "weight_chart" }, { item: "vitamins.vit_d" }, { field: "bench.note" }],
  };
  const examples = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  const bundles = [own, ...examples.map((e) => e.bundle ?? { reply: e.reply })];
  assert.ok(bundles.length >= 10, "the examples of the manual are read too");
  for (const bundle of bundles) {
    const markup = bundleToMarkup(bundle);
    const back = bundleFromMarkup(markup);
    assert.deepEqual(back.problems, [], markup);
    assert.deepEqual(back.bundle, bundle, markup);
    for (const screen of bundle.screens || []) for (const c of screen.cards || []) assert.deepEqual(checkCardMarkup(c).problems, [], `${c.key} of «${bundle.name}»`);
  }

  const markup = bundleToMarkup({ v: 2, name: "Вода", tracks: [{ key: "water", name: "Вода", kind: "log", fields: [{ key: "ml", name: "Выпито", type: "number", unit: "мл", goal: 2000 }] }], screens: [{ key: "home", cards: [{ title: "Вода сегодня", body: [{ el: "quick", of: "water", values: { ml: 250 } }] }] }] });
  assert.equal(markup, `<c-bundle v="2" name="Вода">
  <c-track key="water" name="Вода" kind="log">
    <c-field key="ml" name="Выпито" type="number" unit="мл" goal="2000"/>
  </c-track>
  <c-screen key="home">
    <c-card title="Вода сегодня">
      <c-quick of="water" values="ml=250"/>
    </c-card>
  </c-screen>
</c-bundle>`);
  assert.equal(bundleToMarkup({ reply: "Дозу я не считаю." }), "<c-reply>Дозу я не считаю.</c-reply>");

  const read = (src) => bundleFromMarkup(src);
  assert.deepEqual(read('<c-bundle v="2" name="x"><c-track key="a" name="A" kind="log"><c-field key="n" required min="1" goal-type="max"></c-field></c-track></c-bundle>').bundle.tracks[0].fields, [{ key: "n", required: true, min: 1, goalType: "max" }], "a bare attribute is yes, a kebab name is a camel key, numbers are numbers");
  assert.deepEqual(read('Готово. <c-bundle v="2" name="x"></c-bundle>').changes.length, 1, "a sentence outside the markup is taken as the reply");
  assert.equal(read('Готово. <c-bundle v="2" name="x"></c-bundle>').bundle.reply, "Готово.");
  const refused = (src) => read(src).problems.map((p) => [p.path, p.rule]);
  assert.deepEqual(refused(""), [["c-bundle", "no-root"]]);
  assert.deepEqual(read("Вот ваш ответ"), { bundle: { reply: "Вот ваш ответ" }, problems: [], changes: ["Фраза без разметки записана как ответ <c-reply>."] }, "a bare sentence is a reply, not an error");
  assert.deepEqual(refused('<c-bundle v="2" name="x"><c-track key="a">'), [["c-bundle", "unclosed-tag"], ["c-bundle", "unclosed-tag"]]);
  assert.deepEqual(refused('<c-bundle v="2" name="x"><c-field key="n"/></c-bundle>'), [["c-bundle > c-field[0]", "unknown-tag"]]);
  assert.deepEqual(refused('<c-bundle v="2" name="x"><c-screen key="home"><c-meter of="water"/></c-screen></c-bundle>'), [["c-bundle > c-screen[0] > c-meter[0]", "not-allowed-here"]]);
  assert.deepEqual(refused('<c-bundle v="2" name="x"><c-screen key="home"><c-card title="t"><script>alert(1)</script></c-card></c-screen></c-bundle>'), [["c-bundle > c-screen[0] > c-card[0] > script[0]", "unknown-tag"]]);
  assert.deepEqual(refused('<c-bundle v="2" name="x"><c-remove/></c-bundle>'), [["c-bundle > c-remove[0]", "empty-remove"]]);
  assert.deepEqual(refused('<c-bundle v="2" name="a" name="b"></c-bundle>'), [["c-bundle@name", "duplicate-attr"]]);
  assert.deepEqual(refused('<c-bundle v="2" name="x"></c-bundle><c-bundle v="2" name="y"></c-bundle>'), [["c-bundle", "extra-root"]]);
  assert.deepEqual(refused('<c-bundle v="2" name="x"><c-card title="t"></c-card></c-bundle>'), [["c-bundle > c-card[0]", "unknown-tag"]]);
  assert.deepEqual(refused('<c-bundle v="2" name="x"><c-track key="a" labels="done принял"></c-track></c-bundle>'), [["c-bundle > c-track[0]@labels", "bad-value"]]);
});

// -- the home -------------------------------------------------------------------------------------
test("the home shows its kit cards above the classic widgets, and +250 мл records one entry", async () => {
  const { context, page, errors } = await open();
  const order = await page.evaluate(() => {
    const kit = document.querySelector(".kit-home");
    const widget = document.querySelector("[data-widget]");
    return { kit: Boolean(kit), above: Boolean(kit && widget && kit.compareDocumentPosition(widget) & Node.DOCUMENT_POSITION_FOLLOWING), titles: [...document.querySelectorAll(".kit-home c-card")].map((c) => c.getAttribute("data-title")) };
  });
  assert.deepEqual(order, { kit: true, above: true, titles: ["Вода сегодня", "Витамины сегодня", "Сон за ночь"] });
  assert.equal(await page.locator("#nav > *").count(), 5, "the navigation keeps its five items");

  const water = card(page, "Вода сегодня");
  assert.equal(await text(water.locator("c-meter .metric-value")), "0");
  assert.equal(await text(water.locator("c-meter .metric-of")), "из 2 000 мл");
  assert.deepEqual(plain(await water.getByRole("button").allInnerTexts()), ["+250 мл", "+500 мл"]);
  await shot(page, "home-light");

  await water.getByRole("button", { name: "+250 мл" }).click();
  await waitText(water.locator("c-meter .metric-value"), /^250$/);
  const today = (await live(page, "tr_water")).filter((o) => o.props.date === TODAY);
  assert.deepEqual(today.map((o) => o.props.tr_water__ml), [250], "one tap, one entry");
  assert.equal(await text(page.locator(".toast")), "Вода: +250 мл Отменить");

  await water.getByRole("button", { name: "+500 мл" }).click();
  await waitText(water.locator("c-meter .metric-value"), /^750$/);
  assert.deepEqual((await live(page, "tr_water")).filter((o) => o.props.date === TODAY).map((o) => o.props.tr_water__ml).sort(), [250, 500]);

  await page.locator(".toast").getByRole("button", { name: "Отменить" }).click();
  await waitText(water.locator("c-meter .metric-value"), /^250$/);
  assert.deepEqual((await live(page, "tr_water")).filter((o) => o.props.date === TODAY).map((o) => o.props.tr_water__ml), [250], "undo takes back the last tap only");
  await waitText(page.locator(".toast"), /^Отменено$/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("a habit is marked with the labels of its track and unmarked quietly", async () => {
  const { context, page, errors } = await open();
  const row = card(page, "Витамины сегодня").locator('li[data-row="vit_d"]');
  assert.deepEqual(await row.getByRole("button").allInnerTexts(), ["принял", "пропустил"]);
  assert.equal(await text(row.locator(".kit-mark-sub")), "утром");
  assert.equal(await row.getByRole("button", { name: "принял", exact: true }).getAttribute("aria-pressed"), "false");
  assert.equal(await row.getByRole("button", { name: /Снять отметку/ }).count(), 0, "nothing to take back yet");
  const marksEl = card(page, "Витамины сегодня").locator("c-marks");
  assert.equal(await text(marksEl.locator(":scope > .kit-hint")), "Отмечено 0 из 2");
  assert.equal(await marksEl.evaluate((el) => [...el.childNodes].every((n) => n.nodeType === 1)), true, "no stray text node such as «null» among the children");

  await row.getByRole("button", { name: "принял", exact: true }).click();
  await until(() => row.getByRole("button", { name: "принял", exact: true }).getAttribute("aria-pressed"), (v) => v === "true", "the mark is shown");
  const marks = (await live(page, "tr_vitamins")).filter((o) => o.props.date === TODAY);
  assert.deepEqual(marks.map((o) => [o.props.kit_item, o.props.kit_state]), [["ti_vitamins_vit_d", "done"]]);
  assert.equal(await text(page.locator(".toast")), "Витамин D: принял Отменить");
  assert.equal(await text(card(page, "Витамины сегодня").locator("c-marks > .kit-hint")), "Отмечено 1 из 2");
  assert.equal(await card(page, "Витамины сегодня").locator('li[data-row="magnesium"] button[aria-pressed="true"]').count(), 0, "the other item stays open");
  await shot(page, "home-vitamin-marked");

  await row.getByRole("button", { name: "пропустил", exact: true }).click();
  await until(() => row.getByRole("button", { name: "пропустил", exact: true }).getAttribute("aria-pressed"), (v) => v === "true", "a second state replaces the first");
  assert.deepEqual((await live(page, "tr_vitamins")).filter((o) => o.props.date === TODAY).map((o) => o.props.kit_state), ["skipped"], "still one mark");

  await row.getByRole("button", { name: /Снять отметку/ }).click();
  await until(() => row.getByRole("button", { name: "пропустил", exact: true }).getAttribute("aria-pressed"), (v) => v === "false", "the mark is gone");
  assert.deepEqual((await live(page, "tr_vitamins")).filter((o) => o.props.date === TODAY), []);
  assert.equal(await row.getByRole("button", { name: /Снять отметку/ }).count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test("a form is prefilled from the last entry, refuses an empty required field and records a night", async () => {
  const { context, page, errors } = await open();
  const form = card(page, "Сон за ночь");
  const lay = form.getByLabel("Лёг");
  const woke = form.getByLabel("Встал");
  assert.equal(await lay.inputValue(), "23:30", "the last night");
  assert.equal(await woke.inputValue(), "07:00");

  await woke.fill("");
  await form.getByRole("button", { name: "Записать" }).click();
  assert.equal(await text(form.getByRole("alert")), "Встал: заполните поле");
  assert.equal((await live(page, "tr_sleep")).filter((o) => o.props.date === TODAY).length, 0, "nothing was written");

  await lay.fill("22:45");
  await woke.fill("06:30");
  await form.getByRole("button", { name: "Записать" }).click();
  await until(async () => (await live(page, "tr_sleep")).filter((o) => o.props.date === TODAY), (list) => list.length === 1, "the night is stored");
  const night = (await live(page, "tr_sleep")).find((o) => o.props.date === TODAY);
  assert.deepEqual([night.props.tr_sleep__lay, night.props.tr_sleep__woke], ["22:45", "06:30"]);
  assert.equal(await text(page.locator(".toast")), "Сон: записано Отменить");
  assert.equal(await card(page, "Сон за ночь").getByLabel("Лёг").inputValue(), "22:45", "the next form starts from this night");

  await card(page, "Сон за ночь").getByRole("button", { name: "Другой день" }).click();
  const date = card(page, "Сон за ночь").getByLabel("Дата записи");
  assert.equal(await date.inputValue(), TODAY);
  assert.equal(await date.getAttribute("max"), TODAY, "the future cannot be picked");
  assert.deepEqual(errors, []);
  await context.close();
});

test("a list asks for the fields of a state, adds an item on the spot and refuses a twin", async () => {
  const { context, page, errors } = await open({ hash: "screen/shop" });
  const list = card(page, "Список");
  await list.locator("c-marks").waitFor();
  assert.deepEqual(await list.locator(".kit-mark-name").allInnerTexts(), ["Молоко", "Хлеб"], "the open items");
  const milk = list.locator('li[data-row="milk"]');
  await milk.getByRole("button", { name: "куплено", exact: true }).click();
  const ask = list.getByRole("form", { name: "Молоко: куплено" });
  assert.equal(await ask.getByLabel("Сумма").count(), 1, "the state asks for the price");
  assert.equal((await live(page, "tr_shop")).length, 0, "nothing is marked until it is confirmed");
  await ask.getByLabel("Сумма").fill("89,5");
  await ask.getByRole("button", { name: "Отметить: куплено" }).click();
  await until(async () => (await live(page, "tr_shop")), (marks) => marks.length === 1, "the purchase is stored");
  const mark = (await live(page, "tr_shop"))[0];
  assert.deepEqual([mark.props.kit_item, mark.props.kit_state, mark.props.tr_shop__price, mark.props.date], ["ti_shop_milk", "done", 89.5, TODAY]);
  assert.equal(await text(page.locator(".toast")), "Молоко: куплено Отменить");
  await until(() => milk.getByRole("button", { name: "куплено", exact: true }).getAttribute("aria-pressed"), (v) => v === "true", "the item shows as bought");

  await list.getByRole("button", { name: "Добавить в «Покупки»" }).click();
  await list.getByLabel("Название нового пункта").fill("Сыр");
  await list.getByRole("button", { name: "Добавить", exact: true }).click();
  await until(async () => (await live(page, "track_item")).filter((o) => o.props.kit_track === "shop").map((o) => [o.id, o.name, o.props.kit_every]), (items) => items.length === 3, "the item is stored");
  assert.ok((await live(page, "track_item")).some((o) => o.id === "ti_shop_syr" && o.props.kit_every === "open" && o.name === "Сыр"), "an item of a list is open");
  await list.locator('li[data-row="syr"]').waitFor();
  assert.equal(await text(page.locator(".toast")), "Покупки: добавлено «Сыр» Отменить");

  await list.getByRole("button", { name: "Добавить в «Покупки»" }).click();
  await list.getByLabel("Название нового пункта").fill("Молоко");
  await list.getByRole("button", { name: "Добавить", exact: true }).click();
  await waitText(page.locator(".toast"), /«Молоко» уже есть в разделе «Покупки»/);
  assert.equal(await page.locator(".toast-error").count(), 1);
  assert.equal((await live(page, "track_item")).filter((o) => o.props.kit_track === "shop").length, 3);
  await shot(page, "screen-shop-light");
  assert.deepEqual(errors, []);
  await context.close();
});

test("a recipe is added to a catalog from its screen with its fields, and a list offers only the name of an item", async () => {
  const { context, page, errors } = await open({ hash: "screen/recipes" });
  const recipes = card(page, "Рецепты");
  await recipes.locator("c-list").waitFor();
  assert.match((await text(recipes.locator("c-list"))), /Борщ.*90 мин/, "the row that was already there");
  const rows = async () => (await live(page, "track_item")).filter((o) => o.props.kit_track === "recipes");

  await recipes.getByRole("button", { name: "Добавить в «Рецепты»" }).click();
  const form = recipes.getByRole("form", { name: "Добавить в «Рецепты»" });
  assert.deepEqual(await form.locator(".kit-label").allInnerTexts(), ["Минут", "Заметка"], "the fields of the track follow the name");
  await form.getByRole("button", { name: "Добавить", exact: true }).click();
  assert.equal(await text(form.getByRole("alert")), "Напишите название");
  await form.getByLabel("Название").fill("Окрошка");
  await form.getByLabel("Минут").fill("0");
  await form.getByRole("button", { name: "Добавить", exact: true }).click();
  assert.equal(await text(form.getByRole("alert")), "Минут: не меньше 1");
  assert.equal((await rows()).length, 1, "nothing is stored until the form is right");
  await form.getByLabel("Минут").fill("25");
  await form.getByLabel("Заметка").fill("на кефире");
  await shot(page, "screen-recipes-add");
  await form.getByRole("button", { name: "Добавить", exact: true }).click();
  await until(rows, (list) => list.length === 2, "the recipe is stored");
  const made = (await rows()).find((o) => o.name === "Окрошка");
  assert.equal(made.id, "ti_recipes_okroshka");
  assert.deepEqual([made.props.kit_track, made.props.kit_key, made.props.kit_plan, made.props.kit_every], ["recipes", "okroshka", { mins: 25, note: "на кефире" }, undefined], "a catalog row has its fields and no schedule");
  assert.equal(await text(page.locator(".toast")), "Рецепты: добавлено «Окрошка» Отменить");
  await waitText(recipes.locator("c-list"), /Окрошка.*25 мин.*на кефире/);

  await recipes.getByRole("button", { name: "Добавить в «Рецепты»" }).click();
  await recipes.getByLabel("Название").fill("борщ");
  await recipes.getByRole("button", { name: "Добавить", exact: true }).click();
  await waitText(page.locator(".toast"), /«борщ» уже есть в разделе «Рецепты»/);
  assert.equal((await rows()).length, 2, "a twin is refused");

  assert.deepEqual(errors, []);
  await context.close();
});

test("the undo of an added recipe takes the row away, and an item of a list is added without fields it does not plan", async () => {
  const { context, page, errors } = await open({ hash: "screen/recipes" });
  const recipes = card(page, "Рецепты");
  await recipes.locator("c-list").waitFor();
  await recipes.getByRole("button", { name: "Добавить в «Рецепты»" }).click();
  await recipes.getByLabel("Название").fill("Суп");
  await recipes.getByRole("button", { name: "Добавить", exact: true }).click();
  await until(async () => (await live(page, "track_item")).filter((o) => o.props.kit_track === "recipes"), (list) => list.length === 2, "the row is stored");
  await page.locator(".toast").getByRole("button", { name: "Отменить" }).click();
  await until(async () => (await live(page, "track_item")).filter((o) => o.props.kit_track === "recipes"), (list) => list.length === 1, "the undo took it away");

  await go(page, "#/screen/shop");
  const bought = card(page, "Купленное");
  await bought.getByRole("button", { name: "Добавить в «Покупки»" }).click();
  const form = bought.getByRole("form", { name: "Добавить в «Покупки»" });
  assert.deepEqual(await form.locator(".kit-label").allInnerTexts(), [], "the price belongs to a purchase, not to an item: only the name is asked");
  await form.getByLabel("Название").fill("Яйца");
  await form.getByRole("button", { name: "Добавить", exact: true }).click();
  await until(async () => (await live(page, "track_item")).filter((o) => o.props.kit_track === "shop"), (list) => list.length === 3, "the item is stored");
  const item = (await live(page, "track_item")).find((o) => o.name === "Яйца");
  assert.deepEqual([item.props.kit_every, item.props.kit_plan], ["open", undefined]);
  assert.deepEqual(errors, []);
  await context.close();
});

// -- the screens --------------------------------------------------------------------------------------
test("«Мои разделы» lists the screens but home, and the streak shows current, best and the month together", async () => {
  const { context, page, errors } = await open();
  const rows = await page.locator(".kit-sections .row").allInnerTexts();
  assert.deepEqual(rows.map((r) => r.replace(/\s+/g, " ").trim()), ["💧 Вода", "💊 Витамины", "🏋 Жим лёжа", "🛒 Покупки", "🍲 Рецепты"], "by kit_order, home left out");
  await page.locator(".kit-sections").getByRole("link", { name: /Витамины/ }).click();
  await page.locator("c-streak").waitFor();
  assert.equal(new URL(page.url()).hash, "#/screen/vitamins");
  assert.match(await text(page.locator(".topbar-title")), /Витамины/);
  assert.equal(await page.locator("#nav .is-on").innerText(), "Главная", "the home tab stays on");

  const streak = card(page, "Серия").locator("c-streak");
  const cells = await streak.locator(".kit-streak-cell").evaluateAll((list) => list.map((c) => c.innerText.replace(/\s+/g, " ").trim()));
  assert.deepEqual(cells, ["5 дней подряд", "7 лучшая серия", "12 из 14 дней за месяц"], "seven good days, two missed, five good days, today still open");
  assert.equal(await streak.locator(".kit-streak").getAttribute("aria-label"), "Серия 5 дней, лучшая 7 дней, за 30 дней 12 из 14");
  assert.equal(/сброс|обнул|потерял/i.test(await text(streak)), false, "no wording that shames a slip");
  const heights = await streak.locator(".kit-streak-value").evaluateAll((list) => list.map((e) => Math.round(e.getBoundingClientRect().height)));
  assert.ok(heights.every((h) => h <= 42), `every number stands on one line: ${heights}`);
  await shot(page, "screen-vitamins-light");
  assert.deepEqual(errors, []);
  await context.close();
});

test("a log with sets linked to a catalog records the link, and a chart can filter by it", async () => {
  const { context, page, errors } = await open({ hash: "screen/bench" });
  await page.locator("c-form").waitFor();
  const best = card(page, "Лучший вес жима");
  assert.equal(await text(best.locator(".metric-value")), "85", "the squat of 100 is not counted: the filter is exercise=bench");

  const form = card(page, "Записать жим");
  assert.deepEqual(await form.locator(".kit-picker button").allInnerTexts(), ["Жим лёжа", "Присед"], "the rows of the catalog");
  await form.getByRole("button", { name: "Жим лёжа" }).click();
  await form.getByLabel("Подходы").fill("3");
  await form.getByLabel("Повторы").fill("5");
  await form.getByLabel("Вес").fill("87,5");
  await form.getByRole("button", { name: "Записать" }).click();
  await until(async () => (await live(page, "tr_bench")).filter((o) => o.props.date === TODAY), (list) => list.length === 1, "the set is stored");
  const entry = (await live(page, "tr_bench")).find((o) => o.props.date === TODAY);
  assert.deepEqual([entry.props.tr_bench__exercise, entry.props.tr_bench__sets, entry.props.tr_bench__reps, entry.props.tr_bench__weight], ["ti_exercises_bench", 3, 5, 87.5]);
  await waitText(best.locator(".metric-value"), /^87,5$/);
  const last = await card(page, "Последние тренировки").locator("tbody tr").first().innerText();
  assert.match(last.replace(/\s+/g, " "), /24 окт.*Жим лёжа.*3.*5.*87,5 кг/);

  await form.getByRole("button", { name: "Присед" }).click();
  await form.getByLabel("Подходы").fill("0");
  await form.getByRole("button", { name: "Записать" }).click();
  assert.match(await text(form.getByRole("alert")), /^Подходы: не меньше 1$/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("half cards stand side by side on a wide screen and stack on a phone", async () => {
  const boxes = async (page) => page.locator('.kit-cell[data-size="half"]').evaluateAll((list) => list.map((c) => { const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; }));
  const phone = await open({ hash: "screen/water" });
  await phone.page.locator("c-bars").waitFor();
  const stacked = await boxes(phone.page);
  assert.equal(stacked.length, 2);
  assert.equal(stacked[0].x, stacked[1].x, "one column on a phone");
  assert.ok(stacked[1].y > stacked[0].y + 50);
  await phone.context.close();

  const wide = await open({ hash: "screen/water", width: 728 });
  await wide.page.locator("c-bars").waitFor();
  const paired = await boxes(wide.page);
  assert.equal(paired[0].y, paired[1].y, "two to a row");
  assert.ok(paired[1].x > paired[0].x + paired[0].w - 1);
  await shot(wide.page, "screen-water-728");
  assert.deepEqual(wide.errors, []);
  await wide.context.close();
});

test("a card with an element the kit does not know is refused and not drawn, the others stay", async () => {
  const { context, page, errors } = await open({ hash: "screen/water" });
  await page.locator("c-bars").waitFor();
  assert.equal(await page.locator("c-gauge").count(), 0, "the unknown element never reached the DOM");
  assert.equal(await page.locator('c-card[data-title="Стрелка воды"]').count(), 0, "nor its card");
  assert.match(await text(page.locator(".kit-refused")), /^Карточка «Стрелка воды» не показана/);
  assert.deepEqual(await page.locator(".kit-cell").evaluateAll((list) => list.map((c) => c.getAttribute("data-card"))), ["water_week", "water_gauge", "water_sum", "water_count"], "the order of the screen is kept");
  assert.equal(await text(card(page, "Выпито за неделю").locator(".metric-value")), "11 400", "the half cards next to it are bound: 1800 + 2100 + 1500 + 2000 + 1750 + 2250");
  assert.equal(await text(card(page, "Записей за неделю").locator(".metric-value")), "10");
  await shot(page, "screen-water-refused");
  assert.deepEqual(errors, []);
  await context.close();
});

test("a failing binding leaves its error where the element would be", async () => {
  const space = JSON.parse(await storage().then((s) => s.origins[0].localStorage[0].value));
  space.objects.cd_water_week.props.kit_body = [{ el: "bars", of: "nothere", value: "ml", range: "@last7d" }];
  const app = await openApp({ storageState: { cookies: [], origins: [{ origin: new URL(baseUrl).origin, localStorage: [{ name: KEY, value: JSON.stringify(space) }] }] } });
  await app.page.goto(`${baseUrl}#/screen/water`);
  await app.page.reload();
  await app.page.locator("c-bars").waitFor();
  assert.match(await text(app.page.locator("c-bars .viz-empty")), /нет раздела «nothere»/);
  assert.equal(await app.page.locator("c-bars").getAttribute("data-error") !== null, true, "the audit can see it");
  assert.match((await audit(app.page)).join("\n"), /ошибка отрисовки/);
  await app.context.close();
});

// -- under a meal --------------------------------------------------------------------------------------
test("a follow track asks its question under each meal of the day and records the answer for that slot", async () => {
  const { context, page, errors } = await open({ hash: `ration/${TODAY}` });
  await page.locator("article.meal").first().waitFor();
  const meals = await page.locator("article.meal").evaluateAll((list) => list.map((m) => [m.getAttribute("data-meal"), m.querySelectorAll(".kit-follow c-marks").length]));
  assert.deepEqual(meals, [["Завтрак", 1], ["Обед", 1], ["Перекус", 1], ["Ужин", 1]], "one control under each meal");

  const breakfast = page.locator('article.meal[data-meal="Завтрак"]');
  assert.equal(await text(breakfast.locator(".kit-follow .kit-mark-name")), "Сытость");
  assert.equal(await breakfast.locator(".kit-follow c-marks").evaluate((el) => [...el.childNodes].every((n) => n.nodeType === 1)), true, "no stray text node such as «null»");
  assert.equal(await text(breakfast.locator(".kit-follow .kit-label")), "Насколько сыт");
  assert.deepEqual(await breakfast.locator(".kit-follow .kit-picker button").evaluateAll((list) => list.map((b) => b.getAttribute("aria-label"))), ["1, голоден", "2", "3, норма", "4", "5, переел"]);
  assert.equal(await text(breakfast.locator(".kit-follow .kit-hint")), "1 — голоден, 5 — объелся");
  await shot(page, "day-ration-follow-light");

  await breakfast.getByRole("button", { name: "Записать" }).click();
  assert.equal(await text(breakfast.getByRole("alert")), "Заполните поле", "an empty answer is not recorded");
  await breakfast.getByRole("button", { name: "4", exact: true }).click();
  await breakfast.getByRole("button", { name: /^Записать/ }).click();
  await until(async () => (await live(page, "tr_satiety")), (list) => list.length === 1, "the answer is stored");
  const entry = (await live(page, "tr_satiety"))[0];
  assert.deepEqual([entry.props.date, entry.props.kit_slot, entry.props.kit_state, entry.props.tr_satiety__level], [TODAY, "m_breakfast_sat", "done", 4]);
  assert.equal(await text(page.locator(".toast")), "Завтрак: Сделано Отменить");

  await until(() => breakfast.getByRole("button", { name: /^Обновить/ }).count(), (n) => n === 1, "the control shows the record");
  assert.equal(await breakfast.getByRole("button", { name: "4", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator('article.meal[data-meal="Обед"]').getByRole("button", { name: /^Обновить/ }).count(), 0, "the other meals are untouched");

  await breakfast.getByRole("button", { name: "5, переел" }).click();
  await breakfast.getByRole("button", { name: /^Обновить/ }).click();
  await until(async () => (await live(page, "tr_satiety")).map((o) => o.props.tr_satiety__level), (v) => v.length === 1 && v[0] === 5, "the answer is replaced, not doubled");

  await breakfast.getByRole("button", { name: /^Снять отметку/ }).click();
  await until(async () => (await live(page, "tr_satiety")).length, (n) => n === 0, "the answer is taken back");

  await go(page, "#/");
  await page.locator('[data-widget="ration-today"]').waitFor();
  assert.equal(await page.locator('[data-widget="ration-today"] .kit-follow').count(), 0, "the compact widget on the home stays small");
  await go(page, "#/sport/" + TODAY);
  assert.equal(await page.locator(".kit-follow").count(), 0, "a track that follows the Рацион does not ask under a training");
  await go(page, "#/ration/2026-10-25");
  await page.locator("article.meal").first().waitFor();
  assert.equal(await page.locator(".kit-follow").count(), 0, "nothing to answer for a day that has not come");
  assert.deepEqual(errors, []);
  await context.close();
});

// -- embeds, the audit and the themes --------------------------------------------------------------------
test("a classic widget embedded in a card keeps the colors of the app", async () => {
  const { context, page, errors } = await open({ hash: "screen/bench" });
  const embed = card(page, "Спорт сегодня");
  await embed.locator("article.meal").waitFor();
  assert.equal(await text(embed.locator(".meal-name")), "Бег");
  await embed.getByRole("button", { name: "выполнено", exact: true }).click();
  await until(() => embed.getByRole("button", { name: "выполнено", exact: true }).getAttribute("aria-pressed"), (v) => v === "true", "the classic control works inside the card");
  const colors = await embed.locator(".seg-btn.is-on").evaluate((el) => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
  assert.deepEqual(colors, { background: "rgb(31, 93, 59)", color: "rgb(255, 255, 255)" }, "the app's --accent, not the kit's soft one");
  await shot(page, "screen-bench-light");
  assert.deepEqual(errors, []);
  await context.close();
});

for (const colorScheme of ["light", "dark"]) {
  test(`every screen passes the render audit at 390 px (${colorScheme})`, async () => {
    const { context, page, errors } = await open({ colorScheme });
    for (const hash of ["", "screen/water", "screen/vitamins", "screen/bench", "screen/shop", "screen/recipes", `ration/${TODAY}`]) {
      await go(page, `#/${hash}`);
      await page.waitForTimeout(250);
      assert.deepEqual(await audit(page), [], `${hash || "home"}: auditRendered`);
      await shot(page, `audit-${hash.replace("/", "-") || "home"}-${colorScheme}`);
    }
    // an error in a form is read from the dark theme too
    await go(page, "#/");
    await card(page, "Сон за ночь").getByLabel("Встал").fill("");
    await card(page, "Сон за ночь").getByRole("button", { name: "Записать" }).click();
    assert.deepEqual(await audit(page), [], "the error line of a form");
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test("the audit names a control without a label and a tap target that is too small", async () => {
  const { context, page } = await open();
  const found = await page.evaluate(async () => {
    const { auditRendered } = await import("/objects/viz/audit.js");
    const quick = document.querySelector("c-quick");
    const stray = document.createElement("input");
    stray.type = "text";
    stray.className = "kit-input";
    quick.append(stray);
    const unlabeled = auditRendered(document.querySelector(".kit-home"));
    stray.setAttribute("aria-label", "Количество");
    stray.style.cssText = "width: 20px; min-width: 0; min-height: 0; height: 20px; padding: 0";
    const small = auditRendered(document.querySelector(".kit-home"));
    stray.remove();
    return { unlabeled, small, clean: auditRendered(document.querySelector(".kit-home")) };
  });
  assert.ok(found.unlabeled.some((p) => p.includes("<c-quick") && p.includes("нет подписи")), found.unlabeled.join("\n"));
  assert.ok(found.small.some((p) => p.includes("маленькая цель нажатия 20x20")), found.small.join("\n"));
  assert.deepEqual(found.clean, []);
  await context.close();
});
