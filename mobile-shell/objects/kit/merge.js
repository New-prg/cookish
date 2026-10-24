// Overlay by key: a bundle is merged into the Spec read from the store. A key
// that exists is changed with only the attributes written; a new key is a
// create; a removal archives and cascades. Nothing here touches the store, and
// the previous spec is never mutated.
import { BY, BY_WORDS } from "./catalogue.js";
import { appSlug } from "./normalize.js";
import { live } from "./spec.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

const TRACK_OVERLAY = ["name", "icon", "avoid", "states", "unmarked", "grace", "times", "per", "follows"];
const GOAL_KEYS = ["goal", "goalType", "goalPer"];

// The field keys an element reads. Lists are returned separately because a
// list loses a key and survives; any other reference makes the element void.
export function elementRefs(el) {
  const byField = el.by && !Object.hasOwn(BY, el.by) && !Object.hasOwn(BY_WORDS, el.by) ? [el.by] : [];
  const single = [el.value, el.category, el.sort, ...byField, ...Object.keys(el.values || {}), ...Object.keys(el.where || {})].filter(Boolean);
  const lists = ["columns", "fields"].filter((name) => Array.isArray(el[name]));
  return { single, lists };
}

function overlay(target, source, names) {
  for (const name of names) {
    if (!(name in source)) continue;
    if (source[name] === null) delete target[name];
    else target[name] = source[name];
  }
}

function assignOptionIds(field, previous) {
  const known = new Map((previous?.options || []).map((name, i) => [name, previous.optionIds?.[i]]));
  let counter = Math.max(0, ...(previous?.optionIds || []).map((id) => Number(String(id).slice(1)) || 0));
  field.optionIds = field.options.map((name) => known.get(name) ?? `o${++counter}`);
}

function mergeField(track, decl) {
  let field = track.fields.find((f) => f.key === decl.key);
  const previous = field ? clone(field) : null;
  if (!field) { field = { key: decl.key }; track.fields.push(field); }
  for (const [name, value] of Object.entries(decl)) if (name !== "key") field[name] = value;
  if (decl.goal === 0 || decl.goal === null) for (const name of GOAL_KEYS) delete field[name];
  if (Array.isArray(field.options) && (!previous || JSON.stringify(previous.options) !== JSON.stringify(field.options))) assignOptionIds(field, previous);
  return field;
}

function mergeItem(track, decl) {
  let item = track.items.find((i) => i.key === decl.key);
  if (!item) { item = { key: decl.key }; track.items.push(item); }
  else delete item.archived;
  for (const [name, value] of Object.entries(decl)) {
    if (name === "key") continue;
    if (name === "plan") item.plan = { ...item.plan, ...value };
    else if (value === null) delete item[name];
    else item[name] = value;
  }
}

function mergeTrack(next, decl, app) {
  let track = next.tracks[decl.key];
  if (track?.readonly) return;
  if (!track) { track = { key: decl.key, app, fields: [], items: [] }; next.tracks[decl.key] = track; }
  else delete track.archived;
  if (decl.kind && !track.kind) track.kind = decl.kind;
  overlay(track, decl, TRACK_OVERLAY);
  if (decl.labels) track.labels = { ...track.labels, ...decl.labels };
  for (const field of decl.fields || []) mergeField(track, field);
  for (const item of decl.items || []) mergeItem(track, item);
}

const nextOrder = (items) => 1 + Math.max(0, ...items.map((x) => x.order ?? 0));

function cardApp(next, body, fallback) {
  for (const el of body || []) {
    const owner = next.tracks[el.of]?.app;
    if (owner) return owner;
  }
  return fallback;
}

// The listed cards come first in the listed order, the rest keep their order after them.
function reorderCards(next, screenKey, order) {
  const here = live(next.cards).filter((c) => c.screen === screenKey).sort((a, b) => a.order - b.order);
  const listed = [...new Set(order)].map((key) => here.find((c) => c.key === key)).filter(Boolean);
  const sequence = [...listed, ...here.filter((c) => !listed.includes(c))];
  if (sequence.every((card, i) => card === here[i])) return;
  sequence.forEach((card, i) => { card.order = i + 1; });
}

function mergeScreen(next, decl, app) {
  let screen = next.screens[decl.key];
  if (!screen) { screen = { key: decl.key, order: nextOrder(Object.values(next.screens)), ...(decl.key === "home" ? {} : { app }) }; next.screens[decl.key] = screen; }
  else delete screen.archived;
  overlay(screen, decl, ["name", "icon"]);
  for (const cdecl of decl.cards || []) {
    let card = next.cards[cdecl.key];
    if (!card) {
      card = { key: cdecl.key, screen: decl.key, size: "full", order: nextOrder(live(next.cards).filter((c) => c.screen === decl.key)), app: cardApp(next, cdecl.body, app) };
      next.cards[cdecl.key] = card;
    } else if (card.archived) {
      delete card.archived;
      card.screen = decl.key;
      card.order = nextOrder(live(next.cards).filter((c) => c.screen === decl.key));
    }
    overlay(card, cdecl, ["title", "caption", "size"]);
    if (cdecl.body) card.body = clone(cdecl.body);
  }
  if (Array.isArray(decl.order)) reorderCards(next, decl.key, decl.order);
}

// -- removals ----------------------------------------------------------------------
function dropElements(next, cascades, test, reason) {
  for (const card of live(next.cards)) {
    const kept = [];
    let changed = false;
    for (const el of card.body) {
      const verdict = test(el);
      if (verdict === "drop") { changed = true; continue; }
      if (verdict && typeof verdict === "object") { changed = true; kept.push(verdict); continue; }
      kept.push(el);
    }
    if (!changed) continue;
    if (!kept.length) {
      card.archived = true;
      cascades.push({ kind: "card", key: card.key, title: card.title, reason });
    } else {
      card.body = kept;
      cascades.push({ kind: "card-part", key: card.key, title: card.title, reason });
    }
  }
}

function removeField(next, cascades, trackKey, fieldKey) {
  const track = next.tracks[trackKey];
  if (!track) return;
  track.fields = track.fields.filter((f) => f.key !== fieldKey);
  dropElements(next, cascades, (el) => {
    if (el.of !== trackKey) return null;
    const { single, lists } = elementRefs(el);
    if (single.includes(fieldKey)) return "drop";
    if (!lists.some((name) => el[name].includes(fieldKey))) return null;
    const copy = { ...el };
    for (const name of lists) copy[name] = el[name].filter((k) => k !== fieldKey);
    return lists.every((name) => !copy[name].length) ? "drop" : copy;
  }, `поле «${fieldKey}» трека «${track.name || trackKey}» убрано`);
}

function removeTrack(next, cascades, trackKey) {
  const track = next.tracks[trackKey];
  if (!track) return;
  track.archived = true;
  dropElements(next, cascades, (el) => (el.of === trackKey ? "drop" : null), `трек «${track.name || trackKey}» убран`);
}

function removeScreen(next, cascades, screenKey) {
  const screen = next.screens[screenKey];
  if (!screen) return;
  screen.archived = true;
  for (const card of live(next.cards).filter((c) => c.screen === screenKey)) {
    card.archived = true;
    cascades.push({ kind: "card", key: card.key, title: card.title, reason: `экран «${screen.name || screenKey}» убран` });
  }
}

export function mergeBundle(spec, bundle, ctx = {}) {
  const next = clone(spec);
  const cascades = [];
  const app = ctx.app || appSlug(bundle.name || "app");
  for (const track of bundle.tracks || []) mergeTrack(next, track, app);
  for (const screen of bundle.screens || []) mergeScreen(next, screen, app);
  // Fixed order: what a removal reaches through is gone before the thing itself.
  const removals = bundle.remove || [];
  for (const r of removals) if (r.card && next.cards[r.card]) next.cards[r.card].archived = true;
  for (const r of removals) {
    if (r.field) { const [t, f] = r.field.split("."); removeField(next, cascades, t, f); }
    if (r.item) {
      const [t, i] = r.item.split(".");
      const item = next.tracks[t]?.items.find((x) => x.key === i);
      if (item) item.archived = true;
    }
  }
  for (const r of removals) if (r.screen) removeScreen(next, cascades, r.screen);
  for (const r of removals) if (r.track) removeTrack(next, cascades, r.track);
  return { spec: next, cascades };
}
