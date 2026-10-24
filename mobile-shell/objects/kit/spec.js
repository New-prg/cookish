// The Spec is the kit's read model: tracks with fields and items, screens and
// cards, derived from the store on demand and never saved. The store stays the
// only truth. `readSpec` also lists the classic sources (ration, sport,
// shopping) as read-only tracks so that `of="ration"` resolves like any other.
// `printSpec` renders a Spec back as bundle IR, for the model and for export.
import { SOURCES, SOURCE_KEYS } from "./catalogue.js";
import { objectsOfType } from "../core/values.js";

// Ids and keys of the store objects a spec part lives in. Deterministic, so a
// bundle applied twice names the same objects.
export const ids = Object.freeze({
  type: (track) => `tr_${track}`,
  relation: (track, field) => `tr_${track}__${field}`,
  item: (track, item) => `ti_${track}_${item}`,
  screen: (key) => `sc_${key}`,
  card: (key) => `cd_${key}`,
});

export const HOME = Object.freeze({ key: "home", name: "Главная", icon: "🏠", order: 0 });

export const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));

// Key order does not matter when two parts of a spec are compared.
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const same = (a, b) => stable(a) === stable(b);

export const live = (map) => Object.values(map || {}).filter((x) => !x.archived);
export const liveItems = (track) => (track?.items || []).filter((i) => !i.archived);
export const fieldOf = (track, key) => track?.fields?.find((f) => f.key === key) || null;
export const itemOf = (track, key) => track?.items?.find((i) => i.key === key) || null;
export const cardsOf = (spec, screenKey) => live(spec.cards).filter((c) => c.screen === screenKey).sort((a, b) => a.order - b.order);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function sourceTrack(key) {
  const source = SOURCES[key];
  return {
    key, name: source.name, icon: source.icon, kind: "source", readonly: true, app: null,
    fields: source.values.map((v) => ({ key: v.key, name: v.name, type: "number", unit: v.unit, virtual: true })),
    items: [],
  };
}

function fieldFromRelation(rel) {
  const k = rel.kit;
  return compact({
    key: k.field, name: rel.name, type: k.type, unit: rel.unit, min: rel.min, max: rel.max, step: k.step,
    options: rel.options?.length ? rel.options.map((o) => o.name) : undefined,
    optionIds: rel.options?.length ? rel.options.map((o) => o.id) : undefined,
    labels: k.labels, calc: k.calc, to: k.to, goal: k.goal, goalType: k.goalType, goalPer: k.goalPer,
    planned: k.planned, on: k.on, required: k.required, hint: k.hint,
  });
}

const cache = new WeakMap();

// How many entries a track holds and how many carry each field. Counted on
// first use: reading the spec for a screen should not walk every entry.
function usageOf(state, trackKey, fields, retired) {
  const entries = objectsOfType(state, ids.type(trackKey));
  const count = (key) => {
    const relKey = ids.relation(trackKey, key);
    return entries.reduce((n, e) => n + (e.props?.[relKey] != null ? 1 : 0), 0);
  };
  const used = {};
  for (const f of fields) { const n = count(f.key); if (n) used[f.key] = n; }
  return { entries: entries.length, fields: used, retired: Object.fromEntries(Object.entries(retired).map(([key, r]) => [key, { ...r, used: count(key) }])) };
}

export function readSpec(state) {
  const hit = cache.get(state);
  if (hit) return hit;
  const byType = { track_item: [], kit_screen: [], kit_card: [] };
  for (const obj of Object.values(state.objects)) byType[obj.type]?.push(obj);

  const tracks = {};
  for (const key of SOURCE_KEYS) tracks[key] = sourceTrack(key);

  const itemsByTrack = new Map();
  for (const obj of byType.track_item) {
    const p = obj.props || {};
    if (!itemsByTrack.has(p.kit_track)) itemsByTrack.set(p.kit_track, []);
    itemsByTrack.get(p.kit_track).push(compact({
      key: p.kit_key, name: obj.name, every: p.kit_every, at: p.kit_at, from: p.kit_from, until: p.kit_until, plan: p.kit_plan,
      archived: obj.archivedAt ? true : undefined,
    }));
  }

  for (const type of Object.values(state.types)) {
    const kit = type.kit;
    if (type.system || !kit?.track) continue;
    const fields = [];
    const present = new Set();
    for (const relKey of type.relations || []) {
      const rel = state.relations[relKey];
      if (rel?.kit?.track === kit.track && rel.kit.field) { fields.push(fieldFromRelation(rel)); present.add(relKey); }
    }
    // Fields taken off the track keep their relation and their values.
    const retired = {};
    for (const rel of Object.values(state.relations)) {
      if (rel.kit?.track === kit.track && rel.kit.field && !present.has(rel.key)) retired[rel.kit.field] = { type: rel.kit.type };
    }
    const track = compact({
      key: kit.track, name: type.name, icon: type.icon, kind: kit.kind, app: kit.app,
      avoid: kit.avoid, states: kit.states, labels: kit.labels, unmarked: kit.unmarked, grace: kit.grace, times: kit.times, per: kit.per, follows: kit.follows,
      archived: kit.archived ? true : undefined, since: kit.since,
      fields, items: itemsByTrack.get(kit.track) || [],
    });
    let usage = null;
    Object.defineProperty(track, "usage", { enumerable: false, get: () => (usage ||= deepFreeze(usageOf(state, kit.track, fields, retired))) });
    tracks[kit.track] = track;
  }

  const screens = {};
  const screenKeyOfId = {};
  for (const obj of byType.kit_screen) {
    const p = obj.props || {};
    screenKeyOfId[obj.id] = p.kit_key;
    screens[p.kit_key] = compact({ key: p.kit_key, name: obj.name, icon: p.kit_icon, order: p.kit_order ?? 0, app: p.kit_app, stored: true, archived: obj.archivedAt ? true : undefined });
  }
  if (!screens.home) screens.home = { ...HOME, stored: false };

  const cards = {};
  for (const obj of byType.kit_card) {
    const p = obj.props || {};
    cards[p.kit_key] = compact({
      key: p.kit_key, screen: screenKeyOfId[p.kit_screen], title: obj.name, caption: p.description, size: p.kit_size || "full",
      order: p.kit_order ?? 0, app: p.kit_app, body: p.kit_body || [], archived: obj.archivedAt ? true : undefined,
    });
  }

  const spec = deepFreeze({ tracks, screens, cards });
  cache.set(state, spec);
  return spec;
}

// -- printing ---------------------------------------------------------------------
const trimField = ({ optionIds, virtual, ...field }) => field;

const showsOf = (body) => (body || []).map((el) => [el.el, el.of ? `${el.of}${el.value ? `.${el.value}` : ""}` : el.what].filter(Boolean).join(" "));

// The space as bundle IR. `summary` is the compact form the model reads: keys,
// names, kinds, fields with types, units and goals, item keys and what each
// card shows. The full form is a bundle that recreates the structure: `app`
// keeps one app, `items: "structure"` keeps items only for catalog and habit.
export function printSpec(spec, { summary = false, app = null, items = "all" } = {}) {
  const mine = (x) => !x.archived && !x.readonly && (!app || x.app === app);
  const tracks = Object.values(spec.tracks).filter(mine);
  const cards = live(spec.cards).filter((c) => !app || c.app === app);

  if (summary) {
    return {
      v: 2,
      tracks: tracks.map((t) => compact({
        key: t.key, name: t.name, kind: t.kind, icon: t.icon, avoid: t.avoid, follows: t.follows,
        fields: t.fields.map((f) => compact({ key: f.key, name: f.name, type: f.type, unit: f.unit, goal: f.goal, goalType: f.goalType, goalPer: f.goalPer, options: f.options, to: f.to })),
        items: t.items.some((i) => !i.archived) ? t.items.filter((i) => !i.archived).map((i) => i.key) : undefined,
      })),
      sources: SOURCE_KEYS.map((key) => ({ key, name: SOURCES[key].name, values: SOURCES[key].values.map((v) => v.key) })),
      screens: live(spec.screens).sort((a, b) => a.order - b.order)
        .map((s) => ({ key: s.key, ...(s.key === "home" ? {} : { name: s.name }), cards: cards.filter((c) => c.screen === s.key).sort((a, b) => a.order - b.order).map((c) => ({ key: c.key, title: c.title, shows: showsOf(c.body) })) }))
        .filter((s) => s.cards.length || s.key !== "home"),
    };
  }

  const withItems = (t) => items === "all" || t.kind === "catalog" || t.kind === "habit";
  return {
    v: 2,
    tracks: tracks.map((t) => compact({
      key: t.key, name: t.name, icon: t.icon, kind: t.kind, avoid: t.avoid, states: t.states, labels: t.labels, unmarked: t.unmarked, grace: t.grace, times: t.times, per: t.per, follows: t.follows,
      fields: t.fields.map(trimField),
      items: withItems(t) && t.items.some((i) => !i.archived)
        ? t.items.filter((i) => !i.archived).map((i) => compact(items === "all" ? { key: i.key, name: i.name, every: i.every, at: i.at, from: i.from, until: i.until, plan: i.plan } : { key: i.key, name: i.name, every: i.every, at: i.at, plan: i.plan }))
        : undefined,
    })),
    screens: live(spec.screens).sort((a, b) => a.order - b.order)
      .map((s) => ({ s, list: cards.filter((c) => c.screen === s.key).sort((a, b) => a.order - b.order) }))
      .filter(({ s, list }) => list.length || (s.key !== "home" && (!app || s.app === app)))
      .map(({ s, list }) => compact({
        key: s.key, name: s.key === "home" ? undefined : s.name, icon: s.key === "home" ? undefined : s.icon,
        cards: list.map((c) => compact({ key: c.key, title: c.title, caption: c.caption, size: c.size, body: c.body })),
      })),
  };
}

export const printSpecJson = (spec, options) => JSON.stringify(printSpec(spec, options));
