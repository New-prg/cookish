// The only place that knows how a Spec is stored. `lower(prev, next)` turns the
// difference between two specs into store ops in a fixed order: relations
// (plain fields, then calc fields), types, items, screens, cards, archives.
// Every id comes from keys, so a spec that did not change yields no ops.
import { FIELD_TYPES, KINDS, UNITS } from "./catalogue.js";
import { formulaRefs, parseFormula } from "../core/formula.js";
import { compact, ids, same } from "./spec.js";

// -- calc: local field keys → relation keys -----------------------------------------
function print(node, rename) {
  switch (node.k) {
    case "lit": return typeof node.v === "string" ? (node.v.includes('"') ? `'${node.v}'` : `"${node.v}"`) : String(node.v);
    case "var": return rename(node.name);
    case "call": return `${node.fn}(${node.args.map((a) => print(a, rename)).join(", ")})`;
    case "get": return `${print(node.obj, rename)}.${node.field}`;
    case "un": return `${node.op}(${print(node.arg, rename)})`;
    case "bin": return `(${print(node.left, rename)} ${node.op} ${print(node.right, rename)})`;
    default: throw new Error("неизвестный узел формулы");
  }
}

export function rewriteCalc(source, track) {
  const keys = new Set(track.fields.map((f) => f.key));
  return print(parseFormula(source), (name) => (keys.has(name) ? ids.relation(track.key, name) : name));
}

// -- store definitions of spec parts --------------------------------------------------
export function relationDef(track, field) {
  const info = FIELD_TYPES[field.type];
  const dimension = UNITS[field.unit]?.dimension || (field.type === "calc" ? "count" : undefined);
  return compact({
    key: ids.relation(track.key, field.key),
    name: field.name,
    format: info.format,
    unit: field.unit,
    dimension: field.unit || field.type === "calc" ? dimension : undefined,
    min: field.min,
    max: field.max,
    options: field.options ? field.options.map((name, i) => ({ id: field.optionIds[i], name })) : undefined,
    types: field.type === "link" ? [field.to === "product" ? "product" : "track_item"] : undefined,
    formula: field.type === "calc" ? rewriteCalc(field.calc, track) : undefined,
    kit: compact({
      track: track.key, field: field.key, type: field.type, step: field.step, labels: field.labels, calc: field.calc, to: field.to,
      goal: field.goal, goalType: field.goalType, goalPer: field.goalPer, planned: field.planned, on: field.on, required: field.required, hint: field.hint,
    }),
  });
}

// `since` is the day the track was made: the ledger never judges days before it.
export function typeDef(track, since) {
  const kind = KINDS[track.kind];
  const lead = kind.fact ? ["date"] : [];
  const tail = track.kind === "habit" || track.kind === "list" ? ["kit_item", "kit_state"] : track.kind === "follow" ? ["kit_slot", "kit_state"] : [];
  return compact({
    key: ids.type(track.key),
    name: track.name,
    plural: track.name,
    icon: track.icon,
    fact: kind.fact,
    layout: kind.fact ? "entry" : "basic",
    relations: [...lead, ...track.fields.map((f) => ids.relation(track.key, f.key)), ...tail],
    hidden: track.archived ? true : undefined,
    kit: compact({
      track: track.key, kind: track.kind, states: track.states, labels: track.labels, unmarked: track.unmarked, grace: track.grace,
      times: track.times, per: track.per, follows: track.follows, avoid: track.avoid, app: track.app, archived: track.archived ? true : undefined, since,
    }),
  });
}

const itemProps = (track, item) => compact({
  kit_track: track.key, kit_key: item.key, kit_every: item.every, kit_at: item.at, kit_from: item.from, kit_until: item.until, kit_plan: item.plan,
});
const screenProps = (screen) => compact({ kit_key: screen.key, kit_order: screen.order, kit_icon: screen.icon, kit_app: screen.app });
const cardProps = (card) => compact({
  kit_key: card.key, kit_screen: ids.screen(card.screen), kit_size: card.size, kit_order: card.order, kit_app: card.app, kit_body: card.body, description: card.caption,
});

// What `update` must write to turn `before` props into `after`: changed keys,
// and null for a key that disappeared.
function propsDiff(before, after) {
  const out = {};
  for (const [k, v] of Object.entries(after)) if (!same(before?.[k], v)) out[k] = v;
  for (const k of Object.keys(before || {})) if (!(k in after)) out[k] = null;
  return out;
}

function objectOps({ id, type, name, before, beforeName, after, wasArchived, isArchived, exists }) {
  const ops = [];
  if (!exists) {
    if (!isArchived) ops.push({ op: "create", type, id, name, props: after });
    return { ops, archive: [] };
  }
  if (wasArchived && !isArchived) ops.push({ op: "restore", id });
  const props = propsDiff(before, after);
  const renamed = beforeName !== name;
  if (Object.keys(props).length || renamed) ops.push({ op: "update", id, ...(renamed ? { name } : {}), props });
  return { ops, archive: !wasArchived && isArchived ? [{ op: "archive", id }] : [] };
}

export function lower(prev, next, ctx = {}) {
  const relationOps = [];
  const typeOps = [];
  const objectOpsList = [];
  const archives = [];
  const tracksOf = (spec) => Object.values(spec.tracks).filter((t) => !t.readonly);

  // relations: plain fields first, calc fields after the fields they read
  const pending = [];
  for (const track of tracksOf(next)) {
    const before = prev.tracks[track.key];
    for (const field of track.fields) {
      const def = relationDef(track, field);
      const was = before && !before.readonly && before.fields.find((f) => f.key === field.key);
      if (was && same(relationDef(before, was), def)) continue;
      if (field.type === "calc") pending.push({ def, track, field });
      else relationOps.push({ op: "defineRelation", relation: def });
    }
  }
  // a calc field waits for the changed calc fields it reads
  const waitsFor = (entry) => [...formulaRefs(parseFormula(entry.field.calc)).vars]
    .filter((name) => name !== entry.field.key && pending.some((p) => p.track === entry.track && p.field.key === name));
  while (pending.length) {
    const ready = pending.find((entry) => !waitsFor(entry).length) || pending[0];
    relationOps.push({ op: "defineRelation", relation: ready.def });
    pending.splice(pending.indexOf(ready), 1);
  }

  for (const track of tracksOf(next)) {
    const before = prev.tracks[track.key];
    const since = before ? before.since : ctx.today;
    const def = typeDef(track, since);
    if (before && !before.readonly && same(typeDef(before, since), def)) continue;
    typeOps.push({ op: "defineType", type: def });
  }

  for (const track of tracksOf(next)) {
    const before = prev.tracks[track.key];
    for (const item of track.items) {
      const was = before?.items.find((i) => i.key === item.key);
      const id = ids.item(track.key, item.key);
      const after = itemProps(track, item);
      const { ops, archive } = objectOps({
        id, type: "track_item", name: item.name,
        before: was ? itemProps(before, was) : null, beforeName: was?.name, after,
        wasArchived: Boolean(was?.archived), isArchived: Boolean(item.archived), exists: Boolean(was),
      });
      objectOpsList.push(...ops);
      archives.push(...archive);
    }
  }

  const screenOps = [];
  const needsHome = Object.values(next.cards).some((c) => !c.archived && c.screen === "home");
  for (const screen of Object.values(next.screens)) {
    const was = prev.screens[screen.key];
    const exists = Boolean(was?.stored);
    if (screen.key === "home" && !exists && !needsHome) continue;
    const { ops, archive } = objectOps({
      id: ids.screen(screen.key), type: "kit_screen", name: screen.name,
      before: exists ? screenProps(was) : null, beforeName: was?.name, after: screenProps(screen),
      wasArchived: Boolean(was?.archived), isArchived: Boolean(screen.archived), exists,
    });
    screenOps.push(...ops);
    archives.push(...archive);
  }

  const cardOps = [];
  for (const card of Object.values(next.cards)) {
    const was = prev.cards[card.key];
    const { ops, archive } = objectOps({
      id: ids.card(card.key), type: "kit_card", name: card.title,
      before: was ? cardProps(was) : null, beforeName: was?.title, after: cardProps(card),
      wasArchived: Boolean(was?.archived), isArchived: Boolean(card.archived), exists: Boolean(was),
    });
    cardOps.push(...ops);
    archives.push(...archive);
  }

  return [...relationOps, ...typeOps, ...objectOpsList, ...screenOps, ...cardOps, ...archives];
}
