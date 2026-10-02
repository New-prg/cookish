// План тренировок and Учёт тренировок: the same scheme as the Рацион (a
// weekly cycle from an anchor date, versions from a date, Особые дни) with
// Тренировки instead of meals, a log of what was done, and an estimate of the
// energy a session takes. The log is a fact: only the human writes it.
import {
  DATE_PATTERN,
  buildPlanVersion,
  formatPlanDate,
  normalizePlanSpecialDays,
  normalizePlanVersion,
  parsePlanDate,
  planOwnerKey,
  readPlanDay,
  shiftPlanDate,
} from "./plan-cycle.js";

export const SPORT_TYPES = ["strength", "run", "swim", "bike", "walk", "yoga", "other"];
export const SPORT_TYPE_LABELS = {
  strength: "Силовая",
  run: "Бег",
  swim: "Плавание",
  bike: "Велосипед",
  walk: "Ходьба",
  yoga: "Йога",
  other: "Другое",
};
export const SPORT_INTENSITIES = ["low", "medium", "high"];
export const SPORT_INTENSITY_LABELS = { low: "низкая", medium: "средняя", high: "высокая" };
export const SPORT_SESSION_STATES = ["unmarked", "done", "changed", "skipped"];
export const SPORT_STATE_LABELS = { unmarked: "не отмечено", done: "выполнено", changed: "изменено", skipped: "пропущено" };

// MET by type and intensity (Compendium of Physical Activities, rounded).
export const SPORT_MET = {
  strength: { low: 3.5, medium: 5, high: 6 },
  run: { low: 7, medium: 9.8, high: 11.5 },
  swim: { low: 6, medium: 8.3, high: 10 },
  bike: { low: 4, medium: 6.8, high: 10 },
  walk: { low: 2.8, medium: 3.5, high: 5 },
  yoga: { low: 2.5, medium: 3, high: 4 },
  other: { low: 3, medium: 4.5, high: 6 },
};

const TIME_PATTERN = /^\d{2}:\d{2}$/;
const TYPES = new Set(SPORT_TYPES);
const INTENSITIES = new Set(SPORT_INTENSITIES);
const STATES = new Set(SPORT_SESSION_STATES);

export function emptySport() {
  return { versions: [], specialDays: {}, log: {} };
}

export function normalizeSport(source) {
  const sport = source && typeof source === "object" ? source : {};
  const log = {};
  Object.values(sport.log && typeof sport.log === "object" ? sport.log : {}).forEach((entry) => {
    if (!entry?.date || !DATE_PATTERN.test(entry.date)) return;
    const owner = planOwnerKey(entry.owner);
    log[`${owner}|${entry.date}`] = {
      date: entry.date,
      owner,
      versionId: String(entry.versionId || ""),
      sessions: Object.fromEntries(Object.entries(entry.sessions && typeof entry.sessions === "object" ? entry.sessions : {})
        .map(([id, record]) => [id, normalizeRecord(record)])),
      unplanned: (Array.isArray(entry.unplanned) ? entry.unplanned : []).map(normalizeSession),
    };
  });
  return {
    versions: (Array.isArray(sport.versions) ? sport.versions : []).map((version, index) => {
      const normalized = normalizePlanVersion(version, index, "sessions", "sport_version");
      normalized.cycle.days.forEach((day) => { day.sessions = day.sessions.map(normalizeSession); });
      return normalized;
    }),
    specialDays: Object.fromEntries(Object.entries(normalizePlanSpecialDays(sport.specialDays, "sessions"))
      .map(([key, day]) => [key, { ...day, sessions: day.sessions.map(normalizeSession) }])),
    log,
  };
}

export function normalizeSession(source) {
  const session = source && typeof source === "object" ? source : {};
  return {
    id: String(session.id || createSportId("session")),
    type: TYPES.has(session.type) ? session.type : "other",
    time: TIME_PATTERN.test(session.time || "") ? session.time : "18:00",
    durationMin: clampMinutes(session.durationMin, 45),
    intensity: INTENSITIES.has(session.intensity) ? session.intensity : "medium",
    note: String(session.note || "").slice(0, 300),
    // Reserved for sets and repetitions.
    exercises: Array.isArray(session.exercises) ? session.exercises : [],
  };
}

function normalizeRecord(record) {
  const source = record && typeof record === "object" ? record : {};
  const result = { state: STATES.has(source.state) ? source.state : "unmarked" };
  if (source.actualDurationMin != null) result.actualDurationMin = clampMinutes(source.actualDurationMin, 0);
  if (INTENSITIES.has(source.actualIntensity)) result.actualIntensity = source.actualIntensity;
  return result;
}

export function sportOwner(state) {
  return planOwnerKey(state?.user?.email || "local");
}

export function readSportDay(state, dateKey) {
  return readPlanDay(state?.sport, sportOwner(state), dateKey, "sessions");
}

export function readSportRange(state, fromKey, toKey) {
  const days = [];
  if (!DATE_PATTERN.test(String(fromKey || "")) || !DATE_PATTERN.test(String(toKey || ""))) return days;
  for (let cursor = fromKey, guard = 0; cursor <= toKey && guard < 400; cursor = shiftPlanDate(cursor, 1), guard += 1) {
    const day = readSportDay(state, cursor);
    if (day) days.push(day);
  }
  return days;
}

export function readSportLogDay(state, dateKey) {
  if (!DATE_PATTERN.test(String(dateKey || ""))) return null;
  const entry = state?.sport?.log?.[`${sportOwner(state)}|${dateKey}`];
  if (!entry) return null;
  return { date: dateKey, versionId: entry.versionId || "", sessions: entry.sessions || {}, unplanned: entry.unplanned || [] };
}

// Energy of a session in ккал: MET × body weight × hours. Without a weight
// there is no estimate.
export function sessionEnergy(session, weightKg, { durationMin, intensity } = {}) {
  const weight = Number(weightKg);
  if (!(weight > 0)) return null;
  const met = SPORT_MET[session?.type]?.[intensity || session?.intensity] ?? SPORT_MET.other.medium;
  const minutes = Number(durationMin ?? session?.durationMin) || 0;
  return Math.round(met * weight * (minutes / 60));
}

// Planned and actual energy of a day. Actual counts done sessions as planned
// (or with the recorded actual values), changed ones with their actual values,
// and unplanned activity; skipped and unmarked sessions add nothing.
export function readSportDayEnergy(state, dateKey) {
  const weight = Number(state?.ration?.profile?.weightKg) || 0;
  const day = readSportDay(state, dateKey);
  const log = readSportLogDay(state, dateKey);
  const sessions = (day?.sessions || []).map((session) => {
    const record = log?.sessions?.[session.id] || { state: "unmarked" };
    const planned = sessionEnergy(session, weight);
    const actual = record.state === "done" || record.state === "changed"
      ? sessionEnergy(session, weight, {
        durationMin: record.actualDurationMin ?? session.durationMin,
        intensity: record.actualIntensity || session.intensity,
      })
      : record.state === "skipped" ? 0 : null;
    return { id: session.id, state: record.state, planned, actual };
  });
  const unplanned = (log?.unplanned || []).map((session) => ({ id: session.id, actual: sessionEnergy(session, weight) }));
  const sum = (values) => values.reduce((total, value) => total + (Number(value) || 0), 0);
  return {
    date: dateKey,
    weightKnown: weight > 0,
    planned: weight > 0 ? sum(sessions.map((session) => session.planned)) : null,
    actual: weight > 0 ? sum([...sessions.map((session) => session.actual), ...unplanned.map((session) => session.actual)]) : null,
    sessions,
    unplanned,
  };
}

export function executeSportCommand(state, command, context = {}) {
  const next = structuredClone(state && typeof state === "object" ? state : {});
  const result = applySportCommand(next, command, context);
  if (result.ok === false) return result;
  return { ...result, state: next };
}

// Mutates `draft`; the caller discards it when the result is not ok.
export function applySportCommand(draft, command, context = {}) {
  draft.sport = draft.sport && typeof draft.sport === "object" ? draft.sport : emptySport();
  draft.sport.versions = draft.sport.versions || [];
  draft.sport.specialDays = draft.sport.specialDays || {};
  draft.sport.log = draft.sport.log || {};
  const ctx = {
    now: context.now || new Date().toISOString(),
    actor: context.actor || sportOwner(draft),
    today: DATE_PATTERN.test(context.today || "") ? context.today : (context.now ? String(context.now).slice(0, 10) : formatPlanDate(new Date())),
  };
  return runSportCommand(draft, command, ctx);
}

const SPORT_SUMMARIES = {
  setSpecialDay: "Особый день тренировок",
  removeSpecialDay: "Особый день тренировок отменён",
  addSession: "Добавлена тренировка",
  updateSession: "Изменена тренировка",
  removeSession: "Удалена тренировка",
};

export function describeSportCommand(command) {
  const type = String(command?.type || "");
  if (type === "releaseVersion") return `Новое расписание тренировок с ${shortDate(command.effectiveFrom || command.anchor)}`;
  const summary = SPORT_SUMMARIES[type] || "Изменение плана тренировок";
  return command?.date ? `${summary} · ${shortDate(command.date)}` : summary;
}

function runSportCommand(next, command, ctx) {
  const sport = next.sport;
  const owner = sportOwner(next);
  const type = String(command?.type || "");
  switch (type) {
    case "setSpecialDay": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      const day = ensureSpecialDay(next, owner, date, { materialize: false });
      day.sessions = (command.sessions || []).map(normalizeSession);
      touch(day, ctx);
      return { ok: true, date };
    }
    case "removeSpecialDay": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      if (!sport.specialDays[`${owner}|${date}`]) return fail("Особый день не найден.");
      delete sport.specialDays[`${owner}|${date}`];
      return { ok: true, date };
    }
    case "addSession": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      const day = ensureSpecialDay(next, owner, date);
      const session = normalizeSession({ ...command.session, id: createSportId("session") });
      day.sessions.push(session);
      touch(day, ctx);
      return { ok: true, date, sessionId: session.id };
    }
    case "updateSession": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      if (!readSportDay(next, date)?.sessions?.some((session) => session.id === command.sessionId)) return fail("Тренировка не найдена.");
      const day = ensureSpecialDay(next, owner, date);
      const index = day.sessions.findIndex((session) => session.id === command.sessionId);
      day.sessions[index] = normalizeSession({ ...day.sessions[index], ...(command.fields || {}), id: command.sessionId });
      touch(day, ctx);
      return { ok: true, date, sessionId: command.sessionId };
    }
    case "removeSession": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      if (!readSportDay(next, date)?.sessions?.some((session) => session.id === command.sessionId)) return fail("Тренировка не найдена.");
      const day = ensureSpecialDay(next, owner, date);
      day.sessions = day.sessions.filter((session) => session.id !== command.sessionId);
      touch(day, ctx);
      return { ok: true, date };
    }
    case "releaseVersion": {
      const days = Array.isArray(command.days) ? command.days : [];
      if (!days.length) return fail("Расписание должно содержать хотя бы один день.");
      const anchor = commandDate(command.anchor) || commandDate(command.effectiveFrom);
      if (!anchor) return fail("Некорректная дата начала.");
      const effectiveFrom = commandDate(command.effectiveFrom) || anchor;
      const version = buildPlanVersion({
        id: createSportId("sport_version"),
        owner,
        days: days.map((day) => ({ ...day, sessions: (day?.sessions || []).map(normalizeSession) })),
        anchor,
        effectiveFrom,
        weekdayBinding: command.weekdayBinding,
        field: "sessions",
        now: ctx.now,
        actor: ctx.actor,
      });
      sport.versions.push(version);
      return { ok: true, versionId: version.id, effectiveFrom };
    }
    case "markSession": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      const state = String(command.state || "");
      if (!STATES.has(state)) return fail("Неизвестное состояние тренировки.");
      const blocked = logWritable(ctx, date);
      if (blocked) return blocked;
      const session = readSportDay(next, date)?.sessions?.find((value) => value.id === command.sessionId);
      if (!session) return fail("Тренировка не найдена.");
      const entry = ensureLogEntry(next, owner, date);
      const record = { state };
      if (state === "changed") {
        record.actualDurationMin = clampMinutes(command.actualDurationMin, session.durationMin);
        record.actualIntensity = INTENSITIES.has(command.actualIntensity) ? command.actualIntensity : session.intensity;
      } else if (state === "done" && (command.actualDurationMin != null || command.actualIntensity)) {
        record.actualDurationMin = clampMinutes(command.actualDurationMin, session.durationMin);
        record.actualIntensity = INTENSITIES.has(command.actualIntensity) ? command.actualIntensity : session.intensity;
      }
      entry.sessions[command.sessionId] = record;
      return { ok: true, date, sessionId: command.sessionId, state };
    }
    case "addUnplanned": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      const blocked = logWritable(ctx, date);
      if (blocked) return blocked;
      const entry = ensureLogEntry(next, owner, date);
      const session = normalizeSession({ ...command.session, id: createSportId("unplanned") });
      entry.unplanned.push(session);
      return { ok: true, date, sessionId: session.id };
    }
    case "removeUnplanned": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      const blocked = logWritable(ctx, date);
      if (blocked) return blocked;
      const entry = sport.log[`${owner}|${date}`];
      const index = (entry?.unplanned || []).findIndex((session) => session.id === command.sessionId);
      if (index < 0) return fail("Активность не найдена.");
      const [session] = entry.unplanned.splice(index, 1);
      return { ok: true, date, session };
    }
    default:
      return fail(`Неизвестная команда спорта: ${type || "(пусто)"}`);
  }
}

function logWritable(ctx, date) {
  if (date > ctx.today) return fail("Нельзя отмечать тренировки будущего дня.");
  if (ctx.actor === "ai") return fail("ИИ не может записывать Учёт тренировок.");
  return null;
}

function ensureLogEntry(state, owner, dateKey) {
  const key = `${owner}|${dateKey}`;
  if (!state.sport.log[key]) {
    state.sport.log[key] = { date: dateKey, owner, versionId: readSportDay(state, dateKey)?.versionId || "", sessions: {}, unplanned: [] };
  }
  return state.sport.log[key];
}

function ensureSpecialDay(state, owner, dateKey, { materialize = true } = {}) {
  const key = `${owner}|${dateKey}`;
  if (!state.sport.specialDays[key]) {
    const computed = materialize ? readSportDay(state, dateKey) : null;
    state.sport.specialDays[key] = { date: dateKey, owner, sessions: structuredClone(computed?.sessions || []), updatedAt: "", updatedBy: "" };
  }
  return state.sport.specialDays[key];
}

function touch(day, ctx) {
  day.updatedAt = ctx.now;
  day.updatedBy = ctx.actor;
}

function clampMinutes(value, fallback) {
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes) || minutes <= 0) return fallback;
  return Math.min(minutes, 24 * 60);
}

function commandDate(value) {
  return DATE_PATTERN.test(String(value || "")) ? String(value) : "";
}

function shortDate(value) {
  if (!DATE_PATTERN.test(String(value || ""))) return String(value || "");
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(parsePlanDate(value));
}

function createSportId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function fail(reason) {
  return { ok: false, reason };
}
