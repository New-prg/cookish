// GLM 5.3 Flash: agent loop with tool calls over ration domain commands.
import { rai } from "./rai.mjs";
import { TODAY, addDays, weekday, viewDay, viewProfile, catalog, toDomainMeals, gateDay, run } from "./fixture.mjs";
import { parseRationDate } from "../../mobile-shell/ration-domain.js";

const MODEL = "z-ai/glm-5.3-flash";
const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

const mealsSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      name: { type: "string" }, time: { type: "string", description: "HH:MM" },
      items: { type: "array", items: { type: "object", properties: { product: { type: "string", description: "Точное название из каталога" }, grams: { type: "number" } }, required: ["product", "grams"] } },
    },
    required: ["name", "time", "items"],
  },
};

const TOOLS = [
  { name: "get_plan", description: "Прочитать план на диапазон дат (включительно), с КБЖУ по дням.", parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] } },
  { name: "get_profile", description: "Профиль рациона: цели КБЖУ, исключения, предпочтения.", parameters: { type: "object", properties: {} } },
  { name: "get_catalog", description: "Каталог продуктов пользователя с КБЖУ на 100 г. Использовать можно только эти продукты.", parameters: { type: "object", properties: {} } },
  { name: "set_special_day", description: "Заменить план на одну дату (Особый день). Передай ВСЕ приёмы пищи дня целиком.", parameters: { type: "object", properties: { date: { type: "string" }, meals: mealsSchema }, required: ["date", "meals"] } },
  { name: "release_version", description: "Выпустить новую Версию недельного цикла, действующую с даты effective_from. Нужны все 7 дней недели, ключи пн..вс.", parameters: { type: "object", properties: { effective_from: { type: "string" }, week: { type: "object", properties: Object.fromEntries(WEEKDAYS.map((d) => [d, mealsSchema])), required: WEEKDAYS } }, required: ["effective_from", "week"] } },
].map((f) => ({ type: "function", function: f }));

const SYSTEM = `Ты планировщик рациона в приложении Cookish. Сегодня ${TODAY} (${weekday(TODAY)}). Завтра ${addDays(TODAY, 1)}.
Правила:
- Меняй план только инструментами. Сначала читай нужную часть плана и каталог.
- Используй только продукты из каталога, точными названиями.
- Одна дата → set_special_day. Регулярное изменение «с даты» → release_version.
- Держи КБЖУ дня в пределах ±15% от целей профиля. Код проверит план и вернёт ошибки — исправь и повтори.
- Историю питания (прошедшие дни, что было съедено) ты менять не можешь: пользователь отмечает её сам в Истории, там же Расхождения.
- Не ставь план ниже 1200 ккал, не лечи и не диагностируй. При опасных просьбах откажи и посоветуй врача.
- Отвечай кратко по-русски.`;

function tool(state, name, args) {
  switch (name) {
    case "get_plan": {
      const days = []; for (let d = args.from; d <= args.to && days.length < 14; d = addDays(d, 1)) days.push(viewDay(state, d));
      return { state, out: days };
    }
    case "get_profile": return { state, out: viewProfile(state) };
    case "get_catalog": return { state, out: catalog(state).map(({ tags, ...p }) => p) };
    case "set_special_day": {
      const { meals, errors } = toDomainMeals(state, args.meals);
      if (errors.length) return { state, out: { ok: false, errors } };
      const r = run(state, { type: "setSpecialDay", date: args.date, meals });
      if (!r.ok) return { state, out: r };
      const gate = gateDay(r.state, args.date);
      if (!gate.ok) return { state, out: { ok: false, gate: gate.problems, totals: gate.totals } };
      return { state: r.state, out: { ok: true, totals: gate.totals } };
    }
    case "release_version": {
      const from = args.effective_from;
      if (from <= TODAY) return { state, out: { ok: false, error: "Версия может начинаться только с будущей даты." } };
      const startIdx = (parseRationDate(from).getDay() + 6) % 7; // пн=0
      const errors = []; const days = [];
      for (let k = 0; k < 7; k++) {
        const key = WEEKDAYS[(startIdx + k) % 7];
        const conv = toDomainMeals(state, args.week?.[key]); errors.push(...conv.errors);
        days.push({ meals: conv.meals });
      }
      if (errors.length) return { state, out: { ok: false, errors: [...new Set(errors)] } };
      const r = run(state, { type: "releaseVersion", anchor: from, effectiveFrom: from, weekdayBinding: true, days });
      if (!r.ok) return { state, out: r };
      const problems = [];
      for (let k = 0; k < 7; k++) { const d = addDays(from, k); const g = gateDay(r.state, d); if (!g.ok) problems.push({ date: d, weekday: weekday(d), problems: g.problems }); }
      if (problems.length) return { state, out: { ok: false, gate: problems } };
      return { state: r.state, out: { ok: true, versionId: r.versionId } };
    }
    default: return { state, out: { ok: false, error: "unknown tool" } };
  }
}

export async function runGlm(state, prompt, { effort = "low", maxTurns = 10 } = {}) {
  const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }];
  const trace = []; let tokensIn = 0, tokensOut = 0, reasoning = 0, cost = 0, calls = 0; const t0 = Date.now();
  for (let turn = 0; turn < maxTurns; turn++) {
    const r = await rai("/api/v1/chat/completions", { model: MODEL, messages, tools: TOOLS, tool_choice: "auto", temperature: 0.2, max_tokens: 16000, reasoning: { effort } });
    calls++;
    if (r.status !== 200) { trace.push({ error: r.json }); return { state, reply: "", trace, error: JSON.stringify(r.json).slice(0, 300), ms: Date.now() - t0, calls, tokensIn, tokensOut, reasoning, cost }; }
    const u = r.json.usage || {}; tokensIn += u.prompt_tokens || 0; tokensOut += u.completion_tokens || 0; reasoning += u.completion_tokens_details?.reasoning_tokens || 0; cost += u.cost || 0;
    const msg = r.json.choices[0].message;
    messages.push({ role: "assistant", content: msg.content || "", tool_calls: msg.tool_calls, reasoning_content: msg.reasoning });
    if (!msg.tool_calls?.length) { trace.push({ say: msg.content }); return { state, reply: msg.content || "", trace, ms: Date.now() - t0, calls, tokensIn, tokensOut, reasoning, cost }; }
    for (const tc of msg.tool_calls) {
      let args; try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = null; }
      const res = args ? tool(state, tc.function.name, args) : { state, out: { ok: false, error: "invalid JSON arguments" } };
      state = res.state;
      trace.push({ tool: tc.function.name, args: summarizeArgs(tc.function.name, args), ok: res.out?.ok, out: JSON.stringify(res.out).slice(0, 240) });
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(res.out) });
    }
  }
  return { state, reply: "", trace, error: "max turns", ms: Date.now() - t0, calls, tokensIn, tokensOut, reasoning, cost };
}

function summarizeArgs(name, a) {
  if (!a) return "∅";
  if (name === "set_special_day") return `${a.date}: ${(a.meals || []).map((m) => `${m.name}[${(m.items || []).map((i) => `${i.product} ${i.grams}`).join(", ")}]`).join(" | ")}`;
  if (name === "release_version") return `${a.effective_from}: ${Object.entries(a.week || {}).map(([d, ms]) => `${d}:${(ms || []).length}`).join(" ")}`;
  return JSON.stringify(a);
}
