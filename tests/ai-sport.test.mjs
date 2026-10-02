import assert from "node:assert/strict";
import test from "node:test";

import { createMockProvider } from "../mobile-shell/ai-provider.js";
import { assistantStats, createAssistant, createThread, viewDay } from "../mobile-shell/ai-tools.js";
import { memoryStorage, openLocalData, todayDateKey } from "../mobile-shell/local-data.js";
import { readRationDay } from "../mobile-shell/ration-domain.js";
import { readSportDay } from "../mobile-shell/sport-domain.js";
import { TODAY, makeState } from "../scripts/ai-lab/fixture.mjs";

const TOMORROW = "2026-10-02";
let sequence = 0;
const call = (name, args) => ({ id: `call_${sequence += 1}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const tools = (...calls) => ({ role: "assistant", content: "", tool_calls: calls });
const say = (content) => ({ role: "assistant", content });

// The lab fixture plus a training plan: strength on Monday, Wednesday and Friday.
function sportState() {
  const state = makeState();
  const strength = (id) => ({ id, type: "strength", time: "19:00", durationMin: 60, intensity: "medium", note: "", exercises: [] });
  state.sport = {
    versions: [{
      id: "sport_version_1",
      owner: "local",
      effectiveFrom: "2026-09-28",
      createdAt: "2026-09-01T00:00:00.000Z",
      cycle: { anchor: "2026-09-28", weekdayBinding: true, days: [
        { id: "mon", sessions: [strength("s_mon")] }, { id: "tue", sessions: [] }, { id: "wed", sessions: [strength("s_wed")] },
        { id: "thu", sessions: [] }, { id: "fri", sessions: [strength("s_fri")] }, { id: "sat", sessions: [] }, { id: "sun", sessions: [] },
      ] },
    }],
    specialDays: {},
    log: {},
  };
  return state;
}

function setup(turns, state = sportState()) {
  const data = openLocalData(memoryStorage(state));
  data.load();
  const provider = createMockProvider((request, index) => {
    const turn = turns[index];
    return typeof turn === "function" ? turn(request) : turn ?? say("Готово.");
  });
  const assistant = createAssistant({ provider, getState: () => data.snapshot(), changePlan: data.changePlan, today: () => TODAY });
  return { data, provider, assistant, thread: createThread({ page: "sport", mode: "plan" }) };
}

const toolResults = (request) => request.messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content));

test("sport assistant: reads the plan and the log with progress lines", async () => {
  let outputs = [];
  const { assistant, thread } = setup([
    tools(call("get_sport_plan", { from: TOMORROW, to: "2026-10-04" }), call("get_sport_log", { from: "2026-09-28", to: "2026-09-30" })),
    (request) => {
      outputs = toolResults(request);
      return say("Прочитал.");
    },
  ]);
  const events = [];
  await assistant.run(thread, "Что с тренировками?", { onEvent: (event) => events.push(event) });
  const [plan, log] = outputs;
  assert.equal(plan.days.length, 3);
  assert.equal(plan.days[0].sessions[0].type, "Силовая");
  assert.equal(plan.days[0].planned_kcal, 400, "MET 5 × 80 kg × 1 h");
  assert.equal(log.days.length, 3);
  assert.equal(log.days[0].sessions[0].state, "не отмечено");
  assert.deepEqual(events.filter((event) => event.type === "progress").map((event) => event.text.split(" ").slice(0, 3).join(" ")), ["Читаю план тренировок", "Смотрю Учёт тренировок"]);
});

test("sport assistant: Особый день and a new schedule are proposals that write nothing until applied", async () => {
  const { assistant, thread, data } = setup([
    tools(
      call("set_sport_special_day", { date: TOMORROW, sessions: [{ type: "run", time: "07:30", duration_min: 40, intensity: "high" }] }),
      call("release_sport_version", { effective_from: "2026-10-05", week: {
        пн: [{ type: "strength", time: "19:00", duration_min: 60, intensity: "high" }], вт: [], ср: [{ type: "swim", time: "08:00", duration_min: 45, intensity: "medium" }],
        чт: [], пт: [{ type: "strength", time: "19:00", duration_min: 60, intensity: "high" }], сб: [{ type: "bike", time: "10:00", duration_min: 90, intensity: "low" }], вс: [],
      } }),
    ),
    say("Предлагаю бег завтра и новое расписание."),
  ]);
  const before = data.snapshot();
  await assistant.run(thread, "Сделай завтра бег и обнови расписание");
  assert.equal(data.snapshot(), before);
  const [day, week] = thread.proposals;
  assert.equal(day.kind, "sport_day");
  assert.equal(day.page, "sport");
  assert.equal(day.preview.type, "sport_days");
  assert.equal(day.preview.days[0].before[0].type, "Силовая");
  assert.equal(day.preview.days[0].after[0].type, "Бег");
  assert.equal(week.kind, "sport_version");

  assert.equal(assistant.apply([day], { together: false }).ok, true);
  assert.equal(readSportDay(data.snapshot(), TOMORROW).sessions[0].type, "run");
  assert.equal(data.snapshot().journal.at(-1).page, "sport");
  assert.equal(assistant.apply([week], { together: false }).ok, true);
  assert.equal(readSportDay(data.snapshot(), "2026-10-07").sessions[0].type, "swim");
  assert.equal(readSportDay(data.snapshot(), "2026-10-05").sessions[0].intensity, "high");
});

test("sport assistant: past days, the log and bad sessions are refused", async () => {
  let outputs = [];
  const { assistant, thread } = setup([
    tools(
      call("set_sport_special_day", { date: "2026-09-30", sessions: [] }),
      call("set_sport_special_day", { date: TOMORROW, sessions: [{ type: "karate", time: "07:00", duration_min: 2, intensity: "high" }] }),
      call("mark_session", { date: TODAY, state: "done" }),
    ),
    (request) => {
      outputs = toolResults(request);
      return say("Нельзя.");
    },
  ]);
  await assistant.run(thread, "Отметь вчерашнюю тренировку");
  assert.equal(thread.proposals.length, 0);
  assert.match(outputs[0].error, /Прошедшие дни менять нельзя/);
  assert.ok(outputs[1].errors.some((error) => /karate/.test(error)));
  assert.ok(outputs[1].errors.some((error) => /5–600/.test(error)));
  assert.match(outputs[2].error, /Нет инструмента/);
});

test("sport assistant: a mixed Спорт + Рацион batch writes one change set", async () => {
  const state = sportState();
  const meals = viewDay(state, TOMORROW).meals.map((meal) => ({
    name: meal.name,
    time: meal.time,
    items: meal.items.map((item) => (meal.name === "Ужин" && item.product === "Куриная грудка" ? { product: "Куриная грудка", amount: 230 } : { product: item.product, amount: item.amount })),
  }));
  const { assistant, thread, data } = setup([
    tools(
      call("set_sport_special_day", { date: TOMORROW, sessions: [{ type: "strength", time: "19:00", duration_min: 75, intensity: "high" }] }),
      call("set_special_day", { date: TOMORROW, meals }),
    ),
    say("Тренировка длиннее, и больше белка на ужин."),
  ], state);
  const profileBefore = structuredClone(data.snapshot().ration.profile);
  await assistant.run(thread, "Завтра тренировка тяжелее, подстрой питание");
  assert.equal(thread.proposals.length, 2);
  assert.deepEqual(thread.proposals.map((proposal) => proposal.page), ["sport", "ration"]);

  const result = assistant.apply(thread.proposals, { together: true });
  assert.equal(result.ok, true);
  const { journal } = data.snapshot();
  assert.equal(journal.length, 1);
  assert.equal(journal[0].page, "ration+sport");
  assert.equal(journal[0].actor, "ai");
  assert.deepEqual(Object.keys(journal[0].after).map((key) => key.split(":")[0]).sort(), ["ration", "sport"]);
  assert.equal(readSportDay(data.snapshot(), TOMORROW).sessions[0].durationMin, 75);
  assert.equal(readRationDay(data.snapshot(), TOMORROW).source, "special");

  const { updatedAt: _a, updatedBy: _b, ...before } = profileBefore;
  const { updatedAt: _c, updatedBy: _d, ...after } = data.snapshot().ration.profile;
  assert.deepEqual(after, before, "the КБЖУ goal never changes without the person");
  assert.equal(data.revertChangeSet(journal[0].id).ok, true, "one undo reverts both pages");
  assert.equal(readSportDay(data.snapshot(), TOMORROW).source, "cycle");
});

test("sport assistant: the КБЖУ goal cannot be changed by the assistant at all", async () => {
  let outputs = [];
  const { assistant, thread, data, provider } = setup([
    tools(call("set_profile", { targetCalories: 3500 }), call("set_ration_profile", { fields: { targetCalories: 3500 } })),
    (request) => {
      outputs = toolResults(request);
      return say("Цели меняет только человек в Профиле.");
    },
  ]);
  await assistant.run(thread, "Подними мне цель до 3500 ккал");
  assert.ok(outputs.every((output) => output.ok === false));
  assert.equal(data.snapshot().ration.profile.targetCalories, 2400);
  const names = provider.requests[0].tools.map((tool) => tool.function.name);
  assert.ok(!names.some((name) => /profile|goal|target/.test(name) && name !== "get_profile"));
  assert.match(provider.requests[0].messages[0].content, /Цели КБЖУ в профиле меняет только человек/);
});

test("sport assistant: aggregates add workouts and energy for 28 days", () => {
  const data = openLocalData(memoryStorage(sportState()));
  data.load();
  const today = todayDateKey();
  const stats = assistantStats(data.snapshot(), TODAY);
  assert.equal(stats.sport.sessions.planned, 2, "Monday and Wednesday of the plan's first week");
  assert.equal(stats.sport.sessions.unmarked, 2);
  assert.equal(stats.sport.minutes.planned, 120);
  assert.equal(stats.sport.energyKcal.planned, 800);
  assert.ok(today);
});

test("sport assistant: Спорт deviations become Тычки", () => {
  const today = todayDateKey();
  const state = sportState();
  state.sport.versions[0].effectiveFrom = "2020-01-06";
  state.sport.versions[0].cycle.anchor = "2020-01-06";
  state.sport.versions[0].cycle.weekdayBinding = false;
  state.sport.versions[0].cycle.days = [{ id: "every", sessions: [{ id: "s_day", type: "run", time: "07:00", durationMin: 30, intensity: "medium", note: "", exercises: [] }] }];
  const data = openLocalData(memoryStorage(state));
  data.load();
  data.markSportSession(today, "s_day", "done");
  data.markSportSession(today, "s_day", "unmarked");
  assert.equal(data.snapshot().assistant.nudges.length, 0, "done and unmarked are not deviations");
  data.markSportSession(today, "s_day", "skipped");
  data.markSportSession(today, "s_day", "changed", { actualDurationMin: 15, actualIntensity: "low" });
  data.addUnplannedSport(today, { type: "walk", durationMin: 50 });
  const nudges = data.snapshot().assistant.nudges;
  assert.deepEqual(nudges.map((nudge) => nudge.kind), ["session_skipped", "session_changed", "unplanned_activity"]);
  assert.ok(nudges.every((nudge) => nudge.page === "sport"));
  assert.match(nudges[0].text, /Бег 07:00: пропущена/);
  assert.match(nudges[1].text, /15 мин вместо 30/);
  assert.match(nudges[2].text, /Ходьба, 50 мин/);
});
