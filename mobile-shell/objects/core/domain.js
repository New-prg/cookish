// Рацион and Спорт over objects. A date gets its Особый день, else the cycle
// day of the week plan in force; marks and discrepancies are facts keyed by
// date and slot, so they survive copying a cycle day into an Особый день.
// The module also registers the `plan` source for sets and two store rules:
// the past plan does not change, and the assistant cannot leave a day below
// the КБЖУ gate.
import { SPORT_MET } from "./schema.js";
import { backlinks, objectsOfType, profileOf, round2, valueOf } from "./values.js";
import { registerSource, resolveDate } from "./query.js";
import { localDateKey, registerRule } from "./store.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

// What differs between the two plans: the list a day holds, the item type
// and the mark type.
export const AREAS = Object.freeze({
  ration: Object.freeze({ list: "meals", item: "meal", mark: "meal_mark", title: "Рацион" }),
  sport: Object.freeze({ list: "sessions", item: "session", mark: "session_mark", title: "Тренировки" }),
});

// The same thresholds as KBJU_GATE in mobile-shell/core/proposals.js.
export const KBJU_GATE = Object.freeze({ minCalories: 1200, tolerance: 0.15, minProteinShare: 0.75 });

const MEAL_STATES = new Set(["unmarked", "eaten", "changed", "skipped"]);
const SESSION_STATES = new Set(["unmarked", "done", "changed", "skipped"]);
const INTENSITIES = new Set(["low", "medium", "high"]);
const NUTRIENTS = Object.freeze({ kcal: "kcal100", protein: "protein100", fat: "fat100", carbs: "carbs100" });
const WEEKDAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

const dayNumber = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
export const shiftDate = (date, days) => new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
const mod = (n, m) => ((n % m) + m) % m;
// Monday is 0; 1970-01-01, day number 0, was a Thursday.
const weekdayOf = (date) => mod(dayNumber(date) + 3, 7);

// normalizeProductName of the legacy Рацион: names and words compare in this form.
export const normalizeName = (name) => String(name || "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
// The words of the Profile («не ест»), kept as the person wrote them: a comma or a line apart.
export const termsOf = (text) => String(text || "").split(/[,\n]/).map(normalizeName).filter(Boolean);

export function cycleDayName(weekdayBinding, anchor, index) {
  return weekdayBinding && DATE.test(anchor || "") ? WEEKDAYS[weekdayOf(shiftDate(anchor, index))] : `День ${index + 1}`;
}

let counter = 0;
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const live = (state, ids) => (Array.isArray(ids) ? ids : []).map((id) => state.objects[id]).filter((obj) => obj && !obj.archivedAt);
const slotOf = (obj) => obj.props.slot || obj.id;
const byTime = (objs) => objs.slice().sort((a, b) => String(a.props.time || "").localeCompare(String(b.props.time || "")));
const stamp = (obj) => {
  const time = Date.parse(obj.createdAt || "");
  return Number.isFinite(time) ? time : 0;
};

// One pass over the space per snapshot: Особые дни by area and date, week
// plans by area in the order the legacy activePlanVersion uses, and facts by
// date and slot.
const indexes = new WeakMap();
function planIndex(state) {
  let index = indexes.get(state);
  if (index) return index;
  index = { special: new Map(), weeks: { ration: [], sport: [] }, marks: new Map(), discrepancies: new Map(), activities: new Map() };
  for (const day of objectsOfType(state, "day_plan")) {
    if (AREAS[day.props.area] && day.props.date) index.special.set(`${day.props.area}|${day.props.date}`, day);
  }
  for (const week of objectsOfType(state, "week_plan")) {
    if (index.weeks[week.props.area] && DATE.test(week.props.effectiveFrom || "")) index.weeks[week.props.area].push(week);
  }
  for (const list of Object.values(index.weeks)) {
    list.sort((a, b) => a.props.effectiveFrom.localeCompare(b.props.effectiveFrom) || stamp(a) - stamp(b) || String(a.id).localeCompare(String(b.id)));
  }
  for (const type of ["meal_mark", "session_mark"]) {
    for (const mark of objectsOfType(state, type)) index.marks.set(`${type}|${mark.props.date}|${mark.props.slot}`, mark);
  }
  // Insertion order breaks createdAt ties: the first matching discrepancy
  // wins, as in the legacy История.
  const discrepancies = objectsOfType(state, "discrepancy").slice().sort((a, b) => stamp(a) - stamp(b));
  for (const entry of discrepancies) push(index.discrepancies, `${entry.props.date}|${entry.props.slot}`, entry);
  for (const activity of objectsOfType(state, "activity")) push(index.activities, activity.props.date, activity);
  indexes.set(state, index);
  return index;
}

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

// The week plan in force on a date: the latest effectiveFrom not after it.
export function activeWeek(state, area, date) {
  let active = null;
  for (const week of planIndex(state).weeks[area] || []) {
    if (week.props.effectiveFrom <= date) active = week;
    else break;
  }
  return active;
}

// For a cycle of 7 days, following weekdays from the anchor and counting days
// from it pick the same day, so weekdayBinding only names the days.
function cycleDay(state, week, date) {
  const days = Array.isArray(week.props.days) ? week.props.days : [];
  const anchor = week.props.anchor;
  if (!days.length || !DATE.test(anchor || "")) return null;
  const day = state.objects[days[mod(dayNumber(date) - dayNumber(anchor), days.length)]];
  return day && !day.archivedAt ? day : null;
}

function resolveDay(state, area, date) {
  if (!AREAS[area] || !DATE.test(String(date || ""))) return { day: null, source: "empty", week: null };
  const week = activeWeek(state, area, date);
  const special = planIndex(state).special.get(`${area}|${date}`);
  if (special) return { day: special, source: "special", week };
  const day = week ? cycleDay(state, week, date) : null;
  return { day, source: day ? "cycle" : "empty", week };
}

export function planDay(state, area, date) {
  const { day, source, week } = resolveDay(state, area, date);
  const items = day ? byTime(live(state, day.props[AREAS[area].list])) : [];
  return { dayId: day?.id ?? null, source, weekId: week?.id ?? null, items: items.map((obj) => obj.id) };
}

export function markFor(state, area, date, slot) {
  const type = AREAS[area]?.mark;
  return (type && planIndex(state).marks.get(`${type}|${date}|${slot}`)) || null;
}

const discrepanciesFor = (state, date, slot) => planIndex(state).discrepancies.get(`${date}|${slot}`) || [];

// The `base` formula of a portion in code: grams or millilitres, null for
// pieces without a piece weight.
function baseOf(product, amount, unit) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  if (unit === "шт.") {
    const piece = Number(product?.props.pieceWeight);
    return piece > 0 ? value * piece : null;
  }
  return unit === "кг" || unit === "л" ? value * 1000 : value;
}

const zero = () => ({ kcal: 0, protein: 0, fat: 0, carbs: 0 });
const addTo = (target, values) => { for (const key of Object.keys(NUTRIENTS)) target[key] += values[key]; };
const rounded = (values) => Object.fromEntries(Object.keys(NUTRIENTS).map((key) => [key, round2(values[key])]));

// Unknown КБЖУ counts as zero, like the legacy Учёт.
function nutritionOf(state, productId, amount, unit) {
  const result = zero();
  const product = productId ? state.objects[productId] : null;
  const base = product ? baseOf(product, amount, unit) : null;
  if (base == null) return result;
  for (const [key, rel] of Object.entries(NUTRIENTS)) {
    const per100 = Number(product.props[rel]);
    if (Number.isFinite(per100)) result[key] = (per100 * base) / 100;
  }
  return result;
}

// Defaults of a product's unit, as rationMeasure in the legacy Рацион.
export function measureOf(product) {
  const unit = product?.props.unit;
  if (unit === "шт.") return { unit: "шт.", portion: 1, pack: 1 };
  if (unit === "л" || unit === "мл") return { unit: "мл", portion: 250, pack: 1000 };
  return { unit: "г", portion: 100, pack: 1000 };
}

// One day of Учёт питания: the plan and what was eaten. A meal counts only in
// «съедено» or «изменено»; then discrepancies drop products, change amounts,
// swap products and add products outside the plan.
export function dayActual(state, date, ctx = {}) {
  const plan = planDay(state, "ration", date);
  const planned = zero();
  const eaten = zero();
  const meals = plan.items.map((mealId) => {
    const meal = state.objects[mealId];
    const slot = slotOf(meal);
    const mark = markFor(state, "ration", date, slot);
    const mealState = MEAL_STATES.has(mark?.props.mealState) ? mark.props.mealState : "unmarked";
    const discrepancies = discrepanciesFor(state, date, slot);
    const mealPlanned = Object.fromEntries(Object.keys(NUTRIENTS).map((key) => [key, valueOf(state, meal, key, ctx) ?? 0]));
    const actual = zero();
    if (mealState === "eaten" || mealState === "changed") {
      for (const portion of live(state, meal.props.items)) {
        const product = portion.props.product;
        const find = (kind) => (product ? discrepancies.find((entry) => entry.props.discrepancyKind === kind && entry.props.product === product) : null);
        if (find("excluded")) continue;
        const changed = find("amount");
        const replaced = find("replaced");
        const amount = changed ? Number(changed.props.amount) || 0 : portion.props.amount;
        addTo(actual, nutritionOf(state, replaced?.props.replacedBy || product, amount, portion.props.unit));
      }
      for (const entry of discrepancies) {
        if (entry.props.discrepancyKind === "added") addTo(actual, nutritionOf(state, entry.props.product, entry.props.amount, entry.props.unit));
      }
    }
    addTo(planned, mealPlanned);
    addTo(eaten, actual);
    return { mealId, slot, state: mealState, planned: mealPlanned, actual: rounded(actual), discrepancies: discrepancies.map((entry) => entry.id) };
  });
  return { date, dayId: plan.dayId, planned: rounded(planned), eaten: rounded(eaten), meals };
}

// MET × body weight × hours, the legacy sessionEnergy; null without a weight.
function energy(kind, intensity, minutes, weight) {
  if (!(weight > 0)) return null;
  const met = SPORT_MET[kind]?.[intensity] ?? SPORT_MET.other.medium;
  return Math.round(met * weight * ((Number(minutes) || 0) / 60));
}

// One day of Учёт тренировок. Done sessions count as planned or with their
// actual values, changed ones with their actual values, skipped ones as zero;
// unmarked sessions add nothing, activities outside the plan add their energy.
export function sportDay(state, date) {
  const plan = planDay(state, "sport", date);
  const weight = Number(profileOf(state)?.props.weightKg) || 0;
  const sessions = plan.items.map((sessionId) => {
    const session = state.objects[sessionId];
    const slot = slotOf(session);
    const mark = markFor(state, "sport", date, slot);
    const sessionState = SESSION_STATES.has(mark?.props.sessionState) ? mark.props.sessionState : "unmarked";
    const { kind, intensity, duration } = session.props;
    const planned = energy(kind, intensity, duration, weight);
    const actual = sessionState === "done" || sessionState === "changed"
      ? energy(kind, mark.props.actualIntensity || intensity, mark.props.actualDuration ?? duration, weight)
      : sessionState === "skipped" ? 0 : null;
    return { sessionId, slot, state: sessionState, planned, actual };
  });
  const activities = planIndex(state).activities.get(date) || [];
  const sum = (values) => values.reduce((total, value) => total + (Number(value) || 0), 0);
  const known = weight > 0;
  return {
    date,
    dayId: plan.dayId,
    weightKnown: known,
    planned: known ? sum(sessions.map((entry) => entry.planned)) : null,
    actual: known ? sum([...sessions.map((entry) => entry.actual), ...activities.map((entry) => energy(entry.props.kind, entry.props.intensity, entry.props.duration, weight))]) : null,
    sessions,
    activities: activities.map((entry) => entry.id),
  };
}

function itemOf(state, id, type, missing) {
  const obj = state.objects[id];
  if (!obj || obj.type !== type) throw new Error(missing);
  return obj;
}

// Creates the mark of (date, slot) or updates it; the link follows the item
// the date shows now.
function markOps(state, area, date, item, props) {
  const { mark: type, item: link } = AREAS[area];
  const slot = slotOf(item);
  const mark = markFor(state, area, date, slot);
  if (mark) return [{ op: "update", id: mark.id, props: { [link]: item.id, ...props } }];
  return [{ op: "create", type, id: newId(type), name: item.name, props: { date, slot, [link]: item.id, ...props } }];
}

export function markMealOps(state, date, mealId, mealState) {
  return markOps(state, "ration", date, itemOf(state, mealId, "meal", "Приём пищи не найден."), { mealState });
}

// A discrepancy also turns an unmarked meal into «изменено». An added product
// without an amount gets the default portion of its unit.
export function discrepancyOps(state, date, mealId, { kind, product, replacedBy, amount, unit } = {}) {
  const meal = itemOf(state, mealId, "meal", "Приём пищи не найден.");
  const slot = slotOf(meal);
  const productObj = product ? state.objects[product] : null;
  const props = { date, slot, discrepancyKind: kind, product, replacedBy: kind === "replaced" ? replacedBy : undefined, amount, unit };
  if (kind === "added") {
    const measure = measureOf(productObj);
    props.amount = Number(amount) || measure.portion;
    props.unit = unit || measure.unit;
  } else if (amount != null) {
    props.amount = Number(amount) || 0;
  }
  const ops = [{ op: "create", type: "discrepancy", id: newId("discrepancy"), name: productObj?.name || "Продукт", props }];
  const mark = markFor(state, "ration", date, slot);
  if (!mark || mark.props.mealState === "unmarked") ops.push(...markOps(state, "ration", date, meal, { mealState: "changed" }));
  return ops;
}

function clampMinutes(value, fallback) {
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes) || minutes <= 0) return fallback;
  return Math.min(minutes, 24 * 60);
}

// Actual values are kept for «изменено», and for «выполнено» only when given.
export function markSessionOps(state, date, sessionId, sessionState, { actualDuration, actualIntensity } = {}) {
  const session = itemOf(state, sessionId, "session", "Тренировка не найдена.");
  const withActual = sessionState === "changed" || (sessionState === "done" && (actualDuration != null || Boolean(actualIntensity)));
  return markOps(state, "sport", date, session, {
    sessionState,
    actualDuration: withActual ? clampMinutes(actualDuration, session.props.duration) : null,
    actualIntensity: withActual ? (INTENSITIES.has(actualIntensity) ? actualIntensity : session.props.intensity) : null,
  });
}

// Copies the items of a day (and the portions of meals) under new ids; the
// slot stays, so marks of the date keep pointing at the same meal.
function copyDay(state, area, day, props, name, idMap) {
  const { list } = AREAS[area];
  const ops = [];
  const items = day ? live(state, day.props[list]).map((item) => {
    const copy = { ...item.props, slot: slotOf(item) };
    if (item.type === "meal") {
      copy.items = live(state, item.props.items).map((portion) => {
        const id = newId("portion");
        idMap[portion.id] = id;
        ops.push({ op: "create", type: "portion", id, name: portion.name, props: { ...portion.props } });
        return id;
      });
    }
    const id = newId(item.type);
    idMap[item.id] = id;
    ops.push({ op: "create", type: item.type, id, name: item.name, props: copy });
    return id;
  }) : [];
  const id = newId("day_plan");
  if (day) idMap[day.id] = id;
  ops.push({ op: "create", type: "day_plan", id, name, props: { area, ...props, [list]: items } });
  return { ops, id };
}

function archiveDayOps(state, area, day) {
  const ops = [];
  for (const item of live(state, day.props[AREAS[area].list])) {
    for (const portion of item.type === "meal" ? live(state, item.props.items) : []) ops.push({ op: "archive", id: portion.id });
    ops.push({ op: "archive", id: item.id });
  }
  ops.push({ op: "archive", id: day.id });
  return ops;
}

// The way to change one date of a week in force: its cycle day becomes an
// Особый день of that date. A date that already has one is returned as is.
export function editableDayOps(state, area, date) {
  const { day, source } = resolveDay(state, area, date);
  if (source === "special") return { ops: [], dayId: day.id, idMap: {} };
  const idMap = {};
  const { ops, id } = copyDay(state, area, day, { date }, `Особый день ${date}`, idMap);
  return { ops, dayId: id, idMap };
}

// A new week plan from a future date: the plan the dates show now becomes the
// cycle (a week of 7 days follows weekdays), and Особые дни inside the range
// are archived because the cycle now holds them. The store rejects a start
// that is not in the future.
export function newWeekOps(state, area, { fromDate, days = 7 } = {}) {
  if (!AREAS[area] || !DATE.test(String(fromDate || ""))) throw new Error("Некорректная дата.");
  const length = Math.max(1, Math.round(Number(days) || 7));
  const dates = Array.from({ length }, (_, index) => shiftDate(fromDate, index));
  const sources = dates.map((date) => resolveDay(state, area, date));
  if (!sources.some(({ day }) => day && live(state, day.props[AREAS[area].list]).length)) {
    throw new Error(area === "ration" ? "В выбранных днях нет приёмов пищи." : "В выбранных днях нет тренировок.");
  }
  const binding = length === 7;
  const ops = [];
  const dayIds = sources.map(({ day }, index) => {
    const copy = copyDay(state, area, day, { cycleIndex: index }, cycleDayName(binding, fromDate, index), {});
    ops.push(...copy.ops);
    return copy.id;
  });
  ops.push({ op: "create", type: "week_plan", id: newId("week_plan"), name: `${AREAS[area].title} с ${fromDate}`, props: { area, effectiveFrom: fromDate, anchor: fromDate, weekdayBinding: binding, days: dayIds } });
  for (const { day, source } of sources) if (source === "special") ops.push(...archiveDayOps(state, area, day));
  return ops;
}

// A Запрос from the plan of some dates: portions summed per product, rounded
// up to packages (plannedRationRequestItems). The first op creates the
// request; its id is the Запрос to open.
export function requestFromPlanOps(state, { dates = [], name = "", today = localDateKey() } = {}) {
  const lines = new Map();
  const sorted = [...dates].sort();
  for (const date of sorted) {
    const { day } = resolveDay(state, "ration", date);
    for (const meal of day ? live(state, day.props.meals) : []) {
      for (const portion of live(state, meal.props.items)) {
        const productId = portion.props.product;
        if (!productId) continue;
        const measure = measureOf(state.objects[productId]);
        const pack = Number(portion.props.packSize) || measure.pack;
        const line = lines.get(productId) || { productId, planned: 0, pack, unit: portion.props.unit || measure.unit };
        line.planned += Number(portion.props.amount) || measure.portion;
        line.pack = pack;
        lines.set(productId, line);
      }
    }
  }
  if (!lines.size) throw new Error("В выбранных днях нет продуктов.");
  const requestId = newId("request");
  const items = [...lines.values()].map((line) => ({
    op: "create",
    type: "request_item",
    id: newId("request_item"),
    name: state.objects[line.productId]?.name || "Продукт",
    props: { request: requestId, product: line.productId, quantity: Math.max(1, Math.ceil(line.planned / line.pack)), unit: "уп.", note: `${round2(line.planned)} ${line.unit} по плану` },
  }));
  const title = name || (sorted.length > 1 ? `Запрос на ${sorted[0]} – ${sorted.at(-1)}` : `Запрос на ${sorted[0]}`);
  return [
    { op: "create", type: "request", id: requestId, name: title, props: { status: "open", date: today, items: items.map((op) => op.id) } },
    ...items,
  ];
}

const boughtOf = (state, itemId) => backlinks(state, "purchase", "item", itemId)
  .reduce((total, id) => total + (Number(state.objects[id]?.props.quantity) || 0), 0);

// A Покупка adds to what was bought; without a quantity it buys the rest. The
// Запрос closes when every item is bought.
export function markBoughtOps(state, itemId, { quantity, price, date = localDateKey(), product } = {}) {
  const item = itemOf(state, itemId, "request_item", "Позиция запроса не найдена.");
  const request = itemOf(state, item.props.request, "request", "Запрос не найден.");
  const requested = Number(item.props.quantity) || 0;
  const rest = Math.max(0, requested - boughtOf(state, itemId));
  const amount = Number(quantity) > 0 ? Number(quantity) : rest || 1;
  const sum = Number(price);
  const ops = [{
    op: "create",
    type: "purchase",
    id: newId("purchase"),
    name: item.name,
    props: { date, request: request.id, item: itemId, product: product || item.props.product, quantity: amount, price: Number.isFinite(sum) && sum >= 0 ? sum : 0 },
  }];
  const items = live(state, request.props.items);
  const done = items.length > 0 && items.every((entry) => boughtOf(state, entry.id) + (entry.id === itemId ? amount : 0) >= (Number(entry.props.quantity) || 0));
  if (done && request.props.status !== "done") ops.push({ op: "update", id: request.id, props: { status: "done" } });
  return ops;
}

registerSource("plan", (state, { area = "ration", date = "@today" } = {}, ctx = {}) => planDay(state, area, resolveDate(date, ctx.today)).items);

// Rule 1. The plan of a past date and every week plan already in force stay
// as they were: a change of today goes through editableDayOps, of the future
// through newWeekOps. Marks of a future date are refused like in the legacy
// История and Учёт. The one-way import writes the past and is exempt.
const PLAN_TYPES = new Set(["week_plan", "day_plan", "meal", "portion", "session"]);
const MARK_TYPES = new Set(["meal_mark", "discrepancy", "session_mark", "activity"]);

function lockedWeek(week, today) {
  return DATE.test(week.props.effectiveFrom || "") && week.props.effectiveFrom <= today;
}

function lockedDay(state, day, today) {
  if (day.props.date) return day.props.date < today;
  return backlinks(state, "week_plan", "days", day.id).some((id) => lockedWeek(state.objects[id], today));
}

function lockedPlan(state, obj, today) {
  const owners = (type, rel) => backlinks(state, type, rel, obj.id).map((id) => state.objects[id]);
  switch (obj.type) {
    case "week_plan": return lockedWeek(obj, today);
    case "day_plan": return lockedDay(state, obj, today);
    case "meal": return owners("day_plan", "meals").some((day) => lockedDay(state, day, today));
    case "session": return owners("day_plan", "sessions").some((day) => lockedDay(state, day, today));
    case "portion": return owners("meal", "items").some((meal) => lockedPlan(state, meal, today));
  }
  return false;
}

registerRule(({ prev, next, touched, actor, today }) => {
  if (actor === "import") return [];
  const problems = [];
  for (const id of touched) {
    const was = prev.objects[id];
    const now = next.objects[id];
    const type = (now || was).type;
    if (PLAN_TYPES.has(type) && ((was && lockedPlan(prev, was, today)) || (now && lockedPlan(next, now, today)))) {
      problems.push({ block: true, message: `«${(now || was).name || next.types[type]?.name}»: план прошедших дней и действующей недели не меняется, измените день через Особый день или новую неделю` });
    } else if (MARK_TYPES.has(type) && now && !now.archivedAt && now.props.date > today) {
      problems.push({ block: true, message: `«${now.name || next.types[type]?.name}»: нельзя отмечать будущий день` });
    }
  }
  return problems;
});

// Rule 2. A batch of the assistant leaves every ration day it touched, from
// today on, inside the КБЖУ gate of the legacy gateMeals, and every week it
// touched inside the weekly loss gate of the legacy weekProblems.
function dayIdsOf(state, obj) {
  const daysOfMeal = (mealId) => backlinks(state, "day_plan", "meals", mealId);
  const mealsOfPortion = (portionId) => backlinks(state, "meal", "items", portionId);
  switch (obj.type) {
    case "day_plan": return [obj.id];
    case "week_plan": return Array.isArray(obj.props.days) ? obj.props.days : [];
    case "meal": return daysOfMeal(obj.id);
    case "session": return backlinks(state, "day_plan", "sessions", obj.id);
    case "portion": return mealsOfPortion(obj.id).flatMap(daysOfMeal);
    case "product": return backlinks(state, "portion", "product", obj.id).flatMap(mealsOfPortion).flatMap(daysOfMeal);
  }
  return [];
}

const weeksOf = (state, day) => backlinks(state, "week_plan", "days", day.id).map((id) => state.objects[id]);

// A day is a ration day when it says so or when a week plan of the Рацион
// lists it: planDay takes the area from the week, so the week decides.
const isRationDay = (state, day) => day.props.area === "ration" || weeksOf(state, day).some((week) => week.props.area === "ration");

function inForce(state, day, today) {
  if (day.props.date) return day.props.date >= today;
  const current = activeWeek(state, "ration", today);
  return weeksOf(state, day).some((week) => week.props.area === "ration" && (week.props.effectiveFrom > today || week.id === current?.id));
}

export function gateDay(state, dayId, ctx = {}) {
  const day = state.objects[dayId];
  const meals = live(state, day?.props.meals);
  const totals = { kcal: 0, protein: 0 };
  for (const meal of meals) for (const key of Object.keys(totals)) totals[key] += valueOf(state, meal, key, ctx) ?? 0;
  totals.kcal = round2(totals.kcal);
  totals.protein = round2(totals.protein);
  const profile = profileOf(state)?.props || {};
  const problems = [];
  const target = Number(profile.targetCalories) || 0;
  if (totals.kcal < KBJU_GATE.minCalories) problems.push(`калорийность ${Math.round(totals.kcal)} ккал ниже безопасного минимума ${KBJU_GATE.minCalories}`);
  if (target && Math.abs(totals.kcal - target) / target > KBJU_GATE.tolerance) problems.push(`калорийность ${Math.round(totals.kcal)} ккал отличается от цели ${target} больше чем на 15%`);
  const protein = Number(profile.targetProtein) || 0;
  if (protein && totals.protein < protein * KBJU_GATE.minProteinShare) problems.push(`белок ${Math.round(totals.protein)} г меньше 75% цели ${protein} г`);
  const excluded = new Set(Array.isArray(profile.excluded) ? profile.excluded : []);
  const terms = termsOf(profile.excludedTerms);
  for (const portion of meals.flatMap((meal) => live(state, meal.props.items))) {
    const product = state.objects[portion.props.product];
    // As the legacy gateMeals: a word of the Profile inside the product name.
    const name = normalizeName(product?.name || portion.name);
    if ((product && excluded.has(product.id)) || terms.some((term) => name.includes(term))) problems.push(`исключённый продукт «${product?.name || portion.name}»`);
    // Pieces without a weight are not counted at all, so they are not flagged.
    const uncounted = portion.props.unit === "шт." && !(Number(product?.props.pieceWeight) > 0);
    if (!uncounted && (!product || product.props.kcal100 == null)) problems.push(`у продукта «${product?.name || portion.name}» нет КБЖУ`);
  }
  return { ok: problems.length === 0, totals, problems: [...new Set(problems)] };
}

// The weekly loss gate of mobile-shell/core/safety.js: the same constants and
// arithmetic. A plan that passes the day gate every day can still lose weight
// faster than 1% of the body weight a week; workouts count in the balance.
const WEEK_GATE = Object.freeze({ activityFactor: 1.3, kcalPerKg: 7700, maxWeeklyLossShare: 0.01 });
const AGE_OF_GROUP = Object.freeze({ adult: 35, senior: 70 });

// Mifflin–St Jeor at the age of the group, the sex unknown, times everyday
// activity; null without weight, height or an adult age group.
function baseEnergy(profile) {
  const weight = Number(profile.weightKg);
  const height = Number(profile.heightCm);
  const age = AGE_OF_GROUP[String(profile.ageGroup || "")];
  if (!(weight > 0) || !(height > 0) || !age) return null;
  return (10 * weight + 6.25 * height - 5 * age - 78) * WEEK_GATE.activityFactor;
}

// The weeks that hold a changed date, from today on: each of them may lose at
// most 1% of body weight. One problem, for the worst week.
export function weekProblems(state, dates, today) {
  const profile = profileOf(state)?.props || {};
  const base = baseEnergy(profile);
  if (!base || !dates?.length) return [];
  const starts = new Set();
  dates.filter((date) => date >= today).forEach((date) => {
    for (let back = 6; back >= 0; back -= 1) {
      const start = shiftDate(date, -back);
      if (start >= today) starts.add(start);
    }
  });
  const cache = new Map();
  const balance = (date) => {
    if (!cache.has(date)) cache.set(date, { intake: dayActual(state, date, { today }).planned.kcal, sport: Number(sportDay(state, date).planned) || 0 });
    return cache.get(date);
  };
  let worst = null;
  [...starts].forEach((start) => {
    const days = Array.from({ length: 7 }, (_, index) => shiftDate(start, index));
    const intake = days.reduce((total, date) => total + balance(date).intake, 0);
    const sport = days.reduce((total, date) => total + balance(date).sport, 0);
    const deficit = 7 * base + sport - intake;
    if (!worst || deficit > worst.deficit) worst = { from: days[0], to: days[6], deficit, intake, sport };
  });
  const weight = Number(profile.weightKg);
  const limit = weight * WEEK_GATE.maxWeeklyLossShare;
  const pace = worst ? worst.deficit / WEEK_GATE.kcalPerKg : 0;
  if (!worst || pace <= limit) return [];
  const round = (value) => Math.round(value * 10) / 10;
  return [`неделя ${worst.from}–${worst.to}: еда ${Math.round(worst.intake)} ккал${worst.sport ? `, тренировки ${Math.round(worst.sport)} ккал` : ""} при расходе около ${Math.round(7 * base)} ккал без тренировок — это −${round(pace)} кг в неделю, больше 1% веса (${round(limit)} кг). Добавь еды или убери нагрузку`];
}

// How far ahead the dates a cycle day or a week plan shows are followed.
const FOLLOW_DAYS = 28;

// The dates from today on that a week plan shows.
function weekDates(week, today) {
  const from = week.props.effectiveFrom;
  if (!DATE.test(from || "")) return [];
  return Array.from({ length: FOLLOW_DAYS }, (_, index) => shiftDate(from > today ? from : today, index));
}

// The dates from today on that a day plan shows now.
function dayDates(state, day, today) {
  if (day.props.date) return day.props.date >= today ? [day.props.date] : [];
  return weeksOf(state, day).flatMap((week) => weekDates(week, today).filter((date) => planDay(state, week.props.area, date).dayId === day.id));
}

registerRule(({ prev, next, touched, actor, today }) => {
  if (actor !== "ai") return [];
  const days = new Set();
  const dates = new Set();
  for (const id of touched) {
    const obj = next.objects[id] || prev.objects[id];
    dayIdsOf(next, obj).forEach((dayId) => days.add(dayId));
    if (obj.type === "week_plan") weekDates(obj, today).forEach((date) => dates.add(date));
    const gone = !next.objects[id] || next.objects[id].archivedAt;
    // An Особый день taken away hands its date back to the cycle.
    if (obj.type === "day_plan" && obj.props.date >= today && gone) {
      dates.add(obj.props.date);
      const fallback = AREAS[obj.props.area] ? planDay(next, obj.props.area, obj.props.date).dayId : null;
      if (obj.props.area === "ration" && fallback) days.add(fallback);
    }
    // The weight, height and age group set the allowance of every week ahead.
    if (obj.type === "profile") {
      const keys = ["weightKg", "heightCm", "ageGroup"];
      if (keys.some((key) => prev.objects[id]?.props[key] !== obj.props[key])) weekDates({ props: { effectiveFrom: today } }, today).forEach((date) => dates.add(date));
    }
  }
  const problems = [];
  for (const dayId of days) {
    const day = next.objects[dayId];
    if (!day || day.archivedAt) continue;
    dayDates(next, day, today).forEach((date) => dates.add(date));
    const label = day.props.date || day.name;
    if (!AREAS[day.props.area]) {
      problems.push({ block: true, message: `${label}: у дня плана нет раздела (Рацион или Спорт), проверить его нельзя` });
      continue;
    }
    if (!isRationDay(next, day) || !inForce(next, day, today)) continue;
    for (const problem of gateDay(next, dayId, { today }).problems) problems.push({ block: true, message: `${label}: ${problem}` });
  }
  for (const message of weekProblems(next, [...dates], today)) problems.push({ block: true, message });
  return problems;
});
