import assert from "node:assert/strict";
import test from "node:test";

import { createThread } from "../mobile-shell/core/assistant-thread.js";
import { memoryStorage, openLocalData } from "../mobile-shell/core/local-data.js";
import { createMockProvider } from "../mobile-shell/services/assistant/ai-provider.js";
import { viewDay } from "../mobile-shell/services/assistant/ai-tools.js";
import { assistantHarness } from "./helpers/assistant-harness.mjs";
import { TODAY, makeState } from "../scripts/ai-lab/fixture.mjs";

const TOMORROW = "2026-10-02";
let sequence = 0;
const call = (name, args) => ({ id: `call_${sequence += 1}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const tools = (...calls) => ({ role: "assistant", content: "", tool_calls: calls });
const say = (content) => ({ role: "assistant", content });

function tomorrow(state, factor = 1) {
  return viewDay(state, TOMORROW).meals.map((meal) => ({
    name: meal.name,
    time: meal.time,
    items: meal.items.map((item) => ({ product: item.product, amount: Math.round(item.amount * factor) })),
  }));
}

function setup(turns, state = makeState()) {
  const data = openLocalData(memoryStorage(state));
  data.load();
  const provider = createMockProvider((request, index) => turns[index] ?? say("Готово."));
  const assistant = assistantHarness({ data, provider, today: () => TODAY });
  const thread = createThread({ page: "ration", mode: "plan" });
  const results = () => thread.messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content));
  return { data, provider, assistant, thread, results, state };
}

test("import: an unknown product comes without КБЖУ for the Заполнитель; the plan waits for them, then applies and undoes", async () => {
  const state = makeState();
  const meals = tomorrow(state);
  meals[0].items.push({ product: "Сыр тофу копчёный", amount: 50, unit: "г" });
  const { data, assistant, thread } = setup([
    tools(call("set_special_day", { date: TOMORROW, meals, import: { source: "текст" } })),
    say("Перенёс план."),
  ], state);
  await assistant.run(thread, "Вот мой план на завтра: ... и сыр тофу копчёный 50 г");
  const [product, day] = thread.proposals;
  assert.equal(product.autoApply, true);
  assert.equal(product.ops[0].product.nutrition, null);
  assert.equal(day.summary, "Импорт: текст, 01.10.2026 · Особый день · 2 окт.");
  assert.equal(day.status, "pending");
  assert.match(day.warnings.join(), /заполнит Заполнитель/);

  assert.equal(assistant.apply([product]).ok, true, "the new product goes to the catalog at once");
  const tofu = data.snapshot().products.find((item) => item.name === "Сыр тофу копчёный");
  assert.ok(data.snapshot().filler.queue.some((entry) => entry.productId === tofu.id), "the Заполнитель takes it");
  const early = assistant.apply([day]);
  assert.equal(early.ok, false);
  assert.match(day.conflict || early.results[0].reason, /нет КБЖУ/);

  data.saveProduct({ id: tofu.id, name: tofu.name, unit: "г", nutrition: { calories: 180, protein: 15, fat: 12, carbs: 2, source: "Справочник" } });
  day.status = "pending";
  const applied = assistant.apply([day]);
  assert.equal(applied.ok, true);
  const set = data.snapshot().journal.at(-1);
  assert.match(set.summary, /Импорт: текст, 01\.10\.2026/);
  assert.equal(data.revertChangeSet(set.id).ok, true, "an import is undone like any change");
  assert.equal(viewDay(data.snapshot(), TOMORROW).source, "обычный план");
});

test("import: a doctor's prescription is moved exactly with warnings, only when the person says so", async () => {
  const state = makeState();
  const low = tomorrow(state, 0.45);
  const prescribed = setup([tools(call("set_special_day", { date: TOMORROW, meals: low, import: { source: "документ", prescription: true, unsure: ["ужин: 100 или 150 г?"] } }))], state);
  await prescribed.assistant.run(prescribed.thread, "Это назначение врача на завтра, перенеси как есть");
  const [proposal] = prescribed.thread.proposals;
  assert.ok(proposal, JSON.stringify(prescribed.results()));
  assert.match(proposal.warnings.join(), /назначение врача не меняю: калорийность \d+ ккал ниже безопасного минимума/);
  assert.deepEqual(proposal.import.unsure, ["ужин: 100 или 150 г?"]);
  assert.equal(prescribed.assistant.apply([proposal]).ok, true, "the Core keeps the prescription as it is");

  const claimed = setup([tools(call("set_special_day", { date: TOMORROW, meals: low, import: { source: "документ", prescription: true } }))], makeState());
  await claimed.assistant.run(claimed.thread, "Перенеси этот план");
  assert.deepEqual(claimed.thread.proposals, []);
  assert.match(claimed.results()[0].error, /только если человек сам сказал/);
});

test("import: a workout plan comes as a schedule with its source", async () => {
  const week = Object.fromEntries(["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((key, index) => [key, index % 2 ? [] : [{ type: "walk", time: "19:00", duration_min: 40, intensity: "low" }]]));
  const { assistant, thread } = setup([tools(call("release_sport_version", { effective_from: "2026-10-05", week, import: { source: "фото" } }))]);
  await assistant.run(thread, "Вот фото плана тренировок от тренера");
  assert.equal(thread.proposals[0].summary, "Импорт: фото, 01.10.2026 · Расписание тренировок с 5 окт.");
});

test("import: an attachment goes to the model as parts and stays in the thread; a foreign URL is dropped", async () => {
  const { assistant, provider, thread } = setup([say("Вижу план.")]);
  const photo = { type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/AAAA" } };
  await assistant.transport.stream("assistant", "run", {
    thread,
    text: "",
    key: "test-key",
    attachment: { kind: "фото", name: "plan.jpg", parts: [photo, { type: "image_url", image_url: { url: "https://example.com/x.png" } }] },
  }).then(({ thread: answered }) => Object.assign(thread, answered));
  const [, person] = provider.requests[0].messages;
  assert.deepEqual(person.content, [{ type: "text", text: "Перенеси план из вложения." }, photo]);
  assert.deepEqual(thread.log[0], { type: "user", text: "Перенеси план из вложения.", attachment: { kind: "фото", name: "plan.jpg" } });
  assert.deepEqual(thread.messages[0].content[1], photo, "the source lives in the thread and its Закладка");
});
