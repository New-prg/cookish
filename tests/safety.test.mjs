import assert from "node:assert/strict";
import test from "node:test";

import { createThread } from "../mobile-shell/core/assistant-thread.js";
import { memoryStorage, openLocalData } from "../mobile-shell/core/local-data.js";
import { baseEnergy, disorderSigns, isMinor } from "../mobile-shell/core/safety.js";
import { createMockProvider } from "../mobile-shell/services/assistant/ai-provider.js";
import { viewDay } from "../mobile-shell/services/assistant/ai-tools.js";
import { assistantHarness } from "./helpers/assistant-harness.mjs";
import { TODAY, makeState } from "../scripts/ai-lab/fixture.mjs";

const TOMORROW = "2026-10-02";
const WEEK = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
let sequence = 0;
const call = (name, args) => ({ id: `call_${sequence += 1}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const tools = (...calls) => ({ role: "assistant", content: "", tool_calls: calls });
const say = (content) => ({ role: "assistant", content });

// The fixture day of tomorrow as the model writes it, every portion times `factor`.
function scaledDay(state, factor) {
  return viewDay(state, TOMORROW).meals.map((meal) => ({
    name: meal.name,
    time: meal.time,
    items: meal.items.map((item) => ({ product: item.product, amount: Math.round(item.amount * factor) })),
  }));
}

function person(profile) {
  const state = makeState();
  state.ration.profile = { ...state.ration.profile, targetProtein: null, targetFat: null, targetCarbs: null, ...profile };
  return state;
}

async function ask(state, turns, text = "Помоги с планом") {
  const data = openLocalData(memoryStorage(state));
  data.load();
  const provider = createMockProvider((request, index) => turns[index] ?? say("Готово."));
  const assistant = assistantHarness({ data, provider, today: () => TODAY });
  const thread = createThread({ page: "ration", mode: "plan" });
  await assistant.run(thread, text);
  return { thread, provider, results: thread.messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content)) };
}

const week = (state, factor) => Object.fromEntries(WEEK.map((key) => [key, scaledDay(state, factor)]));

test("safety: the energy of a day without workouts, none for a minor or without the numbers", () => {
  assert.equal(Math.round(baseEnergy({ ageGroup: "Взрослый", weightKg: 80, heightCm: 180 })), 2174);
  assert.equal(baseEnergy({ ageGroup: "Подросток", weightKg: 60, heightCm: 170 }), null);
  assert.equal(baseEnergy({ ageGroup: "Взрослый", heightCm: 180 }), null);
  assert.equal(isMinor({ ageGroup: "Ребёнок" }), true);
  assert.equal(isMinor({ ageGroup: "adult" }), false);
});

test("safety: a week of safe days that loses more than 1% of weight is refused", async () => {
  const state = person({ weightKg: 110, heightCm: 185, targetCalories: 1500 });
  const { thread, results } = await ask(state, [tools(call("release_version", { effective_from: TOMORROW, week: week(state, 1300 / 2310) }))], "Похудеть побыстрее");
  assert.deepEqual(thread.proposals, []);
  assert.ok(results[0].gate.some((problem) => /неделя 2026-10-02–2026-10-08:.*больше 1% веса/.test(problem)), JSON.stringify(results[0].gate));
  assert.equal(results[0].gate.some((problem) => /ниже безопасного минимума|отличается от цели/.test(problem)), false, "every day passes the day gate");
});

test("safety: an ordinary week passes", async () => {
  const state = person({ weightKg: 60, heightCm: 165, targetCalories: 1600 });
  const { thread } = await ask(state, [tools(call("release_version", { effective_from: TOMORROW, week: week(state, 1500 / 2310) }))]);
  assert.equal(thread.proposals.length, 1);
});

test("safety: workouts without food count in the week; three hard days in a row get a warning", async () => {
  const run = (minutes) => [{ type: "run", time: "18:00", duration_min: minutes, intensity: "high" }];
  const daily = Object.fromEntries(WEEK.map((key) => [key, run(90)]));
  const heavy = await ask(person({}), [tools(call("release_sport_version", { effective_from: TOMORROW, week: daily }))], "Каждый день по полтора часа бега, рацион не трогай");
  assert.deepEqual(heavy.thread.proposals, []);
  assert.ok(heavy.results[0].gate.some((problem) => /тренировки \d+ ккал.*больше 1% веса/.test(problem)), JSON.stringify(heavy.results[0].gate));

  const three = Object.fromEntries(WEEK.map((key, index) => [key, index < 3 ? run(20) : []]));
  const light = await ask(person({}), [tools(call("release_sport_version", { effective_from: "2026-10-05", week: three }))]);
  const [proposal] = light.thread.proposals;
  assert.ok(proposal, "a short hard run is fine for the balance");
  assert.match(proposal.warnings[0], /высокая интенсивность 3 дня подряд/);
  assert.match(light.results[0].hint, /предупреждени/);
});

test("safety: words of an eating disorder stop every cut, but not more food", async () => {
  const state = person({});
  const words = "Хочу есть ещё меньше, вообще ничего не есть";
  const cut = await ask(state, [tools(call("set_special_day", { date: TOMORROW, meals: scaledDay(state, 0.7) }))], words);
  assert.deepEqual(cut.thread.proposals, []);
  assert.match(cut.results[0].error, /Снижать калории или добавлять нагрузку сейчас нельзя: слова человека/);
  assert.match(cut.provider.requests[0].messages[0].content, /ВНИМАНИЕ: слова человека[\s\S]*расстройствам пищевого поведения/);

  const more = await ask(state, [tools(call("set_special_day", { date: TOMORROW, meals: scaledDay(state, 1.05) }))], words);
  assert.equal(more.thread.proposals.length, 1, "more food is always welcome");
});

test("safety: a minor in Profile and frequent «не съедено» in Учёт protect the same way", async () => {
  const minor = person({ ageGroup: "Подросток" });
  const teen = await ask(minor, [tools(call("set_special_day", { date: TOMORROW, meals: scaledDay(minor, 0.8) }))], "Хочу похудеть к лету");
  assert.match(teen.results[0].error, /несовершеннолетний в профиле/);
  assert.match(teen.provider.requests[0].messages[0].content, /рассчитано на совершеннолетнего/);

  const skipping = person({});
  for (let back = 1; back <= 4; back += 1) {
    const date = `2026-09-${String(31 - back).padStart(2, "0")}`;
    skipping.ration.history[`local|${date}`] = { date, owner: "local", meals: { meal_a: { state: "skipped" }, meal_b: { state: back === 1 ? "eaten" : "skipped" } } };
  }
  assert.deepEqual(disorderSigns(skipping, [], TODAY), ["частые «не съедено» в Учёте"]);
  assert.deepEqual(disorderSigns(person({}), ["Сделай завтра без мяса"], TODAY), []);
});
