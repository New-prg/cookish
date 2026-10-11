import { STRICTNESS_LEVELS } from "../../core/nudges.js";

// The decision on a burst of Тычки: one background call to the provider. The
// queue itself is data and lives in the Core (core/nudges.js).

export const NUDGE_BURST_MS = 30_000;
export const NUDGE_RETRY_MS = 5 * 60_000;

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
// transient failure it retries later. `store` reads and writes local data;
// `isOnline` comes from the platform.
export function createNudgeWorker({
  provider,
  store,
  buildContext,
  isOnline = () => true,
  allowed = () => true,
  // Wrapped: a browser rejects setTimeout called on another object.
  timers = { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (id) => clearTimeout(id) },
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
