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
      meals: { label: "Съедено приёмов", unit: "" },
      meals_planned: { label: "Приёмов по плану", unit: "" },
    }),
  }),
  sport: Object.freeze({
    title: "Спорт",
    values: Object.freeze({
      burned: { label: "Расход", unit: "ккал" },
      burned_planned: { label: "Расход по плану", unit: "ккал" },
      minutes: { label: "Тренировки", unit: "мин" },
      sessions: { label: "Тренировок сделано", unit: "" },
      sessions_planned: { label: "Тренировок по плану", unit: "" },
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
  if (area === "shopping") {
    return purchasesOn(state, date).map((obj) => ({ slot: obj.id, id: obj.id, area, name: obj.name || "Покупка", time: "" }));
  }
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
    meals: marked ? day.meals.filter((meal) => isEaten(meal.state)).length : null,
    meals_planned: planned ? day.meals.length : null,
  };
}

const isEaten = (mealState) => mealState === "eaten" || mealState === "changed";
const isDone = (sessionState) => sessionState === "done" || sessionState === "changed";

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
    sessions: marked ? day.sessions.filter((session) => isDone(session.state)).length + activities.length : null,
    sessions_planned: day.sessions.length ? day.sessions.length : null,
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

// The same values per slot of one date: each meal or session, so a chart can show
// one bar per slot. A slot nobody marked has no eaten, burned or minutes value; the
// activities outside the plan make one more slot.
function rationSlots(state, date, ctx) {
  const day = dayActual(state, date, ctx);
  return day.meals.map((meal) => {
    const marked = meal.state !== "unmarked";
    const obj = state.objects[meal.mealId];
    return {
      slot: meal.slot, name: obj.name || "Приём пищи", time: obj.props.time || "",
      values: {
        kcal: marked ? meal.actual.kcal : null, protein: marked ? meal.actual.protein : null, fat: marked ? meal.actual.fat : null, carbs: marked ? meal.actual.carbs : null,
        kcal_planned: meal.planned.kcal, protein_planned: meal.planned.protein,
        skipped: meal.state === "skipped" ? 1 : 0, meals: marked ? (isEaten(meal.state) ? 1 : 0) : null, meals_planned: 1,
      },
    };
  });
}

function sportSlots(state, date) {
  const day = sportDay(state, date);
  const slots = day.sessions.map((session) => {
    const marked = session.state !== "unmarked";
    const obj = state.objects[session.sessionId];
    const mark = markFor(state, "sport", date, session.slot);
    return {
      slot: session.slot, name: obj.name || "Тренировка", time: obj.props.time || "", actual: session.actual,
      values: {
        burned: marked ? session.actual : null, burned_planned: session.planned,
        minutes: isDone(session.state) ? mark?.props.actualDuration ?? obj.props.duration : marked ? 0 : null,
        sessions: marked ? (isDone(session.state) ? 1 : 0) : null, sessions_planned: 1,
      },
    };
  });
  const activities = (day.activities || []).map((id) => state.objects[id]);
  if (activities.length) {
    const known = sum(slots.map((slot) => slot.actual));
    slots.push({
      slot: "__extra", name: "Вне плана", time: "",
      values: { burned: day.weightKnown ? Math.max(0, day.actual - known) : null, burned_planned: null, minutes: sum(activities.map((entry) => entry.props.duration)), sessions: activities.length, sessions_planned: null },
    });
  }
  return slots.map(({ actual, ...slot }) => slot);
}

/** The values of one source on one date, split by slot: [{ slot, name, time, values }]. Shopping has no slots. */
export function sourceSlots(state, source, date, ctx = {}) {
  if (source === "ration") return rationSlots(state, date, ctx);
  if (source === "sport") return sportSlots(state, date);
  throw new Error(`у источника «${source}» нет приёмов и тренировок для by: slot`);
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
