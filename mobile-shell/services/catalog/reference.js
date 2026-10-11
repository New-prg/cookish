import { normalizeProductName } from "../../core/ration-domain.js";
import { REFERENCE_FOODS } from "./reference-foods.js";

// A search in the built-in reference of common products (#63, #64). A word of
// the query matches a word of a name up to its ending: «гречку» finds «Гречка
// ядрица», «огурцы» finds «Огурец», while «рис» does not find «Рисовое
// молоко» and «сыр» does not find «сырые». Other forms (boiled, baked, fried,
// pickled, smoked, dried, canned) take part only when the query names one.

// Candidates whose calories spread wider than this need the person (#64);
// a few ккал apart are the same for a meal.
export const AMBIGUOUS_SPREAD = 0.15;
export const AMBIGUOUS_FLOOR = 10;

const PREPARED = /отварн|варён|варен|запечён|запечен|жарен|на воде|пюре|яичниц|солён|солен|маринов|квашен|копчен|сушён|сушен|консерв/;
// Letters an ending may add or change; a short word gets one.
const ENDING = 2;
const SHORT = 3;

function words(text) {
  return normalizeProductName(text).split(/[^a-zа-яё0-9%,.]+/i).filter(Boolean);
}

function sameWord(asked, word) {
  if (asked.length <= SHORT) return word.startsWith(asked) && word.length - asked.length <= 1;
  let common = 0;
  while (common < asked.length && asked[common] === word[common]) common += 1;
  return common >= SHORT && asked.length - common <= ENDING && word.length - common <= ENDING;
}

// Every word of the query is a word of the name up to its ending.
export function matchesQuery(name, query) {
  const wanted = words(query).filter((word) => word.length >= 2);
  const own = words(name);
  return wanted.length > 0 && wanted.every((asked) => own.some((word) => sameWord(asked, word)));
}

export function isPrepared(text) {
  return PREPARED.test(normalizeProductName(text));
}

function percents(text) {
  return [...String(text).matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((match) => Number(match[1].replace(",", ".")));
}

// The query names no fat content, and the names of the candidates name
// different ones: «творог» between «Творог 2%» and «Творог 5%».
export function percentsDiffer(names, query) {
  if (percents(query).length) return false;
  return new Set(names.flatMap(percents)).size > 1;
}

// Calories of the candidates differ by more than 15% and 10 ккал.
export function caloriesSpread(values) {
  const known = values.map(Number).filter(Number.isFinite);
  if (known.length < 2) return false;
  const low = Math.min(...known);
  const high = Math.max(...known);
  return high - low > AMBIGUOUS_FLOOR && (low === 0 || (high - low) / low > AMBIGUOUS_SPREAD);
}

// Up to `limit` entries, closest names first: a name that starts with the
// query, then the fewest extra words. `ambiguous` when the entries that fit
// the query differ in calories by more than 15%, or in a fat content the
// query does not name.
export function findReference(query, { limit = 5, foods = REFERENCE_FOODS } = {}) {
  const asksPrepared = isPrepared(query);
  const asked = words(query);
  const found = foods
    .filter((food) => matchesQuery(food.name, query))
    .map((food) => {
      const own = words(food.name);
      return { food, set: !asksPrepared && isPrepared(food.name), head: sameWord(asked[0], own[0]), extra: own.length - asked.length };
    })
    .sort((a, b) => Number(a.set) - Number(b.set) || Number(b.head) - Number(a.head) || a.extra - b.extra || a.food.name.localeCompare(b.food.name, "ru"));
  const fitting = found.filter((entry) => !entry.set).map((entry) => entry.food);
  return {
    candidates: found.slice(0, limit).map((entry) => entry.food),
    ambiguous: caloriesSpread(fitting.map((food) => food.nutrition.calories)) || percentsDiffer(fitting.map((food) => food.name), query),
  };
}
