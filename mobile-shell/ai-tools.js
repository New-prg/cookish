// The assistant's agent loop and tools (epic #44). It reads the plan through
// domain projections and turns model tool calls into Предложения: each one is
// executed on a copy of the state with actor "ai", checked by the КБЖУ gate
// and shown as a card. Nothing is written until the person applies it; apply
// re-checks every Предложение on the current state and journals the batch.
import {
  applyRationCommand,
  createId,
  formatRationDate,
  normalizeProductName,
  parseRationDate,
  rationMeasure,
  rationOwner,
  readRationDay,
  readRationDayNutrition,
  readRationHistoryDay,
  todayDateKey,
} from "./ration-domain.js";
import { diffPlan, readChangeSets, readPart, restoreChangeSet, sameContent } from "./plan-journal.js";
import {
  SPORT_INTENSITIES,
  SPORT_INTENSITY_LABELS,
  SPORT_STATE_LABELS,
  SPORT_TYPES,
  SPORT_TYPE_LABELS,
  applySportCommand,
  normalizeSession,
  readSportDay,
  readSportDayEnergy,
  readSportLogDay,
} from "./sport-domain.js";

export const ASSISTANT_MAX_TURNS = 8;
export const KBJU_GATE = Object.freeze({ minCalories: 1200, tolerance: 0.15, minProteinShare: 0.75 });
export const STATS_DAYS = 28;

const WEEK_KEYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const WEEKDAY_BY_DAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const PAGE_LABELS = { ration: "Рацион", sport: "Спорт", requests: "Покупки" };
const MODE_LABELS = { log: "Учёт", plan: "План" };
const MAX_PLAN_DAYS = 14;
const MAX_HISTORY_DAYS = 28;

const mealsSchema = {
  type: "array",
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
            product: { type: "string", description: "Точное название продукта из каталога" },
            amount: { type: "number", description: "Порция в единице продукта из каталога: г, мл или шт." },
          },
          required: ["product", "amount"],
        },
      },
    },
    required: ["name", "time", "items"],
  },
};

const datesSchema = { type: "object", properties: { from: { type: "string", description: "ГГГГ-ММ-ДД" }, to: { type: "string", description: "ГГГГ-ММ-ДД" } }, required: ["from", "to"] };

export const RATION_TOOLS = [
  { name: "get_plan", description: "Прочитать план питания на диапазон дат (включительно, до 14 дней) с КБЖУ по дням.", parameters: datesSchema },
  { name: "get_profile", description: "Профиль: цели КБЖУ, вес, исключённые продукты, предпочтения.", parameters: { type: "object", properties: {} } },
  { name: "get_catalog", description: "Каталог продуктов с единицей и КБЖУ на 100 г/мл. В плане можно использовать только эти продукты.", parameters: { type: "object", properties: {} } },
  { name: "get_history", description: "Прочитать Историю питания прошедших дней (до 28 дней): отметки приёмов пищи и Расхождения. Только чтение.", parameters: datesSchema },
  { name: "get_change_sets", description: "Журнал последних изменений плана (человека и ассистента) с id для отката.", parameters: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "set_special_day", description: "Предложить Особый день: заменить план одной даты (сегодня или будущее). Передай ВСЕ приёмы пищи дня целиком.", parameters: { type: "object", properties: { date: { type: "string" }, meals: mealsSchema }, required: ["date", "meals"] } },
  { name: "release_version", description: "Предложить новый недельный план, действующий с даты effective_from (сегодня или будущее). Нужны все 7 дней недели, ключи пн..вс.", parameters: { type: "object", properties: { effective_from: { type: "string" }, week: { type: "object", properties: Object.fromEntries(WEEK_KEYS.map((key) => [key, mealsSchema])), required: WEEK_KEYS } }, required: ["effective_from", "week"] } },
  { name: "upsert_product", description: "Предложить новый продукт каталога или исправить КБЖУ существующего (на 100 г или 100 мл).", parameters: { type: "object", properties: { name: { type: "string" }, unit: { type: "string", enum: ["г", "мл", "шт."] }, calories: { type: "number" }, protein: { type: "number" }, fat: { type: "number" }, carbs: { type: "number" }, fiber: { type: "number" } }, required: ["name", "calories", "protein", "fat", "carbs"] } },
  { name: "revert_change_set", description: "Предложить откат набора изменений из журнала (своего или ручного).", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
].map((tool) => ({ type: "function", function: tool }));

const sessionsSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      type: { type: "string", enum: SPORT_TYPES, description: "strength — силовая, run — бег, swim — плавание, bike — велосипед, walk — ходьба, yoga — йога, other — другое" },
      time: { type: "string", description: "ЧЧ:ММ" },
      duration_min: { type: "number" },
      intensity: { type: "string", enum: SPORT_INTENSITIES, description: "low — низкая, medium — средняя, high — высокая" },
      note: { type: "string" },
    },
    required: ["type", "time", "duration_min", "intensity"],
  },
};

export const SPORT_TOOLS = [
  { name: "get_sport_plan", description: "Прочитать План тренировок на диапазон дат (включительно, до 14 дней) с плановым расходом ккал.", parameters: datesSchema },
  { name: "get_sport_log", description: "Прочитать Учёт тренировок прошедших дней (до 28 дней): отметки, фактические длительность и интенсивность, внеплановая активность. Только чтение.", parameters: datesSchema },
  { name: "set_sport_special_day", description: "Предложить Особый день тренировок: заменить все тренировки одной даты (сегодня или будущее). Пустой список — день отдыха.", parameters: { type: "object", properties: { date: { type: "string" }, sessions: sessionsSchema }, required: ["date", "sessions"] } },
  { name: "release_sport_version", description: "Предложить новое недельное расписание тренировок с даты effective_from (сегодня или будущее). Нужны все 7 дней, ключи пн..вс; день отдыха — пустой список.", parameters: { type: "object", properties: { effective_from: { type: "string" }, week: { type: "object", properties: Object.fromEntries(WEEK_KEYS.map((key) => [key, sessionsSchema])), required: WEEK_KEYS } }, required: ["effective_from", "week"] } },
].map((tool) => ({ type: "function", function: tool }));

export const ASSISTANT_TOOLS = [...RATION_TOOLS, ...SPORT_TOOLS];

export function createThread({ page = "ration", mode = "" } = {}) {
  return { id: createId("thread"), page, mode, createdAt: new Date().toISOString(), messages: [], proposals: [], log: [] };
}

// `changePlan(meta, mutator)` is the local-data batch writer (one Набор
// изменений per call); `getState()` returns the current local data.
export function createAssistant({ provider, getState, changePlan, today = todayDateKey, maxTurns = ASSISTANT_MAX_TURNS } = {}) {
  return {
    async run(thread, text, { page = thread.page, mode = thread.mode, onEvent = () => {} } = {}) {
      const day = today();
      const emit = (event) => {
        thread.log.push(event.type === "proposal" ? { type: "proposal", proposalId: event.proposal.id } : event);
        onEvent(event);
      };
      thread.page = page;
      thread.mode = mode;
      thread.messages.push({ role: "user", content: String(text || "") });
      emit({ type: "user", text: String(text || "") });
      const working = { state: replayPending(getState(), thread, day) };
      const system = systemPrompt(getState(), { page, mode, today: day });
      for (let turn = 0; turn < maxTurns; turn += 1) {
        const answer = await provider.complete({ messages: [{ role: "system", content: system }, ...thread.messages], tools: ASSISTANT_TOOLS });
        if (!answer.ok) {
          emit({ type: "error", text: answer.reason });
          return { ok: false, reason: answer.reason };
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
          const output = args && typeof args === "object"
            ? runTool(name, args, { working, thread, today: day, emit })
            : { ok: false, error: "Аргументы инструмента — не JSON." };
          thread.messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
        }
      }
      const reply = "Не успел закончить за отведённые шаги. Уточните просьбу или попробуйте ещё раз.";
      emit({ type: "assistant", text: reply });
      return { ok: false, reason: reply };
    },

    // Applies Предложения: together as one Набор изменений, or one set each.
    // Every Предложение is re-checked on the current state; a stale one gets a
    // conflict instead of applying. Statuses are written onto the proposals.
    apply(proposals, { together = true } = {}) {
      const day = today();
      const list = (proposals || []).filter((proposal) => proposal && proposal.status !== "applied");
      if (!list.length) return { ok: false, reason: "Нечего применять." };
      const groups = together ? [list] : list.map((proposal) => [proposal]);
      const results = [];
      groups.forEach((group) => {
        const outcomes = new Map();
        const written = changePlan({
          actor: "ai",
          page: pageOf(group),
          summary: batchSummary(group),
        }, (draft, context) => {
          const productIds = [];
          group.forEach((proposal) => {
            const outcome = tryProposal(draft, proposal, context, day);
            outcomes.set(proposal.id, outcome);
            if (outcome.ok) productIds.push(...outcome.productIds);
          });
          const applied = group.filter((proposal) => outcomes.get(proposal.id)?.ok);
          if (!applied.length) return { ok: false, reason: outcomes.get(group[0].id)?.reason || "Предложение устарело." };
          return { ok: true, productIds, summary: batchSummary(applied) };
        });
        group.forEach((proposal) => {
          const outcome = outcomes.get(proposal.id) || { ok: false, reason: written.reason };
          if (written.ok && outcome.ok) {
            proposal.status = "applied";
            proposal.changeSetId = written.changeSetId || "";
            delete proposal.conflict;
          } else {
            proposal.status = "conflict";
            proposal.conflict = outcome.ok ? written.reason : outcome.reason;
          }
          results.push({ id: proposal.id, ok: proposal.status === "applied", changeSetId: proposal.changeSetId || "", reason: proposal.conflict || "" });
        });
      });
      return { ok: results.some((result) => result.ok), results };
    },

    recheck(proposals) {
      return recheckProposals(getState(), proposals, today());
    },
  };
}

// Marks pending Предложения that no longer apply to `state` as conflicts.
export function recheckProposals(state, proposals, day = todayDateKey()) {
  const draft = structuredClone(state);
  (proposals || []).forEach((proposal) => {
    if (proposal.status !== "pending" && proposal.status !== "conflict") return;
    const outcome = tryProposal(draft, proposal, { now: new Date().toISOString(), today: day, actor: "ai" }, day);
    if (outcome.ok) {
      proposal.status = "pending";
      delete proposal.conflict;
    } else {
      proposal.status = "conflict";
      proposal.conflict = outcome.reason;
    }
  });
  return proposals;
}

function runTool(name, args, { working, thread, today, emit }) {
  const state = working.state;
  switch (name) {
    case "get_plan": {
      const range = dateRange(args.from, args.to, MAX_PLAN_DAYS);
      if (!range.ok) return range;
      emit({ type: "progress", text: `Читаю план ${shortDate(range.dates[0])}–${shortDate(range.dates.at(-1))}…` });
      return { ok: true, days: range.dates.map((date) => viewDay(state, date)) };
    }
    case "get_profile":
      emit({ type: "progress", text: "Смотрю профиль…" });
      return { ok: true, profile: viewProfile(state) };
    case "get_catalog":
      emit({ type: "progress", text: "Смотрю каталог продуктов…" });
      return { ok: true, products: viewCatalog(state) };
    case "get_history": {
      if (isDate(args.from) && args.from >= today) return { ok: false, error: "История есть только у прошедших дней." };
      const range = dateRange(args.from, args.to < today ? args.to : addDays(today, -1), MAX_HISTORY_DAYS);
      if (!range.ok) return range;
      emit({ type: "progress", text: `Смотрю Историю питания за ${range.dates.length} дн.…` });
      return { ok: true, days: range.dates.map((date) => viewHistoryDay(state, date)) };
    }
    case "get_change_sets":
      emit({ type: "progress", text: "Читаю журнал изменений…" });
      return { ok: true, changeSets: readChangeSets(state, { limit: Math.min(Math.max(Number(args.limit) || 10, 1), 30) }) };
    case "get_sport_plan": {
      const range = dateRange(args.from, args.to, MAX_PLAN_DAYS);
      if (!range.ok) return range;
      emit({ type: "progress", text: `Читаю план тренировок ${shortDate(range.dates[0])}–${shortDate(range.dates.at(-1))}…` });
      return { ok: true, weightKnown: Number(state.ration?.profile?.weightKg) > 0, days: range.dates.map((date) => viewSportDay(state, date)) };
    }
    case "get_sport_log": {
      if (isDate(args.from) && args.from >= today) return { ok: false, error: "Учёт есть только у прошедших дней." };
      const range = dateRange(args.from, args.to < today ? args.to : addDays(today, -1), MAX_HISTORY_DAYS);
      if (!range.ok) return range;
      emit({ type: "progress", text: `Смотрю Учёт тренировок за ${range.dates.length} дн.…` });
      return { ok: true, days: range.dates.map((date) => viewSportLogDay(state, date)) };
    }
    case "set_sport_special_day":
      return proposeSportDay(args, { working, thread, today, emit });
    case "release_sport_version":
      return proposeSportVersion(args, { working, thread, today, emit });
    case "set_special_day":
      return proposeSpecialDay(args, { working, thread, today, emit });
    case "release_version":
      return proposeVersion(args, { working, thread, today, emit });
    case "upsert_product":
      return proposeProduct(args, { working, thread, today, emit });
    case "revert_change_set":
      return proposeRevert(args, { working, thread, today, emit });
    default:
      return { ok: false, error: `Нет инструмента ${name || "(пусто)"}. Историю питания ассистент не меняет.` };
  }
}

function proposeSpecialDay(args, { working, thread, today, emit }) {
  const date = String(args.date || "");
  if (!isDate(date)) return { ok: false, error: "Дата должна быть в формате ГГГГ-ММ-ДД." };
  if (date < today) return { ok: false, error: "Прошедшие дни менять нельзя: их История питания отмечается человеком." };
  const { meals, errors } = toDomainMeals(working.state, args.meals, readRationDay(working.state, date)?.meals);
  if (errors.length) return { ok: false, errors };
  const ops = [{ op: "ration", command: { type: "setSpecialDay", date, meals } }];
  return finishProposal({
    kind: "special_day",
    summary: `Особый день · ${shortDate(date)}`,
    page: "ration",
    dates: [date],
    gateDates: [date],
    ops,
  }, { working, thread, today, emit });
}

function proposeVersion(args, { working, thread, today, emit }) {
  const from = String(args.effective_from || "");
  if (!isDate(from)) return { ok: false, error: "effective_from должна быть в формате ГГГГ-ММ-ДД." };
  if (from < today) return { ok: false, error: "Новый план может начинаться только сегодня или позже." };
  const start = (parseRationDate(from).getDay() + 6) % 7;
  const errors = [];
  const days = [];
  for (let index = 0; index < 7; index += 1) {
    const key = WEEK_KEYS[(start + index) % 7];
    const date = addDays(from, index);
    const converted = toDomainMeals(working.state, args.week?.[key], readRationDay(working.state, date)?.meals);
    errors.push(...converted.errors);
    if (!Array.isArray(args.week?.[key])) errors.push(`Нет дня «${key}» в неделе.`);
    days.push({ id: `cycle_day_${date}`, meals: converted.meals });
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  const ops = [{ op: "ration", command: { type: "releaseVersion", anchor: from, effectiveFrom: from, weekdayBinding: true, days } }];
  return finishProposal({
    kind: "version",
    summary: `Новый план с ${shortDate(from)}`,
    page: "ration",
    dates: [from],
    gateDates: [],
    gateMeals: days.map((day, index) => ({ label: `${WEEK_KEYS[(start + index) % 7]} (${addDays(from, index)})`, meals: day.meals })),
    previewDates: Array.from({ length: 7 }, (_, index) => addDays(from, index)),
    ops,
  }, { working, thread, today, emit });
}

function proposeSportDay(args, { working, thread, today, emit }) {
  const date = String(args.date || "");
  if (!isDate(date)) return { ok: false, error: "Дата должна быть в формате ГГГГ-ММ-ДД." };
  if (date < today) return { ok: false, error: "Прошедшие дни менять нельзя: Учёт тренировок отмечает человек." };
  const { sessions, errors } = toDomainSessions(args.sessions, readSportDay(working.state, date)?.sessions);
  if (errors.length) return { ok: false, errors };
  return finishProposal({
    kind: "sport_day",
    summary: `Тренировки · ${shortDate(date)}`,
    page: "sport",
    dates: [date],
    gateDates: [],
    ops: [{ op: "sport", command: { type: "setSpecialDay", date, sessions } }],
  }, { working, thread, today, emit });
}

function proposeSportVersion(args, { working, thread, today, emit }) {
  const from = String(args.effective_from || "");
  if (!isDate(from)) return { ok: false, error: "effective_from должна быть в формате ГГГГ-ММ-ДД." };
  if (from < today) return { ok: false, error: "Новое расписание может начинаться только сегодня или позже." };
  const start = (parseRationDate(from).getDay() + 6) % 7;
  const errors = [];
  const days = [];
  for (let index = 0; index < 7; index += 1) {
    const key = WEEK_KEYS[(start + index) % 7];
    const date = addDays(from, index);
    if (!Array.isArray(args.week?.[key])) errors.push(`Нет дня «${key}» в неделе.`);
    const converted = toDomainSessions(args.week?.[key] || [], readSportDay(working.state, date)?.sessions);
    errors.push(...converted.errors);
    days.push({ id: `cycle_day_${date}`, sessions: converted.sessions });
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  return finishProposal({
    kind: "sport_version",
    summary: `Расписание тренировок с ${shortDate(from)}`,
    page: "sport",
    dates: [from],
    gateDates: [],
    previewDates: Array.from({ length: 7 }, (_, index) => addDays(from, index)),
    ops: [{ op: "sport", command: { type: "releaseVersion", anchor: from, effectiveFrom: from, weekdayBinding: true, days } }],
  }, { working, thread, today, emit });
}

// Model sessions → domain Тренировки. A session keeps the id of the planned
// one with the same type, so today's marks survive the change.
export function toDomainSessions(sessions, currentSessions = []) {
  if (!Array.isArray(sessions)) return { sessions: [], errors: ["sessions должен быть массивом тренировок."] };
  const errors = [];
  const used = new Set();
  const result = sessions.map((value) => {
    const type = String(value?.type || "");
    if (!SPORT_TYPES.includes(type)) errors.push(`Неизвестный тип тренировки «${type}»: возьми значение из списка.`);
    const intensity = SPORT_INTENSITIES.includes(value?.intensity) ? value.intensity : "medium";
    const minutes = Number(value?.duration_min ?? value?.durationMin);
    if (!(minutes >= 5 && minutes <= 600)) errors.push(`Длительность ${value?.duration_min} мин вне пределов 5–600.`);
    const same = (currentSessions || []).find((session) => !used.has(session.id) && session.type === type);
    if (same) used.add(same.id);
    return normalizeSession({
      id: same?.id || createId("session"),
      type,
      time: value?.time,
      durationMin: minutes,
      intensity,
      note: value?.note || "",
    });
  });
  return { sessions: result, errors: [...new Set(errors)] };
}

function proposeProduct(args, { working, thread, today, emit }) {
  const name = String(args.name || "").trim();
  if (!name) return { ok: false, error: "Нужно название продукта." };
  const nutrition = {};
  for (const field of ["calories", "protein", "fat", "carbs", "fiber"]) {
    const value = args[field] == null || args[field] === "" ? (field === "fiber" ? 0 : NaN) : Number(args[field]);
    if (!Number.isFinite(value) || value < 0) return { ok: false, error: `Поле ${field} должно быть неотрицательным числом.` };
    nutrition[field] = value;
  }
  if (nutrition.calories > 900 || nutrition.protein > 100 || nutrition.fat > 100 || nutrition.carbs > 100) {
    return { ok: false, error: "КБЖУ на 100 г вне разумных пределов: проверь значения." };
  }
  const existing = productByName(working.state, name);
  const unit = ["г", "мл", "шт."].includes(args.unit) ? args.unit : (existing?.unit || "г");
  const product = {
    ...(existing ? structuredClone(existing) : {
      id: createId("product"),
      category: "",
      brand: "",
      kind: "generic",
      genericKey: normalizeProductName(name).replace(/[^a-zа-яё0-9]+/gi, "_"),
      barcode: "",
      ingredients: "",
      catalogSource: "Ассистент",
    }),
    name: existing?.name || name,
    unit: existing?.unit || (unit === "мл" ? "л" : unit),
    nutrition: { ...nutrition, vitamins: existing?.nutrition?.vitamins || "", minerals: existing?.nutrition?.minerals || "", basis: "100 г/мл", source: "Ассистент" },
    nutritionSource: "Ассистент",
    confirmed: existing ? Boolean(existing.confirmed) : false,
  };
  return finishProposal({
    kind: "product",
    summary: existing ? `КБЖУ продукта «${product.name}»` : `Новый продукт «${product.name}»`,
    page: "ration",
    dates: [],
    gateDates: [],
    ops: [{ op: "product", product }],
    productIds: [product.id],
  }, { working, thread, today, emit });
}

function proposeRevert(args, { working, thread, today, emit }) {
  const id = String(args.id || "");
  const set = (working.state.journal || []).find((entry) => entry.id === id);
  if (!set) return { ok: false, error: "Набор изменений не найден: возьми id из get_change_sets." };
  const dates = Object.keys(set.after).filter((key) => key.includes(":special:")).map((key) => key.split("|").pop());
  if (dates.some((date) => date < today)) return { ok: false, error: "Набор меняет прошедшие дни, его откат уже не применить." };
  return finishProposal({
    kind: "revert",
    summary: `Откат: ${set.summary}`,
    page: set.page === "sport" ? "sport" : "ration",
    dates,
    gateDates: [],
    ops: [{ op: "revert", changeSetId: id }],
  }, { working, thread, today, emit });
}

// Executes the Предложение on a copy of the working state, gates it and, when
// it passes, adds its card to the thread. The working state then includes it,
// so the model reads its own unapplied changes.
function finishProposal(spec, { working, thread, today, emit }) {
  const next = structuredClone(working.state);
  const context = { now: new Date().toISOString(), actor: "ai", today };
  const executed = executeOps(next, spec.ops, context);
  if (!executed.ok) return { ok: false, error: executed.reason };
  const gate = gateProposal(next, spec);
  if (!gate.ok) return { ok: false, gate: gate.problems, totals: gate.totals, hint: "Исправь план так, чтобы проверка прошла, и предложи снова." };
  const diff = diffPlan(working.state, next, { productIds: spec.productIds || [] });
  if (!diff) return { ok: false, error: "Предложение ничего не меняет в плане." };
  const ref = `P${thread.proposals.length + 1}`;
  const proposal = {
    id: createId("proposal"),
    ref,
    kind: spec.kind,
    summary: spec.summary,
    page: spec.page,
    dates: spec.dates,
    gateDates: spec.gateDates,
    ...(spec.gateMeals ? { gateMeals: spec.gateMeals } : {}),
    ops: spec.ops,
    before: diff.before,
    after: diff.after,
    preview: buildPreview(working.state, next, spec),
    status: "pending",
    createdAt: context.now,
  };
  thread.proposals.push(proposal);
  working.state = next;
  emit({ type: "proposal", proposal });
  return {
    ok: true,
    proposal: ref,
    note: "Предложение показано человеку карточкой. План изменится только после его подтверждения.",
    ...(gate.totals ? { totals: gate.totals } : {}),
  };
}

function executeOps(draft, ops, context) {
  for (const op of ops || []) {
    if (op.op === "ration") {
      const result = applyRationCommand(draft, structuredClone(op.command), { ...context, actor: "ai" });
      if (!result.ok) return result;
    } else if (op.op === "sport") {
      const result = applySportCommand(draft, structuredClone(op.command), { ...context, actor: "ai" });
      if (!result.ok) return result;
    } else if (op.op === "product") {
      draft.products = draft.products || [];
      const product = { ...structuredClone(op.product), updatedAt: context.now, updatedBy: "ai" };
      const index = draft.products.findIndex((value) => value.id === product.id);
      if (index >= 0) draft.products[index] = { ...draft.products[index], ...product, deletedAt: "" };
      else draft.products.push(product);
    } else if (op.op === "revert") {
      const result = restoreChangeSet(draft, op.changeSetId, { now: context.now, actor: "ai" });
      if (!result.ok) return result;
    } else {
      return { ok: false, reason: "Неизвестное действие предложения." };
    }
  }
  return { ok: true };
}

// Re-checks one Предложение on `draft` and applies it there when it still fits.
function tryProposal(draft, proposal, context, today) {
  if (proposal.status === "applied") return { ok: false, reason: "Предложение уже применено." };
  const stale = Object.keys(proposal.before || {}).filter((key) => !sameContent(readPart(draft, key), proposal.before[key]));
  if (stale.length) return { ok: false, reason: "План изменился после предложения: оно устарело." };
  if ((proposal.dates || []).some((date) => date < today)) return { ok: false, reason: "Этот день уже прошёл." };
  const trial = { ...draft, ration: structuredClone(draft.ration), products: structuredClone(draft.products || []) };
  if (draft.sport) trial.sport = structuredClone(draft.sport);
  const executed = executeOps(trial, proposal.ops, { ...context, actor: "ai" });
  if (!executed.ok) return { ok: false, reason: executed.reason };
  const missing = missingProducts(trial, proposal);
  if (missing.length) return { ok: false, reason: `Нет продукта ${missing.join(", ")}: сначала примените предложение с ним.` };
  const gate = gateProposal(trial, proposal);
  if (!gate.ok) return { ok: false, reason: `Не проходит проверку КБЖУ: ${gate.problems.join("; ")}.` };
  draft.ration = trial.ration;
  draft.products = trial.products;
  if (trial.sport) draft.sport = trial.sport;
  return { ok: true, productIds: (proposal.ops || []).filter((op) => op.op === "product").map((op) => op.product.id) };
}

function replayPending(state, thread, today) {
  const draft = structuredClone(state);
  thread.proposals.filter((proposal) => proposal.status === "pending").forEach((proposal) => {
    tryProposal(draft, proposal, { now: new Date().toISOString(), today, actor: "ai" }, today);
  });
  return draft;
}

function missingProducts(state, proposal) {
  const live = new Set((state.products || []).filter((product) => !product.deletedAt).map((product) => product.id));
  const names = new Set();
  (proposal.ops || []).forEach((op) => {
    const command = op.command || {};
    const meals = [...(command.meals || []), ...(command.days || []).flatMap((day) => day.meals || [])];
    meals.forEach((meal) => (meal.items || []).forEach((item) => {
      if (item.productId && !live.has(item.productId)) names.add(`«${item.name || item.productId}»`);
    }));
  });
  return [...names];
}

// The КБЖУ gate is code, not the model: not below 1200 ккал, within ±15% of
// the calorie target, protein at least 75% of its target, no excluded
// products and no products without КБЖУ.
export function gateProposal(state, spec) {
  const checks = [
    ...(spec.gateDates || []).map((date) => ({ label: date, meals: readRationDay(state, date)?.meals || [] })),
    ...(spec.gateMeals || []),
  ];
  const problems = [];
  let totals = null;
  checks.forEach(({ label, meals }) => {
    const result = gateMeals(state, meals);
    totals = totals || result.totals;
    result.problems.forEach((problem) => problems.push(checks.length > 1 ? `${label}: ${problem}` : problem));
  });
  return { ok: problems.length === 0, problems, totals };
}

export function gateMeals(state, meals) {
  const profile = state.ration?.profile || {};
  const owner = rationOwner(state);
  const probeDate = "2000-01-01";
  const probe = {
    user: state.user,
    products: state.products || [],
    ration: { versions: [], history: {}, profile, specialDays: { [`${owner}|${probeDate}`]: { date: probeDate, owner, meals: meals || [] } } },
  };
  const nutrition = readRationDayNutrition(probe, probeDate);
  const totals = nutrition.totals;
  const problems = [];
  const target = Number(profile.targetCalories) || 0;
  if (totals.calories < KBJU_GATE.minCalories) {
    problems.push(`калорийность ${Math.round(totals.calories)} ккал ниже безопасного минимума ${KBJU_GATE.minCalories}`);
  }
  if (target && Math.abs(totals.calories - target) / target > KBJU_GATE.tolerance) {
    problems.push(`калорийность ${Math.round(totals.calories)} ккал отличается от цели ${target} больше чем на 15%`);
  }
  const protein = Number(profile.targetProtein) || 0;
  if (protein && totals.protein < protein * KBJU_GATE.minProteinShare) {
    problems.push(`белок ${Math.round(totals.protein)} г меньше 75% цели ${protein} г`);
  }
  const excluded = (profile.excludedProducts || []).map(normalizeProductName).filter(Boolean);
  const products = state.products || [];
  (meals || []).forEach((meal) => (meal.items || []).forEach((item) => {
    const name = normalizeProductName(products.find((product) => product.id === item.productId)?.name || item.name);
    const term = excluded.find((value) => name.includes(value));
    if (term) problems.push(`исключённый продукт «${item.name || name}»`);
  }));
  const unknown = new Set(nutrition.missing.filter((entry) => entry.reason === "no_nutrition").map((entry) => entry.itemId));
  (meals || []).forEach((meal) => (meal.items || []).forEach((item) => {
    if (unknown.has(item.id)) problems.push(`у продукта «${item.name}» нет КБЖУ: сначала upsert_product`);
  }));
  return { ok: problems.length === 0, totals, problems: [...new Set(problems)] };
}

// Model meals [{ name, time, items: [{ product, amount }] }] → domain meals.
// A meal keeps the id of the planned meal with the same name, so marks of
// today's meals survive the change.
export function toDomainMeals(state, meals, currentMeals = []) {
  const errors = [];
  if (!Array.isArray(meals)) return { meals: [], errors: ["meals должен быть массивом приёмов пищи."] };
  const used = new Set();
  const result = meals.map((meal, mealIndex) => {
    const name = String(meal?.name || `Приём пищи ${mealIndex + 1}`).trim();
    const same = (currentMeals || []).find((value) => !used.has(value.id) && normalizeProductName(value.name) === normalizeProductName(name));
    if (same) used.add(same.id);
    return {
      id: same?.id || createId("meal"),
      name,
      time: /^\d{2}:\d{2}$/.test(meal?.time || "") ? meal.time : "12:00",
      items: (Array.isArray(meal?.items) ? meal.items : []).map((item) => {
        const product = productByName(state, item?.product);
        if (!product) errors.push(`Продукта «${item?.product}» нет в каталоге: возьми название из get_catalog или предложи upsert_product.`);
        const measure = rationMeasure(product);
        const amount = Number(item?.amount ?? item?.grams);
        return {
          id: createId("ration_item"),
          productId: product?.id || "",
          name: product?.name || String(item?.product || ""),
          portionSize: amount > 0 ? amount : measure.defaultPortion,
          packageSize: measure.defaultPackage,
          measureUnit: measure.unit,
        };
      }),
    };
  });
  return { meals: result, errors: [...new Set(errors)] };
}

// Context the model always receives: page and mode, the profile and 28-day
// aggregates. Details are read through tools.
export function assistantContext(state, { page = "ration", mode = "", today = todayDateKey() } = {}) {
  return {
    today,
    weekday: weekday(today),
    page: PAGE_LABELS[page] || page,
    mode: MODE_LABELS[mode] || "",
    profile: viewProfile(state),
    stats28: assistantStats(state, today),
  };
}

export function assistantStats(state, today = todayDateKey()) {
  const dates = Array.from({ length: STATS_DAYS }, (_, index) => addDays(today, -(index + 1)));
  const counts = { planned: 0, eaten: 0, changed: 0, skipped: 0, unmarked: 0 };
  const sums = { calories: 0, protein: 0, fat: 0, carbs: 0 };
  let plannedDays = 0;
  const discrepancies = new Map();
  dates.forEach((date) => {
    const day = readRationDay(state, date);
    const meals = day?.meals || [];
    if (meals.length) {
      plannedDays += 1;
      const totals = readRationDayNutrition(state, date).totals;
      Object.keys(sums).forEach((field) => { sums[field] += totals[field]; });
    }
    const history = readRationHistoryDay(state, date);
    meals.forEach((meal) => {
      counts.planned += 1;
      const record = history?.meals?.[meal.id];
      const mealState = record?.state && counts[record.state] != null ? record.state : "unmarked";
      counts[mealState] += 1;
    });
    Object.values(history?.meals || {}).forEach((record) => (record.discrepancies || []).forEach((item) => {
      const product = (state.products || []).find((value) => value.id === item.productId)?.name || item.name || "продукт";
      const key = `${item.kind}|${product}`;
      discrepancies.set(key, (discrepancies.get(key) || 0) + 1);
    }));
  });
  const marked = counts.eaten + counts.changed + counts.skipped;
  const sport = sportStats(state, dates);
  const profile = state.ration?.profile || {};
  return {
    days: STATS_DAYS,
    ration: {
      meals: counts,
      adherence: counts.planned ? Math.round((counts.eaten / counts.planned) * 100) : null,
      markedShare: counts.planned ? Math.round((marked / counts.planned) * 100) : null,
      averagePlannedPerDay: plannedDays
        ? Object.fromEntries(Object.entries(sums).map(([field, value]) => [field, Math.round(value / plannedDays)]))
        : null,
      target: {
        calories: profile.targetCalories ?? null,
        protein: profile.targetProtein ?? null,
        fat: profile.targetFat ?? null,
        carbs: profile.targetCarbs ?? null,
      },
      frequentDiscrepancies: [...discrepancies.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([key, count]) => ({ kind: key.split("|")[0], product: key.split("|").slice(1).join("|"), count })),
    },
    sport,
    spend: spendStats(state, dates.at(-1), today),
  };
}

// Тренировки for 28 days: planned against done, minutes and energy.
function sportStats(state, dates) {
  const sessions = { planned: 0, done: 0, changed: 0, skipped: 0, unmarked: 0 };
  const minutes = { planned: 0, actual: 0 };
  const energy = { planned: 0, actual: 0 };
  let unplanned = 0;
  const weightKnown = Number(state.ration?.profile?.weightKg) > 0;
  dates.forEach((date) => {
    const day = readSportDay(state, date);
    const log = readSportLogDay(state, date);
    (day?.sessions || []).forEach((session) => {
      const record = log?.sessions?.[session.id] || { state: "unmarked" };
      sessions.planned += 1;
      sessions[record.state] = (sessions[record.state] || 0) + 1;
      minutes.planned += session.durationMin;
      if (record.state === "done" || record.state === "changed") minutes.actual += record.actualDurationMin ?? session.durationMin;
    });
    (log?.unplanned || []).forEach((session) => {
      unplanned += 1;
      minutes.actual += session.durationMin;
    });
    if (weightKnown) {
      const value = readSportDayEnergy(state, date);
      energy.planned += value.planned || 0;
      energy.actual += value.actual || 0;
    }
  });
  return { sessions, unplanned, minutes, energyKcal: weightKnown ? energy : null };
}

function spendStats(state, from, to) {
  let total = 0;
  let receipts = 0;
  (state.requests || []).filter((request) => !request.deletedAt).forEach((request) => {
    (request.responses || []).filter((response) => !response.deletedAt).forEach((response) => {
      const date = String(response.createdAt || response.updatedAt || "").slice(0, 10);
      if (!date || date < from || date > to) return;
      const sum = (response.items || []).reduce((value, item) => value + (Number(item.price) || 0), 0);
      if (!sum) return;
      receipts += 1;
      total += sum;
    });
  });
  return { receipts, total: Math.round(total * 100) / 100, currency: "RUB" };
}

export function systemPrompt(state, { page = "ration", mode = "", today = todayDateKey() } = {}) {
  const where = [PAGE_LABELS[page] || page, MODE_LABELS[mode]].filter(Boolean).join(" · ");
  return `Ты ассистент приложения Cookish: планируешь питание и тренировки одного человека. Сегодня ${today} (${weekday(today)}). Завтра ${addDays(today, 1)}.
Человек открыл чат со страницы «${where}».
Правила:
- План меняешь только предложениями: set_special_day, release_version, upsert_product, revert_change_set. Предложение ничего не пишет, пока человек его не применит. Не говори, что план уже изменён.
- Прошедшие дни менять нельзя. Сегодня и будущее меняются только через предложения.
- Историю питания (отметки приёмов пищи и Расхождения) ты не меняешь и не можешь менять: человек отмечает её сам в режиме Учёт.
- Сначала читай нужную часть плана и каталог. Используй только продукты из каталога, точными названиями. Если продукта нет или у него нет КБЖУ, сначала предложи upsert_product.
- Одна дата → set_special_day со всеми приёмами пищи дня. Регулярное изменение «с даты» → release_version со всеми 7 днями недели.
- Держи КБЖУ дня в пределах ±15% от целей профиля, не ниже 1200 ккал, белок не меньше 75% цели, без исключённых продуктов. Код проверит план и вернёт ошибки — исправь и повтори.
- Тренировки меняешь предложениями set_sport_special_day и release_sport_version. Учёт тренировок (отметки, внеплановую активность) пишет только человек.
- Цели КБЖУ в профиле меняет только человек, сам ты их не меняешь никогда. В дни тренировок можешь предложить скорректировать рацион обычным предложением; одна пачка может затрагивать и питание, и тренировки.
- Не лечи и не ставь диагнозов. При опасных просьбах откажи и посоветуй обратиться к врачу.
- Отвечай кратко по-русски.
Контекст: ${JSON.stringify(assistantContext(state, { page, mode, today }))}`;
}

function buildPreview(before, after, spec) {
  if (spec.kind === "sport_day" || spec.kind === "sport_version") {
    const dates = spec.previewDates || spec.dates;
    const days = dates.map((date) => {
      const was = viewSportDay(before, date);
      const now = viewSportDay(after, date);
      return {
        date,
        before: was.sessions,
        after: now.sessions,
        energyBefore: was.planned_kcal,
        energyAfter: now.planned_kcal,
        delta: { energy: now.planned_kcal == null || was.planned_kcal == null ? null : now.planned_kcal - was.planned_kcal },
      };
    }).filter((day) => JSON.stringify(day.before) !== JSON.stringify(day.after));
    return { type: "sport_days", days };
  }
  if (spec.kind === "product") {
    const product = spec.ops[0].product;
    const previous = (before.products || []).find((value) => value.id === product.id);
    return {
      type: "product",
      name: product.name,
      unit: product.unit,
      before: previous?.nutrition ? per100(previous.nutrition) : null,
      after: per100(product.nutrition),
    };
  }
  const dates = spec.previewDates || spec.dates;
  const days = dates.map((date) => {
    const was = viewDay(before, date);
    const now = viewDay(after, date);
    return {
      date,
      before: was.meals,
      after: now.meals,
      beforeTotals: was.totals,
      afterTotals: now.totals,
      delta: Object.fromEntries(["calories", "protein", "fat", "carbs"].map((field) => [field, round1(now.totals[field] - was.totals[field])])),
    };
  }).filter((day) => JSON.stringify(day.before) !== JSON.stringify(day.after));
  return { type: spec.kind === "revert" ? "revert" : "days", days };
}

function per100(nutrition) {
  return Object.fromEntries(["calories", "protein", "fat", "carbs"].map((field) => [field, Number(nutrition?.[field]) || 0]));
}

export function viewDay(state, date) {
  const day = readRationDay(state, date);
  const totals = readRationDayNutrition(state, date).totals;
  return {
    date,
    weekday: weekday(date),
    source: day?.source === "special" ? "Особый день" : day ? "обычный план" : "нет плана",
    meals: (day?.meals || []).slice().sort((a, b) => String(a.time || "").localeCompare(String(b.time || ""))).map((meal) => ({
      name: meal.name,
      time: meal.time,
      items: (meal.items || []).map((item) => {
        const product = (state.products || []).find((value) => value.id === item.productId);
        return { product: product?.name || item.name, amount: Number(item.portionSize) || rationMeasure(product).defaultPortion, unit: item.measureUnit || rationMeasure(product).unit };
      }),
    })),
    totals: { calories: round1(totals.calories), protein: round1(totals.protein), fat: round1(totals.fat), carbs: round1(totals.carbs) },
  };
}

function viewSportDay(state, date) {
  const day = readSportDay(state, date);
  const energy = readSportDayEnergy(state, date);
  return {
    date,
    weekday: weekday(date),
    source: day?.source === "special" ? "Особый день" : day ? "обычный план" : "нет плана",
    sessions: (day?.sessions || []).slice().sort((a, b) => a.time.localeCompare(b.time)).map((session) => ({
      type: SPORT_TYPE_LABELS[session.type],
      time: session.time,
      duration_min: session.durationMin,
      intensity: SPORT_INTENSITY_LABELS[session.intensity],
      ...(session.note ? { note: session.note } : {}),
    })),
    planned_kcal: energy.planned,
  };
}

function viewSportLogDay(state, date) {
  const day = readSportDay(state, date);
  const log = readSportLogDay(state, date);
  return {
    date,
    weekday: weekday(date),
    sessions: (day?.sessions || []).map((session) => {
      const record = log?.sessions?.[session.id] || { state: "unmarked" };
      return {
        type: SPORT_TYPE_LABELS[session.type],
        time: session.time,
        planned_min: session.durationMin,
        state: SPORT_STATE_LABELS[record.state],
        ...(record.actualDurationMin != null ? { actual_min: record.actualDurationMin } : {}),
        ...(record.actualIntensity ? { actual_intensity: SPORT_INTENSITY_LABELS[record.actualIntensity] } : {}),
      };
    }),
    unplanned: (log?.unplanned || []).map((session) => ({ type: SPORT_TYPE_LABELS[session.type], duration_min: session.durationMin, intensity: SPORT_INTENSITY_LABELS[session.intensity] })),
    actual_kcal: readSportDayEnergy(state, date).actual,
  };
}

function viewHistoryDay(state, date) {
  const day = readRationDay(state, date);
  const history = readRationHistoryDay(state, date);
  const labels = { unmarked: "не отмечено", eaten: "съедено", changed: "изменено", skipped: "не съедено" };
  return {
    date,
    weekday: weekday(date),
    meals: (day?.meals || []).map((meal) => {
      const record = history?.meals?.[meal.id] || {};
      return {
        name: meal.name,
        time: meal.time,
        state: labels[record.state] || labels.unmarked,
        discrepancies: (record.discrepancies || []).map((item) => ({
          kind: item.kind,
          product: (state.products || []).find((value) => value.id === item.productId)?.name || item.name || "",
          ...(item.replacedName ? { replacedBy: item.replacedName } : {}),
          ...(item.amount ? { amount: item.amount, unit: item.measureUnit || "" } : {}),
        })),
      };
    }),
  };
}

function viewProfile(state) {
  const { updatedAt, updatedBy, ...profile } = state.ration?.profile || {};
  return profile;
}

function viewCatalog(state) {
  return (state.products || []).filter((product) => !product.deletedAt).map((product) => ({
    name: product.name,
    unit: rationMeasure(product).unit,
    per100: product.nutrition ? per100(product.nutrition) : null,
  }));
}

function productByName(state, name) {
  const key = normalizeProductName(name);
  if (!key) return null;
  return (state.products || []).find((product) => !product.deletedAt && normalizeProductName(product.name) === key) || null;
}

function dateRange(from, to, limit) {
  if (!isDate(from) || !isDate(to)) return { ok: false, error: "Даты должны быть в формате ГГГГ-ММ-ДД." };
  if (from > to) return { ok: false, error: "from позже to." };
  const dates = [];
  for (let date = from; date <= to && dates.length < limit; date = addDays(date, 1)) dates.push(date);
  return { ok: true, dates };
}

function pageOf(proposals) {
  const pages = new Set(proposals.map((proposal) => proposal.page || "ration"));
  return pages.has("ration") && pages.has("sport") ? "ration+sport" : pages.has("sport") ? "sport" : "ration";
}

function batchSummary(proposals) {
  const text = `Ассистент: ${proposals.map((proposal) => proposal.summary).join("; ")}`;
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function addDays(dateKey, days) {
  const date = parseRationDate(dateKey);
  date.setDate(date.getDate() + days);
  return formatRationDate(date);
}

function weekday(dateKey) {
  return WEEKDAY_BY_DAY[parseRationDate(dateKey).getDay()];
}

function shortDate(dateKey) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(parseRationDate(dateKey));
}

function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}
