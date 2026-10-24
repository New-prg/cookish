// Safety that stays in code. `safetyFloors` is the one body: the bundle
// validator calls it on the facts of a bundle, the store rule calls it on the
// facts of what a batch changed, so nothing a model writes can lower a floor
// whichever door it comes through. The two entry rules (no future day, one
// mark per item and day) keep the recorded data well formed.
import { ENERGY_FLOOR, isDoseUnit } from "./catalogue.js";
import { formulaRefs, parseFormula } from "../core/formula.js";
import { objectsOfType } from "../core/values.js";
import { ids } from "./spec.js";

// -- numbers in text -------------------------------------------------------------
const NUMBER_RE = /\d+(?:[\s ]\d{3})*(?:[.,]\d+)?/g;
const canon = (text) => String(Number(text.replace(/[\s ]/g, "").replace(",", ".")));
export const numbersIn = (value) => [...String(value ?? "").matchAll(NUMBER_RE)].map((m) => canon(m[0]));
const clip = (text) => (text.length > 40 ? `${text.trim().slice(0, 40)}…` : text.trim());

// The same number in other units is the same number: 2 л is 2000 мл, 82 кг is 82000 г.
const scale = (n, by) => String(Number((Number(n) * by).toPrecision(12)));
export const allows = (allowed, n) => allowed.has(n) || allowed.has(scale(n, 1000)) || allowed.has(scale(n, 0.001));

const TEXT_ATTRS = new Set(["text", "title", "caption", "hint", "reply"]);

// Numbers a text of the bundle may print besides its own bindings: those the
// person typed in the request, those written in any attribute of the bundle
// (goals, limits, values, plans, ranges, names, keys). A number about the person
// that none of these supplied is the model's own, and stays refused; so does a
// count of what the person holds («собрали 4 вещи»).
export function sourceNumbers(bundle, request = "") {
  const out = new Set(numbersIn(request));
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      for (const [name, inner] of Object.entries(value)) if (name !== "v" && !TEXT_ATTRS.has(name)) walk(inner);
    } else numbersIn(value).forEach((n) => out.add(n));
  };
  walk(bundle);
  return out;
}

// Numbers a card may print: those written in its own bindings and those of the
// goal, the bounds and the name of what it binds to.
export function bindingNumbers(body, lookupTrack) {
  const allowed = new Set();
  const add = (value) => numbersIn(value).forEach((n) => allowed.add(n));
  for (const el of body || []) {
    for (const [name, value] of Object.entries(el)) {
      if (name === "el" || TEXT_ATTRS.has(name)) continue;
      if (value && typeof value === "object") add(JSON.stringify(value)); else add(value);
    }
    const track = el.of ? lookupTrack(el.of) : null;
    if (!track) continue;
    add(track.name);
    const bound = new Set([el.value, el.category, ...Object.keys(el.values || {}), ...(el.fields || []), ...(el.columns || [])].filter(Boolean));
    for (const field of track.fields || []) {
      if (!bound.has(field.key)) continue;
      add(field.name);
      for (const attr of ["goal", "min", "max", "step"]) if (field[attr] != null) add(field[attr]);
    }
  }
  return allowed;
}

// Numbers of a field's own declaration, for its hint.
export const fieldNumbers = (field) => {
  const allowed = new Set(numbersIn(field.name));
  for (const attr of ["goal", "min", "max", "step"]) if (field[attr] != null) numbersIn(field[attr]).forEach((n) => allowed.add(n));
  return allowed;
};

// -- calc over doses ------------------------------------------------------------
// lookup(fieldKey) → { unit, calc } of a field of the same track, or null.
export function calcReads(calc, lookup, seen = new Set()) {
  const units = [];
  let refs;
  try { refs = formulaRefs(parseFormula(calc)).vars; } catch { return units; }
  for (const name of refs) {
    const field = lookup(name);
    if (!field || seen.has(name)) continue;
    seen.add(name);
    if (field.unit) units.push(field.unit);
    if (field.calc) units.push(...calcReads(field.calc, lookup, seen));
  }
  return units;
}

const BURNED = /burn|sport|расход|трат|сожж|тренир/i;
const dailyOf = (goal, per) => (per === "week" ? goal / 7 : per === "month" ? goal / 30 : goal);

// facts: { goals: [{ ref, key, name, unit, goal, per }], calcs: [{ ref, name, unit, readsUnits }], texts: [{ ref, text, allowed: Set }] }
// returns [{ rule, ref, message }]
export function safetyFloors({ goals = [], calcs = [], texts = [] } = {}) {
  const out = [];
  for (const g of goals) {
    if (g.unit !== "ккал" || BURNED.test(`${g.key} ${g.name}`)) continue;
    if (dailyOf(Number(g.goal), g.per) < ENERGY_FLOOR) {
      out.push({ rule: "energy-goal-floor", ref: g.ref, message: `Цель ${g.goal} ккал${g.per && g.per !== "day" ? ` в ${g.per === "week" ? "неделю" : "месяц"}` : ""} у поля «${g.name}» ниже ${ENERGY_FLOOR} ккал в день: приложение не ставит такие цели, потому что это ниже безопасного минимума. Поставьте не меньше ${ENERGY_FLOOR} ккал в день или уберите goal.` });
    }
  }
  for (const c of calcs) {
    const doses = [...new Set([c.unit, ...(c.readsUnits || [])].filter((u) => isDoseUnit(u)))];
    if (doses.length) {
      out.push({ rule: "dose-calc", ref: c.ref, message: `Поле «${c.name}» считается по дозам лекарств (${doses.join(", ")}). Приложение дозы только записывает, вычислять их не может: подбирает дозу врач. Уберите calc, а дозу записывайте обычным полем number.` });
    }
  }
  for (const t of texts) {
    if (typeof t.text !== "string") continue;
    for (const m of t.text.matchAll(NUMBER_RE)) {
      if (!allows(t.allowed, canon(m[0]))) {
        out.push({ rule: "number-in-text", ref: t.ref, message: `В тексте «${clip(t.text)}» стоит число ${m[0].trim()}, которого нет в привязках, в пакете и в просьбе. Не пишите числа о человеке сами: уберите число из текста или возьмите его из goal, limit или периода.` });
        break;
      }
    }
  }
  return out;
}

// -- the store rules --------------------------------------------------------------
const registered = new WeakSet();

// The floors judge every batch, whoever writes it. The numbers in texts are judged
// in validateBundle only: the store does not know the request that supplied
// them, and the assistant applies its proposals as "ai" after the request is
// gone. Cards and fields come from a bundle either way (propose_objects refuses
// them), so no model-written text skips that check.
function factsOfBatch(prev, next) {
  const facts = { goals: [], calcs: [] };
  for (const [key, rel] of Object.entries(next.relations)) {
    if (!rel.kit?.field || prev.relations[key] === rel) continue;
    const ref = `${rel.kit.track}.${rel.kit.field}`;
    if (rel.kit.goal != null) facts.goals.push({ ref, key: rel.kit.field, name: rel.name, unit: rel.unit, goal: rel.kit.goal, per: rel.kit.goalPer });
    if (rel.kit.type === "calc") {
      const lookup = (name) => {
        const sibling = next.relations[ids.relation(rel.kit.track, name)];
        return sibling?.kit ? { unit: sibling.unit, calc: sibling.kit.calc } : null;
      };
      facts.calcs.push({ ref, name: rel.name, unit: rel.unit, readsUnits: calcReads(rel.kit.calc, lookup) });
    }
  }
  return facts;
}

export function registerKitRules(registerRule) {
  if (registered.has(registerRule)) return;
  registered.add(registerRule);

  registerRule(({ prev, next }) => safetyFloors(factsOfBatch(prev, next)).map((p) => ({ block: true, message: p.message })));

  registerRule(({ next, touched, actor, today }) => {
    if (actor === "import") return [];
    const problems = [];
    for (const id of touched) {
      const obj = next.objects[id];
      const track = obj && !obj.archivedAt ? next.types[obj.type]?.kit?.track : null;
      if (!track) continue;
      const label = `«${next.types[obj.type].name}»`;
      if (obj.props.date > today) problems.push({ block: true, message: `${label}: нельзя записать или отметить будущий день` });
      const target = obj.props.kit_item || obj.props.kit_slot;
      if (!target) continue;
      const twin = objectsOfType(next, obj.type).find((o) => o.id !== obj.id && o.props.date === obj.props.date && (o.props.kit_item || o.props.kit_slot) === target);
      if (twin) problems.push({ block: true, message: `${label}: на этот день и пункт уже есть отметка, вторая не нужна` });
    }
    return problems;
  });
}
