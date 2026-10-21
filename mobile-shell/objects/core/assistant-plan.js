// Plan side of the Ассистент: what the read tools show about days, and the
// ops that write a day or a week of Рацион or Спорт from the model's words.
// domain.js copies an existing day (editableDayOps, newWeekOps); here the
// content is new, so the ops are built directly in the same shape: slots of
// the meals or sessions the date shows now are kept, so marks of that date
// still find their meal.
import { normalizeProductName } from "../../core/ration-domain.js";
import { AREAS, cycleDayName, dayActual, markFor, planDay, shiftDate, sportDay } from "./domain.js";
import { valueOf } from "./values.js";

export const WEEK_KEYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const SOURCE_NAMES = { special: "Особый день", cycle: "обычный план", empty: "нет плана" };

export const weekdayKey = (date) => WEEK_KEYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
const SHORT_DATE = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
export const shortDate = (date) => SHORT_DATE.format(new Date(`${date}T00:00:00Z`));

const live = (state, ids) => (Array.isArray(ids) ? ids : []).map((id) => state.objects[id]).filter((obj) => obj && !obj.archivedAt);
const slotOf = (obj) => obj.props.slot || obj.id;
const round1 = (value) => Math.round((Number(value) || 0) * 10) / 10;
const optionName = (state, relKey, id) => state.relations[relKey]?.options?.find((option) => option.id === id)?.name ?? id;

// Defaults of a unit as rationMeasure in the legacy Рацион.
export function measureOf(unit) {
  const text = String(unit || "г").toLowerCase();
  if (text.includes("шт")) return { unit: "шт.", portion: 1, pack: 1 };
  if (text === "л" || text.includes("мл")) return { unit: "мл", portion: 250, pack: 1000 };
  return { unit: "г", portion: 100, pack: 1000 };
}

// ——— What the read tools show ———

function mealView(state, meal, ctx) {
  return {
    name: meal.name,
    time: meal.props.time,
    items: live(state, meal.props.items).map((portion) => ({
      product: state.objects[portion.props.product]?.name || portion.name,
      id: portion.props.product,
      amount: portion.props.amount,
      unit: portion.props.unit,
    })),
    kcal: round1(valueOf(state, meal, "kcal", ctx) ?? 0),
  };
}

const totalsOf = (values) => Object.fromEntries(["kcal", "protein", "fat", "carbs"].map((key) => [key, round1(values[key])]));

export function rationDayView(state, date, ctx) {
  const plan = planDay(state, "ration", date);
  return {
    date,
    weekday: weekdayKey(date),
    source: SOURCE_NAMES[plan.source],
    meals: plan.items.map((id) => mealView(state, state.objects[id], ctx)),
    totals: totalsOf(dayActual(state, date, ctx).planned),
  };
}

function sessionView(state, session, burned) {
  return {
    kind: session.props.kind,
    time: session.props.time,
    duration_min: session.props.duration,
    intensity: session.props.intensity,
    ...(session.props.note ? { note: session.props.note } : {}),
    ...(burned != null ? { kcal: burned } : {}),
  };
}

export function sportDayView(state, date, ctx) {
  const plan = planDay(state, "sport", date);
  const day = sportDay(state, date, ctx);
  return {
    date,
    weekday: weekdayKey(date),
    source: SOURCE_NAMES[plan.source],
    sessions: day.sessions.map((entry) => sessionView(state, state.objects[entry.sessionId], entry.planned)),
    planned_kcal: day.planned,
  };
}

export function rationHistoryView(state, date, ctx) {
  const day = dayActual(state, date, ctx);
  return {
    date,
    weekday: weekdayKey(date),
    meals: day.meals.map((entry) => {
      const meal = state.objects[entry.mealId];
      return {
        name: meal.name,
        time: meal.props.time,
        state: optionName(state, "mealState", entry.state),
        planned_kcal: round1(entry.planned.kcal),
        actual_kcal: round1(entry.actual.kcal),
        discrepancies: entry.discrepancies.map((id) => {
          const item = state.objects[id];
          const { discrepancyKind: kind, product, replacedBy, amount, unit } = item.props;
          return {
            kind: optionName(state, "discrepancyKind", kind),
            product: state.objects[product]?.name || item.name,
            ...(replacedBy ? { replacedBy: state.objects[replacedBy]?.name } : {}),
            ...(amount ? { amount, unit } : {}),
          };
        }),
      };
    }),
    totals: { planned_kcal: round1(day.planned.kcal), eaten_kcal: round1(day.eaten.kcal) },
  };
}

export function sportHistoryView(state, date, ctx) {
  const day = sportDay(state, date, ctx);
  return {
    date,
    weekday: weekdayKey(date),
    sessions: day.sessions.map((entry) => {
      const session = state.objects[entry.sessionId];
      const mark = markFor(state, "sport", date, entry.slot);
      return {
        kind: session.props.kind,
        time: session.props.time,
        planned_min: session.props.duration,
        state: optionName(state, "sessionState", entry.state),
        ...(mark?.props.actualDuration != null ? { actual_min: mark.props.actualDuration } : {}),
        ...(mark?.props.actualIntensity ? { actual_intensity: mark.props.actualIntensity } : {}),
        planned_kcal: entry.planned,
        actual_kcal: entry.actual,
      };
    }),
    unplanned: day.activities.map((id) => {
      const { kind, duration, intensity } = state.objects[id].props;
      return { kind, duration_min: duration, intensity };
    }),
    actual_kcal: day.actual,
  };
}

// ——— What the person sees on a Предложение card ———

// One meal or session in a few words, keyed by slot.
function entryOf(state, area, obj) {
  if (area === "ration") {
    const items = live(state, obj.props.items).map((portion) => `${state.objects[portion.props.product]?.name || portion.name} ${portion.props.amount} ${portion.props.unit || ""}`.trim());
    return { slot: slotOf(obj), label: `${obj.name} · ${obj.props.time || ""}`.replace(/ · $/, ""), text: items.join(", ") || "пусто" };
  }
  const note = obj.props.note ? `, ${obj.props.note}` : "";
  return { slot: slotOf(obj), label: `${optionName(state, "kind", obj.props.kind)} · ${obj.props.time || ""}`.replace(/ · $/, ""), text: `${obj.props.duration} мин, ${optionName(state, "intensity", obj.props.intensity)}${note}` };
}

function side(state, area, date, ctx) {
  const plan = planDay(state, area, date);
  const entries = plan.items.map((id) => entryOf(state, area, state.objects[id]));
  const totals = area === "ration" ? totalsOf(dayActual(state, date, ctx).planned) : { kcal: sportDay(state, date, ctx).planned };
  return { entries, totals, source: plan.source };
}

// Per date: the changed meals or sessions as «было → станет» and the totals
// before and after (КБЖУ for Рацион, burned kcal for Спорт).
export function dayPreview(before, after, area, date, ctx) {
  const was = side(before, area, date, ctx);
  const now = side(after, area, date, ctx);
  const changes = [];
  const seen = new Set();
  for (const entry of now.entries) {
    seen.add(entry.slot);
    const old = was.entries.find((value) => value.slot === entry.slot);
    if (!old || old.text !== entry.text || old.label !== entry.label) changes.push({ label: entry.label, was: old ? `${old.label === entry.label ? "" : `${old.label}: `}${old.text}` : null, now: entry.text });
  }
  for (const entry of was.entries) if (!seen.has(entry.slot)) changes.push({ label: entry.label, was: entry.text, now: null });
  return { date, weekday: weekdayKey(date), area, changes, before: was.totals, after: now.totals };
}

// ——— The model's words into plan content ———

// Plan content the model wrote, checked against the space. `findProduct(ref)`
// returns { id, name, unit } for an id, a name or a product of the same
// Предложение. Returns { items, errors }.
export function parseDay(state, area, list, findProduct) {
  const errors = [];
  if (!Array.isArray(list)) return { items: [], errors: [area === "ration" ? "meals должен быть массивом приёмов пищи." : "sessions должен быть массивом тренировок."] };
  if (list.length > 12) return { items: [], errors: ["Слишком много элементов в дне: не больше 12."] };
  if (area === "ration") {
    const items = list.map((meal, index) => {
      const name = String(meal?.name || `Приём пищи ${index + 1}`).trim().slice(0, 80);
      const rows = Array.isArray(meal?.items) ? meal.items : [];
      if (!rows.length) errors.push(`В приёме «${name}» нет продуктов.`);
      return {
        name,
        time: /^\d{2}:\d{2}$/.test(meal?.time || "") ? meal.time : "12:00",
        items: rows.map((row) => {
          const product = findProduct(row?.product);
          if (!product) {
            errors.push(`Продукта «${row?.product}» нет в пространстве: возьми id из find_objects (type product) или заведи его в new_products через find_reference / search_food.`);
            return null;
          }
          const measure = measureOf(product.unit);
          const amount = Number(row?.amount ?? row?.grams);
          if (amount > 10000) errors.push(`Порция «${product.name}» ${amount} слишком большая.`);
          return { product: product.id, name: product.name, amount: amount > 0 ? amount : measure.portion, unit: measure.unit, packSize: measure.pack };
        }).filter(Boolean),
      };
    });
    return { items, errors: [...new Set(errors)] };
  }
  const kinds = (state.relations.kind?.options || []).map((option) => option.id);
  const intensities = (state.relations.intensity?.options || []).map((option) => option.id);
  const items = list.map((value) => {
    const kind = String(value?.kind ?? value?.type ?? "");
    if (!kinds.includes(kind)) errors.push(`Неизвестный вид тренировки «${kind}»: возьми значение из списка ${kinds.join(", ")}.`);
    const minutes = Number(value?.duration ?? value?.duration_min);
    if (!(minutes >= 5 && minutes <= 600)) errors.push(`Длительность ${value?.duration ?? value?.duration_min} мин вне пределов 5–600.`);
    return {
      kind,
      time: /^\d{2}:\d{2}$/.test(value?.time || "") ? value.time : "18:00",
      duration: minutes,
      intensity: intensities.includes(value?.intensity) ? value.intensity : "medium",
      note: String(value?.note || "").slice(0, 200),
    };
  });
  return { items, errors: [...new Set(errors)] };
}

// ——— Plan content into ops ———

function archiveDay(state, area, dayId) {
  const day = state.objects[dayId];
  const ops = [];
  for (const item of live(state, day?.props[AREAS[area].list])) {
    if (item.type === "meal") for (const portion of live(state, item.props.items)) ops.push({ op: "archive", id: portion.id });
    ops.push({ op: "archive", id: item.id });
  }
  if (day) ops.push({ op: "archive", id: day.id });
  return ops;
}

// Creates the meals or sessions of a day. A meal keeps the slot of an old
// meal of the same name, a session that of an old session of the same kind.
function itemOps(state, area, items, old, newId) {
  const used = new Set();
  const ops = [];
  const ids = items.map((item) => {
    if (area === "ration") {
      const same = old.find((value) => !used.has(value.id) && normalizeProductName(value.name) === normalizeProductName(item.name));
      if (same) used.add(same.id);
      const id = newId("meal");
      const portions = item.items.map((row) => {
        const portionId = newId("portion");
        ops.push({ op: "create", type: "portion", id: portionId, name: row.name, props: { product: row.product, amount: row.amount, unit: row.unit, packSize: row.packSize } });
        return portionId;
      });
      ops.push({ op: "create", type: "meal", id, name: item.name, props: { time: item.time, items: portions, slot: same ? slotOf(same) : id } });
      return id;
    }
    const same = old.find((value) => !used.has(value.id) && value.props.kind === item.kind);
    if (same) used.add(same.id);
    const id = newId("session");
    ops.push({ op: "create", type: "session", id, name: optionName(state, "kind", item.kind), props: { kind: item.kind, time: item.time, duration: item.duration, intensity: item.intensity, ...(item.note ? { note: item.note } : {}), slot: same ? slotOf(same) : id } });
    return id;
  });
  return { ops, ids };
}

// The Особый день of one date with the whole content of the day. A previous
// Особый день of that date is archived; a cycle day stays and is overridden.
export function dayOps(state, area, date, items, newId) {
  const plan = planDay(state, area, date);
  const old = plan.items.map((id) => state.objects[id]);
  const { ops, ids } = itemOps(state, area, items, old, newId);
  const dayId = newId("day_plan");
  return [
    ...(plan.source === "special" ? archiveDay(state, area, plan.dayId) : []),
    ...ops,
    { op: "create", type: "day_plan", id: dayId, name: `Особый день ${date}`, props: { area, date, [AREAS[area].list]: ids } },
  ];
}

// A new week plan from a future date: seven cycle days following weekdays.
// Особые дни inside the first seven dates are archived because the cycle now
// holds them, as newWeekOps does.
export function weekOps(state, area, from, days, newId) {
  const ops = [];
  const dayIds = days.map((items, index) => {
    const built = itemOps(state, area, items, [], newId);
    const id = newId("day_plan");
    ops.push(...built.ops, { op: "create", type: "day_plan", id, name: cycleDayName(true, from, index), props: { area, cycleIndex: index, [AREAS[area].list]: built.ids } });
    return id;
  });
  ops.push({ op: "create", type: "week_plan", id: newId("week_plan"), name: `${AREAS[area].title} с ${from}`, props: { area, effectiveFrom: from, anchor: from, weekdayBinding: true, days: dayIds } });
  for (let index = 0; index < 7; index += 1) {
    const plan = planDay(state, area, shiftDate(from, index));
    if (plan.source === "special") ops.push(...archiveDay(state, area, plan.dayId));
  }
  return ops;
}
