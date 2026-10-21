// The builder: an LLM turns a person's words into a Предложение that adds
// types, relations, sets and widgets to the space. The model sees only the
// structure of the space, never the text of objects, and speaks a small op
// language that this module translates into store ops and checks on a copy of
// the space as actor "ai". Nothing is written until the person applies it.
import { openObjectStore } from "./store.js";
import { functionNames } from "./formula.js";
import { FORMATS, DIMENSIONS } from "./schema.js";
import { homeOf } from "./values.js";

export const BUILDER_OPS = Object.freeze(["defineRelation", "defineType", "createSet", "addWidget"]);
const MAX_OPS = 30;

export function spaceOutline(state) {
  const visible = (t) => !t.hidden || ["meal_mark", "session_mark", "discrepancy", "portion", "request_item", "day_plan"].includes(t.key);
  return {
    types: Object.values(state.types).filter(visible).map((t) => ({ key: t.key, name: t.name, fact: Boolean(t.fact), relations: t.relations })),
    relations: Object.values(state.relations).filter((r) => r.format !== "json").map((r) => ({
      key: r.key, name: r.name, format: r.format,
      ...(r.unit ? { unit: r.unit } : {}), ...(r.dimension ? { dimension: r.dimension } : {}),
      ...(r.options?.length ? { options: r.options.map((o) => o.id) } : {}),
      ...(r.types ? { types: r.types } : {}),
    })),
    sets: Object.values(state.objects).filter((o) => o.type === "set" && !o.archivedAt).map((o) => ({ id: o.id, name: o.name })),
    widgets: (homeOf(state)?.props?.widgets || []).map((w) => ({ title: w.title, kind: w.kind })),
    counts: Object.fromEntries(Object.values(state.types).map((t) => [t.key, Object.values(state.objects).filter((o) => o.type === t.key && !o.archivedAt).length]).filter(([, n]) => n)),
  };
}

export function builderPrompt(state, today) {
  return `Ты Сборщик в приложении Cookish. Cookish устроен как Anytype: всё хранится как объекты типов, у типа есть связи (свойства), наборы показывают объекты, главная панель состоит из виджетов. Ты собираешь для человека новые типы, связи, наборы и виджеты. Сегодня ${today}.

Ответ: только JSON {"reply": "1-3 предложения человеку", "summary": "что меняется, до 80 символов", "ops": [...]}.
Операции:
- {"op":"defineRelation","key":"латиница_с_подчёркиванием","name":"Название","format":"${FORMATS.filter((f) => f !== "json").join("|")}","unit":"мл","dimension":"${DIMENSIONS.join("|")}","options":["вариант"],"types":["ключ типа для object/objects"],"formula":"выражение","min":0,"max":5000}
- {"op":"defineType","key":"...","name":"Вода","icon":"💧","fact":true,"relations":["at","water_ml"]}. fact=true для записей о том, что человек сделал или измерил (вода, вес, давление, настроение). Такие записи делает только человек.
- {"op":"createSet","ref":"water_today","name":"Вода сегодня","source":{"type":"water"},"filters":[{"rel":"at","op":"within","value":"@today"}],"sorts":[{"rel":"at","dir":"desc"}],"group":{"rel":"at","by":"day"},"aggregates":[{"rel":"water_ml","fn":"sum"}],"layout":"list|table|kanban|calendar|gallery|checklist","relations":["at","water_ml"]}
- {"op":"addWidget","title":"Вода","set":"ref или id набора","display":"list|number|bars","aggregate":{"rel":"water_ml","fn":"sum|avg|min|max|count"},"series":{"dateRel":"at","valueRel":"water_ml","fn":"sum","range":"@last7d"},"goal":2000}
Фильтры: eq, neq, gt, gte, lt, lte, contains, empty, notEmpty, within. Даты: @today, @yesterday, @last7d, @last30d, @thisWeek, @thisMonth.
Формулы: числа, строки в кавычках, + - * /, сравнения, && || !, связи объекта по ключу, переход по ссылке через точку (product.kcal100), this, today, profile. Функции: ${functionNames().join(", ")}.

Правила:
- Используй существующие связи и типы, если они подходят. Новые ключи только латиницей.
- Ты не создаёшь записи (объекты-факты) и не пишешь в Рацион, Учёт и Историю питания. Записи вносит человек.
- Цели по калориям ниже 1200 ккал не ставь. Не стыди и не наказывай за срывы, серии без обнуления.
- Медицинские показатели (сахар, давление, лекарства) только записываются и показываются трендом. Дозы и диагнозы не считаешь, в reply советуешь врача.
- Если просьба опасна или не выполнима этими операциями, верни "ops": [] и объясни в reply.

Пространство сейчас (только структура): ${JSON.stringify(spaceOutline(state))}`;
}

// Translates builder ops into store ops. Set refs become ids, widgets append
// to the home dashboard. Returns problems instead of throwing.
export function translate(state, ops) {
  const problems = [];
  const storeOps = [];
  const refs = new Map();
  const home = homeOf(state);
  const stamp = Date.now().toString(36);
  const widgets = [...(home?.props?.widgets || [])];
  let widgetsChanged = false;
  if (!Array.isArray(ops)) return { storeOps, problems: ["ops должен быть списком"] };
  if (ops.length > MAX_OPS) return { storeOps, problems: [`не больше ${MAX_OPS} операций за раз`] };
  ops.forEach((op, index) => {
    const where = `операция ${index + 1}`;
    switch (op?.op) {
      case "defineRelation": {
        const { op: _, options, ...rest } = op;
        storeOps.push({ op: "defineRelation", relation: { ...rest, ...(options ? { options: options.map((o) => (typeof o === "string" ? { id: o, name: o } : o)) } : {}) } });
        if (op.format === "formula" && /^ед/i.test(String(op.unit || ""))) problems.push(`${where}: формулы с единицами лекарств не собираю, дозу подбирает врач`);
        break;
      }
      case "defineType": {
        const { op: _, ...type } = op;
        storeOps.push({ op: "defineType", type: { layout: type.fact ? "entry" : "basic", ...type } });
        break;
      }
      case "createSet": {
        const id = `set_${String(op.ref || op.name || index).toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30)}_${stamp}_${index}`;
        refs.set(op.ref || op.name, id);
        storeOps.push({
          op: "create", type: "set", id, name: String(op.name || "Набор"),
          props: {
            query: { source: op.source || {}, filters: op.filters || [], sorts: op.sorts || [], ...(op.group ? { group: op.group } : {}), aggregates: op.aggregates || [] },
            view: { layout: op.layout || "list", relations: op.relations || [] },
          },
        });
        break;
      }
      case "addWidget": {
        if (!home) { problems.push(`${where}: нет главной панели`); break; }
        const setId = refs.get(op.set) || (state.objects[op.set]?.type === "set" ? op.set : null);
        if (!setId) { problems.push(`${where}: нет набора «${op.set}»`); break; }
        const widget = { id: `w_${stamp}_${index}`, kind: "set", title: String(op.title || ""), setId, display: op.display || "list" };
        if (op.aggregate) widget.aggregate = op.aggregate;
        if (op.series) widget.series = op.series;
        if (op.goal != null) widget.goal = Number(op.goal);
        const energy = [op.aggregate?.rel, op.series?.valueRel].some((rel) => state.relations[rel]?.dimension === "energy" || storeOps.some((o) => o.relation?.key === rel && o.relation?.dimension === "energy"));
        if (energy && widget.goal != null && widget.goal < 1200) problems.push(`${where}: цель по калориям ниже 1200 ккал не ставлю`);
        widgets.push(widget);
        widgetsChanged = true;
        break;
      }
      default:
        problems.push(`${where}: Сборщик не умеет «${op?.op}»`);
    }
  });
  if (widgetsChanged) storeOps.push({ op: "update", id: home.id, props: { widgets } });
  return { storeOps, problems };
}

// Applies the ops to a throwaway copy of the space as the assistant would.
export function dryRun(state, storeOps, today) {
  const scratch = openObjectStore({ storage: null, today: () => today });
  scratch.replaceAll(state);
  const result = scratch.apply(storeOps, { actor: "ai", summary: "проверка" });
  return result.ok ? { ok: true, warnings: result.warnings || [] } : { ok: false, problems: result.problems || [result.reason] };
}

function parseAnswer(content) {
  const text = String(content || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

export async function buildProposal({ provider, state, request, today, history = [], maxRepairs = 2 }) {
  const messages = [{ role: "system", content: builderPrompt(state, today) }, ...history, { role: "user", content: String(request) }];
  const usage = [];
  let lastProblems = [];
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const answer = await provider.complete({ messages, responseFormat: { type: "json_object" } });
    if (!answer.ok) return { ok: false, reason: answer.reason, usage };
    if (answer.usage) usage.push(answer.usage);
    const content = typeof answer.message.content === "string" ? answer.message.content : answer.message.content?.map?.((p) => p.text).join("") || "";
    const parsed = parseAnswer(content);
    let problems;
    let storeOps = [];
    if (!parsed) problems = ["ответ не JSON"];
    else {
      const translated = translate(state, parsed.ops || []);
      storeOps = translated.storeOps;
      problems = translated.problems;
      if (!problems.length && storeOps.length) {
        const check = dryRun(state, storeOps, today);
        if (!check.ok) problems = check.problems;
      }
    }
    if (!problems.length) {
      return {
        ok: true,
        usage,
        attempts: attempt + 1,
        answer: content,
        proposal: { reply: String(parsed.reply || ""), summary: String(parsed.summary || "Изменения пространства").slice(0, 80), ops: storeOps },
      };
    }
    lastProblems = problems;
    messages.push({ role: "assistant", content }, { role: "user", content: `Проверка не прошла: ${problems.join("; ")}. Исправь и верни JSON целиком.` });
  }
  return { ok: false, reason: "Сборщик не смог собрать проверенное предложение", problems: lastProblems, usage };
}
