// Kinds are defaults, not types: this one function turns a bare declaration
// into a complete one. A new track gets the states, the unmarked policy and the
// labels of its kind; a new item gets its schedule and its first day; a new
// field gets its goal type and period. A track the bundle gives no card gets
// the cards of its kind. The manual prints the same table by calling it.
import { AVOID, FIELD_TYPES, KINDS, LIMITS, STATE_LABELS, UNITS, isAdditiveUnit } from "./catalogue.js";
import { keyFromName } from "./normalize.js";
import { fieldOf, itemOf, live } from "./spec.js";

const isNumeric = (f) => FIELD_TYPES[f.type]?.numeric;
const firstNumeric = (fields) => fields.find((f) => isNumeric(f) && f.type !== "scale") || fields.find(isNumeric);
// A day's worth adds up (portions, minutes, money) or the person set a goal on it.
const additive = (f) => f.goal != null || isAdditiveUnit(f.unit);
// One-tap «+1» fits a lone counter, not a measurement or a field with a unit like ml.
const COUNTER_UNITS = new Set(["шт.", "раз", "порц.", "подх."]);
const takesOne = (f) => (f.min == null || f.min <= 1) && (f.max == null || f.max >= 1);
const clip = (text) => text.slice(0, LIMITS.title);

// The cards a track of this kind gets when the bundle names none. `home` is the
// card for the main screen, `screen` the cards of the track's own screen.
export function defaultCards(track) {
  const k = track.key;
  const fields = track.fields || [];
  const goalField = fields.find((f) => isNumeric(f) && f.goal != null);
  const num = goalField || firstNumeric(fields);
  const recordable = fields.filter((f) => f.type !== "calc");
  const recorded = recordable.slice(0, 3).map((f) => f.key);
  const out = { home: null, screen: [] };
  switch (track.kind) {
    case "log": {
      const counter = recordable.length === 1 && recordable[0].type === "number" && COUNTER_UNITS.has(recordable[0].unit) && takesOne(recordable[0]) ? recordable[0] : null;
      out.home = { key: `${k}_add`, title: clip(track.name), body: [
        ...(goalField ? [{ el: "meter", of: k, value: goalField.key }] : []),
        ...(counter ? [{ el: "quick", of: k, values: { [counter.key]: 1 } }] : []),
        { el: "form", of: k },
      ] };
      if (num && additive(num)) {
        out.screen.push({ key: `${k}_days`, title: clip(`${num.name} по дням`), caption: "Последние 7 дней", body: [{ el: "bars", of: k, value: num.key, fn: "sum", range: "@last7d" }] });
      } else if (num) {
        out.screen.push(
          { key: `${k}_trend`, title: clip(`${num.name} за месяц`), body: [{ el: "line", of: k, value: num.key, fn: "avg", range: "@last30d" }] },
          { key: `${k}_latest`, title: "Последнее значение", size: "half", body: [{ el: "stat", of: k, value: num.key, fn: "last", range: "@all" }] },
          { key: `${k}_change`, title: "Изменение за месяц", size: "half", body: [{ el: "stat", of: k, value: num.key, fn: "delta", range: "@last30d" }] },
        );
      }
      out.screen.push({ key: `${k}_last`, title: "Последние записи", body: [{ el: "list", of: k, columns: ["date", ...recorded], limit: 5, range: "@last30d", edit: true }] });
      break;
    }
    case "habit": {
      const course = (track.items || []).some((i) => i.until);
      out.home = { key: `${k}_today`, title: clip(`${track.name} сегодня`), body: [
        { el: "marks", of: k },
        ...(course ? [{ el: "meter", of: k, value: "done", goal: "due", range: "@all" }] : []),
      ] };
      out.screen.push(
        { key: `${k}_streak`, title: "Серия", body: [{ el: "streak", of: k }] },
        { key: `${k}_days`, title: "Сделано по дням", caption: "Последние 14 дней", body: [{ el: "bars", of: k, value: "done", fn: "sum", range: "@last14d" }] },
      );
      break;
    }
    case "list": {
      const money = fields.find((f) => isNumeric(f) && UNITS[f.unit]?.dimension === "money");
      out.home = { key: `${k}_open`, title: clip(`${track.name}: осталось`), body: [{ el: "stat", of: k, value: "open", range: "@today" }] };
      out.screen.push({ key: `${k}_items`, title: clip(track.name), body: [{ el: "marks", of: k, add: true }] });
      if (money?.planned) out.screen.push({ key: `${k}_left`, title: "Осталось на сумму", size: "half", body: [{ el: "stat", of: k, value: money.key, fn: "sum", rows: "items", where: { state: "open" }, range: "@all" }] });
      if (money) out.screen.push({ key: `${k}_spent`, title: "Потрачено за месяц", size: "half", body: [{ el: "stat", of: k, value: money.key, fn: "sum", range: "@thisMonth" }] });
      break;
    }
    case "catalog":
      out.screen.push({ key: `${k}_rows`, title: clip(track.name), body: [{ el: "list", of: k, columns: ["name", ...fields.slice(0, 4).map((f) => f.key)], limit: 50, add: true, edit: true, search: true }] });
      break;
    case "follow": {
      const choice = fields.find((f) => f.type === "choice");
      out.home = { key: `${k}_today`, title: clip(track.name), body: [{ el: "marks", of: k }] };
      if (num) out.screen.push({ key: `${k}_trend`, title: clip(`${num.name} по дням`), body: [{ el: "line", of: k, value: num.key, fn: "avg", range: "@last30d" }] });
      if (choice) out.screen.push({ key: `${k}_kinds`, title: clip(`${choice.name}: сколько раз`), caption: "Последние 30 дней", body: [{ el: "bars", of: k, by: choice.key, fn: "count", range: "@last30d" }] });
      out.screen.push({ key: `${k}_last`, title: "Последние отметки", body: [{ el: "table", of: k, columns: ["date", "slot", ...recorded], limit: 8, range: "@last30d" }] });
      break;
    }
    default:
  }
  return out;
}

// The full declaration of a new track: its config, labels and defaults.
function expandTrack(decl, today) {
  const kind = KINDS[decl.kind];
  const track = { ...decl };
  if (!kind) return track;
  if (kind.marks) {
    track.states ??= [...kind.defaults.states];
    track.unmarked ??= decl.avoid ? AVOID.unmarked : kind.defaults.unmarked;
    if (kind.defaults.grace != null) track.grace ??= kind.defaults.grace;
    track.labels = Object.fromEntries(track.states.map((s) => [s, decl.labels?.[s] ?? (decl.avoid ? AVOID.labels[s] : undefined) ?? STATE_LABELS[s]]));
  }
  if (decl.fields) track.fields = decl.fields.map((f) => expandField(f));
  if (decl.items) track.items = decl.items.map((i) => expandItem(i, decl.kind, today));
  return track;
}

function expandField(field) {
  const out = { ...field };
  const info = FIELD_TYPES[out.type];
  if (info?.defaults) for (const [k, v] of Object.entries(info.defaults)) out[k] ??= v;
  if (out.goal != null && out.goal !== 0) {
    out.goalType ??= "min";
    out.goalPer ??= "day";
  }
  return out;
}

function expandItem(item, kind, today) {
  const out = { ...item };
  if (kind === "habit" || kind === "list") {
    out.every ??= kind === "list" ? "open" : "day";
    out.from ??= today;
  }
  return out;
}

// spec: the space before the bundle. Returns a new bundle; the input is not touched.
export function expandDefaults(spec, bundle, { today } = {}) {
  const out = JSON.parse(JSON.stringify(bundle));
  const day = today || new Date().toISOString().slice(0, 10);
  const fresh = [];
  out.tracks = (out.tracks || []).map((decl) => {
    const prev = spec?.tracks?.[decl.key];
    if (!prev || prev.archived) {
      const track = expandTrack(decl, day);
      fresh.push(track);
      return track;
    }
    const track = { ...decl };
    if (decl.fields) track.fields = decl.fields.map((f) => (fieldOf(prev, f.key) ? f : expandField(f)));
    if (decl.items) track.items = decl.items.map((i) => (itemOf(prev, i.key) ? i : expandItem(i, prev.kind, day)));
    return track;
  });
  if (!out.tracks.length) delete out.tracks;

  // A bundle that names a track only on home still gets the track's own screen with
  // its history; one that gives the track a screen of its own gets nothing added.
  const onHome = new Set();
  const elsewhere = new Set();
  for (const screen of out.screens || []) for (const card of screen.cards || []) for (const el of card.body || []) if (el.of) (screen.key === "home" ? onHome : elsewhere).add(el.of);
  const takenCards = new Set([...live(spec?.cards).map((c) => c.key), ...(out.screens || []).flatMap((s) => (s.cards || []).map((c) => c.key))]);
  const place = (card) => {
    // A default key never collides with a card of the space or of the bundle.
    const key = takenCards.has(card.key) ? keyFromName(card.key, "card", takenCards) : card.key;
    takenCards.add(key);
    return { ...card, key };
  };
  // Defaults are a courtesy: they never push a valid answer over the limits of screens and cards.
  const screenFor = (key, make) => {
    out.screens ||= [];
    let found = out.screens.find((s) => s.key === key);
    if (!found && out.screens.length < LIMITS.screens) { found = make(); out.screens.push(found); }
    return found;
  };
  for (const track of fresh) {
    if (elsewhere.has(track.key)) continue;
    const { home, screen } = defaultCards(track);
    if (home && !onHome.has(track.key)) {
      const main = screenFor("home", () => ({ key: "home", cards: [] }));
      if (main && (main.cards ||= []).length < LIMITS.cards) main.cards.push(place(home));
    }
    if (screen.length) {
      const reuse = spec?.screens?.[track.key] && !spec.screens[track.key].archived;
      const own = screenFor(track.key, () => (reuse ? { key: track.key, cards: [] } : { key: track.key, name: track.name, ...(track.icon ? { icon: track.icon } : {}), cards: [] }));
      if (own) (own.cards ||= []).push(...screen.slice(0, Math.max(0, LIMITS.cards - own.cards.length)).map(place));
    }
  }
  if (out.screens && !out.screens.length) delete out.screens;
  return out;
}
