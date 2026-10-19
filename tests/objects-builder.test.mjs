import assert from "node:assert/strict";
import { test } from "node:test";
import { openObjectStore } from "../mobile-shell/objects/core/store.js";
import { buildProposal, spaceOutline, builderPrompt } from "../mobile-shell/objects/core/builder.js";
import { runQuery } from "../mobile-shell/objects/core/query.js";
import { createMockProvider } from "../mobile-shell/services/assistant/ai-provider.js";

const TODAY = "2026-10-19";
const open = () => {
  let n = 0;
  const store = openObjectStore({ storage: null, today: () => TODAY, idFactory: (p) => `${p}_${++n}` });
  store.create("dashboard", { id: "home", name: "Главная", props: { widgets: [] } });
  store.replaceAll({ ...store.state(), meta: { ...store.state().meta, home: "home" } });
  return store;
};

const WATER = {
  reply: "Собрал «Воду»: записи с объёмом, набор за сегодня и виджет с суммой.",
  summary: "Тип «Вода», набор и виджет",
  ops: [
    { op: "defineRelation", key: "water_ml", name: "Выпито, мл", format: "number", unit: "мл", dimension: "volume", min: 0, max: 5000 },
    { op: "defineType", key: "water", name: "Вода", icon: "💧", fact: true, relations: ["at", "water_ml"] },
    { op: "createSet", ref: "water_today", name: "Вода сегодня", source: { type: "water" }, filters: [{ rel: "at", op: "within", value: "@today" }], aggregates: [{ rel: "water_ml", fn: "sum" }], layout: "list", relations: ["at", "water_ml"] },
    { op: "addWidget", title: "Вода сегодня", set: "water_today", display: "number", aggregate: { rel: "water_ml", fn: "sum" }, goal: 2000 },
  ],
};

test("a water tracker request becomes a checked proposal that the person applies", async () => {
  const store = open();
  const provider = createMockProvider(() => JSON.stringify(WATER));
  const result = await buildProposal({ provider, state: store.state(), request: "хочу считать воду", today: TODAY });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.attempts, 1);
  assert.equal(store.state().types.water, undefined, "nothing is written before the person applies");
  const applied = store.apply(result.proposal.ops, { actor: "ai", summary: result.proposal.summary });
  assert.equal(applied.ok, true, applied.reason);
  const s = store.state();
  assert.equal(s.types.water.fact, true);
  assert.equal(s.objects.home.props.widgets.length, 1);
  assert.equal(s.objects.home.props.widgets[0].goal, 2000);
  assert.match(store.create("water", { name: "Стакан", props: { at: `${TODAY}T08:00:00Z`, water_ml: 250 } }, { actor: "ai" }).reason, /записывает только человек/);
  assert.equal(store.create("water", { name: "Стакан", props: { at: `${TODAY}T08:00:00Z`, water_ml: 250 } }).ok, true);
  const setId = s.objects.home.props.widgets[0].setId;
  assert.equal(runQuery(store.state(), store.state().objects[setId].props.query, { today: TODAY }).totals["sum:water_ml"], 250);
  assert.equal(store.revert(applied.changeSetId).ok, true, "the whole proposal is one undo step");
  assert.equal(store.state().types.water, undefined);
});

test("a broken answer is sent back with the problems and repaired", async () => {
  const store = open();
  const bad = { ...WATER, ops: [{ ...WATER.ops[0], format: "litres" }, ...WATER.ops.slice(1)] };
  const provider = createMockProvider((_req, i) => JSON.stringify(i === 0 ? bad : WATER));
  const result = await buildProposal({ provider, state: store.state(), request: "вода", today: TODAY });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.match(provider.requests[1].messages.at(-1).content, /нет формата litres/);
});

test("unsafe proposals are refused by code, not by the prompt", async () => {
  const store = open();
  store.apply({ op: "defineRelation", relation: { key: "meal_kcal", name: "Ккал", format: "number", dimension: "energy", unit: "ккал" } });
  const lowGoal = {
    reply: "", summary: "",
    ops: [
      { op: "defineType", key: "food_log", name: "Еда", fact: true, relations: ["at", "meal_kcal"] },
      { op: "createSet", ref: "f", name: "Еда сегодня", source: { type: "food_log" }, aggregates: [{ rel: "meal_kcal", fn: "sum" }] },
      { op: "addWidget", title: "Лимит", set: "f", display: "number", aggregate: { rel: "meal_kcal", fn: "sum" }, goal: 600 },
    ],
  };
  const dose = { reply: "", summary: "", ops: [{ op: "defineRelation", key: "dose", name: "Доза", format: "formula", unit: "ед", formula: "1 + 1" }] };
  const writesFacts = { reply: "", summary: "", ops: [{ op: "createObject", type: "meal_mark" }] };
  for (const [answer, why] of [[lowGoal, /ниже 1200/], [dose, /единицами лекарств/], [writesFacts, /не умеет «createObject»/]]) {
    const provider = createMockProvider(() => JSON.stringify(answer));
    const result = await buildProposal({ provider, state: store.state(), request: "x", today: TODAY, maxRepairs: 0 });
    assert.equal(result.ok, false);
    assert.match(result.problems.join("; "), why);
  }
});

test("the model sees the structure of the space, never the text of objects", () => {
  const store = open();
  store.create("note", { name: "Секрет: диагноз гипертония", props: { description: "вес 80 кг" } });
  const outline = JSON.stringify(spaceOutline(store.state()));
  assert.doesNotMatch(outline, /гипертония|80 кг/);
  assert.match(builderPrompt(store.state(), TODAY), /"key":"product"/);
});
