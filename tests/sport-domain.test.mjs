import assert from "node:assert/strict";
import test from "node:test";

import {
  SPORT_MET,
  executeSportCommand,
  normalizeSport,
  readSportDay,
  readSportDayEnergy,
  readSportLogDay,
  readSportRange,
  sessionEnergy,
} from "../mobile-shell/sport-domain.js";
import { activePlanVersion, cycleDayFor } from "../mobile-shell/plan-cycle.js";
import { RATION_SCHEMA_VERSION } from "../mobile-shell/ration-domain.js";
import { memoryStorage, openLocalData, todayDateKey } from "../mobile-shell/local-data.js";

const CTX = { now: "2026-10-01T09:00:00.000Z", today: "2026-10-01", actor: "local" };
const MONDAY = "2026-09-28";

const session = (id, type, time, durationMin, intensity = "medium") => ({ id, type, time, durationMin, intensity, note: "" });
const week = () => [
  { id: "mon", sessions: [session("s_mon", "strength", "19:00", 60)] },
  { id: "tue", sessions: [] },
  { id: "wed", sessions: [session("s_wed", "run", "07:30", 40, "high")] },
  { id: "thu", sessions: [] },
  { id: "fri", sessions: [session("s_fri", "strength", "19:00", 60)] },
  { id: "sat", sessions: [session("s_sat", "bike", "10:00", 90, "low")] },
  { id: "sun", sessions: [session("s_sun", "yoga", "09:00", 30, "low")] },
];

function planned(state = {}) {
  const result = executeSportCommand({ ration: { profile: { weightKg: 80 } }, ...state }, {
    type: "releaseVersion", anchor: MONDAY, effectiveFrom: MONDAY, weekdayBinding: true, days: week(),
  }, CTX);
  assert.equal(result.ok, true);
  return result.state;
}

test("sport: a weekly cycle follows weekdays and a later version replaces it from its date", () => {
  let state = planned();
  assert.equal(readSportDay(state, "2026-09-30").sessions[0].type, "run");
  assert.equal(readSportDay(state, "2026-10-07").sessions[0].type, "run", "the week repeats");
  assert.deepEqual(readSportDay(state, "2026-10-06").sessions, []);
  assert.equal(readSportDay(state, "2026-09-27"), null, "no plan before the first version");

  const next = executeSportCommand(state, {
    type: "releaseVersion", anchor: "2026-10-05", effectiveFrom: "2026-10-05", weekdayBinding: true,
    days: week().map((day) => ({ ...day, sessions: day.sessions.map((value) => ({ ...value, durationMin: 30 })) })),
  }, CTX);
  state = next.state;
  assert.equal(readSportDay(state, "2026-09-30").sessions[0].durationMin, 40, "the past keeps its version");
  assert.equal(readSportDay(state, "2026-10-07").sessions[0].durationMin, 30);
  assert.equal(activePlanVersion(state.sport, "local", "2026-10-07").id, next.versionId);
  assert.equal(readSportRange(state, "2026-10-05", "2026-10-11").length, 7);
});

test("sport: the shared cycle module serves both plans", () => {
  const cycle = { anchor: "2026-09-28", weekdayBinding: false, days: [{ id: "a" }, { id: "b" }, { id: "c" }] };
  assert.equal(cycleDayFor(cycle, "2026-09-28").id, "a");
  assert.equal(cycleDayFor(cycle, "2026-10-01").id, "a");
  assert.equal(cycleDayFor(cycle, "2026-09-27").id, "c");
});

test("sport: a Особый день overrides one date and edits materialize it", () => {
  let state = planned();
  const added = executeSportCommand(state, { type: "addSession", date: "2026-10-02", session: { type: "swim", time: "08:00", durationMin: 45 } }, CTX);
  state = added.state;
  const day = readSportDay(state, "2026-10-02");
  assert.equal(day.source, "special");
  assert.deepEqual(day.sessions.map((value) => value.type), ["strength", "swim"]);
  assert.equal(readSportDay(state, "2026-10-09").sessions.length, 1, "next Friday follows the cycle");

  state = executeSportCommand(state, { type: "updateSession", date: "2026-10-02", sessionId: "s_fri", fields: { durationMin: 75, intensity: "high" } }, CTX).state;
  assert.equal(readSportDay(state, "2026-10-02").sessions[0].durationMin, 75);
  state = executeSportCommand(state, { type: "removeSession", date: "2026-10-02", sessionId: added.sessionId }, CTX).state;
  assert.equal(readSportDay(state, "2026-10-02").sessions.length, 1);
  state = executeSportCommand(state, { type: "setSpecialDay", date: "2026-10-03", sessions: [] }, CTX).state;
  assert.deepEqual(readSportDay(state, "2026-10-03").sessions, [], "a rest day");
  state = executeSportCommand(state, { type: "removeSpecialDay", date: "2026-10-03" }, CTX).state;
  assert.equal(readSportDay(state, "2026-10-03").source, "cycle");
  assert.equal(executeSportCommand(state, { type: "updateSession", date: "2026-10-03", sessionId: "missing", fields: {} }, CTX).ok, false);
});

test("sport: marks, actual values and unplanned activity go to the log", () => {
  let state = planned();
  state = executeSportCommand(state, { type: "markSession", date: "2026-09-28", sessionId: "s_mon", state: "done" }, CTX).state;
  state = executeSportCommand(state, { type: "markSession", date: "2026-09-30", sessionId: "s_wed", state: "changed", actualDurationMin: 25, actualIntensity: "medium" }, CTX).state;
  const unplanned = executeSportCommand(state, { type: "addUnplanned", date: "2026-09-30", session: { type: "walk", durationMin: 60, intensity: "low" } }, CTX);
  state = unplanned.state;
  assert.equal(readSportLogDay(state, "2026-09-28").sessions.s_mon.state, "done");
  const wednesday = readSportLogDay(state, "2026-09-30");
  assert.deepEqual(wednesday.sessions.s_wed, { state: "changed", actualDurationMin: 25, actualIntensity: "medium" });
  assert.equal(wednesday.unplanned[0].type, "walk");
  assert.equal(wednesday.versionId, state.sport.versions[0].id);

  assert.equal(executeSportCommand(state, { type: "markSession", date: "2026-10-02", sessionId: "s_fri", state: "done" }, CTX).ok, false, "the future cannot be marked");
  assert.equal(executeSportCommand(state, { type: "markSession", date: "2026-09-30", sessionId: "s_wed", state: "sleeping" }, CTX).ok, false);
  state = executeSportCommand(state, { type: "removeUnplanned", date: "2026-09-30", sessionId: unplanned.sessionId }, CTX).state;
  assert.deepEqual(readSportLogDay(state, "2026-09-30").unplanned, []);
});

test("sport: the assistant never writes Учёт тренировок", () => {
  const state = planned();
  const ai = { ...CTX, actor: "ai" };
  const marked = executeSportCommand(state, { type: "markSession", date: "2026-09-28", sessionId: "s_mon", state: "skipped" }, ai);
  assert.equal(marked.ok, false);
  assert.match(marked.reason, /ИИ не может записывать Учёт тренировок/);
  assert.equal(executeSportCommand(state, { type: "addUnplanned", date: "2026-09-28", session: { type: "run" } }, ai).ok, false);
  assert.equal(executeSportCommand(state, { type: "setSpecialDay", date: "2026-10-02", sessions: [] }, ai).ok, true, "the plan is not a fact");
});

test("sport: energy is MET × weight × hours, planned and actual", () => {
  assert.equal(sessionEnergy({ type: "run", intensity: "high", durationMin: 40 }, 80), Math.round(SPORT_MET.run.high * 80 * (40 / 60)));
  assert.equal(sessionEnergy({ type: "strength", intensity: "medium", durationMin: 60 }, 80), 400);
  assert.equal(sessionEnergy({ type: "run", durationMin: 30 }, null), null, "no weight, no estimate");

  let state = planned();
  state = executeSportCommand(state, { type: "markSession", date: "2026-09-30", sessionId: "s_wed", state: "changed", actualDurationMin: 20, actualIntensity: "medium" }, CTX).state;
  state = executeSportCommand(state, { type: "addUnplanned", date: "2026-09-30", session: { type: "walk", durationMin: 60, intensity: "medium" } }, CTX).state;
  const wednesday = readSportDayEnergy(state, "2026-09-30");
  assert.equal(wednesday.planned, sessionEnergy({ type: "run", intensity: "high", durationMin: 40 }, 80));
  assert.equal(wednesday.actual, sessionEnergy({ type: "run", intensity: "medium", durationMin: 20 }, 80) + sessionEnergy({ type: "walk", intensity: "medium", durationMin: 60 }, 80));
  const monday = readSportDayEnergy(state, "2026-09-28");
  assert.equal(monday.planned, 400);
  assert.equal(monday.actual, 0, "an unmarked session adds nothing");

  const noWeight = planned({ ration: { profile: {} } });
  assert.equal(readSportDayEnergy(noWeight, "2026-09-28").weightKnown, false);
  assert.equal(readSportDayEnergy(noWeight, "2026-09-28").planned, null);
});

test("sport: plan commands write change sets; the log does not", () => {
  const today = todayDateKey();
  const data = openLocalData(memoryStorage(null));
  data.load();
  const released = data.releaseSportVersion({ effectiveFrom: today, days: week() });
  assert.equal(released.ok, true);
  const added = data.addSportSession(today, { type: "run", time: "07:00", durationMin: 30 });
  const sessionId = readSportDay(data.snapshot(), today).sessions[0].id;
  data.markSportSession(today, sessionId, "skipped");
  data.addUnplannedSport(today, { type: "walk", durationMin: 20 });

  const { journal } = data.snapshot();
  assert.equal(journal.length, 2);
  assert.equal(journal[0].page, "sport");
  assert.match(journal[0].summary, /Новое расписание тренировок/);
  assert.match(journal[1].summary, /Добавлена тренировка/);
  assert.ok(Object.keys(journal[1].after)[0].startsWith("sport:special:"));

  assert.equal(data.revertChangeSet(added.changeSetId).ok, true);
  assert.equal(readSportDay(data.snapshot(), today).source, "cycle");
  assert.equal(readSportLogDay(data.snapshot(), today).sessions[sessionId].state, "skipped", "the log stays");
});

test("sport: old data migrates to an empty plan and log", () => {
  const storage = memoryStorage({ schemaVersion: 13, products: [], requests: [], ration: { versions: [], specialDays: {}, history: {} }, journal: [] });
  const data = openLocalData(storage);
  const state = data.load();
  assert.equal(state.schemaVersion, RATION_SCHEMA_VERSION);
  assert.equal(RATION_SCHEMA_VERSION, 14);
  assert.deepEqual(state.sport, { versions: [], specialDays: {}, log: {} });
  assert.equal(storage.backups().v13.schemaVersion, 13);

  const normalized = normalizeSport({
    versions: [{ id: "v", effectiveFrom: MONDAY, cycle: { anchor: MONDAY, days: [{ sessions: [{ id: "x", type: "karate", durationMin: -5 }] }] } }],
    specialDays: { broken: { date: "nope" }, ok: { date: "2026-10-01", sessions: [{ id: "y", type: "run", intensity: "extreme" }] } },
    log: { "local|2026-10-01": { date: "2026-10-01", sessions: { y: { state: "weird" } }, unplanned: [{ id: "z", type: "swim" }] } },
  });
  assert.equal(normalized.versions[0].cycle.days[0].sessions[0].type, "other");
  assert.equal(normalized.versions[0].cycle.days[0].sessions[0].durationMin, 45);
  assert.deepEqual(Object.keys(normalized.specialDays), ["local|2026-10-01"]);
  assert.equal(normalized.specialDays["local|2026-10-01"].sessions[0].intensity, "medium");
  assert.equal(normalized.log["local|2026-10-01"].sessions.y.state, "unmarked");
  assert.deepEqual(normalized.log["local|2026-10-01"].unplanned[0].exercises, []);
});
