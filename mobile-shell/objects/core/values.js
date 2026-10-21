// Reading relation values from a state snapshot. Formula relations are
// computed on demand and memoized per snapshot: a new snapshot after every
// command means the cache never goes stale.
import { Ref, evaluateFormula, isRef } from "./formula.js";

const caches = new WeakMap();

function cacheFor(state) {
  let cache = caches.get(state);
  if (!cache) {
    cache = { values: new Map(), errors: new Map(), backlinks: null, byType: null, profile: undefined, active: new Set() };
    caches.set(state, cache);
  }
  return cache;
}

export const SYSTEM_FIELDS = Object.freeze(["id", "type", "name", "createdAt", "updatedAt", "createdBy", "updatedBy"]);

export function objectOf(state, item) {
  if (item == null) return null;
  if (isRef(item)) return state.objects[item.id] || null;
  if (typeof item === "string") return state.objects[item] || null;
  if (typeof item === "object" && item.id) return state.objects[item.id] || item;
  return null;
}

export function objectsOfType(state, typeKey) {
  const cache = cacheFor(state);
  if (!cache.byType) {
    cache.byType = new Map();
    for (const obj of Object.values(state.objects)) {
      if (obj.archivedAt) continue;
      if (!cache.byType.has(obj.type)) cache.byType.set(obj.type, []);
      cache.byType.get(obj.type).push(obj);
    }
  }
  return cache.byType.get(typeKey) || [];
}

// The home is the dashboard named in meta, else the first dashboard: the store
// has no op to write meta.
export function homeOf(state) {
  const named = state.objects[state.meta?.home];
  if (named && !named.archivedAt && named.type === "dashboard") return named;
  return objectsOfType(state, "dashboard")[0] || null;
}

export function profileOf(state) {
  const cache = cacheFor(state);
  if (cache.profile === undefined) cache.profile = objectsOfType(state, "profile")[0] || null;
  return cache.profile;
}

export function backlinks(state, typeKey, relKey, targetId) {
  const cache = cacheFor(state);
  if (!cache.backlinks) cache.backlinks = new Map();
  const indexKey = `${typeKey}|${relKey}`;
  if (!cache.backlinks.has(indexKey)) {
    const index = new Map();
    for (const obj of objectsOfType(state, typeKey)) {
      const value = obj.props?.[relKey];
      for (const id of Array.isArray(value) ? value : value ? [value] : []) {
        if (!index.has(id)) index.set(id, []);
        index.get(id).push(obj.id);
      }
    }
    cache.backlinks.set(indexKey, index);
  }
  return cache.backlinks.get(indexKey).get(targetId) || [];
}

// The value a person sees: links stay ids, formulas are computed.
export function valueOf(state, item, relKey, ctx = {}) {
  const obj = objectOf(state, item);
  if (!obj) return null;
  if (SYSTEM_FIELDS.includes(relKey)) return obj[relKey] ?? (relKey === "name" ? "" : null);
  const rel = state.relations[relKey];
  if (rel?.format === "formula") return computed(state, obj, rel, ctx);
  const raw = obj.props?.[relKey];
  return raw === undefined ? null : raw;
}

export function formulaError(state, id, relKey, ctx = {}) {
  return cacheFor(state).errors.get(`${id}|${relKey}|${ctx.today || ""}`) || null;
}

function computed(state, obj, rel, ctx) {
  const cache = cacheFor(state);
  const key = `${obj.id}|${rel.key}|${ctx.today || ""}`;
  if (cache.values.has(key)) return cache.values.get(key);
  if (cache.active.has(key)) {
    cache.errors.set(key, "формула ссылается сама на себя");
    return null;
  }
  cache.active.add(key);
  let result = null;
  try {
    result = evaluateFormula(rel.formula, scopeFor(state, obj, ctx));
    if (typeof result === "number" && !Number.isFinite(result)) result = null;
  } catch (error) {
    cache.errors.set(key, error.message);
  } finally {
    cache.active.delete(key);
  }
  cache.values.set(key, result);
  return result;
}

// What a formula sees: relation values with links wrapped as Ref, so the
// formula can follow them with a dot.
export function scopeFor(state, obj, ctx = {}) {
  const profile = profileOf(state);
  const field = (item, relKey) => {
    const target = objectOf(state, item);
    if (!target) return null;
    const value = valueOf(state, target, relKey, ctx);
    const rel = state.relations[relKey];
    if (rel?.format === "object") return value ? new Ref(value) : null;
    if (rel?.format === "objects") return (Array.isArray(value) ? value : []).map((id) => new Ref(id));
    return value;
  };
  return {
    state,
    ctx,
    self: new Ref(obj.id),
    today: ctx.today || null,
    profile: profile ? new Ref(profile.id) : null,
    field,
    object: (id) => state.objects[id] || null,
    backlinks: (typeKey, relKey) => backlinks(state, typeKey, relKey, obj.id).map((id) => new Ref(id)),
  };
}

export function displayValue(state, item, relKey, ctx = {}) {
  const value = valueOf(state, item, relKey, ctx);
  const rel = state.relations[relKey];
  if (value == null || value === "") return "";
  if (!rel) return String(value);
  switch (rel.format) {
    case "select": return rel.options?.find((o) => o.id === value)?.name ?? String(value);
    case "multiselect": return (Array.isArray(value) ? value : []).map((v) => rel.options?.find((o) => o.id === v)?.name ?? v).join(", ");
    case "checkbox": return value ? "да" : "нет";
    case "object": return state.objects[value]?.name || "";
    case "objects": return (Array.isArray(value) ? value : []).map((id) => state.objects[id]?.name).filter(Boolean).join(", ");
    case "number":
    case "formula":
      if (typeof value === "number") return `${round2(value).toLocaleString("ru-RU")}${rel.unit ? ` ${rel.unit}` : ""}`;
      if (typeof value === "boolean") return value ? "да" : "нет";
      return String(value);
    default: return String(value);
  }
}

export const round2 = (value) => Math.round(Number(value) * 100) / 100;
