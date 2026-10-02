import assert from "node:assert/strict";
import test from "node:test";

import { createMockProvider } from "../mobile-shell/ai-provider.js";
import {
  ASSISTANT_MAX_TURNS,
  ASSISTANT_TOOLS,
  assistantStats,
  createAssistant,
  createThread,
  gateMeals,
  viewDay,
} from "../mobile-shell/ai-tools.js";
import { memoryStorage, openLocalData } from "../mobile-shell/local-data.js";
import { readRationDay } from "../mobile-shell/ration-domain.js";
import { TODAY, makeState } from "../scripts/ai-lab/fixture.mjs";

const TOMORROW = "2026-10-02";
const SATURDAY = "2026-10-03";

let callSequence = 0;
const call = (name, args) => ({ id: `call_${callSequence += 1}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const tools = (...calls) => ({ role: "assistant", content: "", tool_calls: calls });
const say = (content) => ({ role: "assistant", content });

// Each turn is a message or a function of the request (to read tool results).
function setup(turns, { state = makeState() } = {}) {
  const data = openLocalData(memoryStorage(state));
  data.load();
  const provider = createMockProvider((request, index) => {
    const turn = turns[index];
    return typeof turn === "function" ? turn(request) : turn ?? say("Готово.");
  });
  const assistant = createAssistant({
    provider,
    getState: () => data.snapshot(),
    changePlan: (meta, mutator) => data.changePlan(meta, mutator),
    today: () => TODAY,
  });
  return { data, provider, assistant, thread: createThread({ page: "ration", mode: "plan" }) };
}

function modelMeals(state, date, change = (meals) => meals) {
  return change(viewDay(state, date).meals.map((meal) => ({
    name: meal.name,
    time: meal.time,
    items: meal.items.map((item) => ({ product: item.product, amount: item.amount })),
  })));
}

function toolResults(request) {
  return request.messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content));
}

const withoutBeef = (meals) => meals.map((meal) => ({
  ...meal,
  items: meal.items.map((item) => item.product === "Говядина" ? { product: "Куриная грудка", amount: 200 } : item),
}));

test("assistant: every read tool shows a progress line and answers the model", async () => {
  const outputs = [];
  const { assistant, thread } = setup([
    tools(
      call("get_plan", { from: TOMORROW, to: SATURDAY }),
      call("get_profile", {}),
      call("get_catalog", {}),
      call("get_history", { from: "2026-09-28", to: "2026-09-30" }),
      call("get_change_sets", {}),
    ),
    (request) => {
      outputs.push(...toolResults(request));
      return say("Прочитал.");
    },
  ]);
  const events = [];
  const result = await assistant.run(thread, "Что у меня в плане?", { onEvent: (event) => events.push(event) });
  assert.equal(result.ok, true);
  assert.equal(result.reply, "Прочитал.");
  const progress = events.filter((event) => event.type === "progress").map((event) => event.text);
  assert.equal(progress.length, 5);
  assert.match(progress[0], /Читаю план/);
  assert.match(progress[3], /Историю питания за 3 дн/);
  assert.match(progress[4], /журнал/);

  const [plan, profile, catalog, history, journal] = outputs;
  assert.equal(plan.days.length, 2);
  assert.equal(plan.days[0].date, TOMORROW);
  assert.ok(plan.days[0].totals.calories > 2000);
  assert.equal(profile.profile.targetCalories, 2400);
  assert.equal(profile.profile.updatedAt, undefined);
  assert.ok(catalog.products.some((product) => product.name === "Гречка" && product.per100.calories === 313));
  assert.equal(history.days.length, 3);
  assert.equal(history.days[0].meals[0].state, "не отмечено");
  assert.ok(Array.isArray(journal.changeSets));
  assert.deepEqual(thread.log.map((entry) => entry.type), ["user", "progress", "progress", "progress", "progress", "progress", "assistant"]);
});

test("assistant: the context always carries page, mode, profile and 28-day aggregates", async () => {
  const { assistant, thread, provider } = setup([say("Привет")]);
  await assistant.run(thread, "Привет", { page: "ration", mode: "plan" });
  const system = provider.requests[0].messages[0].content;
  assert.match(system, /«Рацион · План»/);
  assert.match(system, /Сегодня 2026-10-01/);
  const context = JSON.parse(system.slice(system.indexOf("Контекст: ") + "Контекст: ".length));
  assert.equal(context.page, "Рацион");
  assert.equal(context.mode, "План");
  assert.equal(context.profile.targetCalories, 2400);
  assert.equal(context.stats28.days, 28);
  assert.ok(context.stats28.ration.averagePlannedPerDay.calories > 0);
  assert.deepEqual(provider.requests[0].tools, ASSISTANT_TOOLS);
});

test("assistant: a proposal is a card and changes nothing until applied", async () => {
  const state = makeState();
  const { assistant, thread, data } = setup([
    tools(call("set_special_day", { date: TOMORROW, meals: modelMeals(state, TOMORROW, withoutBeef) })),
    say("Предлагаю курицу вместо говядины."),
  ], { state });
  const before = data.snapshot();
  const events = [];
  const result = await assistant.run(thread, "Завтра без говядины", { onEvent: (event) => events.push(event) });
  assert.equal(result.ok, true);
  assert.equal(data.snapshot(), before, "a proposal never writes");

  const [proposal] = thread.proposals;
  assert.equal(thread.proposals.length, 1);
  assert.equal(proposal.kind, "special_day");
  assert.equal(proposal.status, "pending");
  assert.deepEqual(proposal.dates, [TOMORROW]);
  assert.equal(proposal.preview.days.length, 1);
  assert.ok(proposal.preview.days[0].delta.calories < 0, "было/стало carries the КБЖУ delta");
  assert.ok(proposal.preview.days[0].before.some((meal) => meal.items.some((item) => item.product === "Говядина")));
  assert.ok(proposal.preview.days[0].after.every((meal) => meal.items.every((item) => item.product !== "Говядина")));
  assert.ok(events.some((event) => event.type === "proposal" && event.proposal.id === proposal.id));
  assert.equal(JSON.parse(JSON.stringify(proposal)).id, proposal.id, "a proposal is serializable");
});

test("assistant: a failed gate goes back to the model, which fixes the plan", async () => {
  const state = makeState();
  let gateOutput = null;
  const { assistant, thread } = setup([
    tools(call("set_special_day", { date: TOMORROW, meals: [{ name: "Завтрак", time: "08:00", items: [{ product: "Яблоко", amount: 150 }] }] })),
    (request) => {
      gateOutput = toolResults(request).at(-1);
      return tools(call("set_special_day", { date: TOMORROW, meals: modelMeals(state, TOMORROW, withoutBeef) }));
    },
    say("Исправил."),
  ], { state });
  const result = await assistant.run(thread, "Сделай завтра только яблоко");
  assert.equal(result.ok, true);
  assert.equal(gateOutput.ok, false);
  assert.ok(gateOutput.gate.some((problem) => /ниже безопасного минимума 1200/.test(problem)));
  assert.ok(gateOutput.gate.some((problem) => /белок/.test(problem)));
  assert.ok(gateOutput.hint);
  assert.equal(thread.proposals.length, 1, "only the fixed plan becomes a card");
});

test("assistant: the gate rejects excluded products and products without КБЖУ", () => {
  const state = makeState();
  state.ration.profile.excludedProducts = ["свинина"];
  state.products.push({ id: "product_mystery", name: "Загадка", unit: "г" });
  const meals = [{ id: "m", name: "Обед", time: "13:00", items: [
    { id: "i1", productId: "product_pork", name: "Свинина", portionSize: 300 },
    { id: "i2", productId: "product_mystery", name: "Загадка", portionSize: 100 },
  ] }];
  const gate = gateMeals(state, meals);
  assert.equal(gate.ok, false);
  assert.ok(gate.problems.some((problem) => /исключённый продукт «Свинина»/.test(problem)));
  assert.ok(gate.problems.some((problem) => /«Загадка» нет КБЖУ/.test(problem)));
});

test("assistant: the past and История питания are refused", async () => {
  const state = makeState();
  let outputs = [];
  const { assistant, thread, data } = setup([
    tools(
      call("set_special_day", { date: "2026-09-30", meals: modelMeals(state, "2026-09-30") }),
      call("release_version", { effective_from: "2026-09-29", week: {} }),
      call("mark_meal", { date: "2026-09-30", state: "eaten" }),
      call("get_history", { from: TODAY, to: TOMORROW }),
    ),
    (request) => {
      outputs = toolResults(request);
      return say("Прошлое менять нельзя, отметьте в Учёте.");
    },
  ], { state });
  const before = data.snapshot();
  await assistant.run(thread, "Вчера я съел пиццу, поправь план");
  assert.equal(thread.proposals.length, 0);
  assert.equal(data.snapshot(), before);
  assert.match(outputs[0].error, /Прошедшие дни менять нельзя/);
  assert.match(outputs[1].error, /сегодня или позже/);
  assert.match(outputs[2].error, /Историю питания ассистент не меняет/);
  assert.match(outputs[3].error, /только у прошедших дней/);
});

test("assistant: today may change through a proposal and keeps today's marks", async () => {
  const state = makeState();
  const { assistant, thread, data } = setup([
    tools(call("set_special_day", { date: TODAY, meals: modelMeals(state, TODAY, (meals) => meals.map((meal) =>
      meal.name === "Ужин" ? { ...meal, items: [{ product: "Лосось", amount: 200 }, { product: "Рис", amount: 80 }, { product: "Овощной салат", amount: 150 }] } : meal)) })),
    say("Ок."),
  ], { state });
  const breakfast = readRationDay(data.snapshot(), TODAY).meals.find((meal) => meal.name === "Завтрак");
  await assistant.run(thread, "Сегодня на ужин рыбу");
  const [proposal] = thread.proposals;
  assert.equal(proposal.status, "pending");
  assert.equal(assistant.apply([proposal]).ok, true);
  const after = readRationDay(data.snapshot(), TODAY);
  assert.equal(after.source, "special");
  assert.equal(after.meals.find((meal) => meal.name === "Завтрак").id, breakfast.id, "meal ids survive, so marks stay");
});

test("assistant: «Применить все» writes one journal set; one by one writes one set each", async () => {
  const state = makeState();
  const turns = () => [
    tools(
      call("set_special_day", { date: TOMORROW, meals: modelMeals(state, TOMORROW, withoutBeef) }),
      call("set_special_day", { date: SATURDAY, meals: modelMeals(state, SATURDAY, (meals) => meals.map((meal) =>
        meal.name === "Обед" ? { ...meal, items: meal.items.map((item) => item.product === "Гречка" ? { product: "Рис", amount: 100 } : item) } : meal)) }),
    ),
    say("Два дня."),
  ];
  const together = setup(turns(), { state });
  await together.assistant.run(together.thread, "Два дня");
  assert.equal(together.thread.proposals.length, 2);
  const applied = together.assistant.apply(together.thread.proposals, { together: true });
  assert.equal(applied.ok, true);
  const journal = together.data.snapshot().journal;
  assert.equal(journal.length, 1);
  assert.equal(journal[0].actor, "ai");
  assert.equal(Object.keys(journal[0].after).length, 2);
  assert.ok(together.thread.proposals.every((proposal) => proposal.status === "applied" && proposal.changeSetId === journal[0].id));
  assert.equal(readRationDay(together.data.snapshot(), TOMORROW).source, "special");

  const single = setup(turns(), { state: makeState() });
  await single.assistant.run(single.thread, "Два дня");
  single.assistant.apply(single.thread.proposals, { together: false });
  assert.equal(single.data.snapshot().journal.length, 2);

  // Undo of an applied card reverts its set.
  assert.equal(together.data.revertChangeSet(journal[0].id).ok, true);
  assert.equal(readRationDay(together.data.snapshot(), TOMORROW).source, "cycle");
});

test("assistant: a proposal made stale by a human edit gets a conflict on apply", async () => {
  const state = makeState();
  const { assistant, thread, data } = setup([
    tools(call("set_special_day", { date: TOMORROW, meals: modelMeals(state, TOMORROW, withoutBeef) })),
    say("Ок."),
  ], { state });
  await assistant.run(thread, "Завтра без говядины");
  const meal = readRationDay(data.snapshot(), TOMORROW).meals[0];
  assert.equal(data.updateRationMeal(TOMORROW, meal.id, { name: "Ранний завтрак" }).ok, true);
  const journalBefore = data.snapshot().journal.length;

  const result = assistant.apply(thread.proposals);
  assert.equal(result.ok, false);
  assert.equal(thread.proposals[0].status, "conflict");
  assert.match(thread.proposals[0].conflict, /устарело/);
  assert.equal(data.snapshot().journal.length, journalBefore);
  assert.equal(readRationDay(data.snapshot(), TOMORROW).meals[0].name, "Ранний завтрак");
});

test("assistant: a new product, then a day that uses it; the day alone cannot apply", async () => {
  const state = makeState();
  const { assistant, thread, data } = setup([
    tools(call("upsert_product", { name: "Киноа", unit: "г", calories: 368, protein: 14, fat: 6, carbs: 64, fiber: 7 })),
    () => tools(call("set_special_day", { date: TOMORROW, meals: modelMeals(state, TOMORROW, (meals) => meals.map((meal) =>
      meal.name === "Обед" ? { ...meal, items: meal.items.map((item) => item.product === "Рис" ? { product: "Киноа", amount: 100 } : item) } : meal)) })),
    say("Добавил киноа."),
  ], { state });
  await assistant.run(thread, "Хочу киноа завтра в обед");
  const [product, day] = thread.proposals;
  assert.equal(product.kind, "product");
  assert.equal(product.preview.after.calories, 368);
  assert.equal(day.kind, "special_day");
  assert.equal(data.snapshot().products.some((value) => value.name === "Киноа"), false);

  assert.equal(assistant.apply([day]).ok, false);
  assert.match(day.conflict, /Киноа/);
  const both = assistant.apply([product, day]);
  assert.equal(both.ok, true);
  const created = data.snapshot().products.find((value) => value.name === "Киноа");
  assert.equal(created.nutrition.calories, 368);
  const [set] = data.snapshot().journal;
  assert.ok(Object.keys(set.after).includes(`catalog:product:${created.id}`));
});

test("assistant: a revert of a manual change is proposed and applied through the journal", async () => {
  const state = makeState();
  const { assistant, thread, data } = setup([], { state });
  const added = data.addRationMeal(TOMORROW);
  const turns = [tools(call("revert_change_set", { id: added.changeSetId })), say("Откатываю.")];
  const provider = createMockProvider((request, index) => turns[index]);
  const reverting = createAssistant({ provider, getState: () => data.snapshot(), changePlan: data.changePlan, today: () => TODAY });
  await reverting.run(thread, "Верни как было");
  const [proposal] = thread.proposals;
  assert.equal(proposal.kind, "revert");
  assert.match(proposal.summary, /^Откат: Добавлен приём пищи/);
  assert.equal(reverting.apply([proposal]).ok, true);
  assert.equal(readRationDay(data.snapshot(), TOMORROW).source, "cycle");
  assert.equal(data.snapshot().journal.length, 2);
  assert.equal(assistant.apply([proposal]).ok, false, "an applied proposal is not applied twice");
});

test("assistant: the loop stops after eight turns", async () => {
  const { assistant, thread, provider } = setup(Array.from({ length: 20 }, () => tools(call("get_profile", {}))));
  const result = await assistant.run(thread, "Думай");
  assert.equal(result.ok, false);
  assert.equal(provider.requests.length, ASSISTANT_MAX_TURNS);
  assert.match(thread.log.at(-1).text, /Не успел/);
});

test("assistant: a provider failure is shown as an error line", async () => {
  const { assistant, thread } = setup([]);
  const failing = createAssistant({
    provider: createMockProvider(() => "x", { hasKey: false }),
    getState: () => makeState(),
    changePlan: () => ({ ok: false }),
    today: () => TODAY,
  });
  const result = await failing.run(thread, "Привет");
  assert.equal(result.ok, false);
  assert.equal(thread.log.at(-1).type, "error");
  assert.match(thread.log.at(-1).text, /Ключ ИИ не задан/);
  assert.ok(assistant);
});

test("assistant: aggregates count marks, discrepancies and spend for 28 days", () => {
  const state = makeState();
  state.requests = [{
    id: "request_1",
    createdAt: "2026-09-20T10:00:00.000Z",
    status: "done",
    items: [{ productId: "product_rice", quantity: 1 }],
    responses: [{ id: "response_1", requestId: "request_1", createdAt: "2026-09-25T10:00:00.000Z", items: [{ productId: "product_rice", quantity: 1, price: 120.5 }] }],
  }, {
    id: "request_old",
    createdAt: "2026-08-01T10:00:00.000Z",
    status: "done",
    items: [{ productId: "product_rice", quantity: 1 }],
    responses: [{ id: "response_old", requestId: "request_old", createdAt: "2026-08-01T10:00:00.000Z", items: [{ productId: "product_rice", quantity: 1, price: 999 }] }],
  }];
  const data = openLocalData(memoryStorage(state));
  data.load();
  const [breakfast, lunch] = readRationDay(data.snapshot(), "2026-09-30").meals;
  assert.equal(data.markRationMeal("2026-09-30", breakfast.id, "eaten").ok, true);
  assert.equal(data.recordRationDiscrepancy("2026-09-30", lunch.id, { kind: "excluded", productId: "product_buckwheat", name: "Гречка" }).ok, true);

  const stats = assistantStats(data.snapshot(), TODAY);
  assert.equal(stats.days, 28);
  assert.equal(stats.ration.meals.planned, 12, "the plan starts on 2026-09-28: three days of four meals");
  assert.equal(stats.ration.meals.eaten, 1);
  assert.equal(stats.ration.meals.changed, 1);
  assert.equal(stats.ration.adherence, 8);
  assert.deepEqual(stats.ration.frequentDiscrepancies, [{ kind: "excluded", product: "Гречка", count: 1 }]);
  assert.equal(stats.ration.target.calories, 2400);
  assert.ok(stats.ration.averagePlannedPerDay.calories > 2000);
  assert.deepEqual(stats.spend, { receipts: 1, total: 120.5, currency: "RUB" });
});
