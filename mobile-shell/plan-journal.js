// Change journal of the plan. Every plan change, by the human or the
// assistant, becomes a Набор изменений: who, when, on which page, a short
// summary and snapshots of the affected plan parts before and after. A set
// can be reverted while those parts still hold its «after» snapshot; the
// revert is a set of its own. История питания and Учёт тренировок are facts
// and never enter the journal.
//
// A plan part is addressed by a key:
//   ration:special:<owner|date>, ration:version:<id>, ration:profile,
//   sport:special:<owner|date>, sport:version:<id>,
//   catalog:product:<id> (only when a caller names the product explicitly).

export const JOURNAL_LIMIT = 200;
// The journal shares the device storage with the rest of the data, so its
// serialized size is bounded as well as the number of sets.
export const JOURNAL_MAX_CHARS = 1_000_000;

const PLAN_AREAS = ["ration", "sport"];
const PAGES = new Set(["ration", "sport", "ration+sport"]);
const META_FIELDS = ["updatedAt", "updatedBy"];

export function emptyJournal() {
  return [];
}

export function normalizeJournal(source) {
  const sets = (Array.isArray(source) ? source : []).filter((set) =>
    set && typeof set === "object" && set.id
      && set.before && typeof set.before === "object"
      && set.after && typeof set.after === "object"
  ).map((set) => ({
    id: String(set.id),
    createdAt: String(set.createdAt || ""),
    actor: set.actor === "ai" ? "ai" : "human",
    page: PAGES.has(set.page) ? set.page : "ration",
    summary: String(set.summary || "Изменение плана"),
    before: structuredClone(set.before),
    after: structuredClone(set.after),
    ...(set.revertOf ? { revertOf: String(set.revertOf) } : {}),
  }));
  return trimJournal(sets);
}

// Parts of the plan that differ between two states, or null when the plan is
// the same. Values are deep copies; a missing part is null.
export function diffPlan(beforeState, afterState, { productIds = [] } = {}) {
  const before = planParts(beforeState, productIds);
  const after = planParts(afterState, productIds);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diff = { before: {}, after: {} };
  keys.forEach((key) => {
    const was = before[key] ?? null;
    const now = after[key] ?? null;
    if (sameContent(was, now)) return;
    diff.before[key] = was == null ? null : structuredClone(was);
    diff.after[key] = now == null ? null : structuredClone(now);
  });
  return Object.keys(diff.after).length ? diff : null;
}

// Appends a set to `state.journal` (mutates the draft) and returns it.
export function appendChangeSet(state, { now, actor, page, summary, diff, revertOf = "", id = createChangeSetId() }) {
  const set = {
    id,
    createdAt: now || new Date().toISOString(),
    actor: actor === "ai" ? "ai" : "human",
    page: PAGES.has(page) ? page : pageOfParts(Object.keys(diff.after)),
    summary: String(summary || "Изменение плана"),
    before: diff.before,
    after: diff.after,
  };
  if (revertOf) set.revertOf = revertOf;
  state.journal = trimJournal([...(Array.isArray(state.journal) ? state.journal : []), set]);
  return set;
}

// Restores the «before» snapshot of a set on the draft when the affected parts
// still match its «after» snapshot, and journals the revert as a new set.
export function revertChangeSet(state, changeSetId, { now, actor } = {}) {
  const set = (state.journal || []).find((entry) => entry.id === changeSetId);
  if (!set) return { ok: false, reason: "Набор изменений не найден." };
  // A product the set created stays on revert: plans and requests may already
  // use it, so its later edits do not block the revert either.
  const kept = (key) => key.startsWith("catalog:product:") && set.before[key] == null;
  const conflicts = Object.keys(set.after).filter((key) => !kept(key) && !sameContent(readPart(state, key), set.after[key]));
  if (conflicts.length) {
    const dates = conflictLabels(set, conflicts);
    return {
      ok: false,
      conflict: true,
      dates,
      reason: `Поверх этого изменения были другие (${dates.join(", ")}), откатить его нельзя.`,
    };
  }
  const stamp = now || new Date().toISOString();
  const keys = Object.keys(set.before).filter((key) => !kept(key));
  const diff = { before: {}, after: {} };
  keys.forEach((key) => {
    const current = readPart(state, key);
    const restored = set.before[key] == null ? null : touch(structuredClone(set.before[key]), stamp, actor);
    writePart(state, key, restored);
    diff.before[key] = current == null ? null : structuredClone(current);
    diff.after[key] = restored == null ? null : structuredClone(restored);
  });
  const revert = appendChangeSet(state, {
    now: stamp,
    actor: actor === "ai" ? "ai" : "human",
    page: set.page,
    summary: `Откат: ${set.summary}`,
    diff,
    revertOf: set.id,
  });
  return { ok: true, changeSetId: revert.id, revertedId: set.id, dates: partDates(set) };
}

// Short view of the journal for the assistant and future UI: newest first.
export function readChangeSets(state, { limit = 20 } = {}) {
  return (state.journal || []).slice(-limit).reverse().map((set) => ({
    id: set.id,
    createdAt: set.createdAt,
    actor: set.actor,
    page: set.page,
    summary: set.summary,
    dates: partDates(set),
    ...(set.revertOf ? { revertOf: set.revertOf } : {}),
  }));
}

export function partDates(set) {
  const keys = Object.keys(set.after || {});
  return [...new Set(keys.map((key) => partLabel(key, set.before[key] || set.after[key])).filter(Boolean))];
}

export function readPart(state, key) {
  const [area, kind, ...rest] = String(key).split(":");
  const id = rest.join(":");
  if (area === "catalog" && kind === "product") {
    return (state.products || []).find((product) => product.id === id) || null;
  }
  const plan = state?.[area];
  if (!plan || !PLAN_AREAS.includes(area)) return null;
  if (kind === "special") return plan.specialDays?.[id] || null;
  if (kind === "version") return (plan.versions || []).find((version) => version.id === id) || null;
  if (kind === "profile" && area === "ration") return plan.profile || null;
  return null;
}

export function writePart(state, key, value) {
  const [area, kind, ...rest] = String(key).split(":");
  const id = rest.join(":");
  if (area === "catalog" && kind === "product") {
    state.products = state.products || [];
    const index = state.products.findIndex((product) => product.id === id);
    if (value == null) {
      if (index >= 0) state.products.splice(index, 1);
    } else if (index >= 0) state.products[index] = value;
    else state.products.push(value);
    return;
  }
  if (!PLAN_AREAS.includes(area)) return;
  const plan = state[area];
  if (!plan) return;
  if (kind === "special") {
    plan.specialDays = plan.specialDays || {};
    if (value == null) delete plan.specialDays[id];
    else plan.specialDays[id] = value;
  } else if (kind === "version") {
    plan.versions = plan.versions || [];
    const index = plan.versions.findIndex((version) => version.id === id);
    if (value == null) {
      if (index >= 0) plan.versions.splice(index, 1);
    } else if (index >= 0) plan.versions[index] = value;
    else plan.versions.push(value);
  } else if (kind === "profile" && area === "ration" && value != null) {
    plan.profile = value;
  }
}

// Content equality of two part values. Edit stamps are not content: two
// edits can produce the same plan at different times.
export function sameContent(a, b) {
  return JSON.stringify(withoutMeta(a)) === JSON.stringify(withoutMeta(b));
}

function planParts(state, productIds) {
  const parts = {};
  PLAN_AREAS.forEach((area) => {
    const plan = state?.[area];
    if (!plan || typeof plan !== "object") return;
    Object.entries(plan.specialDays || {}).forEach(([key, day]) => { parts[`${area}:special:${key}`] = day; });
    (plan.versions || []).forEach((version) => { parts[`${area}:version:${version.id}`] = version; });
  });
  if (state?.ration?.profile) parts["ration:profile"] = state.ration.profile;
  (productIds || []).forEach((id) => {
    const product = (state?.products || []).find((value) => value.id === id);
    if (product) parts[`catalog:product:${id}`] = product;
  });
  return parts;
}

function withoutMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value ?? null;
  const copy = { ...value };
  META_FIELDS.forEach((field) => delete copy[field]);
  return copy;
}

function touch(value, now, actor) {
  if (value && typeof value === "object" && "updatedAt" in value) {
    value.updatedAt = now;
    value.updatedBy = actor === "ai" ? "ai" : (actor || value.updatedBy || "local");
  }
  return value;
}

function pageOfParts(keys) {
  const areas = new Set(keys.map((key) => key.split(":")[0]).filter((area) => PLAN_AREAS.includes(area)));
  if (areas.has("ration") && areas.has("sport")) return "ration+sport";
  return areas.has("sport") ? "sport" : "ration";
}

function partLabel(key, value) {
  const [area, kind, ...rest] = String(key).split(":");
  const id = rest.join(":");
  if (kind === "special") return id.split("|").pop();
  if (kind === "version") return value?.effectiveFrom ? `с ${value.effectiveFrom}` : "";
  if (kind === "profile") return "профиль";
  if (area === "catalog") return value?.name ? `продукт «${value.name}»` : "продукт";
  return "";
}

function conflictLabels(set, keys) {
  return [...new Set(keys.map((key) => partLabel(key, set.after[key] || set.before[key])).filter(Boolean))];
}

function trimJournal(sets) {
  const result = sets.slice(-JOURNAL_LIMIT);
  let size = result.reduce((sum, set) => sum + JSON.stringify(set).length, 0);
  while (result.length > 1 && size > JOURNAL_MAX_CHARS) size -= JSON.stringify(result.shift()).length;
  return result;
}

function createChangeSetId() {
  return `change_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
