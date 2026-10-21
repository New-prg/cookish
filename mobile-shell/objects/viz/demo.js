// Demo space for the gallery and the tests: the example of the app plus the
// trackers a person would keep (water, weighing, what was eaten), longer
// histories of purchases and workouts, and the sets the example dashboards read.
// Everything is written with store ops, like a person or the builder would.
import { openObjectStore } from "../core/store.js";
import { demoLegacyState, legacyToObjects } from "../core/migrate.js";
import { shiftDate } from "./util.js";

// A small deterministic generator, so tests and screenshots do not move.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const between = (rand, lo, hi) => lo + rand() * (hi - lo);

export function demoStore(today) {
  let n = 0;
  const store = openObjectStore({ storage: null, clock: () => new Date(`${today}T09:00:00.000Z`), today: () => today, idFactory: (prefix) => `${prefix}_v${++n}` });
  const loaded = store.replaceAll(legacyToObjects(demoLegacyState(today), { today }));
  if (!loaded.ok) throw new Error(loaded.reason);
  return store;
}

const must = (result, what) => {
  if (!result.ok) throw new Error(`${what}: ${result.reason}`);
  return result;
};

export function buildDemoState(today) {
  const store = demoStore(today);
  const rand = rng(Number(today.replace(/-/g, "")));
  const apply = (ops, what) => must(store.apply(ops, { actor: "human", summary: what }), what);

  apply([
    { op: "defineRelation", relation: { key: "drunk", name: "Выпито", format: "number", unit: "мл", dimension: "volume", min: 0 } },
    { op: "defineRelation", relation: { key: "eaten_kcal", name: "Съедено, ккал", format: "number", unit: "ккал", dimension: "energy", min: 0 } },
    { op: "defineRelation", relation: { key: "eaten_protein", name: "Съедено белка", format: "number", unit: "г", dimension: "mass", min: 0 } },
    { op: "defineRelation", relation: { key: "eaten_fat", name: "Съедено жиров", format: "number", unit: "г", dimension: "mass", min: 0 } },
    { op: "defineRelation", relation: { key: "eaten_carbs", name: "Съедено углеводов", format: "number", unit: "г", dimension: "mass", min: 0 } },
    { op: "defineType", type: { key: "water", name: "Вода", plural: "Вода", icon: "💧", layout: "entry", fact: true, relations: ["date", "drunk"] } },
    { op: "defineType", type: { key: "weighing", name: "Взвешивание", plural: "Взвешивания", icon: "⚖️", layout: "entry", fact: true, relations: ["date", "weightKg"] } },
    { op: "defineType", type: { key: "eaten_day", name: "Съедено за день", plural: "Съедено по дням", icon: "🍽", layout: "entry", fact: true, relations: ["date", "eaten_kcal", "eaten_protein", "eaten_fat", "eaten_carbs"] } },
  ], "Трекеры");

  const ops = [];
  // Water: two to five glasses a day for three weeks; today is half done.
  for (let back = 21; back >= 0; back -= 1) {
    const date = shiftDate(today, -back);
    const glasses = back === 0 ? 3 : 3 + Math.floor(rand() * 3);
    for (let g = 0; g < glasses; g += 1) ops.push({ op: "create", type: "water", name: "Вода", props: { date, drunk: pick(rand, [200, 250, 300, 350, 500]) } });
  }
  // Weight: every second day for five weeks, a slow way down.
  for (let back = 35; back >= 0; back -= 2) {
    const date = shiftDate(today, -back);
    const kg = Math.round((82.6 - (35 - back) * 0.055 + between(rand, -0.35, 0.35)) * 10) / 10;
    ops.push({ op: "create", type: "weighing", name: "Вес", props: { date, weightKg: kg } });
  }
  // What was eaten: two weeks of daily totals against the targets of the profile.
  for (let back = 13; back >= 0; back -= 1) {
    if (back === 0) continue;
    const date = shiftDate(today, -back);
    const kcal = Math.round(between(rand, 1950, 2700) / 10) * 10;
    ops.push({ op: "create", type: "eaten_day", name: "Съедено", props: {
      date, eaten_kcal: kcal, eaten_protein: Math.round(kcal * between(rand, 0.052, 0.068)), eaten_fat: Math.round(kcal * between(rand, 0.03, 0.04)), eaten_carbs: Math.round(kcal * between(rand, 0.1, 0.13)),
    } });
  }
  // Today so far.
  ops.push({ op: "create", type: "eaten_day", name: "Съедено", props: { date: today, eaten_kcal: 1340, eaten_protein: 82, eaten_fat: 41, eaten_carbs: 148 } });
  // Purchases of ten weeks, two or three a week, before this week.
  const shops = ["Овощи и фрукты", "Мясо и рыба", "Крупы и молочное", "Большая закупка", "Хлеб и мелочи"];
  for (let back = 75; back >= 8; back -= 3) {
    ops.push({ op: "create", type: "purchase", name: pick(rand, shops), props: { date: shiftDate(today, -back), price: Math.round(between(rand, 380, 2300) / 10) * 10, quantity: 1 } });
  }
  // Workouts: three or four a week for twelve weeks.
  const kinds = ["run", "strength", "swim", "walk", "yoga", "bike"];
  for (let back = 83; back >= 1; back -= 1) {
    if (rand() > 0.46) continue;
    const kind = pick(rand, kinds);
    ops.push({ op: "create", type: "activity", name: { run: "Бег", strength: "Силовая", swim: "Плавание", walk: "Прогулка", yoga: "Йога", bike: "Велосипед" }[kind], props: { date: shiftDate(today, -back), kind, duration: Math.round(between(rand, 20, 80) / 5) * 5, intensity: pick(rand, ["low", "medium", "high"]) } });
  }
  apply(ops, "История");

  const set = (id, name, query, view) => ({ op: "create", type: "set", id, name, props: { query, view } });
  apply([
    set("set_water", "Вода", { source: { type: "water" }, sorts: [{ rel: "date", dir: "desc" }] }, { layout: "table", relations: ["date", "drunk"] }),
    set("set_weight", "Вес", { source: { type: "weighing" }, sorts: [{ rel: "date", dir: "desc" }] }, { layout: "table", relations: ["date", "weightKg"] }),
    set("set_eaten", "Съедено по дням", { source: { type: "eaten_day" }, sorts: [{ rel: "date", dir: "desc" }] }, { layout: "table", relations: ["date", "eaten_kcal", "eaten_protein", "eaten_fat", "eaten_carbs"] }),
    set("set_spend", "Все покупки", { source: { type: "purchase" }, sorts: [{ rel: "date", dir: "desc" }] }, { layout: "table", relations: ["date", "price"] }),
    set("set_activity", "Активность", { source: { type: "activity" }, sorts: [{ rel: "date", dir: "desc" }] }, { layout: "table", relations: ["date", "kind", "duration"] }),
    set("set_open_requests", "Открытые запросы", { source: { type: "request" }, filters: [{ rel: "status", op: "eq", value: "open" }] }, { layout: "list", relations: ["date", "progress"] }),
  ], "Наборы");
  return store.state();
}
