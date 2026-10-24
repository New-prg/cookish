// The one store of the page and the helpers every screen shares: writes with
// undo, navigation, and small reads over the schema.
import { openObjectStore } from "../core/store.js";
import "../core/domain.js";
import { homeOf } from "../core/values.js";
import { resolveDate } from "../core/query.js";
import { applyUndoable, localNow } from "./dom.js";

export const store = openObjectStore({ storage: window.localStorage });
export const ctx = () => ({ today: store.today() });

// Every write of the page (applyUndoable in dom.js, on the one store).
export const act = (ops, options) => applyUndoable(store, ops, options);

export const go = (path) => { location.hash = path; };
export const rerender = () => window.dispatchEvent(new Event("objects:render"));

// Screen state that is not data: a layout tried before saving, edit modes.
const memo = new Map();
export function local(key, init) {
  if (!memo.has(key)) memo.set(key, init());
  return memo.get(key);
}

export function hrefFor(obj) {
  if (!obj) return "#/";
  if (obj.type === "set") return `#/set/${encodeURIComponent(obj.id)}`;
  if (obj.type === "dashboard") return "#/";
  if (obj.type === "request") return `#/request/${encodeURIComponent(obj.id)}`;
  return `#/object/${encodeURIComponent(obj.id)}`;
}

export const typeOf = (state, obj) => state.types[obj?.type] || { key: obj?.type, name: obj?.type, icon: "▫", relations: [] };
export const iconOf = (state, obj) => typeOf(state, obj).icon || "▫";
export const nameOf = (obj) => obj?.name?.trim() || "Без названия";

// Relations a person edits: not hidden, not the JSON plumbing of sets.
export const isVisibleRelation = (rel) => rel && !rel.hidden && rel.format !== "json";

export const isNumeric = (state, relKey) => {
  const rel = state.relations[relKey];
  return rel?.format === "number" || (rel?.format === "formula" && Boolean(rel.unit || rel.dimension));
};
export const dateRelationOf = (state, typeKey) => (state.types[typeKey]?.relations || []).find((k) => ["date", "datetime"].includes(state.relations[k]?.format)) || null;

const DEFAULT_WIDGETS = [
  { id: "w_ration", kind: "ration-today", title: "Сегодня в Рационе" },
  { id: "w_sport", kind: "sport-today", title: "Спорт сегодня" },
  { id: "w_requests", kind: "requests", title: "Покупки" },
];

export function ensureHome() {
  if (homeOf(store.state())) return;
  store.apply({ op: "create", type: "dashboard", name: "Главная", props: { widgets: DEFAULT_WIDGETS } }, { actor: "human", summary: "Главная панель" });
}

// Every object that links here through any object or objects relation.
const backlinkIndex = new WeakMap();
export function allBacklinks(state, id) {
  let index = backlinkIndex.get(state);
  if (!index) {
    index = new Map();
    for (const obj of Object.values(state.objects)) {
      if (obj.archivedAt) continue;
      for (const [key, value] of Object.entries(obj.props || {})) {
        const format = state.relations[key]?.format;
        if (format !== "object" && format !== "objects") continue;
        for (const target of Array.isArray(value) ? value : [value]) {
          if (!index.has(target)) index.set(target, []);
          index.get(target).push({ obj, rel: state.relations[key] });
        }
      }
    }
    backlinkIndex.set(state, index);
  }
  return index.get(id) || [];
}

const TRANSLIT = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e", ю: "yu", я: "ya" };

// A free key for a new type or relation, known before the batch runs so one
// batch can define relations and the type that lists them.
export function freeKey(taken, prefix, name) {
  const slug = String(name || "").toLowerCase().split("").map((c) => TRANSLIT[c] ?? (/[a-z0-9]/.test(c) ? c : "_")).join("").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 28);
  const base = `${prefix}_${slug || "x"}`;
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
}

// Values a new object of a type starts with: the moment for a record, today
// for a dated object, and whatever the set filters fix to one value.
export function newObjectProps(state, typeKey, filters = []) {
  const type = state.types[typeKey];
  const props = {};
  const today = store.today();
  for (const key of type?.relations || []) {
    const rel = state.relations[key];
    if (rel?.format === "datetime" && type.fact) props[key] = localNow();
    if (rel?.format === "date" && (type.fact || key === "date")) props[key] = today;
  }
  for (const filter of filters) {
    const rel = state.relations[filter.rel];
    if (filter.op !== "eq" || !rel || rel.format === "formula" || !(type?.relations || []).includes(filter.rel)) continue;
    const value = resolveDate(filter.value, today);
    if (value != null && !String(value).startsWith("@")) props[filter.rel] = value;
  }
  return props;
}
