import assert from "node:assert/strict";
import { test } from "node:test";
import { demoLegacyState, legacyToObjects } from "../mobile-shell/objects/core/migrate.js";
import { resolveRange } from "../mobile-shell/objects/core/query.js";
import { spanHours } from "../mobile-shell/objects/core/functions.js";
import { openObjectStore } from "../mobile-shell/objects/core/store.js";
import { valueOf } from "../mobile-shell/objects/core/values.js";
import {
  BY_WORDS, ELEMENTS, ELEMENT_KEYS, FIELD_TYPES, FNS, FOLLOWS, LIMITS, RANGES, SOURCES, WHERE_KEYS, WHERE_OPS, componentsForMarkup, rangeProblem, splitCondition, wherePairs,
} from "../mobile-shell/objects/kit/catalogue.js";
import { applyBundle, checkBundle } from "../mobile-shell/objects/kit/pipeline.js";
import { exportBundle, previewImport } from "../mobile-shell/objects/kit/share.js";
import { normalizeBundle } from "../mobile-shell/objects/kit/normalize.js";
import { bundleFromMarkup } from "../mobile-shell/objects/kit/markup.js";
import { cardsOf, printSpec, readSpec } from "../mobile-shell/objects/kit/spec.js";
import { expandDefaults } from "../mobile-shell/objects/kit/defaults.js";
import { validateBundle } from "../mobile-shell/objects/kit/validate.js";

const TODAY = "2026-10-24";
const ctx = { today: TODAY };

function openSpace(state = null) {
  let n = 0;
  const store = openObjectStore({ storage: null, clock: () => new Date("2026-10-24T09:00:00Z"), today: () => TODAY, idFactory: (p) => `${p}_${++n}` });
  if (state) assert.equal(store.replaceAll(state).ok, true);
  return store;
}

const build = (store, bundle, extra = {}) => {
  const checked = checkBundle(bundle, store.state(), { ...ctx, ...extra });
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
  const applied = applyBundle(store, checked);
  assert.equal(applied.ok, true, applied.reason);
  return { checked, applied };
};

// -- the seven requests of the brief, as bundle IR -------------------------------
const WATER = {
  v: 2, name: "Вода", reply: "Собрал учёт воды: цель на день и кнопки.",
  tracks: [{ key: "water", name: "Вода", kind: "log", icon: "💧", fields: [{ key: "ml", name: "Выпито", type: "number", unit: "мл", min: 1, max: 5000, goal: 2000 }] }],
  screens: [
    { key: "home", cards: [{ key: "water_today", title: "Вода сегодня", body: [{ el: "meter", of: "water", value: "ml" }, { el: "quick", of: "water", values: { ml: 250 } }, { el: "quick", of: "water", values: { ml: 500 } }] }] },
    {
      key: "water", name: "Вода", icon: "💧",
      cards: [
        { key: "water_week", title: "Вода по дням", caption: "Последние 7 дней", body: [{ el: "bars", of: "water", value: "ml", fn: "sum", range: "@last7d" }] },
        { key: "water_calendar", title: "Календарь воды", caption: "Чем темнее, тем больше выпито", body: [{ el: "heatmap", of: "water", value: "ml", fn: "sum", range: "@last12w" }] },
        { key: "water_last", title: "Последние записи", body: [{ el: "list", of: "water", columns: ["date", "ml"], limit: 5, range: "@last30d" }] },
      ],
    },
  ],
};

const VITAMINS = {
  v: 2, name: "Витамины",
  tracks: [{ key: "vitamins", name: "Витамины", kind: "habit", icon: "💊", items: [{ name: "Витамин D", key: "vit_d", every: "day", at: "morning" }, { name: "Магний", key: "magnesium", every: "day", at: "evening" }] }],
  screens: [
    { key: "home", cards: [{ key: "vitamins_today", title: "Витамины сегодня", body: [{ el: "marks", of: "vitamins" }] }] },
    {
      key: "vitamins", name: "Витамины", icon: "💊",
      cards: [
        { key: "vitamins_streak", title: "Серия", body: [{ el: "streak", of: "vitamins" }] },
        { key: "vitamins_days", title: "Принято по дням", caption: "Последние 7 дней", body: [{ el: "bars", of: "vitamins", value: "done", range: "@last7d" }] },
        { key: "vitamins_calendar", title: "Как идёт приём", caption: "Доля принятого за день", body: [{ el: "heatmap", of: "vitamins", value: "rate", range: "@last12w" }] },
      ],
    },
  ],
};

// One row per set with a link to the catalogue of exercises (C), filtered by where.
const GYM = {
  v: 2, name: "Силовая",
  tracks: [
    { key: "exercises", name: "Упражнения", kind: "catalog", icon: "📋", items: [{ key: "bench", name: "Жим лёжа" }, { key: "squat", name: "Присед" }] },
    {
      key: "sets", name: "Подходы", kind: "log", icon: "🏋",
      fields: [
        { key: "exercise", name: "Упражнение", type: "link", to: "exercises", required: true },
        { key: "reps", name: "Повторы", type: "number", min: 1, max: 100, required: true },
        { key: "weight", name: "Вес", type: "number", unit: "кг", min: 0, max: 500, required: true },
        { key: "volume", name: "Тоннаж", type: "calc", calc: "reps * weight", unit: "кг" },
      ],
    },
  ],
  screens: [
    { key: "home", cards: [{ key: "sets_add", title: "Записать подход", body: [{ el: "form", of: "sets", fields: ["exercise", "reps", "weight"] }] }] },
    {
      key: "strength", name: "Силовая", icon: "🏋",
      cards: [
        { key: "bench_progress", title: "Рабочий вес в жиме", caption: "Максимум за неделю", body: [{ el: "line", of: "sets", value: "weight", fn: "max", by: "week", range: "@last12w", where: { exercise: "bench" }, area: true }] },
        { key: "bench_best", title: "Лучший вес за 30 дней", size: "half", body: [{ el: "stat", of: "sets", value: "weight", fn: "max", range: "@last30d", compare: true, good: "up", where: { exercise: "bench" } }] },
        { key: "sets_volume", title: "Тоннаж", size: "half", body: [{ el: "spark", of: "sets", value: "volume", fn: "sum", range: "@last30d" }] },
        { key: "sets_last", title: "Последние подходы", body: [{ el: "table", of: "sets", columns: ["date", "exercise", "reps", "weight"], limit: 6, range: "@last30d" }] },
      ],
    },
  ],
};

const SATIETY = {
  v: 2, name: "Сытость",
  tracks: [{ key: "satiety", name: "Сытость", kind: "follow", follows: "ration", icon: "😌", fields: [{ key: "level", name: "Насколько сыт", type: "scale", min: 1, max: 5, hint: "1 — голоден, 5 — объелся" }] }],
  screens: [
    { key: "home", cards: [{ key: "satiety_today", title: "Сытость после еды", body: [{ el: "marks", of: "satiety" }] }] },
    {
      key: "satiety", name: "Сытость", icon: "😌",
      cards: [
        { key: "satiety_line", title: "Сытость по дням", caption: "Среднее за день", body: [{ el: "line", of: "satiety", value: "level", fn: "avg", range: "@last30d" }] },
        { key: "satiety_last", title: "Последние отметки", body: [{ el: "table", of: "satiety", columns: ["date", "slot", "level"], limit: 8, range: "@last30d" }] },
      ],
    },
  ],
};

const SHOPPING = {
  v: 2, name: "Покупки на неделю",
  tracks: [{ key: "shop_week", name: "Покупки на неделю", kind: "list", icon: "🛒", fields: [{ key: "price", name: "Сумма", type: "number", unit: "₽", min: 0, max: 1000000 }] }],
  screens: [
    { key: "home", cards: [{ key: "shop_week_open", title: "Осталось купить", body: [{ el: "stat", of: "shop_week", value: "open", range: "@today" }] }] },
    {
      key: "shop_week", name: "Покупки на неделю", icon: "🛒",
      cards: [
        { key: "shop_week_items", title: "Список", body: [{ el: "marks", of: "shop_week", add: true }] },
        { key: "shop_week_spent", title: "Потрачено за неделю", size: "half", body: [{ el: "stat", of: "shop_week", value: "price", fn: "sum", range: "@thisWeek" }] },
        { key: "shop_week_days", title: "Траты по дням", size: "half", body: [{ el: "bars", of: "shop_week", value: "price", fn: "sum", range: "@last7d" }] },
      ],
    },
  ],
};

const SLEEP = {
  v: 2, name: "Сон",
  tracks: [{
    key: "sleep", name: "Сон", kind: "log", icon: "😴",
    fields: [
      { key: "lay", name: "Лёг", type: "time", required: true },
      { key: "woke", name: "Встал", type: "time", required: true },
      { key: "hours", name: "Спал", type: "calc", calc: "spanHours(lay, woke)", unit: "ч" },
    ],
  }],
  screens: [
    { key: "home", cards: [{ key: "sleep_add", title: "Сон за ночь", body: [{ el: "form", of: "sleep", fields: ["lay", "woke"] }] }] },
    {
      key: "sleep", name: "Сон", icon: "😴",
      cards: [
        { key: "sleep_month", title: "Сон за месяц", caption: "Часов за ночь", body: [{ el: "line", of: "sleep", value: "hours", fn: "avg", range: "@last30d", area: true }] },
        { key: "sleep_avg", title: "В среднем за неделю", size: "half", body: [{ el: "stat", of: "sleep", value: "hours", fn: "avg", range: "@last7d", compare: true, good: "up" }] },
        { key: "sleep_calendar", title: "Календарь сна", size: "half", body: [{ el: "heatmap", of: "sleep", value: "hours", fn: "avg", range: "@last12w" }] },
        { key: "sleep_last", title: "Последние ночи", body: [{ el: "table", of: "sleep", columns: ["date", "lay", "woke", "hours"], limit: 7, range: "@last30d" }] },
      ],
    },
  ],
};

const SWEETS = {
  v: 2, name: "Без сладкого",
  tracks: [{ key: "sweets", name: "Без сладкого", kind: "habit", avoid: true, icon: "🍬", items: [{ name: "Не ем сладкое", key: "no_sweets", every: "day" }] }],
  screens: [
    { key: "home", cards: [{ key: "sweets_today", title: "Без сладкого", body: [{ el: "marks", of: "sweets" }, { el: "streak", of: "sweets" }] }] },
    {
      key: "sweets", name: "Без сладкого", icon: "🍬",
      cards: [
        { key: "sweets_calendar", title: "Дни без сладкого", caption: "Темнее, когда всё получилось", body: [{ el: "heatmap", of: "sweets", value: "rate", range: "@last12w" }] },
        { key: "sweets_slips", title: "Срывы по неделям", body: [{ el: "bars", of: "sweets", value: "skipped", range: "@last12w", by: "week" }] },
      ],
    },
  ],
};

const WEIGHT = {
  v: 2, name: "Вес",
  tracks: [{ key: "weight", name: "Вес", kind: "log", icon: "⚖", fields: [{ key: "kg", name: "Вес", type: "number", unit: "кг", min: 20, max: 400 }] }],
  screens: [{
    key: "weight", name: "Вес", icon: "⚖",
    cards: [
      { key: "weight_chart", title: "Вес по дням", body: [{ el: "line", of: "weight", value: "kg", fn: "avg", range: "@last30d" }] },
      { key: "weight_last", title: "Последние взвешивания", body: [{ el: "table", of: "weight", columns: ["date", "kg"], limit: 5, range: "@last30d" }] },
    ],
  }],
};

const REQUESTS = { water: WATER, vitamins: VITAMINS, gym: GYM, satiety: SATIETY, shopping: SHOPPING, sleep: SLEEP, sweets: SWEETS };

// The space of the patch examples: a water track whose card sits only on its own
// screen, and a weight track with two cards.
const WATER_SCREEN_ONLY = { ...WATER, screens: WATER.screens.filter((s) => s.key !== "home") };

test("each of the seven requests passes the pipeline on an empty space, applies as one change and applies again as nothing", () => {
  for (const [name, bundle] of Object.entries(REQUESTS)) {
    const store = openSpace();
    const before = store.state();
    const checked = checkBundle(bundle, before, ctx);
    assert.equal(checked.ok, true, `${name}: ${JSON.stringify(checked.problems)}`);
    assert.equal(checked.layer, null);
    assert.ok(checked.ops.length >= 4, `${name}: structure was lowered`);
    assert.equal(store.state(), before, `${name}: checking writes nothing`);
    const applied = applyBundle(store, checked);
    assert.equal(applied.ok, true, `${name}: ${applied.reason}`);
    assert.ok(applied.changeSetId, `${name}: one change set`);
    const again = checkBundle(bundle, store.state(), ctx);
    assert.equal(again.ok, true, `${name}: ${JSON.stringify(again.problems)}`);
    assert.deepEqual(again.ops, [], `${name}: the same bundle twice is no ops`);
    assert.equal(again.noop, true);
    assert.equal(store.revert(applied.changeSetId).ok, true, `${name}: one revert undoes the bundle`);
    assert.equal(store.state().types[`tr_${bundle.tracks.at(-1).key}`], undefined, `${name}: the track type is gone after the revert`);
  }
});

test("the water bundle becomes the stored track, goal and cards the design promises", () => {
  const store = openSpace();
  const { checked } = build(store, WATER);
  const s = store.state();
  assert.deepEqual(s.types.tr_water.kit, { track: "water", kind: "log", app: "voda", since: TODAY });
  assert.equal(s.types.tr_water.fact, true);
  assert.deepEqual(s.types.tr_water.relations, ["date", "tr_water__ml"]);
  assert.equal(s.relations.tr_water__ml.kit.goal, 2000);
  assert.equal(s.relations.tr_water__ml.kit.goalType, "min", "defaults are written out");
  assert.equal(s.relations.tr_water__ml.dimension, "volume");
  assert.equal(s.objects.cd_water_today.props.kit_screen, "sc_home");
  assert.deepEqual(s.objects.cd_water_today.props.kit_body.map((e) => e.el), ["meter", "quick", "quick"]);
  assert.deepEqual(checked.rows[0], ["Трек", "Вода", "поле «Выпито, мл», цель 2000 в день"]);
  assert.equal(checked.reply, "Собрал учёт воды: цель на день и кнопки.");
  assert.equal(JSON.stringify(s).includes("Собрал учёт"), false, "the reply is not stored");
  assert.equal(Object.values(s.objects).filter((o) => o.type === "tr_water").length, 0, "no entry was created");
});

test("a habit stores its items with deterministic ids and the day they start", () => {
  const store = openSpace();
  build(store, VITAMINS);
  const s = store.state();
  assert.deepEqual(s.objects.ti_vitamins_vit_d.props, { kit_track: "vitamins", kit_key: "vit_d", kit_every: "day", kit_at: "morning", kit_from: TODAY });
  assert.equal(s.objects.ti_vitamins_magnesium.name, "Магний");
  assert.deepEqual(s.types.tr_vitamins.relations, ["date", "kit_item", "kit_state"]);
  assert.deepEqual(s.types.tr_vitamins.kit.states, ["done", "skipped"]);
  assert.equal(s.types.tr_vitamins.kit.unmarked, "ignore");
  const later = checkBundle(VITAMINS, s, { today: "2026-10-30" });
  assert.deepEqual(later.ops, [], "a later day does not move the start of an item already made");
  const avoid = openSpace();
  build(avoid, SWEETS);
  assert.equal(avoid.state().types.tr_sweets.kit.unmarked, "assumed");
  assert.deepEqual(avoid.state().types.tr_sweets.kit.labels, { done: "держусь", skipped: "сорвался" });
});

test("the gym: a link to a catalogue, where on the charts and a calc that really computes", () => {
  const store = openSpace();
  build(store, GYM);
  const s = store.state();
  assert.equal(s.types.tr_exercises.fact, false);
  assert.equal(s.objects.ti_exercises_bench.name, "Жим лёжа");
  assert.equal(s.relations.tr_sets__exercise.format, "object");
  assert.deepEqual(s.relations.tr_sets__exercise.types, ["track_item"]);
  assert.equal(s.relations.tr_sets__volume.formula, "(tr_sets__reps * tr_sets__weight)", "local names become relation keys");
  const row = store.create("tr_sets", { props: { date: TODAY, tr_sets__exercise: "ti_exercises_bench", tr_sets__reps: 5, tr_sets__weight: 80 } });
  assert.equal(row.ok, true, row.reason);
  assert.equal(valueOf(store.state(), row.ids[0], "tr_sets__volume", ctx), 400);
  const bad = checkBundle({ v: 2, name: "x", screens: [{ key: "home", cards: [{ key: "x1", title: "Жим", body: [{ el: "stat", of: "sets", value: "weight", fn: "max", range: "@last30d", where: { exercise: "deadlift" } }] }] }] }, store.state(), ctx);
  assert.equal(bad.ok, false);
  assert.equal(bad.problems[0].rule, "bad-value");
  assert.match(bad.problems[0].message, /Ключи строк: bench, squat/);
});

test("sleep: spanHours is the formula and a night past midnight counts", () => {
  const store = openSpace();
  build(store, SLEEP);
  const entry = store.create("tr_sleep", { props: { date: TODAY, tr_sleep__lay: "23:30", tr_sleep__woke: "07:15" } });
  assert.equal(valueOf(store.state(), entry.ids[0], "tr_sleep__hours", ctx), 7.75);
  assert.equal(spanHours("23:30", "07:15"), 7.75);
  assert.equal(spanHours("22:00", "06:00"), 8);
  assert.equal(spanHours("08:00", "08:00"), 0);
  assert.equal(spanHours("8:00", "09:00"), null, "not a HH:MM time");
});

test("satiety is a follow track on the demo space and leaves the classic data alone", () => {
  const demo = legacyToObjects(demoLegacyState(TODAY), { today: TODAY });
  const store = openSpace(demo);
  const classicBefore = Object.fromEntries(Object.entries(store.state().objects).filter(([, o]) => !String(o.type).startsWith("kit_")));
  const { checked } = build(store, SATIETY);
  const s = store.state();
  assert.deepEqual(s.types.tr_satiety.relations, ["date", "tr_satiety__level", "kit_slot", "kit_state"]);
  assert.equal(s.types.tr_satiety.kit.follows, "ration");
  assert.equal(s.relations.tr_satiety__level.min, 1);
  assert.equal(s.relations.tr_satiety__level.max, 5);
  assert.ok(checked.rows.some((r) => r[0] === "Новая карточка" && r[1] === "Сытость после еды"));
  const classicAfter = Object.fromEntries(Object.entries(s.objects).filter(([id, o]) => classicBefore[id] && o.type === classicBefore[id].type));
  assert.deepEqual(classicAfter, classicBefore, "no classic object changed");
  assert.equal(Object.keys(s.objects).filter((id) => !classicBefore[id]).every((id) => /^(sc|cd)_/.test(id)), true, "only a screen and cards were added to the objects");
  const entry = store.create("tr_satiety", { props: { date: TODAY, kit_slot: "breakfast", kit_state: "done", tr_satiety__level: 4 } });
  assert.equal(entry.ok, true, entry.reason);
  assert.match(store.create("tr_satiety", { props: { date: TODAY, kit_slot: "breakfast", kit_state: "done", tr_satiety__level: 2 } }).reason, /уже есть отметка/, "one mark per slot and day");
  assert.match(store.create("tr_satiety", { props: { date: "2026-10-30", kit_slot: "lunch", kit_state: "done" } }).reason, /будущий день/);
});

// -- the patches ------------------------------------------------------------------
function patchSpace() {
  const store = openSpace();
  build(store, WATER_SCREEN_ONLY);
  build(store, WEIGHT);
  assert.equal(store.create("tr_weight", { props: { date: TODAY, tr_weight__kg: 80.5 } }).ok, true);
  assert.equal(store.create("tr_water", { props: { date: TODAY, tr_water__ml: 250 } }).ok, true);
  return store;
}
const entriesOf = (store, type) => Object.values(store.state().objects).filter((o) => o.type === type);

test("patch: «убери график веса» archives one card and keeps the weight entries", () => {
  const store = patchSpace();
  const checked = checkBundle({ v: 2, name: "Убрать график веса", remove: [{ card: "weight_chart" }] }, store.state(), ctx);
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
  assert.deepEqual(checked.ops, [{ op: "archive", id: "cd_weight_chart" }]);
  assert.deepEqual(checked.rows, [["Уберётся карточка", "Вес по дням", "экран «Вес»"]]);
  assert.equal(applyBundle(store, checked).ok, true);
  const spec = readSpec(store.state());
  assert.equal(spec.cards.weight_chart.archived, true);
  assert.equal(spec.cards.weight_last.archived, undefined);
  assert.equal(entriesOf(store, "tr_weight").length, 1, "entries survive");
});

test("patch: «добавь на главную воду» puts one card on the home screen", () => {
  const store = patchSpace();
  const bundle = { v: 2, name: "Вода на главную", screens: [{ key: "home", cards: [{ key: "water_today", title: "Вода сегодня", body: [{ el: "meter", of: "water", value: "ml" }, { el: "quick", of: "water", values: { ml: 250 } }] }] }] };
  const checked = checkBundle(bundle, store.state(), ctx);
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
  assert.deepEqual(checked.ops.map((o) => `${o.op}:${o.id}`), ["create:sc_home", "create:cd_water_today"]);
  assert.equal(applyBundle(store, checked).ok, true);
  const spec = readSpec(store.state());
  assert.equal(spec.cards.water_today.screen, "home");
  assert.equal(spec.cards.water_today.app, "voda", "the card belongs to the app of the track it shows");
  assert.equal(spec.cards.water_week.screen, "water", "the other cards stay where they were");
  assert.equal(entriesOf(store, "tr_water").length, 1);
});

test("patch: «цель воды 2,5 литра» changes one attribute and nothing else", () => {
  const store = patchSpace();
  const before = store.state();
  const checked = checkBundle({ v: 2, name: "Цель воды 2500", tracks: [{ key: "water", fields: [{ key: "ml", goal: "2 500" }] }] }, before, ctx);
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
  assert.ok(checked.changes.some((c) => /записано числом 2500/.test(c)));
  assert.deepEqual(checked.ops.map((o) => `${o.op}:${o.relation.key}`), ["defineRelation:tr_water__ml"]);
  assert.deepEqual(checked.rows, [["Изменится поле", "Вода: Выпито, мл", "цель 2000 → 2500 в день"]]);
  assert.equal(applyBundle(store, checked).ok, true);
  const s = store.state();
  assert.equal(s.relations.tr_water__ml.kit.goal, 2500);
  assert.equal(s.relations.tr_water__ml.max, 5000, "the other attributes are kept");
  assert.equal(s.types.tr_water, before.types.tr_water, "the type was not rewritten");
  assert.equal(entriesOf(store, "tr_water")[0].props.tr_water__ml, 250);
  const lowered = checkBundle({ v: 2, name: "Снять цель", tracks: [{ key: "water", fields: [{ key: "ml", goal: 0 }] }] }, s, ctx);
  assert.equal(applyBundle(store, lowered).ok, true);
  assert.equal(store.state().relations.tr_water__ml.kit.goal, undefined, "goal 0 clears the goal");
});

// -- removal and cascades ---------------------------------------------------------
test("removing a track archives it, takes its cards along and keeps every entry; redeclaring restores it", () => {
  const store = patchSpace();
  build(store, {
    v: 2, name: "Сводка",
    screens: [{ key: "home", cards: [{ key: "mix", title: "Сводка", body: [{ el: "meter", of: "water", value: "ml" }, { el: "stat", of: "weight", value: "kg", fn: "avg", range: "@last7d" }] }] }],
  });
  const checked = checkBundle({ v: 2, name: "Убрать вес", remove: [{ track: "weight" }] }, store.state(), ctx);
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
  assert.deepEqual(checked.cascades.map((c) => [c.kind, c.key]), [["card", "weight_chart"], ["card", "weight_last"], ["card-part", "mix"]]);
  assert.ok(checked.rows.some((r) => r[0] === "Уберётся трек" && r[1] === "Вес" && /записи \(1\) останутся/.test(r[2])));
  assert.ok(checked.rows.some((r) => r[0] === "Изменится карточка" && r[1] === "Сводка"));
  assert.equal(applyBundle(store, checked).ok, true);
  const s = store.state();
  assert.equal(s.types.tr_weight.hidden, true);
  assert.equal(s.types.tr_weight.kit.archived, true);
  assert.equal(entriesOf(store, "tr_weight").length, 1, "entries are kept");
  assert.deepEqual(s.objects.cd_mix.props.kit_body.map((e) => e.el), ["meter"], "only the weight part of the mixed card went");
  const spec = readSpec(s);
  assert.equal(spec.tracks.weight.archived, true);
  assert.equal(checkBundle({ v: 2, name: "x", screens: [{ key: "home", cards: [{ key: "w1", title: "Вес", body: [{ el: "stat", of: "weight", value: "kg", fn: "avg", range: "@last7d" }] }] }] }, s, ctx).problems[0].rule, "unknown-key", "an archived track cannot be shown");
  const restored = checkBundle({ v: 2, name: "Вернуть вес", tracks: [{ key: "weight", name: "Вес", kind: "log" }] }, s, ctx);
  assert.equal(restored.ok, true, JSON.stringify(restored.problems));
  assert.equal(applyBundle(store, restored).ok, true);
  assert.equal(store.state().types.tr_weight.hidden, undefined);
  assert.equal(store.state().types.tr_weight.kit.archived, undefined);
  assert.equal(entriesOf(store, "tr_weight").length, 1);
});

test("removing a field drops what binds it and removing an item archives only that item", () => {
  const store = openSpace();
  build(store, VITAMINS);
  const item = checkBundle({ v: 2, name: "Убрать магний", remove: [{ item: "vitamins.magnesium" }] }, store.state(), ctx);
  assert.deepEqual(item.ops, [{ op: "archive", id: "ti_vitamins_magnesium" }]);
  assert.equal(applyBundle(store, item).ok, true);
  assert.equal(store.state().objects.ti_vitamins_magnesium.archivedAt != null, true);
  assert.equal(store.state().objects.ti_vitamins_vit_d.archivedAt, undefined);

  const gym = openSpace();
  build(gym, GYM);
  const field = checkBundle({ v: 2, name: "Без тоннажа", remove: [{ field: "sets.volume" }] }, gym.state(), ctx);
  assert.equal(field.ok, true, JSON.stringify(field.problems));
  assert.deepEqual(field.cascades.map((c) => [c.kind, c.key]), [["card", "sets_volume"]]);
  assert.deepEqual(field.ops.find((o) => o.op === "defineType").type.relations, ["date", "tr_sets__exercise", "tr_sets__reps", "tr_sets__weight"]);
  const cut = checkBundle({ v: 2, name: "Без повторов", remove: [{ field: "sets.reps" }] }, gym.state(), ctx);
  assert.equal(cut.problems[0].rule, "field-in-use", "the calc that reads it must go first");
});

// -- refusals ---------------------------------------------------------------------
function space() {
  const store = openSpace();
  build(store, WATER);
  build(store, SLEEP);
  return store;
}
const home = (body, extra = {}) => ({ v: 2, name: "Тест", screens: [{ key: "home", cards: [{ key: "t1", title: "Тест", body, ...extra }] }] });
const track = (fields, extra = {}) => ({ v: 2, name: "Тест", tracks: [{ key: "mood", name: "Настроение", kind: "log", fields, ...extra }] });
const num = (key, extra = {}) => ({ key, name: "Число", type: "number", ...extra });

const INVALID = [
  ["text that is not JSON", "Вот ваш трекер: вода и всё", "L0", "not-json", "", /нет JSON-объекта/],
  ["an unknown attribute of a field", track([num("ml", { colour: "red" })]), "L1", "unknown-key", "tracks.mood.fields.ml.colour", /Допустимо: key, name, type/],
  ["a kind that does not exist", track([num("ml")], { kind: "planner" }), "L1", "bad-value", "tracks.mood.kind", /Допустимо: log, habit, list, catalog, follow/],
  ["a typo that reads as a new track", { v: 2, name: "Тест", tracks: [{ key: "watr", fields: [{ key: "ml", goal: 3000 }] }] }, "L1", "missing-attr", "tracks.watr.name", /Трека «watr» нет.*water, sleep/],
  ["a follow track without follows", { v: 2, name: "Тест", tracks: [{ key: "feel", name: "Самочувствие", kind: "follow" }] }, "L1", "missing-attr", "tracks.feel.follows", /follows: ration, sport, shopping/],
  ["a chart of a track that does not exist", home([{ el: "stat", of: "watr", value: "ml", range: "@today" }]), "L1", "unknown-key", "screens.home.cards.t1.body[0].of", /Ключи треков.*water/],
  ["an average of a time field", home([{ el: "stat", of: "sleep", value: "lay", fn: "avg", range: "@last7d" }]), "L1", "fn-not-numeric", "screens.home.cards.t1.body[0].fn", /числовое поле \(hours\)/],
  ["a calc that reads a field the track does not have", track([num("a"), { key: "total", name: "Итого", type: "calc", calc: "a + b" }]), "L1", "bad-calc", "tracks.mood.fields.total.calc", /Поля трека: a/],
  ["a quick value above the field's max", home([{ el: "quick", of: "water", values: { ml: 9000 } }]), "L1", "bad-value", "screens.home.cards.t1.body[0].values.ml", /не больше 5000/],
  ["a reserved word as a field key", track([num("done")]), "L1", "reserved-key", "tracks.mood.fields.done.key", /зарезервирован/],
  ["a streak over a log without a goal", home([{ el: "streak", of: "sleep" }]), "L1", "kind-element", "screens.home.cards.t1.body[0].of", /goal в объявление поля/],
  ["a meter over a field without a goal", home([{ el: "meter", of: "sleep", value: "hours" }]), "L1", "no-goal", "screens.home.cards.t1.body[0].value", /Добавьте goal/],
  ["a removal of a card that is not there", { v: 2, name: "Тест", remove: [{ card: "water_graph" }] }, "L1", "unknown-key", "remove[0].card", /water_today, water_week.*Скопируйте ключ/],
  ["a bundle that carries entries", { ...WATER, entries: [{ track: "water", ml: 250 }] }, "L1", "unknown-key", ".entries", /их вносит человек/],
  ["more tracks than the limit", { v: 2, name: "Тест", tracks: ["a1", "b1", "c1", "d1", "e1"].map((key) => ({ key, name: key, kind: "log" })) }, "L1", "limit", "tracks", new RegExp(`больше ${LIMITS.tracks}`)],
  ["a doze calculated", track([num("mg", { unit: "мг" }), { key: "dose", name: "Доза", type: "calc", calc: "mg * 2", unit: "мг" }]), "L1", "dose-calc", "tracks.mood.fields.dose.calc", /подбирает доз/],
  ["a number about the person in a title", home([{ el: "stat", of: "water", value: "ml", range: "@last7d" }], { title: "Вы пьёте 1800 мл" }), "L1", "number-in-text", "screens.home.cards.t1.title", /число 1800/],
];

for (const [name, bundle, layer, rule, path, message] of INVALID) {
  test(`refused at ${layer}: ${name}`, () => {
    const result = checkBundle(bundle, space().state(), ctx);
    assert.equal(result.ok, false);
    assert.equal(result.layer, layer);
    assert.deepEqual(result.ops, [], "no ops for a refused bundle");
    assert.ok(result.problems.length >= 1 && result.problems.length <= 6);
    const hit = result.problems.find((p) => p.rule === rule);
    assert.ok(hit, `${rule} among ${JSON.stringify(result.problems.map((p) => p.rule))}`);
    assert.equal(hit.path, path);
    assert.match(hit.message, message);
  });
}

test("a field type cannot change once the field has entries", () => {
  const store = space();
  assert.equal(store.create("tr_water", { props: { date: TODAY, tr_water__ml: 250 } }).ok, true);
  const result = checkBundle({ v: 2, name: "Тип", tracks: [{ key: "water", fields: [{ key: "ml", type: "text" }] }] }, store.state(), ctx);
  assert.equal(result.layer, "L1");
  assert.equal(result.problems.find((p) => p.rule === "type-change-used").path, "tracks.water.fields.ml.type");
  assert.match(result.problems.find((p) => p.rule === "type-change-used").message, /уже есть записи \(1\)/);
});

test("the energy floor: an 800 kcal goal is refused by the validator and by the store", () => {
  const goal = (value, extra = {}) => ({ v: 2, name: "Еда", tracks: [{ key: "food", name: "Еда", kind: "log", fields: [{ key: "kcal", name: "Съедено", type: "number", unit: "ккал", goal: value, ...extra }] }] });
  const refused = checkBundle(goal(800), openSpace().state(), ctx);
  assert.equal(refused.layer, "L1");
  assert.equal(refused.problems[0].rule, "energy-goal-floor");
  assert.equal(refused.problems[0].path, "tracks.food.fields.kcal.goal");
  assert.match(refused.problems[0].message, /Цель 800 ккал.*ниже 1200 ккал в день.*Поставьте не меньше 1200/);
  assert.equal(checkBundle(goal(1200), openSpace().state(), ctx).ok, true, "1200 is the floor, not below it");
  assert.equal(checkBundle(goal(8000, { goalPer: "week" }), openSpace().state(), ctx).problems[0].rule, "energy-goal-floor", "8000 a week is under 1200 a day");
  assert.equal(checkBundle({ v: 2, name: "Спорт", tracks: [{ key: "burn", name: "Сожжено", kind: "log", fields: [{ key: "burned", name: "Сожжено", type: "number", unit: "ккал", goal: 400 }] }] }, openSpace().state(), ctx).ok, true, "a burned-energy goal is not intake");
  // the same floor stands in the store for whoever bypasses the validator
  const store = openSpace();
  const direct = store.apply({ op: "defineRelation", relation: { key: "tr_food__kcal", name: "Съедено", format: "number", unit: "ккал", kit: { track: "food", field: "kcal", type: "number", goal: 800, goalPer: "day" } } });
  assert.equal(direct.ok, false);
  assert.match(direct.reason, /ниже 1200 ккал в день/);
});

test("L2 refuses what only the store can see: a key that belongs to someone else", () => {
  const store = openSpace();
  assert.equal(store.apply({ op: "defineRelation", relation: { key: "tr_water__ml", name: "Моя связь", format: "number" } }).ok, true);
  const result = checkBundle(WATER, store.state(), ctx);
  assert.equal(result.ok, false);
  assert.equal(result.layer, "L2");
  assert.equal(result.problems[0].rule, "store");
  assert.match(result.problems[0].message, /ключ «tr_water__ml» уже занят связью «Моя связь»/);
  assert.equal(store.state().types.tr_water, undefined, "nothing was written");
});

test("the store refuses to redefine a key of another track and allows the track's own", () => {
  const store = openSpace();
  build(store, WATER);
  const own = store.apply({ op: "defineType", type: { ...store.state().types.tr_water, name: "Вода 2", system: undefined } });
  assert.equal(own.ok, true, own.reason);
  const stolen = store.apply({ op: "defineType", type: { key: "tr_water", name: "Чужой", relations: ["date"] } });
  assert.match(stolen.reason, /уже занят типом «Вода 2»/);
  assert.equal(store.apply({ op: "defineType", type: { key: "mood", name: "Настроение", relations: ["date"] } }).ok, true);
  assert.match(store.apply({ op: "defineType", type: { key: "mood", name: "Другое", relations: ["date"] } }).reason, /уже занят типом/);
});

test("a dry run never writes a fact and the model cannot carry one", () => {
  const store = openSpace();
  const state = store.state();
  const checked = checkBundle(GYM, state, ctx);
  assert.equal(checked.ok, true);
  const factTypes = new Set(Object.values(checked.spec.tracks).filter((t) => !t.readonly).map((t) => `tr_${t.key}`));
  assert.equal(checked.ops.filter((o) => o.op === "create" && factTypes.has(o.type)).length, 0, "no op creates an entry");
  assert.equal(checked.ops.some((o) => o.op === "create" && o.props?.date), false);
  assert.equal(store.state(), state, "the real space is untouched");
  const viaAi = store.apply({ op: "create", type: "tr_water", props: { date: TODAY } }, { actor: "ai" });
  assert.equal(viaAi.ok, false);
  build(store, WATER);
  const fact = store.apply({ op: "create", type: "tr_water", props: { date: TODAY, tr_water__ml: 250 } }, { actor: "ai" });
  assert.match(fact.reason, /записывает только человек/);
});

// -- normalize, spec, share ---------------------------------------------------------
test("normalize takes a fenced block and fixes only what has one reading", () => {
  const messy = "Вот пакет:\n```json\n" + JSON.stringify({
    name: " Вода ", tracks: [{ key: "Water-Intake", name: "Вода", kind: "Журнал", fields: [{ key: "ml", name: "Выпито", type: "integer", unit: "ml", goal: "2 000", required: "да" }], items: [] }],
    screens: [{ key: "home", cards: [{ title: "Вода сегодня", body: [{ el: "c-quick", of: "Water-Intake", values: "ml=250" }, { el: "line", of: "water_intake", value: "ml", range: "7 дней", area: "да" }] }] }],
  }) + "\n```";
  const { bundle, changes } = normalizeBundle(messy);
  assert.equal(bundle.v, 2);
  assert.equal(bundle.name, "Вода");
  assert.equal(bundle.tracks[0].key, "water_intake");
  assert.equal(bundle.tracks[0].kind, "log");
  assert.deepEqual(bundle.tracks[0].fields[0], { key: "ml", name: "Выпито", type: "number", unit: "мл", goal: 2000, required: true });
  assert.deepEqual(bundle.screens[0].cards[0].body[0], { el: "quick", of: "water_intake", values: { ml: 250 } });
  assert.equal(bundle.screens[0].cards[0].key, "voda_segodnya");
  assert.equal(bundle.screens[0].cards[0].body[1].range, "@last7d");
  assert.equal(bundle.screens[0].cards[0].body[1].area, true);
  assert.ok(changes.length >= 8 && changes.every((c) => /[а-яё]/i.test(c)), "every fix is a Russian sentence");
  assert.equal(normalizeBundle("{\"v\":2,\"name\":\"x\",}").bundle.name, "x", "a trailing comma is tolerated");
  assert.equal(normalizeBundle("no braces here").bundle, null);
  assert.equal(normalizeBundle("{\"v\":2,\"name\":\"x\"", {}).bundle, null);
});

test("a goal on a meter is hoisted onto the field that has none and reported", () => {
  const store = openSpace();
  const bare = { ...WATER_SCREEN_ONLY, tracks: [{ key: "water", name: "Вода", kind: "log", fields: [{ key: "ml", name: "Выпито", type: "number", unit: "мл" }] }] };
  build(store, bare);
  const bundle = { v: 2, name: "Цель", screens: [{ key: "home", cards: [{ key: "water_today", title: "Вода сегодня", body: [{ el: "meter", of: "water", value: "ml", goal: 2000 }] }] }] };
  const checked = checkBundle(bundle, store.state(), ctx);
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
  assert.ok(checked.changes.some((c) => /Цель 2000 перенесена с элемента на поле «ml»/.test(c)));
  assert.equal(applyBundle(store, checked).ok, true);
  assert.equal(store.state().relations.tr_water__ml.kit.goal, 2000);
  assert.equal(Object.keys(store.state().objects.cd_water_today.props.kit_body[0]).includes("goal"), false);
  const clash = checkBundle({ ...bundle, screens: [{ key: "home", cards: [{ key: "water_today", title: "Вода сегодня", body: [{ el: "meter", of: "water", value: "ml", goal: 3000 }] }] }] }, store.state(), ctx);
  assert.equal(clash.problems[0].rule, "unknown-attr");
  assert.match(clash.problems[0].message, /Цель задаётся один раз в поле/);
});

test("expandDefaults gives a bare track the cards of its kind and the manual can print them", () => {
  const spec = readSpec(openSpace().state());
  const bare = (kind, extra = {}) => expandDefaults(spec, { v: 2, name: "Б", tracks: [{ key: "t1", name: "Трек", kind, ...extra }] }, ctx);
  const cards = (bundle) => bundle.screens.flatMap((s) => s.cards.map((c) => `${s.key}:${c.body.map((e) => e.el).join("+")}`));
  assert.deepEqual(cards(bare("log", { fields: [{ key: "ml", name: "Мл", type: "number", unit: "мл", goal: 2000 }] })), ["home:meter+form", "t1:bars", "t1:list"]);
  assert.deepEqual(cards(bare("habit", { items: [{ name: "Зарядка" }] })), ["home:marks", "t1:streak", "t1:bars"]);
  assert.deepEqual(cards(bare("list", { fields: [{ key: "price", name: "Сумма", type: "number", unit: "₽" }] })), ["home:stat", "t1:marks", "t1:stat"]);
  assert.deepEqual(cards(bare("catalog", { fields: [{ key: "note", name: "Заметка", type: "text" }] })), ["t1:list"]);
  assert.deepEqual(cards(bare("follow", { follows: "sport", fields: [{ key: "lvl", name: "Уровень", type: "scale" }] })), ["home:marks", "t1:line", "t1:table"]);
  const habit = bare("habit", { avoid: true, items: [{ name: "Не курить" }] }).tracks[0];
  assert.deepEqual([habit.unmarked, habit.labels, habit.states, habit.grace, habit.items[0].every, habit.items[0].from], ["assumed", { done: "держусь", skipped: "сорвался" }, ["done", "skipped"], 0, "day", TODAY]);
  for (const kind of ["log", "habit", "list", "catalog", "follow"]) {
    const store = openSpace();
    const checked = checkBundle({ v: 2, name: "Б", tracks: [{ key: "t1", name: "Трек", kind, ...(kind === "follow" ? { follows: "ration" } : {}), fields: [{ key: "n", name: "Число", type: "number", unit: "шт.", goal: 3 }] }] }, store.state(), ctx);
    assert.equal(checked.ok, true, `${kind}: ${JSON.stringify(checked.problems)}`);
    assert.ok(checked.ops.some((o) => o.op === "create" && o.type === "kit_card"), `${kind} got default cards`);
  }
});

test("printSpec: the summary tells the model keys, the full print recreates the structure", () => {
  const store = openSpace();
  build(store, WATER);
  build(store, VITAMINS);
  const summary = printSpec(readSpec(store.state()), { summary: true });
  assert.deepEqual(summary.tracks.map((t) => [t.key, t.kind]), [["water", "log"], ["vitamins", "habit"]]);
  assert.deepEqual(summary.tracks[0].fields, [{ key: "ml", name: "Выпито", type: "number", unit: "мл", goal: 2000, goalType: "min", goalPer: "day" }]);
  assert.deepEqual(summary.tracks[1].items, ["vit_d", "magnesium"]);
  assert.deepEqual(summary.sources.map((s) => s.key), ["ration", "sport", "shopping"]);
  const homeScreen = summary.screens.find((s) => s.key === "home");
  assert.deepEqual(homeScreen.cards[0], { key: "water_today", title: "Вода сегодня", shows: ["meter water.ml", "quick water", "quick water"] });
  assert.equal(JSON.stringify(summary).length < 3000, true, "the summary stays small");
});

test("export holds structure only and import puts it into another space, renaming what collides", () => {
  const source = openSpace();
  build(source, VITAMINS);
  build(source, SHOPPING);
  build(source, { v: 2, name: "Молоко", tracks: [{ key: "shop_week", items: [{ name: "Молоко" }] }] });
  assert.equal(readSpec(source.state()).tracks.shop_week.items[0].every, "open", "a list item has no schedule");
  assert.equal(source.create("tr_vitamins", { props: { date: TODAY, kit_item: "ti_vitamins_vit_d", kit_state: "done" } }).ok, true);
  const shared = JSON.parse(exportBundle(source.state(), "vitaminy"));
  assert.deepEqual(shared.tracks.map((t) => t.key), ["vitamins"]);
  assert.equal(shared.tracks[0].items.length, 2, "habit items are structure");
  assert.equal(JSON.stringify(shared).includes("kit_item"), false, "no entry travels");
  assert.equal(JSON.stringify(shared).includes(TODAY), false, "no date of the sender travels");
  const everything = JSON.parse(exportBundle(source.state()));
  assert.equal(everything.tracks.find((t) => t.key === "shop_week").items, undefined, "list items are personal and stay home");
  assert.equal(JSON.stringify(everything).includes("Молоко"), false);

  const fresh = openSpace();
  const preview = previewImport(JSON.stringify(shared), fresh.state(), ctx);
  assert.equal(preview.ok, true, JSON.stringify(preview.problems));
  assert.deepEqual(preview.renames, []);
  assert.equal(applyBundle(fresh, preview, { summary: `Импорт «${preview.name}»` }).ok, true);
  assert.deepEqual(readSpec(fresh.state()).tracks.vitamins.items.map((i) => i.key), ["vit_d", "magnesium"]);

  const again = previewImport(JSON.stringify(shared), fresh.state(), ctx);
  assert.equal(again.ok, true, JSON.stringify(again.problems));
  const renamed = (kind) => again.renames.filter((r) => r.kind === kind).map((r) => `${r.from}>${r.to}`);
  assert.deepEqual(renamed("track"), ["vitamins>vitamins_2"]);
  assert.deepEqual(renamed("screen"), ["vitamins>vitamins_2"]);
  assert.deepEqual(renamed("card"), ["vitamins_today>vitamins_today_2", "vitamins_streak>vitamins_streak_2", "vitamins_days>vitamins_days_2", "vitamins_calendar>vitamins_calendar_2"]);
  assert.equal(applyBundle(fresh, again).ok, true);
  const spec = readSpec(fresh.state());
  assert.ok(spec.tracks.vitamins_2 && spec.cards.vitamins_today_2.body[0].of === "vitamins_2", "references follow the rename");
  assert.notEqual(spec.tracks.vitamins_2.app, spec.tracks.vitamins.app, "the second copy is its own app");

  const hostile = previewImport(JSON.stringify({ v: 2, name: "Чужое", remove: [{ track: "vitamins" }] }), fresh.state(), ctx);
  assert.equal(hostile.ok, false);
  assert.equal(hostile.problems[0].rule, "import-remove");
});

test("one resolver reads every range token of the catalogue", () => {
  const expected = {
    "@today": ["2026-10-24", "2026-10-24"], "@yesterday": ["2026-10-23", "2026-10-23"], "@last7d": ["2026-10-18", "2026-10-24"], "@last14d": ["2026-10-11", "2026-10-24"],
    "@last30d": ["2026-09-25", "2026-10-24"], "@last90d": ["2026-07-27", "2026-10-24"], "@last8w": ["2026-08-31", "2026-10-24"], "@last12w": ["2026-08-03", "2026-10-24"],
    "@last6m": ["2026-05-01", "2026-10-24"], "@thisWeek": ["2026-10-19", "2026-10-25"], "@thisMonth": ["2026-10-01", "2026-10-31"],
  };
  for (const [token, [from, to]] of Object.entries(expected)) assert.deepEqual(resolveRange(token, TODAY), { from, to }, token);
  assert.deepEqual(resolveRange("@next3d", TODAY), { from: TODAY, to: "2026-10-26" });
  assert.deepEqual(resolveRange({ from: "@-3d", to: "@today" }, TODAY), { from: "2026-10-21", to: TODAY });
  assert.throws(() => resolveRange("@last", TODAY), /неизвестный период/);
});

test("the catalogue feeds the markup validator with every new tag", () => {
  const components = componentsForMarkup();
  assert.deepEqual(Object.keys(components).sort(), ELEMENT_KEYS.map((k) => ({ p: "p", empty: "c-empty" })[k] || `c-${k}`).sort());
  assert.deepEqual(components["c-quick"].kit.required, ["of", "values"]);
  assert.equal(components["c-meter"].kit.needsGoal, true);
  assert.deepEqual(components["c-marks"].attrs.add, { type: "bool" });
  assert.deepEqual(components["c-bars"].attrs.range.type, "range");
  assert.deepEqual(components["c-line"].attrs.by, { type: "enum", values: ["day", "week", "month"] });
  assert.deepEqual(components["c-bars"].attrs.by, { type: "text", max: 40 }, "bars take a time step or a value to group by");
  assert.deepEqual(components["c-list"].attrs.edit, { type: "bool" });
  assert.deepEqual(components["c-table"].attrs.search, { type: "bool" });
  assert.deepEqual(components["c-marks"].attrs.date, { type: "enum", values: ["@today", "@yesterday"] });
  assert.equal(components["c-embed"].attrs.what.values.length, 3);
});

test("validateBundle alone tells the same story as the pipeline", () => {
  const spec = readSpec(openSpace().state());
  assert.deepEqual(validateBundle(WATER, spec, ctx), []);
  assert.equal(validateBundle({ v: 2, name: "x", tracks: [{ key: "ration", name: "Мой рацион", kind: "log" }] }, spec, ctx)[0].rule, "reserved-key");
  assert.equal(validateBundle({ v: 3, name: "x" }, spec, ctx)[0].rule, "bad-value");
});

// -- every attribute survives the store ---------------------------------------------
const SINK = {
  v: 2, name: "Всё сразу",
  tracks: [
    {
      key: "mood", name: "Самочувствие", kind: "log", icon: "🙂",
      fields: [
        { key: "plus", name: "Плюс", type: "calc", calc: "double + 1", unit: "очк." },
        { key: "feel", name: "Самочувствие", type: "scale", min: 1, max: 5, labels: ["плохо", "", "норма", "", "отлично"], hint: "1 — плохо, 5 — отлично" },
        { key: "place", name: "Где", type: "choice", options: ["работа", "дом", "улица"] },
        { key: "sleepy", name: "Хочется спать", type: "yesno" },
        { key: "note", name: "Заметка", type: "text", required: true },
        { key: "at", name: "Во сколько", type: "time" },
        { key: "since", name: "С какого дня", type: "date" },
        { key: "score", name: "Баллы", type: "number", min: 0, max: 10, step: 0.5, goal: 7, goalType: "min", goalPer: "week" },
        { key: "double", name: "Вдвое", type: "calc", calc: "score * 2", unit: "очк." },
      ],
    },
    {
      key: "meds", name: "Таблетки", kind: "habit", grace: 1, times: 3, per: "week", states: ["done", "changed", "skipped"], labels: { done: "принял" }, unmarked: "missed",
      fields: [{ key: "dose", name: "Доза", type: "number", unit: "таб.", planned: true, on: ["done", "changed"] }],
      items: [
        { key: "morning_pill", name: "Утренняя", every: "mon,wed,fri", at: "08:30", plan: { dose: 1 }, until: "2026-12-31" },
        { key: "evening_pill", name: "Вечерняя", every: "2d", at: "evening" },
      ],
    },
    { key: "recipes", name: "Рецепты", kind: "catalog", fields: [{ key: "minutes", name: "Время", type: "number", unit: "мин" }], items: [{ key: "pasta", name: "Паста", plan: { minutes: 15 } }] },
  ],
  screens: [
    { key: "home", cards: [{ key: "mood_now", title: "Как вы", body: [{ el: "form", of: "mood", fields: ["feel", "place", "note"] }, { el: "quick", of: "mood", values: { feel: 4, place: "дом" } }] }] },
    {
      key: "mood", name: "Самочувствие", icon: "🙂",
      cards: [
        { key: "mood_goal", title: "Баллы за неделю", body: [{ el: "meter", of: "mood", value: "score" }, { el: "stat", of: "mood", value: "score", fn: "avg", range: "@thisWeek", good: "up" }] },
        { key: "mood_places", title: "Где бывает хорошо", body: [{ el: "bars", of: "mood", value: "feel", fn: "avg", range: "@last8w", by: "week", category: "place", stack: "grouped" }] },
        { key: "mood_table", title: "Записи", body: [{ el: "table", of: "mood", columns: ["date", "feel", "place"], sort: "date", order: "desc", limit: 10, range: "@last30d", where: { place: "дом" } }] },
        { key: "meds_card", title: "Таблетки", body: [{ el: "marks", of: "meds" }, { el: "list", of: "meds", columns: ["date", "item", "state", "dose"], limit: 5, range: "@last14d" }, { el: "empty", text: "Пока отметок нет." }] },
        { key: "recipes_card", title: "Рецепты", body: [{ el: "list", of: "recipes", columns: ["name", "minutes"], limit: 20 }, { el: "stat", of: "recipes", fn: "count", range: "@today" }] },
        { key: "ration_card", title: "Рацион сегодня", body: [{ el: "embed", what: "ration-today" }, { el: "stat", of: "ration", value: "kcal", range: "@today" }, { el: "meter", of: "ration", value: "kcal" }] },
      ],
    },
  ],
};

test("a bundle that uses every attribute comes back from the store unchanged: no ops, same export", () => {
  const store = openSpace();
  const { checked } = build(store, SINK);
  const defined = checked.ops.filter((o) => o.op === "defineRelation").map((o) => o.relation.key);
  assert.ok(defined.indexOf("tr_mood__double") < defined.indexOf("tr_mood__plus"), "a calc is defined after the calc it reads");
  assert.ok(defined.indexOf("tr_mood__score") < defined.indexOf("tr_mood__double"), "and after the plain fields");
  const s = store.state();
  assert.equal(s.relations.tr_mood__plus.formula, "(tr_mood__double + 1)");
  assert.deepEqual(s.relations.tr_mood__place.options, [{ id: "o1", name: "работа" }, { id: "o2", name: "дом" }, { id: "o3", name: "улица" }]);
  assert.deepEqual(s.relations.tr_mood__feel.kit.labels, ["плохо", "", "норма", "", "отлично"]);
  assert.deepEqual(s.relations.tr_meds__dose.kit, { track: "meds", field: "dose", type: "number", planned: true, on: ["done", "changed"] });
  assert.deepEqual(s.types.tr_meds.kit, { track: "meds", kind: "habit", states: ["done", "changed", "skipped"], labels: { done: "принял", changed: "изменено", skipped: "пропущено" }, unmarked: "missed", grace: 1, times: 3, per: "week", app: "vse_srazu", since: TODAY });
  assert.deepEqual(s.objects.ti_meds_morning_pill.props.kit_plan, { dose: 1 });
  assert.equal(s.objects.ti_meds_evening_pill.props.kit_every, "2d");
  assert.deepEqual(s.objects.ti_recipes_pasta.props.kit_plan, { minutes: 15 });
  assert.equal(s.types.tr_recipes.fact, false);
  const again = checkBundle(SINK, s, ctx);
  assert.equal(again.ok, true, JSON.stringify(again.problems));
  assert.deepEqual(again.ops, []);

  const exported = exportBundle(s);
  const fresh = openSpace();
  const imported = previewImport(exported, fresh.state(), ctx);
  assert.equal(imported.ok, true, JSON.stringify(imported.problems));
  assert.deepEqual(imported.renames, []);
  assert.equal(applyBundle(fresh, imported).ok, true);
  assert.equal(exportBundle(fresh.state()), exported, "export, import, export is a fixed point");
});

test("options keep their ids when the list changes, so recorded values keep their meaning", () => {
  const store = openSpace();
  build(store, SINK);
  assert.equal(store.create("tr_mood", { props: { date: TODAY, tr_mood__place: "o2", tr_mood__note: "x" } }).ok, true);
  const patch = checkBundle({ v: 2, name: "Места", tracks: [{ key: "mood", fields: [{ key: "place", options: ["улица", "дом", "работа", "кафе"] }] }] }, store.state(), ctx);
  assert.equal(patch.ok, true, JSON.stringify(patch.problems));
  assert.equal(applyBundle(store, patch).ok, true);
  const s = store.state();
  assert.deepEqual(s.relations.tr_mood__place.options, [{ id: "o3", name: "улица" }, { id: "o2", name: "дом" }, { id: "o1", name: "работа" }, { id: "o4", name: "кафе" }]);
  const entry = Object.values(s.objects).find((o) => o.type === "tr_mood");
  assert.equal(s.relations.tr_mood__place.options.find((o) => o.id === entry.props.tr_mood__place).name, "дом");
});

test("a card key lives on one screen and the message names where", () => {
  const store = openSpace();
  build(store, WATER);
  const result = checkBundle({ v: 2, name: "Перенос", screens: [{ key: "home", cards: [{ key: "water_week", title: "Неделя", body: [{ el: "p", text: "Текст" }] }] }] }, store.state(), ctx);
  assert.equal(result.layer, "L1");
  assert.equal(result.problems[0].rule, "card-moved");
  assert.match(result.problems[0].message, /уже есть на экране «water».*water_week_2/);
});

test("undo: a patch restores the old definition as one step", () => {
  const store = openSpace();
  build(store, WATER);
  const patch = build(store, { v: 2, name: "Цель воды 2500", tracks: [{ key: "water", fields: [{ key: "ml", goal: 2500 }] }] });
  assert.equal(store.state().relations.tr_water__ml.kit.goal, 2500);
  assert.equal(store.revert(patch.applied.changeSetId).ok, true);
  assert.equal(store.state().relations.tr_water__ml.kit.goal, 2000);
});

// -- L3, commas, the start day ----------------------------------------------------
test("L3 checks the markup of a card L1 let through and names the screen, the card and the element", () => {
  const store = openSpace();
  build(store, WATER);
  const bundle = (body) => ({ v: 2, name: "Условие", screens: [{ key: "home", cards: [{ key: "water_today", title: "Вода сегодня", body }] }] });
  const fine = { el: "stat", of: "water", value: "ml", fn: "sum", range: "@last7d" };
  assert.equal(checkBundle(bundle([fine]), store.state(), ctx).ok, true);
  const long = { note: "я".repeat(41) };
  build(store, { v: 2, name: "Заметка", tracks: [{ key: "water", fields: [{ key: "note", name: "Заметка", type: "text" }] }] });
  const result = checkBundle(bundle([fine, { ...fine, where: long }]), store.state(), ctx);
  assert.equal(result.layer, "L3", "validateBundle accepts the value, the markup validator does not");
  assert.deepEqual(result.ops, []);
  assert.equal(result.problems[0].path, "screens.home.cards.water_today.body[1].where");
  assert.equal(result.problems[0].rule, "bad-value");
  assert.match(result.problems[0].message, /where/);
  const created = checkBundle({ v: 2, name: "Новая", screens: [{ key: "water", cards: [{ key: "water_new", title: "Новая", body: [{ ...fine, where: long }] }] }] }, store.state(), ctx);
  assert.equal(created.problems[0].path, "screens.water.cards.water_new.body[0].where", "a created card is checked as well");
});

const commaTrack = (field, extra = {}) => ({ v: 2, name: "Запятые", tracks: [{ key: "mood", name: "Настроение", kind: "log", fields: [field], ...extra }] });
for (const [name, bundle, path, said] of [
  ["a choice option", commaTrack({ key: "place", name: "Где", type: "choice", options: ["дома, на диване", "на работе"] }), "tracks.mood.fields.place.options", /«дома, на диване».*«дома и на диване»/],
  ["a scale label", commaTrack({ key: "feel", name: "Самочувствие", type: "scale", min: 1, max: 3, labels: ["плохо", "ни так, ни сяк", "хорошо"] }), "tracks.mood.fields.feel.labels", /Подпись шкалы «ни так, ни сяк»/],
  ["an item name", { v: 2, name: "Запятые", tracks: [{ key: "pills", name: "Таблетки", kind: "habit", items: [{ key: "mag", name: "Магний, B6", every: "day" }] }] }, "tracks.pills.items.mag.name", /Название пункта «Магний, B6».*Магний и B6/],
]) {
  test(`a comma in ${name} is refused with the reason and what to write`, () => {
    const result = checkBundle(bundle, openSpace().state(), ctx);
    assert.equal(result.layer, "L1");
    const hit = result.problems.find((p) => p.rule === "comma");
    assert.ok(hit, JSON.stringify(result.problems));
    assert.equal(hit.path, path);
    assert.match(hit.message, /списки в разметке пишутся через запятую/);
    assert.match(hit.message, said);
  });
}

test("a track remembers the day it was made and an overlay never moves it", () => {
  const store = openSpace();
  build(store, WATER);
  assert.equal(store.state().types.tr_water.kit.since, TODAY);
  build(store, { v: 2, name: "Название", tracks: [{ key: "water", name: "Вода в день", states: undefined, icon: "🥤" }] }, { today: "2026-11-03" });
  const kit = store.state().types.tr_water.kit;
  assert.equal(kit.since, TODAY, "a later change keeps the first day");
  build(store, { v: 2, name: "Убрать", remove: [{ track: "water" }] }, { today: "2026-11-04" });
  build(store, WATER, { today: "2026-11-05" });
  assert.equal(store.state().types.tr_water.kit.since, TODAY, "a track brought back keeps it too");
});

// -- an answer in words only ---------------------------------------------------------
test("a reply alone is a valid answer that changes nothing and needs no name", () => {
  const state = space().state();
  const reply = "Дозу подбирает врач. Могу собрать отметку приёма.";
  for (const raw of [{ reply }, { v: 2, reply, tracks: [] }, JSON.stringify({ reply }), bundleFromMarkup(`<c-reply>${reply}</c-reply>`).bundle]) {
    const result = checkBundle(raw, state, ctx);
    assert.equal(result.ok, true, JSON.stringify(result.problems));
    assert.equal(result.noop, true);
    assert.equal(result.reply, reply);
    assert.deepEqual([result.ops, result.rows, result.cascades], [[], [], []]);
  }
  assert.deepEqual(applyBundle(openSpace(), checkBundle({ reply }, state, ctx)), { ok: true, changeSetId: null, noop: true });

  const nameless = checkBundle({ reply, tracks: [{ key: "tea", name: "Чай", kind: "log" }] }, state, ctx);
  assert.equal(nameless.ok, false, "a reply does not excuse a bundle that builds something without its name");
  assert.equal(nameless.problems[0].path, "name");
  assert.equal(checkBundle({ reply: "  " }, state, ctx).ok, false, "no words and no bundle is not an answer");
});

test("the words of a reply-only answer pass the number rule like any other words", () => {
  const state = space().state();
  const refused = checkBundle({ reply: "Вы съели 3000 ккал, это много." }, state, ctx);
  assert.equal(refused.layer, "L1");
  assert.equal(refused.problems[0].rule, "number-in-text");
  assert.equal(refused.problems[0].path, "reply");
  assert.equal(checkBundle({ reply: "Вы съели 3000 ккал, это много." }, state, { ...ctx, request: "я съел 3000 ккал, это много?" }).ok, true);
});

// -- numbers in text -------------------------------------------------------------------
const counter = (extra = {}, card = {}, field = {}) => ({
  v: 2, name: "Вода", ...extra,
  tracks: [{ key: "water", name: "Вода", kind: "log", fields: [{ key: "ml", name: "Выпито", type: "number", unit: "мл", min: 1, max: 5000, goal: 3000, ...field }] }],
  screens: [{ key: "home", cards: [{ key: "w1", title: "Вода", body: [{ el: "meter", of: "water", value: "ml" }, { el: "list", of: "water", limit: 5, range: "@last30d" }], ...card }] }],
});
const numberProblem = (result) => result.problems.find((p) => p.rule === "number-in-text");

for (const [name, bundle, request] of [
  ["the same number in other units: a reply «3 литра» for a goal of 3000 мл", counter({ reply: "Поставил цель 3 литра в день." })],
  ["the same number in other units: a title «3 литра» for a goal of 3000 мл", counter({}, { title: "Цель 3 литра" })],
  ["the same number the other way: a reply «3000 мл» for a request of 3 литра", { reply: "Могу вести воду, цель 3000 мл в день." }, "веди воду, 3 литра в день"],
  ["a limit of a list: «Последние 5 записей»", counter({ reply: "Последние 5 записей лежат на главной." })],
  ["a limit of a list in a title", counter({}, { title: "Последние 5 записей" })],
  ["a range: «за 30 дней»", counter({}, { title: "Записи за 30 дней" })],
  ["a number of the request in a title", counter({}, { title: "Пить 8 стаканов" }), "хочу пить 8 стаканов в день"],
  ["a number of the request in a reply, written with a space", counter({ reply: "Цель 2500 мл." }), "цель 2 500 мл"],
  ["a number of an item name", { v: 2, name: "Витамины", reply: "Добавил D3 на утро.", tracks: [{ key: "vit", name: "Витамины", kind: "habit", items: [{ key: "d3", name: "Витамин D3", every: "day" }] }] }],
  ["a number of a plan", { v: 2, name: "Витамины", reply: "По 40 за раз, как вы просили.", tracks: [{ key: "vit", name: "Витамины", kind: "habit", fields: [{ key: "dose", name: "Доза", type: "number", planned: true }], items: [{ key: "vit_d", name: "Витамин", every: "day", plan: { dose: 40 } }] }] }],
  ["a number of a field name", counter({ reply: "Поле «Стаканов по 250» готово." }, {}, { name: "Стаканов по 250" })],
]) {
  test(`numbers in text: allowed from ${name}`, () => {
    const result = checkBundle(bundle, openSpace().state(), { ...ctx, request });
    assert.equal(result.ok, true, JSON.stringify(result.problems));
  });
}

for (const [name, bundle, path, number, request] of [
  ["the person's own number in a reply", counter({ reply: "Вы выпили 3500 мл за вчера." }), "reply", "3500"],
  ["the person's own number, said in kcal, in a title", counter({}, { title: "Вы съели 2400 ккал" }), "screens.home.cards.w1.title", "2400", "покажи воду"],
  ["a weight of the person in a caption", counter({}, { caption: "Ваш вес 82 кг" }), "screens.home.cards.w1.caption", "82", "покажи воду"],
  ["a number that is neither scaled nor supplied: 2 литра against 3000 мл", counter({ reply: "Вы выпили 2 литра." }), "reply", "2"],
  ["a number in the hint of a field", counter({}, {}, { hint: "Вы обычно пьёте 1700" }), "tracks.water.fields.ml.hint", "1700"],
  ["a number that stood in no request of this bundle", counter({ reply: "Вы пили 8 стаканов." }), "reply", "8", "хочу воду"],
  ["a count that only the version number would excuse", counter({ reply: "Собрал 2 экрана." }), "reply", "2"],
]) {
  test(`numbers in text: still refused for ${name}`, () => {
    const result = checkBundle(bundle, openSpace().state(), { ...ctx, request });
    assert.equal(result.layer, "L1", JSON.stringify(result.problems));
    const hit = numberProblem(result);
    assert.ok(hit, JSON.stringify(result.problems));
    assert.equal(hit.path, path);
    assert.match(hit.message, new RegExp(`число ${number}`));
  });
}

test("a checked bundle applied later as «ai», as the assistant does, is not refused for a number the request supplied", () => {
  const store = openSpace();
  build(store, WATER);
  const titled = { v: 2, name: "Норма", screens: [{ key: "water", cards: [{ key: "water_week", title: "Пить 8 стаканов" }] }] };
  assert.equal(checkBundle(titled, store.state(), ctx).layer, "L1", "no request, no number");
  const checked = checkBundle(titled, store.state(), { ...ctx, request: "хочу 8 стаканов" });
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
  const applied = store.apply(checked.ops, { actor: "ai", summary: "Норма" });
  assert.equal(applied.ok, true, applied.reason);
  assert.equal(readSpec(store.state()).cards.water_week.title, "Пить 8 стаканов");
});

test("a card whose title came from the request can be reordered by a later bundle that has no request", () => {
  const store = openSpace();
  build(store, WATER);
  build(store, { v: 2, name: "Норма", screens: [{ key: "water", cards: [{ key: "water_week", title: "Пить 8 стаканов" }] }] }, { request: "хочу 8 стаканов" });
  assert.equal(readSpec(store.state()).cards.water_week.title, "Пить 8 стаканов");
  build(store, { v: 2, name: "Порядок", screens: [{ key: "water", order: ["water_last"] }] });
  assert.deepEqual(cardsOf(readSpec(store.state()), "water").map((c) => c.key), ["water_last", "water_week", "water_calendar"]);
});

// -- yes/no values ---------------------------------------------------------------------
const MEALS = {
  v: 2, name: "Овощи",
  tracks: [
    { key: "meals", name: "Приёмы", kind: "log", fields: [{ key: "has", name: "Овощи были", type: "yesno" }, { key: "note", name: "Заметка", type: "text" }] },
    { key: "foods", name: "Продукты", kind: "catalog", fields: [{ key: "veg", name: "Овощ", type: "yesno" }], items: [{ key: "carrot", name: "Морковь", plan: { veg: "да" } }] },
  ],
  screens: [{ key: "home", cards: [{ key: "meals_ok", title: "Приёмы с овощами", body: [{ el: "stat", of: "meals", fn: "count", range: "@last7d", where: { has: "true" } }, { el: "quick", of: "meals", values: { has: "yes" } }] }] }],
};

test("a yes/no field reads true, да and yes in where, quick values and an item plan as booleans, and says so", () => {
  const store = openSpace();
  const { checked } = build(store, MEALS);
  assert.equal(checked.changes.filter((c) => /поле да\/нет/.test(c)).length, 3, JSON.stringify(checked.changes));
  assert.ok(checked.changes.some((c) => /«has» — поле да\/нет, «true» записано как true/.test(c)), JSON.stringify(checked.changes));
  const body = readSpec(store.state()).cards.meals_ok.body;
  assert.deepEqual(body[0].where, { has: true });
  assert.deepEqual(body[1].values, { has: true });
  assert.deepEqual(readSpec(store.state()).tracks.foods.items[0].plan, { veg: true });

  const no = checkBundle({ v: 2, name: "Нет", screens: [{ key: "home", cards: [{ key: "meals_no", title: "Без овощей", body: [{ el: "stat", of: "meals", fn: "count", range: "@last7d", where: { has: "Нет" } }] }] }] }, store.state(), ctx);
  assert.equal(no.ok, true, JSON.stringify(no.problems));
  assert.deepEqual(no.spec.cards.meals_no.body[0].where, { has: false });

  const text = checkBundle({ v: 2, name: "Текст", screens: [{ key: "home", cards: [{ key: "meals_note", title: "Заметки", body: [{ el: "list", of: "meals", range: "@last7d", where: { note: "true" } }] }] }] }, store.state(), ctx);
  assert.equal(text.ok, true, "a text field keeps the word");
  assert.deepEqual(text.spec.cards.meals_note.body[0].where, { note: "true" });
  assert.equal(text.changes.some((c) => /да\/нет/.test(c)), false);
});

test("the markup surface writes has=true and the pipeline reads it as a yes/no value", () => {
  const store = openSpace();
  build(store, MEALS);
  const parsed = bundleFromMarkup('<c-bundle v="2" name="Овощи ещё"><c-screen key="home"><c-card key="meals_two" title="Ещё"><c-stat of="meals" fn="count" range="@last7d" where="has=true"/><c-quick of="meals" values="has=нет"/></c-card></c-screen></c-bundle>');
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.bundle.screens[0].cards[0].body[0].where, { has: "true" }, "the markup keeps the text");
  const result = checkBundle(parsed.bundle, store.state(), ctx);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.deepEqual(result.spec.cards.meals_two.body.map((el) => el.where || el.values), [{ has: true }, { has: false }]);
});

// -- list with add ----------------------------------------------------------------------
test("a list may offer a form to add rows, for a catalog and a list, and only there", () => {
  const store = openSpace();
  build(store, WATER);
  build(store, { v: 2, name: "Рецепты", tracks: [{ key: "recipes", name: "Рецепты", kind: "catalog", fields: [{ key: "mins", name: "Минут", type: "number", unit: "мин" }] }, { key: "buy", name: "Купить", kind: "list" }] });
  const card = (of, extra = {}) => ({ v: 2, name: "Форма", screens: [{ key: "home", cards: [{ key: "add_card", title: "Строки", body: [{ el: "list", of, add: true, ...extra }] }] }] });
  assert.equal(checkBundle(card("recipes"), store.state(), ctx).ok, true);
  assert.equal(checkBundle(card("buy", { range: "@last30d" }), store.state(), ctx).ok, true);
  const refused = checkBundle(card("water", { range: "@last30d" }), store.state(), ctx);
  assert.equal(refused.layer, "L1");
  assert.equal(refused.problems[0].rule, "kind-element");
  assert.equal(refused.problems[0].path, "screens.home.cards.add_card.body[0].add");
  assert.match(refused.problems[0].message, /kind=log.*form или quick/);
  const table = { v: 2, name: "Таблица", screens: [{ key: "home", cards: [{ key: "tbl", title: "Таблица", body: [{ el: "table", of: "recipes", add: true }] }] }] };
  assert.equal(checkBundle(table, store.state(), ctx).problems[0].rule, "unknown-attr", "only list carries add");
});

// -- order of the cards ---------------------------------------------------------------------
test("order puts the listed cards first and keeps the rest after them; one undo takes it back", () => {
  const store = openSpace();
  build(store, WATER);
  const keys = () => cardsOf(readSpec(store.state()), "water").map((c) => c.key);
  assert.deepEqual(keys(), ["water_week", "water_calendar", "water_last"]);
  const bundle = { v: 2, name: "Порядок", screens: [{ key: "water", order: ["water_last", "water_week"] }] };
  const { checked, applied } = build(store, bundle);
  assert.deepEqual(keys(), ["water_last", "water_week", "water_calendar"]);
  assert.deepEqual(checked.rows, [["Карточки переставятся", "Вода", "Последние записи, Вода по дням, Календарь воды"]]);
  assert.equal(checkBundle(bundle, store.state(), ctx).noop, true, "the same order twice is no ops");
  assert.equal(store.revert(applied.changeSetId).ok, true);
  assert.deepEqual(keys(), ["water_week", "water_calendar", "water_last"]);
});

test("order may name a card written in the same bundle, reads a comma string, and refuses a key the screen does not have", () => {
  const store = openSpace();
  build(store, WATER);
  const extra = { key: "water_extra", title: "Ещё", body: [{ el: "stat", of: "water", value: "ml", fn: "sum", range: "@last7d" }] };
  const added = checkBundle({ v: 2, name: "Ещё", screens: [{ key: "water", order: "water_extra", cards: [extra] }] }, store.state(), ctx);
  assert.equal(added.ok, true, JSON.stringify(added.problems));
  assert.ok(added.changes.some((c) => /order/.test(c)), "the string was made a list and said so");
  assert.deepEqual(cardsOf(added.spec, "water").map((c) => c.key), ["water_extra", "water_week", "water_calendar", "water_last"]);

  const unknown = checkBundle({ v: 2, name: "Порядок", screens: [{ key: "water", order: ["water_week", "water_graph"] }] }, store.state(), ctx);
  assert.equal(unknown.layer, "L1");
  assert.equal(unknown.problems[0].rule, "unknown-key");
  assert.equal(unknown.problems[0].path, "screens.water.order");
  assert.match(unknown.problems[0].message, /нет карточки «water_graph».*Карточки экрана: water_week, water_calendar, water_last/);
  const twice = checkBundle({ v: 2, name: "Порядок", screens: [{ key: "water", order: ["water_week", "water_week"] }] }, store.state(), ctx);
  assert.equal(twice.problems[0].rule, "bad-value");
  const moved = checkBundle({ v: 2, name: "Порядок", screens: [{ key: "home", order: ["water_week"] }] }, store.state(), ctx);
  assert.equal(moved.problems[0].path, "screens.home.order", "a card of another screen is not on this one");
});

test("the markup surface writes order as a comma list", () => {
  const parsed = bundleFromMarkup('<c-bundle v="2" name="Порядок"><c-screen key="water" order="water_last,water_week"/></c-bundle>');
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.bundle.screens, [{ key: "water", order: ["water_last", "water_week"] }]);
  const store = openSpace();
  build(store, WATER);
  assert.equal(checkBundle(parsed.bundle, store.state(), ctx).ok, true);
});

// =====================================================================================================
// Round 2: the vocabulary of the kit grows, and each word has a refusal that names the fix.
// =====================================================================================================
const R2 = {
  v: 2, name: "Для проверок",
  tracks: [
    { key: "pantry", name: "Кладовая", kind: "log", fields: [{ key: "product", name: "Продукт", type: "text" }, { key: "expires", name: "Годен до", type: "date" }, { key: "left", name: "Осталось", type: "number", min: 0, max: 100 }, { key: "shelf", name: "Полка", type: "choice", options: ["верх", "низ"] }] },
    { key: "wish", name: "Хотелки", kind: "list", fields: [{ key: "price", name: "Цена", type: "number", unit: "₽", planned: true }], items: [{ key: "lamp", name: "Лампа", plan: { price: 2500 } }] },
    { key: "books", name: "Книги", kind: "catalog", fields: [{ key: "genre", name: "Жанр", type: "choice", options: ["роман", "наука"] }, { key: "pages", name: "Страниц", type: "number" }], items: [{ key: "war", name: "Война и мир", plan: { genre: "роман", pages: 1300 } }] },
  ],
};
const R2_MORE = {
  v: 2, name: "Ещё для проверок",
  tracks: [
    { key: "chores", name: "Дела", kind: "habit", items: [{ key: "trash", name: "Мусор" }] },
    { key: "spend", name: "Траты", kind: "log", fields: [{ key: "sum", name: "Сумма", type: "number", unit: "₽", goal: 20000, goalType: "max", goalPer: "month" }, { key: "glass", name: "Стакан", type: "number", unit: "мл", goal: 2000 }] },
  ],
};
function space2() {
  const store = space();
  build(store, R2);
  build(store, R2_MORE);
  return store;
}
const el = (extra) => home([{ of: "pantry", ...extra }]);
const at = (n = 0) => `screens.home.cards.t1.body[${n}]`;

const INVALID_R2 = [
  ["a period past the limit of days", home([{ el: "stat", of: "pantry", fn: "count", range: "@last400d" }]), "bad-value", `${at()}.range`, /N должно быть от 1 до 365.*@lastNd, @lastNw, @lastNm.*@all/],
  ["a period past the limit of months", home([{ el: "stat", of: "pantry", fn: "count", range: "@last13m" }]), "bad-value", `${at()}.range`, /от 1 до 12 \(месяцев\)/],
  ["a period nobody defined", home([{ el: "stat", of: "pantry", fn: "count", range: "@last7x" }]), "bad-value", `${at()}.range`, /Допустимо: @today, @yesterday, @lastNd/],
  ["a delta on a line", home([{ el: "line", of: "spend", value: "sum", fn: "delta", range: "@last30d" }]), "bad-value", `${at()}.fn`, /delta.*stat и meter.*last или first/],
  ["a less-than on a choice", home([{ el: "stat", of: "pantry", fn: "count", range: "@last7d", where: { shelf: "<верх" } }]), "bad-value", `${at()}.where.shelf`, /годятся = и !=/],
  ["a state that is not one", home([{ el: "stat", of: "chores", value: "done", range: "@last7d", where: { state: "finished" } }]), "bad-value", `${at()}.where.state`, /state: done, changed, skipped, open/],
  ["a date that does not read", home([{ el: "stat", of: "pantry", fn: "count", range: "@last7d", where: { expires: "<=вчера" } }]), "bad-value", `${at()}.where.expires`, /не читается.*today, \+7d, -30d/],
  ["a number that is not one", home([{ el: "stat", of: "pantry", fn: "count", range: "@last7d", where: { left: ">много" } }]), "bad-value", `${at()}.where.left`, /нужно число/],
  ["a field the track does not have in where", home([{ el: "stat", of: "pantry", fn: "count", range: "@last7d", where: { colour: "red" } }]), "unknown-key", `${at()}.where.colour`, /Ключи: product, expires, left, shelf, date/],
  ["an item of a track that has none in where", home([{ el: "stat", of: "pantry", fn: "count", range: "@last7d", where: { item: "lamp" } }]), "unknown-key", `${at()}.where.item`, /Ключи: product/],
  ["rows of items on a log", home([{ el: "stat", of: "pantry", rows: "items", fn: "count", range: "@all" }]), "kind-attr", `${at()}.rows`, /habit, list и catalog.*kind=log/],
  ["a virtual value over items", home([{ el: "stat", of: "wish", rows: "items", value: "done", range: "@all" }]), "unknown-key", `${at()}.value`, /value — поле пункта: price.*where \{"state": "done"\}/],
  ["bars over a catalog without a value to group by", home([{ el: "bars", of: "books", value: "pages", fn: "sum", range: "@all" }]), "kind-element", `${at()}.el`, /нет дат.*list и table.*stat.*bars с rows: "items" и by/],
  ["a line over a catalog", home([{ el: "line", of: "books", value: "pages", fn: "sum", range: "@last30d" }]), "kind-element", `${at()}.el`, /Строки справочника показывают list и table/],
  ["a heatmap over a catalog", home([{ el: "heatmap", of: "books", value: "pages", range: "@last12w" }]), "kind-element", `${at()}.el`, /rows: "items"/],
  ["bars of items on a time step", home([{ el: "bars", of: "wish", rows: "items", value: "price", fn: "sum", by: "week", range: "@all" }]), "bad-value", `${at()}.by`, /нет оси времени/],
  ["a compare over items", home([{ el: "stat", of: "wish", rows: "items", value: "price", fn: "sum", range: "@all", compare: true }]), "bad-value", `${at()}.compare`, /нет периодов/],
  ["a course meter on a list", home([{ el: "meter", of: "wish", value: "done", goal: "due", range: "@all" }]), "kind-attr", `${at()}.goal`, /расписание есть у habit.*kind=list/],
  ["a course meter that counts something else", home([{ el: "meter", of: "chores", value: "rate", goal: "due", range: "@all" }]), "bad-value", `${at()}.value`, /value: "done"/],
  ["a course meter without value", home([{ el: "meter", of: "chores", goal: "due", range: "@all" }]), "missing-attr", `${at()}.value`, /value: "done"/],
  ["bars by a field that cannot group", home([{ el: "bars", of: "pantry", value: "left", fn: "sum", by: "expires", range: "@last30d" }]), "unknown-key", `${at()}.by`, /by «expires» не подходит.*product, shelf.*day, week, month/],
  ["bars by slot of a log", home([{ el: "bars", of: "pantry", value: "left", fn: "sum", by: "slot", range: "@last30d" }]), "unknown-key", `${at()}.by`, /такие by: product, shelf/],
  ["bars by slot of shopping", home([{ el: "bars", of: "shopping", value: "spent", fn: "sum", by: "slot", range: "@last30d" }]), "unknown-key", `${at()}.by`, /только by: slot|нет приёмов|время/],
  ["bars over all the time by day", home([{ el: "bars", of: "spend", value: "sum", fn: "sum", range: "@all" }]), "too-many-points", `${at()}.by`, /by: "week" или by: "month"/],
  ["a heatmap over all the time", home([{ el: "heatmap", of: "spend", value: "sum", fn: "sum", range: "@all" }]), "range-too-long", `${at()}.range`, /@last12w или @last90d/],
  ["all the time of a classic source", home([{ el: "stat", of: "shopping", value: "spent", fn: "sum", range: "@all" }]), "bad-value", `${at()}.range`, /нет собственного начала/],
  ["a compare over all the time", home([{ el: "stat", of: "spend", value: "sum", fn: "sum", range: "@all", compare: true }]), "bad-value", `${at()}.compare`, /прошлого периода нет/],
  ["pace over a goal per day", home([{ el: "meter", of: "spend", value: "glass", pace: "left" }]), "no-goal", `${at()}.pace`, /goalPer: "week" или "month".*sum/],
  ["pace over a classic source", home([{ el: "stat", of: "shopping", value: "spent", fn: "sum", range: "@thisMonth", pace: "left" }]), "bad-value", `${at()}.pace`, /классический раздел/],
  ["pace with an average", home([{ el: "meter", of: "spend", value: "sum", fn: "avg", pace: "left" }]), "bad-value", `${at()}.fn`, /считается суммой/],
  ["marks of a day that cannot be opened", home([{ el: "marks", of: "chores", date: "@tomorrow" }]), "bad-value", `${at()}.date`, /Допустимо: @today, @yesterday/],
  ["edit on a chart", home([{ el: "bars", of: "spend", value: "sum", fn: "sum", range: "@last7d", edit: true }]), "unknown-attr", `${at()}.edit`, /Допустимо: of, value, fn, range, by/],
  ["a name on the home screen", { v: 2, name: "Тест", screens: [{ key: "home", name: "Главная", cards: [{ key: "t1", title: "Тест", body: [{ el: "p", text: "Привет" }] }] }] }, "home-name", "screens.home.name", /Уберите name у home/],
  ["a field that asks at skipped on a track without that button", { v: 2, name: "Тест", tracks: [{ key: "why", name: "Почему", kind: "follow", follows: "ration", fields: [{ key: "reason", name: "Причина", type: "choice", options: ["не успел", "не хотел"], on: ["skipped"] }] }] }, "bad-value", "tracks.why.states", /Добавьте в states skipped: \["done","skipped"\]/],
  ["a planned time that is not a time", { v: 2, name: "Тест", tracks: [{ key: "fasts", name: "Окно", kind: "habit", fields: [{ key: "opens", name: "С", type: "time", planned: true }], items: [{ key: "window", name: "Окно", plan: { opens: "9:00" } }] }] }, "bad-value", "tracks.fasts.items.window.plan.opens", /ЧЧ:ММ/],
  ["a planned scale past its top", { v: 2, name: "Тест", tracks: [{ key: "fasts", name: "Окно", kind: "habit", fields: [{ key: "energy", name: "Бодрость", type: "scale", planned: true }], items: [{ key: "window", name: "Окно", plan: { energy: 9 } }] }] }, "bad-value", "tracks.fasts.items.window.plan.energy", /не больше 5/],
];

for (const [name, bundle, rule, path, message] of INVALID_R2) {
  test(`round 2, refused at L1: ${name}`, () => {
    const result = checkBundle(bundle, space2().state(), ctx);
    assert.equal(result.ok, false, "a valid bundle where a refusal is due");
    assert.equal(result.layer, "L1");
    assert.deepEqual(result.ops, []);
    const hit = result.problems.find((p) => p.rule === rule && p.path === path);
    assert.ok(hit, `${rule} at ${path} among ${JSON.stringify(result.problems.map((p) => [p.rule, p.path]))}`);
    assert.match(hit.message, message);
    assert.ok(result.problems.length <= 6);
    assert.match(hit.message, /[а-яё]/i, "the message is Russian");
  });
}

test("round 2: every new word passes in the right place and the bundle goes through all layers", () => {
  const store = space2();
  build(store, {
    v: 2, name: "Новые треки",
    tracks: [
      { key: "fasts", name: "Окно", kind: "habit", states: ["done", "changed", "skipped"], fields: [{ key: "opens", name: "С", type: "time", planned: true }, { key: "energy", name: "Бодрость", type: "scale", planned: true }], items: [{ key: "window", name: "Окно", plan: { opens: "12:00", energy: 3 } }] },
      { key: "bought", name: "Где куплено", kind: "follow", follows: "shopping", fields: [{ key: "shop", name: "Магазин", type: "choice", options: ["Рынок", "Онлайн"] }] },
      { key: "why", name: "Почему", kind: "follow", follows: "ration", states: ["done", "skipped"], fields: [{ key: "reason", name: "Причина", type: "choice", options: ["не успел", "не хотел"], on: ["skipped"] }] },
    ],
  });
  const everything = {
    v: 2, name: "Всё новое",
    screens: [{
      key: "all", name: "Всё",
      cards: [
        { key: "a_delta", title: "Изменение", body: [{ el: "stat", of: "spend", value: "sum", fn: "delta", range: "@all" }, { el: "stat", of: "spend", value: "sum", fn: "last", range: "@last45d" }] },
        { key: "a_where", title: "Скоро", body: [{ el: "table", of: "pantry", columns: ["product", "expires"], range: "@last6m", where: { expires: "<=+7d", left: ">=1" }, edit: true, search: true }] },
        { key: "a_state", title: "Не сделано", body: [{ el: "list", of: "chores", range: "@last7d", where: { state: "!=done", item: "trash" } }, { el: "marks", of: "chores", date: "@yesterday" }] },
        { key: "a_items", title: "Пункты", body: [{ el: "stat", of: "wish", rows: "items", value: "price", fn: "sum", range: "@all", where: { state: "open" } }, { el: "table", of: "wish", rows: "items", columns: ["name", "price", "state"], edit: true }] },
        { key: "a_catalog", title: "Книги", body: [{ el: "stat", of: "books", fn: "count", range: "@all" }, { el: "bars", of: "books", value: "pages", fn: "sum", by: "genre", range: "@all" }] },
        { key: "a_course", title: "Курс", body: [{ el: "meter", of: "chores", value: "done", goal: "due", range: "@all" }] },
        { key: "a_axes", title: "Разрезы", body: [{ el: "bars", of: "pantry", value: "left", fn: "sum", by: "shelf", range: "@last30d" }, { el: "bars", of: "chores", fn: "count", by: "state", range: "@last30d" }, { el: "bars", of: "ration", value: "skipped", fn: "sum", by: "slot", range: "@last30d" }, { el: "bars", of: "spend", value: "sum", fn: "sum", by: "month", range: "@all" }] },
        { key: "a_pace", title: "Темп", body: [{ el: "meter", of: "spend", value: "sum", pace: "left" }, { el: "stat", of: "spend", value: "sum", fn: "sum", range: "@thisMonth", pace: "left" }] },
        { key: "a_sources", title: "Источники", body: [{ el: "stat", of: "ration", value: "meals", fn: "sum", range: "@last7d" }, { el: "stat", of: "sport", value: "sessions_planned", fn: "sum", range: "@last7d" }] },
      ],
    }],
  };
  const checked = checkBundle(everything, store.state(), ctx);
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
  assert.equal(applyBundle(store, checked).ok, true);
  assert.deepEqual(checkBundle(everything, store.state(), ctx).ops, [], "and applied again it is the same space");
  const spec = readSpec(store.state());
  assert.deepEqual(spec.tracks.fasts.fields.map((f) => [f.key, f.planned]), [["opens", true], ["energy", true]]);
  assert.equal(spec.tracks.bought.follows, "shopping");
  assert.deepEqual(spec.tracks.why.fields[0].on, ["skipped"]);
  assert.deepEqual(spec.cards.a_state.body[0].where, { state: "!=done", item: "trash" }, "the operators travel through the store as written");
});

test("round 2: the same bundle applied twice changes nothing the second time", () => {
  const store = space2();
  const bundle = {
    v: 2, name: "Окно питания",
    tracks: [{ key: "fasts", name: "Окно", kind: "habit", fields: [{ key: "opens", name: "С", type: "time", planned: true }, { key: "energy", name: "Бодрость", type: "scale", planned: true }], items: [{ key: "window", name: "Окно", plan: { opens: "12:00", energy: 3 } }] }, { key: "bought", name: "Где куплено", kind: "follow", follows: "shopping", fields: [{ key: "shop", name: "Магазин", type: "choice", options: ["Рынок", "Онлайн"] }] }],
    screens: [{ key: "fasts", name: "Окно", cards: [{ key: "fasts_marks", title: "Окно", body: [{ el: "marks", of: "fasts", date: "@yesterday" }] }, { key: "fasts_where", title: "Хотелки", body: [{ el: "table", of: "wish", rows: "items", where: { price: ">=1000" }, columns: ["name", "price"], edit: true, search: true }] }] }],
  };
  build(store, bundle);
  const again = checkBundle(bundle, store.state(), ctx);
  assert.equal(again.ok, true, JSON.stringify(again.problems));
  assert.deepEqual(again.ops, []);
});

test("round 2: the range grammar is one function for the catalogue, the validator and the resolver", () => {
  const range = (token) => resolveRange(token, TODAY);
  assert.deepEqual(range("@last45d"), { from: "2026-09-10", to: TODAY });
  assert.deepEqual(range("@last365d"), { from: "2025-10-25", to: TODAY });
  assert.deepEqual(range("@last1d"), { from: TODAY, to: TODAY });
  assert.deepEqual(range("@last52w"), { from: "2025-10-27", to: TODAY }, "52 weeks: from the Monday 51 weeks back");
  assert.deepEqual(range("@last3m"), { from: "2026-08-01", to: TODAY });
  assert.deepEqual(range("@last12m"), { from: "2025-11-01", to: TODAY });
  assert.deepEqual(resolveRange("@all", TODAY, { since: "2026-09-15" }), { from: "2026-09-15", to: TODAY });
  assert.deepEqual(resolveRange("@all", TODAY), { from: TODAY, to: TODAY }, "without a first day, @all is today");
  assert.throws(() => range("@last0d"), /неизвестный период/);
  for (const ok of ["@today", "@yesterday", "@thisWeek", "@thisMonth", "@all", "@last1d", "@last365d", "@last52w", "@last12m", "@last45d", "@last3m"]) assert.equal(rangeProblem(ok), null, ok);
  for (const bad of ["@last0d", "@last366d", "@last53w", "@last13m", "@lastd", "@last7x", "@tomorrow", "last7d", "@ALL", 7, null]) assert.notEqual(rangeProblem(bad), null, String(bad));
  assert.match(rangeProblem("@last366d"), /от 1 до 365 \(дней\)/);
  assert.deepEqual(RANGES.map((r) => r.token), ["@today", "@yesterday", "@lastNd", "@lastNw", "@lastNm", "@thisWeek", "@thisMonth", "@all"]);
  assert.ok(RANGES.every((r) => r.doc && r.examples.every((example) => example === r.token || rangeProblem(example) === null)));
});

test("round 2: the normalizer reads the new words with one meaning", () => {
  const normalized = (body) => normalizeBundle({ v: 2, name: "x", screens: [{ key: "home", cards: [{ key: "c1", title: "t", body }] }] });
  const out = normalized([
    { el: "stat", of: "pantry", fn: "Delta", range: "за всё время", where: "expires<=+7d,left>=1" },
    { el: "bars", of: "pantry", by: "По неделям", range: "last 45 days" },
    { el: "bars", of: "pantry", by: "Shelf", rows: "item", range: "@all" },
    { el: "marks", of: "chores", date: "вчера" },
    { el: "meter", of: "spend", value: "sum", pace: "Remaining", goal: "due" },
    { el: "list", of: "pantry", edit: "yes", search: "да" },
  ]);
  const [stat, byWeek, byShelf, marks, meter, list] = out.bundle.screens[0].cards[0].body;
  assert.deepEqual([stat.fn, stat.range, stat.where], ["delta", "@all", { expires: "<=+7d", left: ">=1" }]);
  assert.deepEqual([byWeek.by, byWeek.range], ["week", "@last45d"]);
  assert.deepEqual([byShelf.by, byShelf.rows], ["shelf", "items"]);
  assert.equal(marks.date, "@yesterday");
  assert.deepEqual([meter.pace, meter.goal], ["left", "due"]);
  assert.deepEqual([list.edit, list.search], [true, true]);
  assert.ok(out.changes.every((c) => /[а-яё]/i.test(c)));
  const follows = normalizeBundle({ v: 2, name: "x", tracks: [{ key: "t1", name: "Т", kind: "Follow", follows: "Покупки" }] });
  assert.equal(follows.bundle.tracks[0].follows, "shopping");
  assert.equal(wherePairs("state!=done,expires<=+7d,date>=-30d,left>1,a=b").date, ">=-30d");
  assert.deepEqual(wherePairs("exercise=bench"), { exercise: "bench" });
  assert.equal(wherePairs("novalue"), null);
  assert.deepEqual(splitCondition("<=+7d"), { op: "<=", value: "+7d" });
  assert.deepEqual(splitCondition("done"), { op: "=", value: "done" });
  assert.deepEqual(splitCondition(5), { op: "=", value: 5 });
});

test("round 2: every attribute and value the catalogue knows has a one-line Russian doc and the manual's example", () => {
  for (const [key, spec] of Object.entries(ELEMENTS)) {
    assert.ok(/[а-яё]/i.test(spec.doc) && !spec.doc.includes("\n"), `${key} doc`);
    for (const [name, attr] of Object.entries(spec.attrs)) {
      assert.ok(/[а-яё]/i.test(attr.doc) && !attr.doc.includes("\n"), `${key}.${name} doc is a Russian line`);
      assert.notEqual(attr.example, undefined, `${key}.${name} has an example`);
    }
  }
  for (const [name, doc] of Object.entries({ ...FNS, ...WHERE_OPS, ...WHERE_KEYS, ...BY_WORDS })) assert.ok(/[а-яё]/i.test(doc) && !doc.includes("\n"), `${name} doc`);
  for (const key of ["edit", "search"]) assert.deepEqual([ELEMENTS.list.attrs[key].type, ELEMENTS.table.attrs[key].type], ["bool", "bool"]);
  assert.deepEqual(ELEMENTS.marks.attrs.date.values, ["@today", "@yesterday"]);
  assert.deepEqual(ELEMENTS.meter.attrs.goal.values, ["due"]);
  assert.deepEqual(Object.keys(FNS), ["sum", "avg", "min", "max", "count", "last", "first", "delta"]);
  assert.deepEqual(Object.keys(FOLLOWS), ["ration", "sport", "shopping"]);
  for (const el of ["stat", "table", "list", "bars"]) assert.deepEqual(ELEMENTS[el].attrs.rows.values, ["items"], el);
  for (const el of ["stat", "meter"]) assert.deepEqual(ELEMENTS[el].attrs.pace.values, ["left"], el);
  for (const type of ["time", "scale"]) assert.ok(FIELD_TYPES[type].attrs.includes("planned"), type);
  assert.deepEqual(SOURCES.ration.values.map((v) => v.key).slice(-2), ["meals", "meals_planned"]);
  assert.deepEqual(SOURCES.sport.values.map((v) => v.key).slice(-2), ["sessions", "sessions_planned"]);
});
