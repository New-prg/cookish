// The authoring loop: the manual and the person's words go to the model, its
// answer is parsed and checked layer by layer, and a failed check goes back as
// one repair message with the problems of the first failing layer only. After
// the last repair the failure is honest: the problems, no half-built result.
import { bundleFromMarkup } from "./markup.js";
import { renderManual } from "./manual.js";
import { normalizeBundle } from "./normalize.js";
import { MAX_PROBLEMS, checkBundle } from "./pipeline.js";

export const DEFAULT_SURFACE = "json";
const MAX_ALLOWED = 12;

const LAYER_NAMES = {
  L0: "разбор ответа",
  L1: "структура, словари и ссылки",
  L2: "проверка хранилища",
  L3: "разметка карточек",
  L4: "вид экранов",
};

const contentOf = (message) => (typeof message?.content === "string" ? message.content : message?.content?.map?.((part) => part.text).join("") || "");

const parseProblem = (message) => ({ path: "", rule: "parse", message });
const hasContent = (bundle) => ["tracks", "screens", "remove"].some((key) => Array.isArray(bundle?.[key]) && bundle[key].length);

// → { raw, bundle, changes } for something to check, { raw, bundle, changes, empty: true }
// for an answer in words only, or { problems } when the text cannot be read.
function parse(surface, text) {
  if (surface === "html") {
    const parsed = bundleFromMarkup(text);
    if (!parsed.bundle) return { problems: parsed.problems.length ? parsed.problems : [parseProblem("В ответе нет <c-bundle> и нет <c-reply>.")] };
    if (parsed.problems.length) return { problems: parsed.problems };
    return { raw: parsed.bundle, bundle: parsed.bundle, changes: parsed.changes, empty: !hasContent(parsed.bundle) };
  }
  const normalized = normalizeBundle(text);
  if (!normalized.bundle) return { problems: normalized.problems };
  return { raw: text, bundle: normalized.bundle, changes: [], empty: !hasContent(normalized.bundle) };
}

const describe = (problem) => {
  const allowed = Array.isArray(problem.allowed) && problem.allowed.length && !String(problem.message).includes(String(problem.allowed[0]))
    ? ` Допустимо: ${problem.allowed.slice(0, MAX_ALLOWED).join(", ")}.`
    : "";
  return `${problem.path ? `${problem.path}: ` : ""}${problem.message}${allowed}`;
};

export function repairMessage({ layer, problems, changes = [] }) {
  const listed = problems.slice(0, MAX_PROBLEMS).map((problem, index) => `${index + 1}. ${describe(problem)}`);
  const fixed = changes.slice(0, MAX_PROBLEMS).map((change) => `- ${typeof change === "string" ? change : change.message || change.path}`);
  return [
    `Проверка не прошла на шаге «${LAYER_NAMES[layer] ?? layer}». Исправь только это, остальное оставь как было, и верни ответ целиком в том же формате.`,
    ...listed,
    ...(fixed.length ? ["Уже поправлено автоматически, проверь, что так и задумано:", ...fixed] : []),
  ].join("\n");
}

// → { ok, reply, checked, summary, attempts, usage, answer }. `checked` is the
// result of checkBundle, or null when the model only answered in words. On a
// failure it holds the last failing check, so the caller sees the layer, the
// problems and what the normalizer fixed.
export async function authorBundle({ provider, state, request, surface = DEFAULT_SURFACE, today = new Date().toLocaleDateString("sv-SE"), maxRepairs = 2, history = [] }) {
  const messages = [{ role: "system", content: renderManual(state, { surface, request, today }) }, ...history, { role: "user", content: String(request) }];
  const usage = [];
  let failed = { layer: "L0", problems: [], changes: [], checked: null };
  let answerText = "";
  for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
    const answer = await provider.complete({ messages, ...(surface === "json" ? { responseFormat: { type: "json_object" } } : {}) });
    if (!answer.ok) return { ok: false, reason: answer.reason, attempts: attempt + 1, usage };
    if (answer.usage) usage.push(answer.usage);
    answerText = contentOf(answer.message);
    const parsed = parse(surface, answerText);
    if (parsed.problems) {
      failed = { layer: "L0", problems: parsed.problems, changes: [], checked: null };
    } else if (parsed.empty) {
      const reply = String(parsed.bundle.reply ?? "").trim();
      if (!reply) {
        failed = { layer: "L0", problems: [parseProblem("В ответе нет ни reply, ни tracks, ни screens, ни remove. Напиши reply или собери приложение.")], changes: [], checked: null };
      } else {
        // The words of a refusal pass the same number rule as the words of an app.
        const checked = checkBundle(parsed.raw, state, { today, request });
        if (checked.ok) return { ok: true, reply, checked: null, summary: "", attempts: attempt + 1, usage, answer: answerText };
        failed = { layer: checked.layer, problems: checked.problems, changes: [...parsed.changes, ...checked.changes], checked };
      }
    } else {
      const checked = checkBundle(parsed.raw, state, { today, request });
      if (checked.ok) {
        return { ok: true, reply: String(parsed.bundle.reply ?? "").trim(), checked, summary: String(checked.summary || parsed.bundle.name || "").slice(0, 80), attempts: attempt + 1, usage, answer: answerText };
      }
      failed = { layer: checked.layer, problems: checked.problems, changes: [...parsed.changes, ...checked.changes], checked };
    }
    messages.push({ role: "assistant", content: answerText }, { role: "user", content: repairMessage(failed) });
  }
  return {
    ok: false,
    reason: "Сборщик не смог собрать проверенное предложение",
    layer: failed.layer,
    problems: failed.problems,
    checked: failed.checked,
    attempts: maxRepairs + 1,
    usage,
    answer: answerText,
  };
}
