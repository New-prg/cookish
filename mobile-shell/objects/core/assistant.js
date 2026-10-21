// The Ассистент on objects. The model reads the space through tools and
// answers with Предложения; each write tool runs its ops on a scratch copy of
// the space as actor "ai", so the store rules (no facts, guarded targets, the
// past plan, the КБЖУ day gate) refuse what is not allowed and the refusal
// goes back to the model as problems to fix. Nothing is written to the real
// space until the person applies a Предложение. Later reads of the same
// conversation see the pending Предложения, as if they were applied.
import { applyThreadEvent } from "../../core/assistant-thread.js";
import { normalizeProductName } from "../../core/ration-domain.js";
import { COMPACTION, compactThread, requestChars } from "../../services/assistant/context-compaction.js";
import { FOOD_TOOLS, createFoodSession, findReferenceTool, resolveCard, searchFoodTool } from "../../services/assistant/food-tools.js";
import { opLanguage, spaceOutline, translate } from "./builder.js";
import { cardProps, createOp, findProductByName } from "./catalog.js";
import { changeRows } from "./changes.js";
import { AREAS, shiftDate } from "./domain.js";
import { FILTER_OPS, runQuery } from "./query.js";
import { openObjectStore } from "./store.js";
import { SYSTEM_FIELDS, displayValue, profileOf, round2, valueOf } from "./values.js";
import { protectiveReasons, raisesDeficit } from "./assistant-safety.js";
import { WEEK_KEYS, dayOps, dayPreview, parseDay, rationDayView, rationHistoryView, shortDate, sportDayView, sportHistoryView, weekOps, weekdayKey } from "./assistant-plan.js";

export const ASSISTANT_MAX_TURNS = 8;
export const MAX_PLAN_DAYS = 14;
export const MAX_HISTORY_DAYS = 28;
const MAX_FIND = 50;
const MAX_TOOL_CHARS = 40_000;
// Days a Предложение is checked over for the safety balance, from today.
const BALANCE_DAYS = 14;

// Types the Ассистент does not write through propose_objects: the plan has
// its own tools, sets and widgets go through propose_space, and the profile
// (targets, excluded products) is the person's.
const NOT_FOR_OBJECTS = new Set(["week_plan", "day_plan", "meal", "portion", "session", "profile", "set", "dashboard"]);

const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

// ——— Tools ———

const dateProp = { type: "string", description: "ГГГГ-ММ-ДД" };
const areaProp = { type: "string", enum: Object.keys(AREAS), description: "ration — Рацион (питание), sport — Спорт (тренировки)" };
const datesSchema = (extra = {}) => ({ type: "object", properties: { area: areaProp, from: dateProp, to: dateProp, ...extra }, required: ["area", "from", "to"] });

const mealsSchema = {
  type: "array",
  description: "Рацион: все приёмы пищи дня целиком",
  items: {
    type: "object",
    properties: {
      name: { type: "string" },
      time: { type: "string", description: "ЧЧ:ММ" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            product: { type: "string", description: "id продукта из find_objects, точное название или название из new_products" },
            amount: { type: "number", description: "Порция в единице продукта: г, мл или шт." },
          },
          required: ["product", "amount"],
        },
      },
    },
    required: ["name", "time", "items"],
  },
};

const sessionsSchema = {
  type: "array",
  description: "Спорт: все тренировки дня целиком, пустой список это день отдыха",
  items: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["strength", "run", "swim", "bike", "walk", "yoga", "other"], description: "strength — силовая, run — бег, swim — плавание, bike — велосипед, walk — ходьба, yoga — йога, other — другое" },
      time: { type: "string", description: "ЧЧ:ММ" },
      duration: { type: "number", description: "минуты, 5–600" },
      intensity: { type: "string", enum: ["low", "medium", "high"], description: "low — низкая, medium — средняя, high — высокая" },
      note: { type: "string" },
    },
    required: ["kind", "time", "duration", "intensity"],
  },
};

const newProductsSchema = {
  type: "array",
  description: "Продукты, которых ещё нет: цифры возьмёт код из карточки, которую ты назвал. source=reference — id из find_reference; source=off — штрихкод из search_food; source=estimate — твоя оценка, только если ничего не нашлось (передай calories, protein, fat, carbs на 100 г/мл).",
  items: {
    type: "object",
    properties: {
      name: { type: "string" },
      source: { type: "string", enum: ["reference", "off", "estimate"] },
      source_ref: { type: "string", description: "id справочника или штрихкод" },
      unit: { type: "string", enum: ["г", "мл", "шт."] },
      piece_weight: { type: "number", description: "вес одной штуки в граммах, нужен для unit=шт." },
      calories: { type: "number" },
      protein: { type: "number" },
      fat: { type: "number" },
      carbs: { type: "number" },
      fiber: { type: "number" },
    },
    required: ["name", "source"],
  },
};

const weekDay = { type: "array", description: "Рацион: приёмы пищи как в meals; Спорт: тренировки как в sessions", items: { type: "object" } };

const READ_TOOLS = [
  { name: "get_space", description: "Устройство пространства: типы и их связи, связи с форматами, наборы, виджеты на главной, сколько объектов каждого типа. Без текста объектов.", parameters: { type: "object", properties: {} } },
  {
    name: "find_objects",
    description: "Найти объекты типа с фильтрами и сортировкой (до 50). Значения связей показаны так, как их видит человек; ссылки это {id, name}.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", description: "ключ типа из get_space, например product, note, request" },
        filters: { type: "array", items: { type: "object", properties: { rel: { type: "string", description: "ключ связи" }, op: { type: "string", enum: FILTER_OPS }, value: { description: "значение; для within диапазон вроде @last7d, для in список" } }, required: ["rel", "op"] } },
        sorts: { type: "array", items: { type: "object", properties: { rel: { type: "string" }, dir: { type: "string", enum: ["asc", "desc"] } }, required: ["rel"] } },
        limit: { type: "number" },
        relations: { type: "array", items: { type: "string" }, description: "какие связи показать; по умолчанию главные связи типа" },
      },
      required: ["type"],
    },
  },
  { name: "get_object", description: "Один объект целиком: значения всех связей (формулы посчитаны) и сколько объектов каждого типа на него ссылается.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "get_plan", description: "Прочитать план Рациона или Спорта на диапазон дат (включительно, до 14 дней): приёмы пищи с продуктами и КБЖУ дня или тренировки с расходом ккал.", parameters: datesSchema() },
  { name: "get_history", description: "Что человек отметил в прошедшие дни (до 28 дней): отметки приёмов или тренировок, расхождения, фактические ккал. Только чтение.", parameters: datesSchema() },
  { name: "get_profile", description: "Профиль: цели КБЖУ, рост, вес, исключённые продукты, предпочтения.", parameters: { type: "object", properties: {} } },
  { name: "get_change_sets", description: "Журнал последних изменений плана и пространства (человека и ассистента) с id для отката.", parameters: { type: "object", properties: { limit: { type: "number" } } } },
  ...FOOD_TOOLS.map((tool) => tool.function).filter((tool) => tool.name !== "upsert_product"),
];

const WRITE_TOOLS = [
  {
    name: "propose_day",
    description: "Предложить Особый день: заменить план одной даты (сегодня или будущее). Передай ВСЕ приёмы пищи (meals) или ВСЕ тренировки (sessions) дня целиком. Новые продукты опиши в new_products.",
    parameters: { type: "object", properties: { area: areaProp, date: dateProp, meals: mealsSchema, sessions: sessionsSchema, new_products: newProductsSchema }, required: ["area", "date"] },
  },
  {
    name: "propose_week",
    description: "Предложить новую неделю плана, которая действует с даты effective_from (завтра или позже; сегодняшний день меняй через propose_day). Нужны все 7 дней, ключи пн..вс; день отдыха в Спорте это пустой список.",
    parameters: { type: "object", properties: { area: areaProp, effective_from: dateProp, week: { type: "object", properties: Object.fromEntries(WEEK_KEYS.map((key) => [key, weekDay])), required: WEEK_KEYS }, new_products: newProductsSchema }, required: ["area", "effective_from", "week"] },
  },
  {
    name: "propose_objects",
    description: "Предложить создать, изменить или убрать объекты: продукты, заметки, запросы на покупки, объекты своих типов. Не для плана (propose_day, propose_week), не для профиля и не для записей-фактов: отметки, покупки и записи трекеров вносит только человек. Для связи с продуктом можно писать его название.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "что меняется, до 80 символов" },
        ops: {
          type: "array",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["create", "update", "archive"] },
              type: { type: "string", description: "ключ типа, для create" },
              id: { type: "string", description: "для update и archive; для create необязательно (латиница, цифры, _), так на объект можно сослаться в другой операции" },
              name: { type: "string" },
              props: { type: "object", description: "ключ связи → значение; null очищает" },
            },
            required: ["op"],
          },
        },
      },
      required: ["summary", "ops"],
    },
  },
  {
    name: "propose_space",
    description: `Предложить свои типы, связи, наборы и виджеты на главной (трекер воды, веса, давления и т. п.). Операции:\n${opLanguage()}`,
    parameters: { type: "object", properties: { summary: { type: "string", description: "что меняется, до 80 символов" }, ops: { type: "array", items: { type: "object" } } }, required: ["summary", "ops"] },
  },
  { name: "propose_revert", description: "Предложить откат набора изменений из журнала (своего или ручного).", parameters: { type: "object", properties: { id: { type: "string", description: "id из get_change_sets" } }, required: ["id"] } },
];

export const OBJECT_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS].map((tool) => ({ type: "function", function: tool }));

// ——— Thread and Предложения ———

export function newThread() {
  return { id: `thread_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, createdAt: new Date().toISOString(), messages: [], log: [], proposals: [], promptTokens: 0, promptChars: 0 };
}

const proposalOf = (thread, id) => thread.proposals.find((proposal) => proposal.id === id);
export const pendingProposals = (thread) => thread.proposals.filter((proposal) => proposal.status === "pending");

// Applies, in order, the Предложения that still wait or conflicted, to a
// scratch store as actor "ai". One that fits stays pending (and is part of the
// scratch space from then on); one that does not becomes a conflict with the
// reason of the store.
function replay(scratch, thread) {
  for (const proposal of thread.proposals) {
    if (proposal.status !== "pending" && proposal.status !== "conflict") continue;
    const result = scratch.apply(proposal.ops, { actor: "ai", summary: proposal.summary });
    if (result.ok) {
      proposal.status = "pending";
      delete proposal.reason;
    } else {
      proposal.status = "conflict";
      proposal.reason = result.reason;
    }
  }
}

function scratchOf(state, today) {
  const scratch = openObjectStore({ storage: null, today: () => today });
  scratch.replaceAll(state);
  return scratch;
}

// Marks the Предложения the space no longer fits as conflicts.
export function recheckProposals(state, thread, today) {
  replay(scratchOf(state, today), thread);
  return thread.proposals;
}

export function applyProposal(store, thread, id) {
  const proposal = proposalOf(thread, id);
  if (!proposal || proposal.status !== "pending") return { ok: false, reason: "Это предложение уже не ждёт решения." };
  const waiting = (proposal.dependsOn || []).map((dep) => proposalOf(thread, dep)).find((dep) => dep && dep.status !== "applied");
  if (waiting) return { ok: false, reason: `Сначала примените «${waiting.summary}»: на него опирается это предложение.` };
  const result = store.apply(proposal.ops, { actor: "ai", summary: proposal.summary });
  if (!result.ok) {
    proposal.status = "conflict";
    proposal.reason = result.reason;
    return { ok: false, reason: result.reason };
  }
  proposal.status = "applied";
  proposal.changeSetId = result.changeSetId;
  delete proposal.reason;
  return { ok: true, changeSetId: result.changeSetId };
}

export function discardProposal(thread, id) {
  const proposal = proposalOf(thread, id);
  if (!proposal || (proposal.status !== "pending" && proposal.status !== "conflict")) return { ok: false, reason: "Это предложение уже не ждёт решения." };
  proposal.status = "discarded";
  return { ok: true };
}

// Takes an applied Предложение back through the journal, as the person's undo.
export function revertProposal(store, thread, id, summary = "") {
  const proposal = proposalOf(thread, id);
  if (!proposal || proposal.status !== "applied" || !proposal.changeSetId) return { ok: false, reason: "Это предложение не применено." };
  const result = store.apply({ op: "revert", changeSetId: proposal.changeSetId }, { actor: "human", summary: summary || `Отмена: ${proposal.summary}` });
  if (result.ok) proposal.status = "reverted";
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

// ——— Reading ———

function plain(state, obj, relKey, ctx) {
  const rel = state.relations[relKey];
  const value = valueOf(state, obj, relKey, ctx);
  if (value == null || value === "") return null;
  switch (rel?.format) {
    case "number":
    case "formula": return typeof value === "number" ? round2(value) : value;
    case "object": return { id: value, name: state.objects[value]?.name || "" };
    case "objects": return (Array.isArray(value) ? value : []).slice(0, 12).map((id) => ({ id, name: state.objects[id]?.name || "" }));
    case "select":
    case "multiselect": return displayValue(state, obj, relKey, ctx);
    default: return value;
  }
}

const compactProps = (state, obj, keys, ctx) => Object.fromEntries(keys.map((key) => [key, plain(state, obj, key, ctx)]).filter(([, value]) => value != null));
const shownRelations = (state, typeKey) => (state.types[typeKey]?.relations || []).filter((key) => state.relations[key] && !state.relations[key].hidden && state.relations[key].format !== "json");

function dateRange(from, to, limit) {
  if (!isDate(from) || !isDate(to)) return { ok: false, error: "Даты должны быть в формате ГГГГ-ММ-ДД." };
  if (from > to) return { ok: false, error: "from позже to." };
  const dates = [];
  for (let date = from; date <= to && dates.length < limit; date = shiftDate(date, 1)) dates.push(date);
  return { ok: true, dates };
}

function findObjects(args, { state, ctx }) {
  const type = state.types[args.type];
  if (!type) return { ok: false, error: `Нет типа «${args.type}»: ключи типов в get_space.` };
  const known = (rel) => SYSTEM_FIELDS.includes(rel) || state.relations[rel];
  const filters = Array.isArray(args.filters) ? args.filters : [];
  const sorts = Array.isArray(args.sorts) ? args.sorts : [];
  const bad = [...filters, ...sorts].find((entry) => !known(entry?.rel));
  if (bad) return { ok: false, error: `Нет связи «${bad?.rel}»: ключи связей в get_space.` };
  const op = filters.find((entry) => !FILTER_OPS.includes(entry.op));
  if (op) return { ok: false, error: `Нет фильтра «${op.op}». Есть: ${FILTER_OPS.join(", ")}.` };
  const keys = (Array.isArray(args.relations) && args.relations.length ? args.relations : shownRelations(state, args.type).slice(0, 8)).filter(known);
  let rows;
  try {
    rows = runQuery(state, { source: { type: args.type }, filters, sorts }, ctx).rows;
  } catch (error) {
    return { ok: false, error: error.message };
  }
  const limit = Math.min(Math.max(Math.round(Number(args.limit)) || 20, 1), MAX_FIND);
  return {
    ok: true,
    total: rows.length,
    objects: rows.slice(0, limit).map((obj) => ({ id: obj.id, name: obj.name, ...compactProps(state, obj, keys, ctx) })),
  };
}

function getObject(args, { state, ctx }) {
  const obj = state.objects[String(args.id || "")];
  if (!obj || obj.archivedAt) return { ok: false, error: "Объекта с таким id нет." };
  const keys = [...new Set([...shownRelations(state, obj.type), ...Object.keys(obj.props || {})])].filter((key) => state.relations[key]);
  const counts = {};
  for (const other of Object.values(state.objects)) {
    if (other.archivedAt || other.id === obj.id) continue;
    const links = Object.entries(other.props || {}).some(([key, value]) => ["object", "objects"].includes(state.relations[key]?.format) && (Array.isArray(value) ? value : [value]).includes(obj.id));
    if (links) counts[state.types[other.type]?.name || other.type] = (counts[state.types[other.type]?.name || other.type] || 0) + 1;
  }
  return { ok: true, id: obj.id, type: obj.type, typeName: state.types[obj.type]?.name, name: obj.name, createdBy: obj.createdBy, props: compactProps(state, obj, keys, ctx), backlinks: counts };
}

// Links read as plain names here: the model needs «исключено: Тофу», not ids.
function profileView(state, ctx) {
  const profile = profileOf(state);
  if (!profile) return {};
  const props = compactProps(state, profile, shownRelations(state, "profile"), ctx);
  if (props.excluded) props.excluded = props.excluded.map((entry) => entry.name);
  return props;
}

function changeSets(args, { base }) {
  const limit = Math.min(Math.max(Math.round(Number(args.limit)) || 10, 1), 30);
  const reverted = new Set(base.journal.map((entry) => entry.revertOf).filter(Boolean));
  return base.journal.slice(-limit).reverse().map((entry) => ({ id: entry.id, at: entry.at, actor: entry.actor, summary: entry.summary, ...(reverted.has(entry.id) ? { reverted: true } : {}), ...(entry.revertOf ? { revertOf: entry.revertOf } : {}) }));
}

// ——— Products of a Предложение ———

// A product named in a plan: an id, a name of the space, or a product the
// same Предложение creates.
function productFinder(work, fresh) {
  return (ref) => {
    const state = work.scratch.state();
    const text = String(ref ?? "").trim();
    const byId = state.objects[text];
    const product = byId?.type === "product" && !byId.archivedAt ? byId : findProductByName(state, text);
    if (product) return { id: product.id, name: product.name, unit: product.props.unit };
    return fresh.get(normalizeProductName(text)) || null;
  };
}

// new_products → ops. A product the space has with КБЖУ is used as it is; one
// without КБЖУ gets the card; the rest are created. Cards of the reference
// and Open Food Facts carry code-checked numbers; an estimate is the model's.
async function productOps(entries, work) {
  const fresh = new Map();
  const ops = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const name = String(entry?.name || "").trim();
    if (!name) return { error: { ok: false, error: "У нового продукта нет названия." } };
    const state = work.scratch.state();
    const existing = findProductByName(state, name);
    if (existing && existing.props.kcal100 != null) continue;
    const card = await resolveCard(entry, work.session);
    if (!card.ok) return { error: card };
    if (existing) {
      ops.push({ op: "update", id: existing.id, props: cardProps({ ...card, name }) });
      continue;
    }
    const unit = entry.unit || card.unit || "г";
    const pieceWeight = Number(entry.piece_weight);
    if (unit === "шт." && !(pieceWeight > 0)) return { error: { ok: false, error: `Для «${name}» в штуках нужен вес штуки: piece_weight в граммах.` } };
    const op = createOp(state, { ...card, name, unit });
    op.id = work.scratch.newId("product");
    op.props.confirmed = false;
    if (pieceWeight > 0) op.props.pieceWeight = pieceWeight;
    ops.push(op);
    fresh.set(normalizeProductName(name), { id: op.id, name, unit: op.props.unit });
  }
  return { ops, fresh };
}

const productRows = (state, ops) => changeRows(state, ops.filter((op) => op.op === "create" || op.op === "update"));

// ——— Writing: the Предложения ———

const balanceDates = (today, extra = []) => [...new Set([...Array.from({ length: BALANCE_DAYS }, (_, index) => shiftDate(today, index)), ...extra])];

// Runs a Предложение on the scratch space; when the store rules and the
// protective mode let it through, it becomes a card in the thread and stays in
// the scratch space for the rest of the run.
function finish(spec, work) {
  const { scratch, thread } = work;
  const before = scratch.state();
  const applied = scratch.apply(spec.ops, { actor: "ai", summary: spec.summary });
  if (!applied.ok) return { ok: false, problems: applied.problems || [applied.reason], hint: "Исправь и предложи снова." };
  const after = scratch.state();
  const refuse = (result) => { scratch.replaceAll(before); return result; };
  if (work.protective.length && raisesDeficit(before, after, balanceDates(work.today, spec.dates))) {
    return refuse({
      ok: false,
      error: `Снижать калории или добавлять нагрузку сейчас нельзя: ${work.protective.join(", ")}.`,
      hint: "Не помогай худеть. Мягко посоветуй обратиться к врачу или к специалисту по расстройствам пищевого поведения.",
    });
  }
  const preview = spec.preview(before, after);
  if (preview.days && !preview.days.some((day) => day.changes.length)) return refuse({ ok: false, error: "Предложение ничего не меняет в плане." });
  // What this Предложение builds on: pending ones that create objects it uses.
  const text = JSON.stringify(spec.ops);
  const dependsOn = pendingProposals(thread).filter((other) => other.ops.some((op) => op.op === "create" && op.id && text.includes(`"${op.id}"`))).map((other) => other.id);
  const proposal = {
    id: `proposal_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind: spec.kind,
    summary: spec.summary,
    ops: spec.ops,
    status: "pending",
    preview,
    ...(dependsOn.length ? { dependsOn } : {}),
    ...(applied.warnings?.length ? { warnings: applied.warnings } : {}),
    createdAt: new Date().toISOString(),
  };
  work.emit({ type: "proposal", proposal });
  const days = preview.days || [];
  return {
    ok: true,
    proposalId: proposal.id,
    summary: spec.summary,
    preview: days.length ? { days: days.map((day) => ({ date: day.date, before: day.before, after: day.after, ...(days.length <= 2 ? { changes: day.changes } : {}) })) } : { rows: preview.rows },
    note: "Предложение показано человеку карточкой. Данные изменятся только после его подтверждения.",
    ...(proposal.warnings ? { warnings: proposal.warnings, hint: "Скажи человеку о предупреждениях." } : {}),
  };
}

async function proposeDay(args, work) {
  const area = AREAS[args.area] ? args.area : null;
  if (!area) return { ok: false, error: "area: ration или sport." };
  const date = String(args.date || "");
  if (!isDate(date)) return { ok: false, error: "Дата должна быть в формате ГГГГ-ММ-ДД." };
  if (date < work.today) return { ok: false, error: "Прошедшие дни менять нельзя: отметки прошлого делает человек." };
  const products = area === "ration" ? await productOps(args.new_products, work) : { ops: [], fresh: new Map() };
  if (products.error) return products.error;
  const parsed = parseDay(work.scratch.state(), area, area === "ration" ? args.meals : args.sessions, productFinder(work, products.fresh));
  if (parsed.errors.length) return { ok: false, problems: parsed.errors };
  const ops = [...products.ops, ...dayOps(work.scratch.state(), area, date, parsed.items, work.scratch.newId)];
  return finish({
    kind: "day",
    summary: `${area === "ration" ? "Особый день" : "Тренировки"} · ${shortDate(date)}`,
    ops,
    dates: [date],
    preview: (before, after) => ({ type: "days", days: [dayPreview(before, after, area, date, work.ctx)], rows: productRows(before, products.ops) }),
  }, work);
}

async function proposeWeek(args, work) {
  const area = AREAS[args.area] ? args.area : null;
  if (!area) return { ok: false, error: "area: ration или sport." };
  const from = String(args.effective_from || "");
  if (!isDate(from)) return { ok: false, error: "effective_from должна быть в формате ГГГГ-ММ-ДД." };
  if (from <= work.today) return { ok: false, error: "Новая неделя может начинаться только завтра или позже: действующая неделя и сегодняшний день не меняются. Сегодня меняй через propose_day." };
  const products = area === "ration" ? await productOps(args.new_products, work) : { ops: [], fresh: new Map() };
  if (products.error) return products.error;
  const find = productFinder(work, products.fresh);
  const errors = [];
  const days = Array.from({ length: 7 }, (_, index) => {
    const key = weekdayKey(shiftDate(from, index));
    if (!Array.isArray(args.week?.[key])) errors.push(`Нет дня «${key}» в неделе.`);
    const parsed = parseDay(work.scratch.state(), area, args.week?.[key] || [], find);
    errors.push(...parsed.errors);
    return parsed.items;
  });
  if (errors.length) return { ok: false, problems: [...new Set(errors)] };
  const dates = Array.from({ length: 7 }, (_, index) => shiftDate(from, index));
  const ops = [...products.ops, ...weekOps(work.scratch.state(), area, from, days, work.scratch.newId)];
  return finish({
    kind: "week",
    summary: `${area === "ration" ? "Новая неделя" : "Расписание тренировок"} с ${shortDate(from)}`,
    ops,
    dates,
    preview: (before, after) => ({ type: "days", days: dates.map((date) => dayPreview(before, after, area, date, work.ctx)), rows: productRows(before, products.ops) }),
  }, work);
}

// Model props in the person's terms (option names, product names) into the
// values the store checks.
function normalizeProps(state, props) {
  const out = {};
  const problems = [];
  for (const [key, value] of Object.entries(props && typeof props === "object" ? props : {})) {
    const rel = state.relations[key];
    if (!rel) { problems.push(`Нет связи «${key}»: ключи связей в get_space.`); continue; }
    let next = value;
    if (value != null && ["select", "multiselect"].includes(rel.format)) {
      const pick = (v) => rel.options?.find((o) => o.id === v)?.id ?? rel.options?.find((o) => String(o.name).toLowerCase() === String(v).toLowerCase())?.id ?? v;
      next = Array.isArray(value) ? value.map(pick) : pick(value);
    } else if (value != null && ["object", "objects"].includes(rel.format)) {
      const pick = (v) => {
        if (state.objects[v]) return v;
        const named = Object.values(state.objects).filter((o) => !o.archivedAt && (!rel.types?.length || rel.types.includes(o.type)) && normalizeProductName(o.name) === normalizeProductName(v));
        return named.length === 1 ? named[0].id : v;
      };
      next = Array.isArray(value) ? value.map(pick) : pick(value);
    } else if (rel.format === "number" && typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      next = Number(value);
    }
    out[key] = next;
  }
  return { props: out, problems };
}

function proposeObjects(args, work) {
  const state = work.scratch.state();
  const list = Array.isArray(args.ops) ? args.ops : null;
  if (!list?.length) return { ok: false, error: "ops: нужен список операций." };
  if (list.length > 20) return { ok: false, error: "Не больше 20 операций за раз." };
  const problems = [];
  const ops = list.map((op, index) => {
    const where = `операция ${index + 1}`;
    const target = state.objects[op?.id];
    const typeKey = op?.op === "create" ? op.type : target?.type;
    if (!["create", "update", "archive"].includes(op?.op)) { problems.push(`${where}: нет операции «${op?.op}»`); return null; }
    if (op.op !== "create" && (!target || target.archivedAt)) { problems.push(`${where}: нет объекта ${op.id}`); return null; }
    if (!state.types[typeKey]) { problems.push(`${where}: нет типа «${typeKey}»`); return null; }
    if (NOT_FOR_OBJECTS.has(typeKey)) { problems.push(`${where}: тип «${state.types[typeKey].name}» через propose_objects не меняется (план: propose_day и propose_week; наборы и виджеты: propose_space; профиль меняет человек)`); return null; }
    if (op.op === "archive") return { op: "archive", id: op.id };
    const normalized = normalizeProps(state, op.props);
    problems.push(...normalized.problems.map((message) => `${where}: ${message}`));
    if (op.op === "update") return { op: "update", id: op.id, ...(op.name !== undefined ? { name: String(op.name) } : {}), props: normalized.props };
    const id = op.id && /^[a-z][a-z0-9_]{2,40}$/.test(op.id) && !state.objects[op.id] ? op.id : work.scratch.newId(typeKey);
    return { op: "create", type: typeKey, id, name: String(op.name ?? ""), props: normalized.props };
  });
  if (problems.length) return { ok: false, problems };
  const summary = String(args.summary || "Изменения объектов").slice(0, 80);
  return finish({ kind: "objects", summary, ops, dates: [], preview: (before) => ({ type: "rows", rows: changeRows(before, ops) }) }, work);
}

function proposeSpace(args, work) {
  const { storeOps, problems } = translate(work.scratch.state(), args.ops);
  if (problems.length) return { ok: false, problems };
  if (!storeOps.length) return { ok: false, error: "Нечего предлагать: в ops нет операций." };
  const summary = String(args.summary || "Изменения пространства").slice(0, 80);
  return finish({ kind: "space", summary, ops: storeOps, dates: [], preview: (before) => ({ type: "rows", rows: changeRows(before, storeOps) }) }, work);
}

function proposeRevert(args, work) {
  const id = String(args.id || "");
  const set = work.base.journal.find((entry) => entry.id === id);
  if (!set) return { ok: false, error: "Набор изменений не найден: возьми id из get_change_sets." };
  if (work.base.journal.some((entry) => entry.revertOf === id)) return { ok: false, error: "Этот набор уже откатили." };
  const summary = `Откат: ${set.summary}`.slice(0, 80);
  return finish({
    kind: "revert",
    summary,
    ops: [{ op: "revert", changeSetId: id }],
    dates: [],
    preview: () => ({ type: "rows", rows: [["Откат", set.summary, `${Object.keys(set.before).length} объектов`]] }),
  }, work);
}

// ——— Prompt ———

const WEEKDAY_NAMES = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const weekdayName = (date) => WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];

// What the model always has: today, the profile and today's plan. Details come
// from the tools.
export function assistantContext(state, today) {
  const ctx = { today };
  const rationToday = rationDayView(state, today, ctx);
  const sportToday = sportDayView(state, today, ctx);
  return {
    today,
    weekday: weekdayName(today),
    profile: profileView(state, ctx),
    todayPlan: { ration: { source: rationToday.source, meals: rationToday.meals.length, totals: rationToday.totals }, sport: { sessions: sportToday.sessions.length, burned_kcal: sportToday.planned_kcal } },
    counts: Object.fromEntries(Object.entries(spaceOutline(state).counts).filter(([key]) => !state.types[key]?.hidden)),
  };
}

export function systemPrompt(state, { today, protective = [] }) {
  return `Ты ассистент приложения Cookish: помогаешь одному человеку с питанием, тренировками, покупками и с его собственными списками. Сегодня ${today} (${weekdayName(today)}). Завтра ${shiftDate(today, 1)}.
Как устроено приложение: всё хранится как объекты типов (продукт, приём пищи, тренировка, запрос на покупки, заметка и типы, которые человек завёл сам). У типа есть связи, это свойства объекта. Набор показывает объекты по запросу, главная состоит из виджетов. Рацион и Спорт это план: неделя плана, в ней дни, в днях приёмы пищи или тренировки. Дату можно переопределить Особым днём.
Правила:
- Сам ты ничего не пишешь. Любое изменение это предложение: propose_day, propose_week, propose_objects, propose_space, propose_revert. Предложение показывается человеку карточкой и меняет данные, только когда он нажмёт «Применить». Не говори, что что-то уже изменено.
- Сначала читай нужное: get_plan, find_objects, get_object, get_profile, get_history. Предложения этого разговора, которые человек ещё не применил, в чтении видны так, как будто они применены.
- Прошедшие дни и неделя плана, которая уже действует, не меняются. Сегодня и ближайшие даты меняй через propose_day, передавая все приёмы пищи или тренировки дня целиком. Регулярное изменение с завтрашнего дня или позже это propose_week со всеми 7 днями (пн..вс).
- Отметки (съедено, тренировка выполнена), расхождения, покупки и записи трекеров делает только человек: ты их читаешь через get_history, но не пишешь. Код такое отклонит.
- Продукты в приёмах пищи называй по id из find_objects (type product) или точным названием. Если продукта нет: общий без марки ищи find_reference, товар с маркой search_food и опиши его в new_products с source и source_ref подходящего кандидата, цифры возьмёт код. Бери кандидата, только если это тот же продукт. Если поиск ответил ambiguous, не выбирай сам: спроси человека (вид, жирность, марка). source=estimate со своими цифрами только если ничего не нашлось.
- Держи КБЖУ дня в пределах ±15% от целей профиля, не ниже 1200 ккал, белок не меньше 75% цели, без исключённых продуктов. Код проверит план и вернёт problems: исправь и предложи снова. Неделя, которую ты предлагаешь, проверяется так же день за днём.
- Цели КБЖУ и исключённые продукты в профиле меняет только человек, сам ты их не меняешь никогда.
- Свои типы, связи, наборы и виджеты (вода, вес, давление, настроение) собирает propose_space. Записи в такие типы вносит только человек, ты их не создаёшь. Медицинские показатели только записываются и показываются трендом; дозы и диагнозы не считаешь, советуешь врача.
- Не лечи и не ставь диагнозов. При опасных просьбах откажи и посоветуй обратиться к врачу.
- Планирование рассчитано на совершеннолетнего человека.
- Защиту от аллергенов не обещай: приложение пока аллергены не учитывает.${protective.length ? `
- ВНИМАНИЕ: ${protective.join(", ")}. Не помогай худеть: не снижай калории и не добавляй нагрузку, код такие предложения отклонит. Поддержи человека и мягко посоветуй обратиться к врачу или к специалисту по расстройствам пищевого поведения.` : ""}
- Отвечай кратко по-русски.
Контекст: ${JSON.stringify(assistantContext(state, today))}`;
}

// ——— The agent loop ———

const PROGRESS = {
  get_space: () => "Смотрю устройство пространства…",
  find_objects: (args) => `Ищу: ${args.type}…`,
  get_object: () => "Открываю объект…",
  get_plan: (args) => `Читаю план ${args.from ? shortDate(args.from) : ""}–${args.to ? shortDate(args.to) : ""}…`,
  get_history: () => "Смотрю, что отмечено…",
  get_profile: () => "Смотрю профиль…",
  get_change_sets: () => "Читаю журнал изменений…",
  find_reference: (args) => `Ищу «${String(args.query || "")}» в справочнике…`,
  search_food: (args) => `Ищу «${String(args.query || "")}» в Open Food Facts…`,
  propose_day: () => "Собираю предложение на день…",
  propose_week: () => "Собираю предложение на неделю…",
  propose_objects: () => "Собираю предложение…",
  propose_space: () => "Собираю предложение…",
  propose_revert: () => "Готовлю откат…",
};

async function runTool(name, args, work) {
  const state = work.scratch.state();
  const ctx = work.ctx;
  switch (name) {
    case "get_space": return { ok: true, space: spaceOutline(state) };
    case "find_objects": return findObjects(args, { state, ctx });
    case "get_object": return getObject(args, { state, ctx });
    case "get_profile": return { ok: true, profile: profileView(state, ctx) };
    case "get_change_sets": return { ok: true, changeSets: changeSets(args, work) };
    case "get_plan": {
      if (!AREAS[args.area]) return { ok: false, error: "area: ration или sport." };
      const range = dateRange(args.from, args.to, MAX_PLAN_DAYS);
      if (!range.ok) return range;
      const view = args.area === "ration" ? rationDayView : sportDayView;
      return { ok: true, area: args.area, ...(args.area === "sport" ? { weightKnown: Number(profileOf(state)?.props.weightKg) > 0 } : {}), days: range.dates.map((date) => view(state, date, ctx)) };
    }
    case "get_history": {
      if (!AREAS[args.area]) return { ok: false, error: "area: ration или sport." };
      if (isDate(args.from) && args.from >= work.today) return { ok: false, error: "Отметки есть только у прошедших дней." };
      const range = dateRange(args.from, args.to < work.today ? args.to : shiftDate(work.today, -1), MAX_HISTORY_DAYS);
      if (!range.ok) return range;
      const view = args.area === "ration" ? rationHistoryView : sportHistoryView;
      return { ok: true, area: args.area, days: range.dates.map((date) => view(state, date, ctx)) };
    }
    case "find_reference": return findReferenceTool(args, work.session);
    case "search_food": return searchFoodTool(args, work.session);
    case "propose_day": return proposeDay(args, work);
    case "propose_week": return proposeWeek(args, work);
    case "propose_objects": return proposeObjects(args, work);
    case "propose_space": return proposeSpace(args, work);
    case "propose_revert": return proposeRevert(args, work);
    default: return { ok: false, error: `Нет инструмента ${name || "(пусто)"}. Отметки и записи-факты ассистент не меняет.` };
  }
}

// `getState()` returns the space (and may be async); a run changes only the
// thread it gets. Events go to `onEvent` as they happen: user, progress,
// proposal, assistant, error, compacted. `catalog` is the catalog Service
// for search_food.
export function createObjectAssistant({ provider, getState, catalog, today, maxTurns = ASSISTANT_MAX_TURNS } = {}) {
  return {
    async run(thread, text, { onEvent = () => {} } = {}) {
      const day = typeof today === "function" ? today() : today;
      const emit = (event) => {
        applyThreadEvent(thread, event);
        onEvent(event);
      };
      const words = String(text || "").trim();
      if (!words) return { ok: false, reason: "Напишите, что нужно." };
      thread.messages.push({ role: "user", content: words });
      emit({ type: "user", text: words });
      const base = await getState();
      // Signs of an eating disorder or a minor in Профиль stop every change
      // towards weight loss: the code refuses it, the prompt says why.
      const said = thread.log.filter((entry) => entry.type === "user").map((entry) => entry.text);
      const protective = protectiveReasons(base, said, day);
      const scratch = scratchOf(base, day);
      replay(scratch, thread);
      const work = { base, scratch, protective, session: createFoodSession(catalog), thread, today: day, ctx: { today: day }, emit };
      const system = systemPrompt(base, { today: day, protective });
      // Once per run: a long conversation shrinks before the next request.
      let compacted = false;
      for (let turn = 0; turn < maxTurns; turn += 1) {
        if (!compacted && thread.promptTokens >= COMPACTION.threshold) {
          compacted = true;
          await compactThread(thread, { provider, system, tools: OBJECT_TOOLS, emit });
        }
        const sentChars = requestChars({ system, tools: OBJECT_TOOLS, messages: thread.messages });
        const answer = await provider.complete({ messages: [{ role: "system", content: system }, ...thread.messages], tools: OBJECT_TOOLS });
        if (!answer.ok) {
          // A request that never reached the model leaves no dangling question
          // behind, so the person can send the same words again.
          if (turn === 0 && thread.messages.at(-1)?.role === "user") thread.messages.pop();
          emit({ type: "error", text: answer.reason });
          return { ok: false, reason: answer.reason };
        }
        // The size of the last request: compaction is decided on it.
        if (Number(answer.usage?.prompt_tokens) > 0) {
          thread.promptTokens = Number(answer.usage.prompt_tokens);
          thread.promptChars = sentChars;
        }
        const message = answer.message || {};
        const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        thread.messages.push({ role: "assistant", content: message.content || "", ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
        if (!toolCalls.length) {
          const reply = String(message.content || "").trim() || "Готово.";
          emit({ type: "assistant", text: reply });
          return { ok: true, reply };
        }
        for (const call of toolCalls) {
          let args = null;
          try {
            args = JSON.parse(call.function?.arguments || "{}");
          } catch {
            args = null;
          }
          const name = call.function?.name || "";
          let output;
          if (!args || typeof args !== "object") {
            output = { ok: false, error: "Аргументы инструмента — не JSON." };
          } else {
            const progress = PROGRESS[name]?.(args);
            if (progress) emit({ type: "progress", text: progress });
            try {
              output = await runTool(name, args, work);
            } catch (error) {
              output = { ok: false, error: error?.message || "Инструмент не сработал." };
            }
          }
          let content = JSON.stringify(output);
          if (content.length > MAX_TOOL_CHARS) content = JSON.stringify({ ok: false, error: "Ответ слишком большой: сузь запрос (даты, фильтры, limit)." });
          thread.messages.push({ role: "tool", tool_call_id: call.id, content });
        }
      }
      const reply = "Не получилось закончить за отведённые шаги. Уточните просьбу или попробуйте ещё раз.";
      emit({ type: "assistant", text: reply });
      return { ok: false, reason: reply };
    },
  };
}
