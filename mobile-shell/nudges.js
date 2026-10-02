import { readRationDay, readRationHistoryDay } from "./ration-domain.js";

// Тычки: every deviation from the plan reaches the assistant, which decides
// whether to tell the person. Detection is code; the queue lives in local data
// and survives a restart; bursts merge into one background call. Nothing in
// the plan changes here: a notice only becomes the first message of the chat.

export const NUDGE_BURST_MS = 30_000;
export const NUDGE_RETRY_MS = 5 * 60_000;
export const NUDGE_QUEUE_LIMIT = 50;

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
    bookmarks: Array.isArray(value.bookmarks) ? value.bookmarks.filter((bookmark) => bookmark && typeof bookmark === "object" && bookmark.id) : [],
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

export function enqueueNudges(assistantState, nudges) {
  if (!nudges.length) return assistantState;
  assistantState.nudges = [...(assistantState.nudges || []), ...nudges].slice(-NUDGE_QUEUE_LIMIT);
  return assistantState;
}

// One background call for a burst of nudges. The answer is JSON
// { notify, text }; the strictness paragraph and the free text «Как
// реагировать» are part of the prompt.
export async function decideNudges(provider, { nudges, settings, context }) {
  const level = STRICTNESS_LEVELS[settings?.strictness] || STRICTNESS_LEVELS.any;
  const howToReact = String(settings?.howToReact || "").trim();
  const system = [
    "Ты ассистент приложения Cookish. Человек отметил отклонения от своего плана питания или тренировок (тычки).",
    "Реши, стоит ли сейчас сказать ему об этом. Ничего не меняй и не обещай изменить: изменения плана предлагаются только в открытом чате.",
    level.prompt,
    howToReact ? `Как реагировать (пожелание человека): ${howToReact}` : "",
    "Не лечи и не ставь диагнозов.",
    "Ответь только JSON: {\"notify\": true|false, \"text\": \"короткое сообщение по-русски, 1–2 предложения\"}.",
  ].filter(Boolean).join("\n");
  const user = JSON.stringify({
    events: nudges.map(({ kind, date, text, page }) => ({ kind, date, page, text })),
    context,
  });
  const answer = await provider.complete({
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    responseFormat: { type: "json_object" },
  });
  if (!answer.ok) return { ok: false, kind: answer.kind, reason: answer.reason };
  const parsed = parseDecision(answer.message?.content);
  if (!parsed) return { ok: false, kind: "bad_response", reason: "Ответ ассистента не JSON." };
  return { ok: true, ...parsed };
}

export function parseDecision(content) {
  const text = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    const message = String(value.text || "").trim();
    return { notify: Boolean(value.notify) && Boolean(message), text: message };
  } catch {
    return null;
  }
}

// Background worker: waits for a quiet burst window, then sends everything
// queued in one call. Without a key or a network the queue waits; on a
// transient failure it retries later. `store` reads and writes local data.
export function createNudgeWorker({
  provider,
  store,
  buildContext,
  isOnline = () => globalThis.navigator?.onLine !== false,
  allowed = () => true,
  timers = globalThis,
  burstMs = NUDGE_BURST_MS,
  retryMs = NUDGE_RETRY_MS,
  onNotice = () => {},
}) {
  let timer = null;
  let running = false;

  function schedule(delay = burstMs) {
    if (timer || running || !store.pending().length) return;
    timer = timers.setTimeout(() => {
      timer = null;
      run();
    }, delay);
  }

  async function run() {
    const nudges = store.pending();
    if (!nudges.length || running) return { ok: true, sent: 0 };
    // Without a key, the provider warning or a network the queue waits.
    if (!provider.hasKey() || !allowed() || !isOnline()) return { ok: false, waiting: true };
    running = true;
    let result;
    try {
      result = await decideNudges(provider, { nudges, settings: store.settings(), context: buildContext() });
    } finally {
      running = false;
    }
    if (!result.ok) {
      if (["network", "timeout", "server", "rate"].includes(result.kind)) schedule(retryMs);
      else if (result.kind === "bad_response") store.finish(nudges.map((item) => item.id), "");
      return result;
    }
    store.finish(nudges.map((item) => item.id), result.notify ? result.text : "");
    if (result.notify) onNotice(result.text);
    schedule();
    return { ok: true, sent: nudges.length, notify: result.notify };
  }

  return {
    schedule,
    run,
    cancel() {
      if (timer) timers.clearTimeout(timer);
      timer = null;
    },
    get scheduled() {
      return Boolean(timer);
    },
  };
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
