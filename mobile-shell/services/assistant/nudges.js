import { STRICTNESS_LEVELS } from "../../core/nudges.js";

// The decision on a burst of Тычки: one background call to the provider. The
// queue and its worker are data and live in the Core (core/nudges.js).

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
