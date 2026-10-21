import assert from "node:assert/strict";
import { test } from "node:test";
import { openObjectStore } from "../mobile-shell/objects/core/store.js";
import { valueOf, formulaError } from "../mobile-shell/objects/core/values.js";
import { runQuery, runSeries } from "../mobile-shell/objects/core/query.js";

const TODAY = "2026-10-19";
const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), map };
};
const open = (storage = memoryStorage()) => {
  let n = 0;
  return openObjectStore({ storage, clock: () => new Date("2026-10-19T09:00:00Z"), today: () => TODAY, idFactory: (p) => `${p}_${++n}` });
};
const ctx = { today: TODAY };

function seedFood(store) {
  const r = store.apply([
    { op: "create", type: "product", id: "oats", name: "Овсянка", props: { unit: "г", kcal100: 366, protein100: 12, fat100: 6, carbs100: 60 } },
    { op: "create", type: "product", id: "milk", name: "Молоко", props: { unit: "мл", kcal100: 52, protein100: 2.8, fat100: 2.5, carbs100: 4.7 } },
    { op: "create", type: "product", id: "egg", name: "Яйцо", props: { unit: "шт.", kcal100: 157, protein100: 12.7, fat100: 11.5, carbs100: 0.7 } },
    { op: "create", type: "portion", id: "p1", name: "Овсянка", props: { product: "oats", amount: 80, unit: "г" } },
    { op: "create", type: "portion", id: "p2", name: "Молоко", props: { product: "milk", amount: 250, unit: "мл" } },
    { op: "create", type: "portion", id: "p3", name: "Яйцо", props: { product: "egg", amount: 2, unit: "шт." } },
    { op: "create", type: "meal", id: "breakfast", name: "Завтрак", props: { time: "08:00", items: ["p1", "p2", "p3"] } },
    { op: "create", type: "day_plan", id: "day", name: "Понедельник", props: { area: "ration", meals: ["breakfast"] } },
  ]);
  assert.equal(r.ok, true, r.reason);
}

test("КБЖУ flows from products through portions to the meal and the day", () => {
  const store = open();
  seedFood(store);
  const s = store.state();
  assert.equal(valueOf(s, "p1", "kcal", ctx), 292.8);
  assert.equal(valueOf(s, "p2", "kcal", ctx), 130);
  assert.equal(valueOf(s, "p3", "kcal", ctx), null, "a piece without weight is not counted, like today's Рацион");
  assert.equal(valueOf(s, "breakfast", "kcal", ctx), 422.8);
  assert.equal(valueOf(s, "day", "protein", ctx), 16.6);
});

test("a piece weight on the product makes pieces count", () => {
  const store = open();
  seedFood(store);
  assert.equal(store.update("egg", { props: { pieceWeight: 55 } }).ok, true);
  assert.equal(valueOf(store.state(), "p3", "kcal", ctx), 172.7);
});

test("the assistant cannot write facts or guarded targets", () => {
  const store = open();
  seedFood(store);
  const mark = { op: "create", type: "meal_mark", name: "Завтрак", props: { date: TODAY, meal: "breakfast", slot: "breakfast", mealState: "eaten" } };
  const byAi = store.apply(mark, { actor: "ai" });
  assert.equal(byAi.ok, false);
  assert.match(byAi.reason, /записывает только человек/);
  assert.equal(store.apply(mark, { actor: "human" }).ok, true);
  assert.equal(store.create("profile", { name: "Профиль", props: { targetCalories: 2000 } }).ok, true);
  const profileId = Object.values(store.state().objects).find((o) => o.type === "profile").id;
  const lower = store.update(profileId, { props: { targetCalories: 1800 } }, { actor: "ai" });
  assert.equal(lower.ok, false);
  assert.match(lower.reason, /меняет только человек/);
});

test("values are checked against relations: unknown, computed, wrong type and range", () => {
  const store = open();
  seedFood(store);
  assert.match(store.update("p1", { props: { calories: 5 } }).reason, /нет связи «calories»/);
  assert.match(store.update("p1", { props: { kcal: 5 } }).reason, /считается сама/);
  assert.match(store.update("p1", { props: { product: "breakfast" } }).reason, /нужен объект типа Продукт/);
  assert.match(store.create("profile", { name: "П", props: { targetCalories: -5 } }).reason, /не меньше 0/);
  assert.match(store.update("p1", { props: { unit: "ведро" } }).reason, /нет варианта/);
  assert.equal(store.state().objects.p1.props.amount, 80, "a rejected batch writes nothing");
});

test("plan changes are journaled and can be reverted; facts are not journaled", () => {
  const store = open();
  seedFood(store);
  const edit = store.update("breakfast", { props: { time: "09:30" } });
  assert.ok(edit.changeSetId);
  const mark = store.create("meal_mark", { name: "Завтрак", props: { date: TODAY, meal: "breakfast", slot: "breakfast", mealState: "eaten" } });
  assert.equal(mark.changeSetId, null);
  assert.equal(store.revert(edit.changeSetId).ok, true);
  assert.equal(store.state().objects.breakfast.props.time, "08:00");
  const again = store.update("breakfast", { props: { time: "10:00" } });
  store.update("breakfast", { props: { time: "11:00" } });
  assert.match(store.revert(again.changeSetId).reason, /поменяли ещё раз/);
});

test("a revert undoes the whole batch, facts included, and never leaves a fact pointing at nothing", () => {
  const store = open();
  seedFood(store);
  const request = store.apply([
    { op: "create", type: "request", id: "req", name: "Магазин", props: { status: "open", items: ["ri"] } },
    { op: "create", type: "request_item", id: "ri", name: "Овсянка", props: { request: "req", product: "oats", quantity: 1, unit: "шт." } },
  ]);
  assert.equal(request.ok, true, request.reason);
  const bought = store.apply([
    { op: "create", type: "purchase", id: "buy", name: "Овсянка", props: { date: TODAY, request: "req", item: "ri", product: "oats", quantity: 1, price: 90 } },
    { op: "update", id: "req", props: { status: "done" } },
  ]);
  assert.ok(bought.changeSetId, "closing the request is journaled");
  assert.equal(store.revert(bought.changeSetId).ok, true);
  assert.equal(store.state().objects.req.props.status, "open");
  assert.equal(store.state().objects.buy, undefined, "the purchase of the same batch goes with it");

  store.create("purchase", { id: "buy2", name: "Овсянка", props: { date: TODAY, request: "req", item: "ri", product: "oats", quantity: 1, price: 95 } });
  const refused = store.revert(request.changeSetId);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /ссылается «Овсянка», откатить нельзя/);
  assert.ok(store.state().objects.req, "the request stays");
});

test("a person-made tracker: relation, fact type, entries, set totals and a daily series", () => {
  const store = open();
  const schema = store.apply([
    { op: "defineRelation", relation: { key: "water_ml", name: "Выпито, мл", format: "number", dimension: "volume", unit: "мл", min: 0, max: 5000 } },
    { op: "defineType", type: { key: "water", name: "Вода", icon: "💧", layout: "entry", fact: true, relations: ["at", "water_ml"] } },
  ]);
  assert.equal(schema.ok, true, schema.reason);
  for (const [at, ml] of [["2026-10-19T08:00:00Z", 250], ["2026-10-19T12:00:00Z", 500], ["2026-10-18T09:00:00Z", 750]]) {
    assert.equal(store.create("water", { name: "Стакан", props: { at, water_ml: ml } }).ok, true);
  }
  assert.match(store.create("water", { name: "x", props: { water_ml: 250 } }, { actor: "ai" }).reason, /записывает только человек/);
  const s = store.state();
  const today = runQuery(s, { source: { type: "water" }, filters: [{ rel: "at", op: "within", value: "@today" }], aggregates: [{ rel: "water_ml", fn: "sum" }] }, ctx);
  assert.equal(today.rows.length, 2);
  assert.equal(today.totals["sum:water_ml"], 750);
  const series = runSeries(s, { source: { type: "water" } }, { dateRel: "at", valueRel: "water_ml", range: "@last7d" }, ctx);
  assert.equal(series.length, 7);
  assert.deepEqual(series.slice(-2), [{ date: "2026-10-18", value: 750 }, { date: "2026-10-19", value: 750 }]);
  assert.equal(series[0].value, null);
});

test("shopping: bought quantity and spend come from purchases by backlinks", () => {
  const store = open();
  seedFood(store);
  const r = store.apply([
    { op: "create", type: "request", id: "req", name: "Неделя", props: { status: "open" } },
    { op: "create", type: "request_item", id: "ri1", name: "Овсянка", props: { request: "req", product: "oats", quantity: 2, unit: "шт." } },
    { op: "create", type: "request_item", id: "ri2", name: "Молоко", props: { request: "req", product: "milk", quantity: 1, unit: "шт." } },
    { op: "update", id: "req", props: { items: ["ri1", "ri2"] } },
    { op: "create", type: "purchase", name: "Овсянка", props: { date: TODAY, request: "req", item: "ri1", product: "oats", quantity: 2, price: 180 } },
    { op: "create", type: "purchase", name: "Молоко", props: { date: TODAY, request: "req", item: "ri2", product: "milk", quantity: 0.5, price: 45 } },
  ]);
  assert.equal(r.ok, true, r.reason);
  const s = store.state();
  assert.equal(valueOf(s, "ri1", "isBought", ctx), true);
  assert.equal(valueOf(s, "ri2", "isBought", ctx), false);
  assert.equal(valueOf(s, "req", "total", ctx), 225);
  assert.equal(valueOf(s, "req", "progress", ctx), "1 из 2");
  assert.equal(valueOf(s, "oats", "lastPrice", ctx), 180);
});

test("formulas are checked when defined and fail safely when run", () => {
  const store = open();
  assert.match(store.apply({ op: "defineRelation", relation: { key: "bad", name: "Плохо", format: "formula", formula: "eval(1)" } }).reason, /нет функции eval/);
  assert.match(store.apply({ op: "defineRelation", relation: { key: "long", name: "Длинно", format: "formula", formula: "1+".repeat(300) + "1" } }).reason, /длиннее/);
  assert.match(store.apply({ op: "defineRelation", relation: { key: "ghost", name: "Призрак", format: "formula", formula: "nope * 2" } }).reason, /неизвестную связь «nope»/);
  assert.equal(store.apply([
    { op: "defineRelation", relation: { key: "loop", name: "Петля", format: "formula", formula: "loop + 1" } },
    { op: "defineType", type: { key: "loopy", name: "Петли", relations: ["loop"] } },
    { op: "create", type: "loopy", id: "x", name: "x" },
  ]).ok, true);
  assert.equal(valueOf(store.state(), "x", "loop", ctx), null);
  assert.match(formulaError(store.state(), "x", "loop", ctx), /сама на себя/);
});

test("the space survives a reload with person-made types and objects", () => {
  const storage = memoryStorage();
  const store = open(storage);
  store.apply([
    { op: "defineRelation", relation: { key: "mood", name: "Настроение", format: "select", options: [{ id: "good", name: "хорошо" }, { id: "bad", name: "плохо" }] } },
    { op: "defineType", type: { key: "diary", name: "Дневник", relations: ["date", "mood"], fact: true } },
    { op: "create", type: "diary", id: "d1", name: "Понедельник", props: { date: TODAY, mood: "good" } },
  ]);
  const again = open(storage);
  assert.equal(again.state().types.diary.name, "Дневник");
  assert.equal(again.state().objects.d1.props.mood, "good");
  assert.equal(again.state().types.product.system, true, "built-in types come from code, not from storage");
});
