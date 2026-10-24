// The object store: the only writer of the object space. Every change is a
// list of ops applied atomically; the store validates each touched object
// against its type and relations, runs the domain rules, journals plan-like
// changes for undo and persists the whole space.
import { builtinSchema, FORMATS, DIMENSIONS } from "./schema.js";
import { parseFormula, formulaRefs, hasFunction } from "./formula.js";
import "./functions.js";

export const STORAGE_KEY = "cookish.objects.v1";
export const SCHEMA_VERSION = 1;
export const JOURNAL_LIMIT = 200;
export const ACTORS = Object.freeze(["human", "ai", "import", "connector"]);
const LAYOUTS = ["basic", "entry", "todo", "note", "set", "dashboard"];

const RULES = [];
// A rule sees the state before and after a batch and the ids it touched. It
// returns problems; a problem with `block: true` rejects the whole batch.
export function registerRule(rule) { RULES.push(rule); }

export function localDateKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function emptyObjectState() {
  const { relations, types } = builtinSchema();
  return { schemaVersion: SCHEMA_VERSION, relations, types, objects: {}, journal: [], meta: { home: null, importedAt: null } };
}

function assemble(saved) {
  const base = emptyObjectState();
  if (!saved || typeof saved !== "object") return base;
  const relations = { ...base.relations };
  for (const r of Object.values(saved.customRelations || {})) if (!relations[r.key]?.system) relations[r.key] = r;
  const types = { ...base.types };
  for (const t of Object.values(saved.customTypes || {})) if (!types[t.key]?.system) types[t.key] = t;
  return { ...base, relations, types, objects: saved.objects || {}, journal: saved.journal || [], meta: { ...base.meta, ...(saved.meta || {}) } };
}

function serialize(state) {
  const custom = (map) => Object.fromEntries(Object.entries(map).filter(([, v]) => !v.system));
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, customRelations: custom(state.relations), customTypes: custom(state.types), objects: state.objects, journal: state.journal, meta: state.meta });
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  return value;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const KEY = /^[a-z][a-z0-9_]{1,40}$/;

export function checkValue(state, rel, value) {
  if (value == null) return null;
  switch (rel.format) {
    case "text": return typeof value === "string" && value.length <= 2000 ? null : "нужен текст до 2000 символов";
    case "url": return typeof value === "string" && /^https?:\/\//.test(value) && value.length <= 500 ? null : "нужна ссылка http(s)";
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "нужно число";
      if (rel.min != null && value < rel.min) return `не меньше ${rel.min}`;
      if (rel.max != null && value > rel.max) return `не больше ${rel.max}`;
      return null;
    }
    case "date": return typeof value === "string" && DATE.test(value) ? null : "нужна дата ГГГГ-ММ-ДД";
    case "time": return typeof value === "string" && TIME.test(value) ? null : "нужно время ЧЧ:ММ";
    case "datetime": return typeof value === "string" && Number.isFinite(Date.parse(value)) ? null : "нужны дата и время";
    case "checkbox": return typeof value === "boolean" ? null : "нужно да или нет";
    case "select":
      if (typeof value !== "string" || value.length > 60) return "нужен вариант из списка";
      return rel.open || rel.options?.some((o) => o.id === value) ? null : `нет варианта «${value}»`;
    case "multiselect":
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return "нужен список вариантов";
      return rel.open || value.every((v) => rel.options?.some((o) => o.id === v)) ? null : "есть вариант не из списка";
    case "object": return checkLink(state, rel, value);
    case "objects":
      if (!Array.isArray(value) || value.length > 500) return "нужен список объектов";
      for (const id of value) { const problem = checkLink(state, rel, id); if (problem) return problem; }
      return null;
    case "json": return JSON.stringify(value).length <= 20000 ? null : "слишком большое значение";
    case "formula": return "формулу нельзя записать, она считается сама";
  }
  return `неизвестный формат ${rel.format}`;
}

function checkLink(state, rel, id) {
  const target = typeof id === "string" ? state.objects[id] : null;
  if (!target) return "ссылка на несуществующий объект";
  if (rel.types?.length && !rel.types.includes(target.type)) return `нужен объект типа ${rel.types.map((t) => state.types[t]?.name || t).join(" или ")}`;
  return null;
}

export function validateObject(state, obj, actor) {
  const problems = [];
  const type = state.types[obj.type];
  if (!type) return [`нет типа «${obj.type}»`];
  if (typeof obj.name !== "string" || obj.name.length > 200) problems.push("название должно быть текстом до 200 символов");
  for (const [key, value] of Object.entries(obj.props || {})) {
    const rel = state.relations[key];
    if (!rel) { problems.push(`нет связи «${key}»`); continue; }
    const problem = checkValue(state, rel, value);
    if (problem) problems.push(`«${rel.name}»: ${problem}`);
    if (rel.guarded && actor === "ai") problems.push(`«${rel.name}» меняет только человек`);
  }
  if (type.singleton && !obj.archivedAt) {
    const other = Object.values(state.objects).find((o) => o.type === obj.type && o.id !== obj.id && !o.archivedAt);
    if (other) problems.push(`«${type.name}» может быть только один`);
  }
  return problems;
}

export function validateType(state, def) {
  const problems = [];
  if (!KEY.test(def.key || "")) problems.push("ключ типа: латиница, цифры и _");
  if (state.types[def.key]?.system) problems.push("системный тип менять нельзя");
  if (!def.name || String(def.name).length > 60) problems.push("нужно название до 60 символов");
  if (def.icon && String(def.icon).length > 8) problems.push("иконка слишком длинная");
  if (def.layout && !LAYOUTS.includes(def.layout)) problems.push(`нет макета ${def.layout}`);
  for (const key of def.relations || []) if (!state.relations[key]) problems.push(`нет связи «${key}»`);
  return problems;
}

export function validateRelation(state, def) {
  const problems = [];
  if (!KEY.test(def.key || "")) problems.push("ключ связи: латиница, цифры и _");
  if (state.relations[def.key]?.system) problems.push("системную связь менять нельзя");
  if (!def.name || String(def.name).length > 60) problems.push("нужно название до 60 символов");
  if (!FORMATS.includes(def.format) || def.format === "json") problems.push(`нет формата ${def.format}`);
  if (def.dimension && !DIMENSIONS.includes(def.dimension)) problems.push(`нет размерности ${def.dimension}`);
  if (def.options && (!Array.isArray(def.options) || def.options.length > 50)) problems.push("вариантов не больше 50");
  for (const t of def.types || []) if (!state.types[t]) problems.push(`нет типа «${t}»`);
  if (def.format === "formula") {
    try {
      const refs = formulaRefs(parseFormula(def.formula));
      for (const fn of refs.calls) if (!hasFunction(fn)) problems.push(`нет функции ${fn}`);
      for (const v of refs.vars) if (!["this", "today", "profile"].includes(v) && !state.relations[v] && v !== def.key) problems.push(`формула читает неизвестную связь «${v}»`);
    } catch (error) {
      problems.push(`формула: ${error.message}`);
    }
  }
  return problems;
}

// A definition may replace an earlier custom one only when both belong to the
// same kit track: a model that reuses a key must not rewrite someone else's type.
function takenKey(existing, def, what) {
  if (!existing || existing.system) return null;
  const track = def.kit?.track;
  if (track && existing.kit?.track === track) return null;
  return `ключ «${def.key}» уже занят ${what} «${existing.name}», возьмите другой ключ`;
}

const slug = (name) => {
  const map = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e", ю: "yu", я: "ya" };
  const s = String(name || "").toLowerCase().split("").map((c) => map[c] ?? (/[a-z0-9]/.test(c) ? c : "_")).join("").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return /^[a-z]/.test(s) ? s.slice(0, 30) : `x_${s}`.slice(0, 30);
};

export function openObjectStore({ storage = null, key = STORAGE_KEY, clock = () => new Date(), today = () => localDateKey(), idFactory = null } = {}) {
  let raw = null;
  try { raw = storage?.getItem(key) ?? null; } catch { raw = null; }
  let state = freeze(assemble(raw ? JSON.parse(raw) : null));
  const listeners = new Set();
  let counter = 0;
  const newId = (prefix) => (idFactory ? idFactory(prefix) : `${prefix}_${clock().getTime().toString(36)}_${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`);

  function persist(next) {
    if (!storage) return null;
    try { storage.setItem(key, serialize(next)); return null; } catch (error) { return error; }
  }

  function apply(ops, { actor = "human", summary = "", silent = false } = {}) {
    if (!ACTORS.includes(actor)) return { ok: false, reason: `неизвестный автор ${actor}` };
    const list = Array.isArray(ops) ? ops : [ops];
    const now = clock().toISOString();
    const draft = { ...state, relations: { ...state.relations }, types: { ...state.types }, objects: { ...state.objects }, journal: state.journal.slice(), meta: { ...state.meta } };
    const before = new Map();
    const schemaBefore = { types: {}, relations: {} };
    const touch = (id) => { if (!before.has(id)) before.set(id, state.objects[id] || null); };
    const created = [];
    const problems = [];
    for (const op of list) {
      const fail = (message) => { problems.push(message); };
      switch (op?.op) {
        case "create": {
          const type = draft.types[op.type];
          if (!type) { fail(`нет типа «${op.type}»`); break; }
          const id = op.id || newId(op.type);
          if (draft.objects[id]) { fail(`объект ${id} уже есть`); break; }
          touch(id);
          draft.objects[id] = { id, type: op.type, name: String(op.name ?? ""), props: cleanProps(op.props), ...(op.blocks ? { blocks: op.blocks } : {}), createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor };
          created.push(id);
          break;
        }
        case "update": {
          const current = draft.objects[op.id];
          if (!current) { fail(`нет объекта ${op.id}`); break; }
          touch(op.id);
          const props = { ...current.props };
          for (const [k, v] of Object.entries(op.props || {})) { if (v === null || v === undefined) delete props[k]; else props[k] = v; }
          draft.objects[op.id] = { ...current, ...(op.name !== undefined ? { name: String(op.name) } : {}), ...(op.blocks !== undefined ? { blocks: op.blocks } : {}), props, updatedAt: now, updatedBy: actor };
          break;
        }
        case "archive":
        case "restore": {
          const current = draft.objects[op.id];
          if (!current) { fail(`нет объекта ${op.id}`); break; }
          touch(op.id);
          const next = { ...current, updatedAt: now, updatedBy: actor };
          if (op.op === "archive") next.archivedAt = now; else delete next.archivedAt;
          draft.objects[op.id] = next;
          break;
        }
        case "defineRelation": {
          const def = { format: "text", ...op.relation, system: false };
          def.key = def.key || `r_${slug(def.name)}`;
          const p = validateRelation(draft, def);
          const taken = takenKey(draft.relations[def.key], def, "связью");
          if (taken) p.push(taken);
          if (p.length) { problems.push(...p.map((m) => `связь «${def.name}»: ${m}`)); break; }
          if (!(def.key in schemaBefore.relations)) schemaBefore.relations[def.key] = state.relations[def.key] || null;
          draft.relations[def.key] = freeze(def);
          created.push(def.key);
          break;
        }
        case "defineType": {
          const def = { layout: "basic", relations: [], fact: false, ...op.type, system: false };
          def.key = def.key || `t_${slug(def.name)}`;
          def.plural = def.plural || def.name;
          const p = validateType(draft, def);
          const taken = takenKey(draft.types[def.key], def, "типом");
          if (taken) p.push(taken);
          if (p.length) { problems.push(...p.map((m) => `тип «${def.name}»: ${m}`)); break; }
          if (!(def.key in schemaBefore.types)) schemaBefore.types[def.key] = state.types[def.key] || null;
          draft.types[def.key] = freeze(def);
          created.push(def.key);
          break;
        }
        case "revert": {
          const set = state.journal.find((s) => s.id === op.changeSetId);
          if (!set) { fail("нет такого изменения в журнале"); break; }
          const changedSince = Object.entries(set.after).some(([id, after]) => JSON.stringify(stripMeta(state.objects[id])) !== JSON.stringify(stripMeta(after)));
          if (changedSince) { fail("после этого изменения объект поменяли ещё раз, откатить нельзя"); break; }
          for (const [id, prev] of Object.entries(set.before)) {
            touch(id);
            if (prev) draft.objects[id] = { ...prev, updatedAt: now, updatedBy: actor };
            else delete draft.objects[id];
          }
          // A type made by this change may have gained entries since; removing it
          // would leave them with no type.
          const orphaned = Object.entries(set.schema?.types || {}).find(([key, prev]) => !prev && state.types[key] && Object.values(draft.objects).some((obj) => obj.type === key));
          if (orphaned) { fail(`в треке «${state.types[orphaned[0]].name}» уже есть записи, откатить нельзя; уберите трек через remove, записи сохранятся`); break; }
          // An object made by this change may have gained marks or purchases
          // since; removing it would leave them pointing at nothing.
          const removed = new Set(Object.entries(set.before).filter(([, prev]) => !prev).map(([id]) => id));
          const holder = removed.size ? Object.values(draft.objects).find((obj) => linkedIds(draft, obj).some((id) => removed.has(id))) : null;
          if (holder) {
            const target = state.objects[linkedIds(draft, holder).find((id) => removed.has(id))];
            fail(`на «${target?.name || target?.id}» ссылается «${holder.name || holder.id}», откатить нельзя`);
            break;
          }
          for (const [k, prev] of Object.entries(set.schema?.relations || {})) { schemaBefore.relations[k] = state.relations[k] || null; if (prev) draft.relations[k] = prev; else delete draft.relations[k]; }
          for (const [k, prev] of Object.entries(set.schema?.types || {})) { schemaBefore.types[k] = state.types[k] || null; if (prev) draft.types[k] = prev; else delete draft.types[k]; }
          break;
        }
        default:
          fail(`неизвестная операция ${op?.op}`);
      }
    }
    if (problems.length) return { ok: false, reason: problems.join("; "), problems };

    const touched = [...before.keys()];
    for (const id of touched) {
      const obj = draft.objects[id];
      const was = before.get(id);
      const type = draft.types[(obj || was).type];
      if (type?.fact && actor === "ai") problems.push(`«${type.name}» записывает только человек`);
      if (obj && !obj.archivedAt) problems.push(...validateObject(draft, obj, actor).map((m) => `${obj.name || type?.name || id}: ${m}`));
    }
    const warnings = [];
    for (const rule of RULES) {
      for (const p of rule({ prev: state, next: draft, touched, actor, today: today(), now }) || []) {
        if (p.block) problems.push(p.message); else warnings.push(p.message);
      }
    }
    if (problems.length) return { ok: false, reason: problems.join("; "), problems };

    // A batch of facts alone is not journaled. A batch that also changes the
    // plan keeps its facts in the change set, so a revert undoes the whole
    // batch: a request reopened together with its purchases gone.
    const facts = touched.filter((id) => draft.types[(draft.objects[id] || before.get(id)).type]?.fact);
    const schemaChanged = Object.keys(schemaBefore.types).length || Object.keys(schemaBefore.relations).length;
    let changeSetId = null;
    if ((touched.length > facts.length || schemaChanged) && actor !== "import") {
      changeSetId = newId("change");
      const set = {
        id: changeSetId, at: now, actor, summary: String(summary || describe(list, draft)).slice(0, 200),
        before: Object.fromEntries(touched.map((id) => [id, before.get(id)])),
        after: Object.fromEntries(touched.map((id) => [id, draft.objects[id] || null])),
        ...(facts.length ? { facts } : {}),
        ...(schemaChanged ? { schema: schemaBefore } : {}),
        ...(list.some((o) => o.op === "revert") ? { revertOf: list.find((o) => o.op === "revert").changeSetId } : {}),
      };
      draft.journal = [...draft.journal, set].slice(-JOURNAL_LIMIT);
    }
    for (const id of touched) if (draft.objects[id]) freeze(draft.objects[id]);
    const next = freeze(draft);
    const error = persist(next);
    if (error) return { ok: false, reason: "не удалось сохранить: мало места на устройстве", storageFailed: true };
    state = next;
    if (!silent) for (const fn of listeners) fn(state);
    return { ok: true, changeSetId, ids: created, warnings };
  }

  return {
    state: () => state,
    today,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    apply,
    create: (type, fields = {}, opts) => apply({ op: "create", type, ...fields }, opts),
    update: (id, patch = {}, opts) => apply({ op: "update", id, ...patch }, opts),
    archive: (id, opts) => apply({ op: "archive", id }, opts),
    revert: (changeSetId, opts) => apply({ op: "revert", changeSetId }, opts),
    newId,
    // Replaces the whole space, for the one-way import of the current app's data.
    replaceAll(nextState) {
      const next = freeze(assemble(JSON.parse(serialize(nextState))));
      const error = persist(next);
      if (error) return { ok: false, reason: "не удалось сохранить: мало места на устройстве" };
      state = next;
      for (const fn of listeners) fn(state);
      return { ok: true };
    },
  };
}

function cleanProps(props) {
  return Object.fromEntries(Object.entries(props || {}).filter(([, v]) => v !== null && v !== undefined));
}

function linkedIds(state, obj) {
  return Object.entries(obj.props || {}).flatMap(([key, value]) => {
    const format = state.relations[key]?.format;
    if (format !== "object" && format !== "objects") return [];
    return Array.isArray(value) ? value : [value];
  });
}

function stripMeta(obj) {
  if (!obj) return null;
  const { updatedAt, updatedBy, ...rest } = obj;
  return rest;
}

function describe(ops, state) {
  const op = ops[0];
  const typeName = (t) => state.types[t]?.name?.toLowerCase() || "объект";
  if (op.op === "create") return `Создан ${typeName(op.type)} «${op.name || ""}»`;
  if (op.op === "update") return `Изменён ${typeName(state.objects[op.id]?.type)} «${state.objects[op.id]?.name || ""}»`;
  if (op.op === "archive") return `Удалён ${typeName(state.objects[op.id]?.type)} «${state.objects[op.id]?.name || ""}»`;
  if (op.op === "defineType") return `Тип «${op.type?.name}»`;
  if (op.op === "defineRelation") return `Связь «${op.relation?.name}»`;
  if (op.op === "revert") return "Откат изменения";
  return "Изменение";
}
