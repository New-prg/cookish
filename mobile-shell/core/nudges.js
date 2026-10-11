import { readRationDay, readRationHistoryDay } from "./ration-domain.js";
import { SPORT_INTENSITY_LABELS, SPORT_TYPE_LABELS, readSportDay, readSportLogDay } from "./sport-domain.js";

// Тычки: every deviation from the plan reaches the assistant, which decides
// whether to tell the person. Detection is code; the queue lives in the Core
// and survives a restart. The decision on a burst is the assistant Service
// (services/assistant/nudges.js). Nothing in the plan changes here: a notice
// only becomes the first message of the chat.

export const NUDGE_QUEUE_LIMIT = 50;
export const BOOKMARK_LIMIT = 30;

export const STRICTNESS_LEVELS = Object.freeze({
  any: {
    label: "Любое отклонение",
    prompt: "Жёсткость «Любое отклонение»: человек хочет слышать о каждом отклонении от плана. Если отклонение есть, коротко скажи о нём и предложи, что можно сделать дальше.",
  },
  notable: {
    label: "Заметные",
    prompt: "Жёсткость «Заметные»: говори только о заметных отклонениях — пропущенный приём пищи или тренировка, крупная замена, повторяющиеся расхождения. Мелочи пропускай.",
  },
  serious: {
    label: "Только серьёзные",
    prompt: "Жёсткость «Только серьёзные»: говори только о серьёзных отклонениях — несколько пропусков подряд, систематический недобор или перебор, риск для цели. Остальное пропускай.",
  },
});

export function defaultAssistantState() {
  return { settings: { strictness: "any", howToReact: "" }, nudges: [], notice: null, bookmarks: [] };
}

export function normalizeAssistantState(source) {
  const value = source && typeof source === "object" ? source : {};
  const settings = value.settings && typeof value.settings === "object" ? value.settings : {};
  const notice = value.notice && typeof value.notice === "object" && String(value.notice.text || "").trim()
    ? { text: String(value.notice.text).trim(), createdAt: String(value.notice.createdAt || "") }
    : null;
  return {
    settings: {
      strictness: STRICTNESS_LEVELS[settings.strictness] ? settings.strictness : "any",
      howToReact: String(settings.howToReact || "").slice(0, 600),
    },
    nudges: (Array.isArray(value.nudges) ? value.nudges : [])
      .filter((nudge) => nudge && typeof nudge === "object" && nudge.id && nudge.kind)
      .slice(-NUDGE_QUEUE_LIMIT),
    notice,
    bookmarks: (Array.isArray(value.bookmarks) ? value.bookmarks : [])
      .filter((bookmark) => bookmark && typeof bookmark === "object" && bookmark.id)
      .map((bookmark) => ({
        ...bookmark,
        log: Array.isArray(bookmark.log) ? bookmark.log : [],
        messages: Array.isArray(bookmark.messages) ? bookmark.messages : [],
        proposals: Array.isArray(bookmark.proposals) ? bookmark.proposals : [],
      }))
      .slice(0, BOOKMARK_LIMIT),
  };
}

const MEAL_DEVIATIONS = { changed: "meal_changed", skipped: "meal_skipped" };
const DISCREPANCY_TEXT = { added: "добавлен продукт", excluded: "не съеден продукт", replaced: "заменён продукт", amount: "другое количество" };

// Deviations a successful История питания command made. `before` and `after`
// are the states around the command; «не отмечено» is never a deviation.
export function rationNudges(command, before, after, { now = new Date().toISOString() } = {}) {
  const type = String(command?.type || "");
  const date = String(command?.date || "");
  const mealName = (state) => mealOf(state, date, command.mealId)?.name || "Приём пищи";
  if (type === "markMeal") {
    const kind = MEAL_DEVIATIONS[command.state];
    const previous = historyMeal(before, date, command.mealId)?.state || "unmarked";
    if (!kind || previous === command.state) return [];
    return [nudge(now, { page: "ration", kind, date, mealId: command.mealId, text: `${mealName(after)}: ${command.state === "skipped" ? "не съеден" : "съеден с изменениями"}` })];
  }
  if (type === "recordDiscrepancy") {
    const item = command.discrepancy || {};
    const product = item.name || item.replacedName || "";
    const detail = [DISCREPANCY_TEXT[item.kind] || "расхождение", product && `«${product}»`, item.replacedName && item.kind === "replaced" ? `на «${item.replacedName}»` : "", item.amount ? `${item.amount} ${item.measureUnit || ""}`.trim() : ""].filter(Boolean).join(" ");
    return [nudge(now, { page: "ration", kind: "discrepancy", date, mealId: command.mealId, text: `${mealName(after)}: ${detail}` })];
  }
  if (type === "transferMeals") {
    const minutes = Number(command.minutes) || 0;
    return [nudge(now, { page: "ration", kind: "meal_transferred", date, mealId: command.mealId, text: `${mealName(after)} перенесён на ${minutes > 0 ? "+" : ""}${minutes} мин` })];
  }
  return [];
}

// Deviations a successful Учёт тренировок command made: a session «пропущено»
// or «изменено» and unplanned activity.
export function sportNudges(command, before, after, { now = new Date().toISOString() } = {}) {
  const type = String(command?.type || "");
  const date = String(command?.date || "");
  if (type === "markSession") {
    if (command.state !== "skipped" && command.state !== "changed") return [];
    const previous = readSportLogDay(before, date)?.sessions?.[command.sessionId]?.state || "unmarked";
    if (previous === command.state) return [];
    const session = readSportDay(after, date)?.sessions?.find((value) => value.id === command.sessionId);
    const name = SPORT_TYPE_LABELS[session?.type] || "Тренировка";
    const record = readSportLogDay(after, date)?.sessions?.[command.sessionId] || {};
    const text = command.state === "skipped"
      ? `${name} ${session?.time || ""}: пропущена`.replace(/\s+:/, ":")
      : `${name}: изменена — ${record.actualDurationMin ?? session?.durationMin} мин вместо ${session?.durationMin}, ${SPORT_INTENSITY_LABELS[record.actualIntensity] || ""}`.trim();
    return [nudge(now, { page: "sport", kind: command.state === "skipped" ? "session_skipped" : "session_changed", date, sessionId: command.sessionId, text })];
  }
  if (type === "addUnplanned") {
    const session = command.session || {};
    return [nudge(now, { page: "sport", kind: "unplanned_activity", date, text: `Внеплановая активность: ${SPORT_TYPE_LABELS[session.type] || "другое"}, ${Number(session.durationMin) || 45} мин` })];
  }
  return [];
}

export function enqueueNudges(assistantState, nudges) {
  if (!nudges.length) return assistantState;
  assistantState.nudges = [...(assistantState.nudges || []), ...nudges].slice(-NUDGE_QUEUE_LIMIT);
  return assistantState;
}

function nudge(now, fields) {
  return { id: `nudge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, createdAt: now, ...fields };
}

function historyMeal(state, date, mealId) {
  return readRationHistoryDay(state, date)?.meals?.[mealId] || null;
}

function mealOf(state, date, mealId) {
  return readRationDay(state, date)?.meals?.find((meal) => meal.id === mealId) || null;
}
