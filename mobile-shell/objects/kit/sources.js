// The classic Рацион, Спорт and Покупки as virtual values per day. They are
// read through domain.js and never written: the gates, the cycle and the
// discrepancies stay where they are. A day with nothing marked gives null, so a
// chart shows a gap instead of a false zero.
import { AREAS, dayActual, markFor, planDay, sportDay } from "../core/domain.js";
import { objectsOfType, profileOf } from "../core/values.js";

// name -> what a bound element shows. `goal` names the Profile relation behind the target.
export const SOURCES = Object.freeze({
  ration: Object.freeze({
    title: "Рацион",
    values: Object.freeze({
      kcal: { label: "Съедено", unit: "ккал", goal: "targetCalories", goalType: "max" },
      protein: { label: "Белки", unit: "г", goal: "targetProtein", goalType: "min" },
      fat: { label: "Жиры", unit: "г", goal: "targetFat", goalType: "max" },
      carbs: { label: "Углеводы", unit: "г", goal: "targetCarbs", goalType: "max" },
      kcal_planned: { label: "По плану", unit: "ккал" },
      protein_planned: { label: "Белки по плану", unit: "г" },
      skipped: { label: "Не съедено приёмов", unit: "" },
    }),
  }),
  sport: Object.freeze({
    title: "Спорт",
    values: Object.freeze({
      burned: { label: "Расход", unit: "ккал" },
      burned_planned: { label: "Расход по плану", unit: "ккал" },
      minutes: { label: "Тренировки", unit: "мин" },
    }),
  }),
  shopping: Object.freeze({
    title: "Покупки",
    values: Object.freeze({
      spent: { label: "Потрачено", unit: "₽" },
      bought: { label: "Куплено позиций", unit: "" },
    }),
  }),
});

export const isSource = (name) => Object.hasOwn(SOURCES, name);

const slotOf = (obj) => obj.props.slot || obj.id;

// The classic slots of a date: meals or sessions with their names and times.
// `follow` tracks attach to these.
export function slotsOf(state, area, date) {
  if (!AREAS[area]) return [];
  return planDay(state, area, date).items.map((id) => {
    const obj = state.objects[id];
    return { slot: slotOf(obj), id, area, name: obj.name || (area === "ration" ? "Приём пищи" : "Тренировка"), time: obj.props.time || "" };
  });
}

const sum = (list) => list.reduce((total, value) => total + (Number(value) || 0), 0);
const round = (value) => Math.round(value * 100) / 100;

function rationDay(state, date, ctx) {
  const day = dayActual(state, date, ctx);
  const marked = day.meals.some((meal) => meal.state !== "unmarked");
  const planned = day.meals.length > 0;
  const eaten = (key) => (marked ? day.eaten[key] : null);
  return {
    kcal: eaten("kcal"), protein: eaten("protein"), fat: eaten("fat"), carbs: eaten("carbs"),
    kcal_planned: planned ? day.planned.kcal : null,
    protein_planned: planned ? day.planned.protein : null,
    skipped: planned ? day.meals.filter((meal) => meal.state === "skipped").length : null,
  };
}

function sportValues(state, date) {
  const day = sportDay(state, date);
  const activities = day.activities.map((id) => state.objects[id]);
  const marked = day.sessions.some((session) => session.state !== "unmarked") || activities.length > 0;
  const minutes = day.sessions.map((session) => {
    if (session.state !== "done" && session.state !== "changed") return 0;
    const mark = markFor(state, "sport", date, session.slot);
    return mark?.props.actualDuration ?? state.objects[session.sessionId].props.duration;
  });
  return {
    burned: marked && day.weightKnown ? day.actual : null,
    burned_planned: day.sessions.length && day.weightKnown ? day.planned : null,
    minutes: marked ? sum([...minutes, ...activities.map((entry) => entry.props.duration)]) : null,
  };
}

const purchaseIndexes = new WeakMap();
function purchasesOn(state, date) {
  let index = purchaseIndexes.get(state);
  if (!index) {
    index = new Map();
    for (const purchase of objectsOfType(state, "purchase")) {
      const day = purchase.props.date;
      if (!index.has(day)) index.set(day, []);
      index.get(day).push(purchase);
    }
    purchaseIndexes.set(state, index);
  }
  return index.get(date) || [];
}

function shoppingValues(state, date) {
  const list = purchasesOn(state, date);
  return { spent: list.length ? round(sum(list.map((p) => p.props.price))) : null, bought: list.length || null };
}

// All values of one source on one date.
export function sourceDay(state, source, date, ctx = {}) {
  if (source === "ration") return rationDay(state, date, ctx);
  if (source === "sport") return sportValues(state, date);
  if (source === "shopping") return shoppingValues(state, date);
  throw new Error(`нет источника «${source}»`);
}

export const sourceValue = (state, source, name, date, ctx) => sourceDay(state, source, date, ctx)[name] ?? null;

// The target of a value from the Profile, or null: only a person writes it.
export function sourceGoal(state, source, name) {
  const meta = SOURCES[source]?.values[name];
  const value = meta?.goal ? Number(profileOf(state)?.props[meta.goal]) : 0;
  return value > 0 ? { goal: value, goalType: meta.goalType } : null;
}
