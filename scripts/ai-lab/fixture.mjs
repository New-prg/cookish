// Shared fixture + thin adapter over the real ration domain module.
import {
  executeRationCommand, migrateRationState, readRationDay, readRationDayNutrition,
  validateRationProfile, normalizeProductName, formatRationDate, parseRationDate,
} from "../../mobile-shell/ration-domain.js";

export const TODAY = "2026-10-01"; // четверг
export const CTX = { now: "2026-10-01T09:00:00.000Z", today: TODAY, actor: "ai" };

const P = (id, name, kcal, p, f, c, fiber = 0, tags = []) => ({
  id: `product_${id}`, name, unit: "г", tags,
  nutrition: { calories: kcal, protein: p, fat: f, carbs: c, fiber },
  updatedAt: "2026-09-01T00:00:00.000Z", updatedBy: "local",
});
export const PRODUCTS = [
  P("oats", "Овсяные хлопья", 366, 12, 6, 60, 10),
  P("milk", "Молоко 2,5%", 52, 2.8, 2.5, 4.7),
  P("banana", "Банан", 96, 1.5, 0.5, 21, 2.6),
  P("eggs", "Яйца куриные", 157, 12.7, 11.5, 0.7),
  P("cottage", "Творог 5%", 121, 17.2, 5, 1.8),
  P("chicken", "Куриная грудка", 113, 23.6, 1.9, 0.4, 0, ["meat"]),
  P("beef", "Говядина", 187, 18.9, 12.4, 0, 0, ["meat"]),
  P("pork", "Свинина", 259, 16, 21.6, 0, 0, ["meat"]),
  P("salmon", "Лосось", 153, 20, 8.1, 0, 0, ["fish"]),
  P("buckwheat", "Гречка", 313, 12.6, 3.3, 62, 11),
  P("rice", "Рис", 344, 6.7, 0.7, 78.9, 0.4),
  P("pasta", "Макароны", 344, 10.4, 1.1, 69.7, 3.7),
  P("lentils", "Чечевица", 295, 24, 1.5, 46.3, 11.5),
  P("tofu", "Тофу", 76, 8, 4.8, 1.9, 0.3),
  P("chickpea", "Нут", 309, 20.1, 4.3, 46.2, 9.9),
  P("salad", "Овощной салат", 30, 1.2, 0.2, 5.5, 2),
  P("oil", "Оливковое масло", 898, 0, 99.8, 0),
  P("bread", "Хлеб цельнозерновой", 247, 13, 3.4, 41, 7),
  P("apple", "Яблоко", 47, 0.4, 0.4, 9.8, 2.4),
  P("nuts", "Грецкий орех", 654, 15.2, 65.2, 7, 6.7),
  P("yogurt", "Йогурт греческий", 66, 5, 2, 4),
  P("cheese", "Сыр", 356, 24, 29.5, 0.3),
];

const it = (pid, grams) => {
  const product = PRODUCTS.find((p) => p.id === `product_${pid}`);
  return { id: `item_${pid}_${Math.random().toString(36).slice(2, 6)}`, productId: product.id, name: product.name, portionSize: grams, packageSize: 1000, measureUnit: "г" };
};
const meal = (id, name, time, items) => ({ id, name, time, items });
const day = (d, lunch, dinner) => ({
  id: `cycle_day_${d}`,
  meals: [
    meal(`m_breakfast_${d}`, "Завтрак", "08:00", [it("oats", 80), it("milk", 250), it("banana", 120)]),
    meal(`m_lunch_${d}`, "Обед", "13:00", lunch),
    meal(`m_snack_${d}`, "Перекус", "16:30", [it("cottage", 200), it("apple", 150), it("nuts", 20)]),
    meal(`m_dinner_${d}`, "Ужин", "19:30", dinner),
  ],
});
// Mon..Sun, weekday-bound 7-day cycle anchored on Monday 2026-09-28.
const WEEK = [
  day("mon", [it("chicken", 200), it("buckwheat", 100), it("salad", 200), it("oil", 10)], [it("salmon", 180), it("rice", 80), it("salad", 150)]),
  day("tue", [it("beef", 180), it("pasta", 100), it("salad", 200), it("oil", 10)], [it("eggs", 150), it("bread", 80), it("cheese", 30)]),
  day("wed", [it("chicken", 200), it("rice", 100), it("salad", 200), it("oil", 10)], [it("lentils", 90), it("salad", 200), it("oil", 10)]),
  day("thu", [it("pork", 150), it("buckwheat", 100), it("salad", 200)], [it("chicken", 200), it("pasta", 80), it("salad", 150)]),
  day("fri", [it("beef", 180), it("rice", 100), it("salad", 200), it("oil", 10)], [it("chicken", 180), it("buckwheat", 80), it("salad", 150)]),
  day("sat", [it("salmon", 180), it("buckwheat", 100), it("salad", 200)], [it("pork", 150), it("bread", 80), it("salad", 150)]),
  day("sun", [it("chicken", 200), it("pasta", 100), it("salad", 200), it("oil", 10)], [it("cottage", 200), it("yogurt", 150), it("bread", 60)]),
];

export function makeState() {
  const base = migrateRationState({ schemaVersion: 12, products: structuredClone(PRODUCTS), requests: [], ration: undefined });
  let r = executeRationCommand(base, { type: "createCycle", anchor: "2026-09-28", effectiveFrom: "2026-09-28", weekdayBinding: true, days: structuredClone(WEEK) }, { ...CTX, actor: "local" });
  r = executeRationCommand(r.state, { type: "setRationProfile", fields: {
    ageGroup: "adult", heightCm: 180, weightKg: 80, goal: "keep", mealsPerDay: 4, schedule: "работа 9–18",
    targetCalories: 2400, targetProtein: 140, targetFat: 80, targetCarbs: 280, preferences: "", excludedProducts: [],
  } }, { ...CTX, actor: "local" });
  return r.state;
}

export const addDays = (key, n) => { const d = parseRationDate(key); d.setDate(d.getDate() + n); return formatRationDate(d); };
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
export const weekday = (key) => WD[parseRationDate(key).getDay()];

const productOf = (state, id) => state.products.find((p) => p.id === id);

// Compact projection the models read: names + grams + totals.
export function viewDay(state, date) {
  const d = readRationDay(state, date);
  const n = readRationDayNutrition(state, date);
  if (!d) return { date, weekday: weekday(date), meals: [] };
  return {
    date, weekday: weekday(date), source: d.source,
    meals: d.meals.map((m) => ({ id: m.id, name: m.name, time: m.time, items: (m.items || []).map((i) => ({ product: productOf(state, i.productId)?.name || i.name, grams: i.portionSize })) })),
    totals: n.totals,
  };
}

export function viewProfile(state) {
  const { updatedAt, updatedBy, ...p } = state.ration.profile;
  return p;
}

export function catalog(state) {
  return state.products.filter((p) => !p.deletedAt).map((p) => ({ name: p.name, per100g: p.nutrition, tags: p.tags || [] }));
}

// Model-facing meals [{name,time,items:[{product,grams}]}] -> domain meals.
export function toDomainMeals(state, meals) {
  const errors = [];
  const out = (meals || []).map((m, mi) => ({
    id: m.id || `meal_ai_${mi}_${Math.random().toString(36).slice(2, 6)}`,
    name: String(m.name || `Приём пищи ${mi + 1}`),
    time: /^\d{2}:\d{2}$/.test(m.time || "") ? m.time : "12:00",
    items: (m.items || []).map((i, ii) => {
      const key = normalizeProductName(i.product);
      const product = state.products.find((p) => normalizeProductName(p.name) === key);
      if (!product) errors.push(`Продукт «${i.product}» не найден в каталоге`);
      return { id: `item_ai_${mi}_${ii}_${Math.random().toString(36).slice(2, 6)}`, productId: product?.id || "", name: product?.name || String(i.product), portionSize: Number(i.grams) || 100, packageSize: 1000, measureUnit: "г" };
    }),
  }));
  return { meals: out, errors };
}

// Deterministic gate (#36 shape): code, not the model, decides if a plan may be written.
export function gateDay(state, date) {
  const profile = state.ration.profile;
  const n = readRationDayNutrition(state, date).totals;
  const problems = [];
  const target = Number(profile.targetCalories) || 0;
  if (n.calories < 1200) problems.push(`калорийность ${Math.round(n.calories)} ккал ниже безопасного минимума 1200`);
  if (target && Math.abs(n.calories - target) / target > 0.15) problems.push(`калорийность ${Math.round(n.calories)} отличается от цели ${target} больше чем на 15%`);
  if (Number(profile.targetProtein) && n.protein < profile.targetProtein * 0.75) problems.push(`белок ${Math.round(n.protein)} г меньше 75% цели ${profile.targetProtein}`);
  const excluded = (profile.excludedProducts || []).map(normalizeProductName);
  for (const m of readRationDay(state, date)?.meals || []) for (const i of m.items || []) {
    if (excluded.includes(normalizeProductName(productOf(state, i.productId)?.name))) problems.push(`исключённый продукт ${i.name}`);
  }
  return { ok: problems.length === 0, totals: n, problems };
}

export function run(state, command) {
  if (command.date && command.date < TODAY) return { ok: false, error: "ИИ не меняет прошедшие дни." };
  return executeRationCommand(state, command, CTX);
}

export { readRationDay, readRationDayNutrition, validateRationProfile };
