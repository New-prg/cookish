// Kinds are defaults, not types: this one function turns a bare declaration
// into a complete one. A new track gets the states, the unmarked policy and the
// labels of its kind; a new item gets its schedule and its first day; a new
// field gets its goal type and period. A track the bundle gives no card gets
// the cards of its kind. The manual prints the same table by calling it.
import { AVOID, FIELD_TYPES, KINDS, STATE_LABELS, UNITS } from "./catalogue.js";
import { keyFromName } from "./normalize.js";
import { fieldOf, itemOf, live } from "./spec.js";

const ADDITIVE = new Set(["volume", "energy", "money"]);
const isNumeric = (f) => FIELD_TYPES[f.type]?.numeric;
const firstNumeric = (fields) => fields.find((f) => isNumeric(f) && f.type !== "scale") || fields.find(isNumeric);
const additive = (f) => f.goal != null || ADDITIVE.has(UNITS[f.unit]?.dimension);

// The cards a track of this kind gets when the bundle names none. `home` is the
// card for the main screen, `screen` the cards of the track's own screen.
export function defaultCards(track) {
  const k = track.key;
  const fields = track.fields || [];
  const num = firstNumeric(fields);
  const goalField = fields.find((f) => isNumeric(f) && f.goal != null);
  const recorded = fields.filter((f) => f.type !== "calc").slice(0, 3).map((f) => f.key);
  const out = { home: null, screen: [] };
  switch (track.kind) {
    case "log": {
      out.home = { key: `${k}_add`, title: track.name, body: [...(goalField ? [{ el: "meter", of: k, value: goalField.key }] : []), { el: "form", of: k }] };
      if (num) {
        out.screen.push(additive(num)
          ? { key: `${k}_days`, title: `${num.name} по дням`, caption: "Последние 7 дней", body: [{ el: "bars", of: k, value: num.key, fn: "sum", range: "@last7d" }] }
          : { key: `${k}_trend`, title: `${num.name} за месяц`, body: [{ el: "line", of: k, value: num.key, fn: "avg", range: "@last30d" }] });
      }
      out.screen.push({ key: `${k}_last`, title: "Последние записи", body: [{ el: "list", of: k, columns: ["date", ...recorded], limit: 5, range: "@last30d" }] });
      break;
    }
    case "habit":
      out.home = { key: `${k}_today`, title: `${track.name} сегодня`, body: [{ el: "marks", of: k }] };
      out.screen.push(
        { key: `${k}_streak`, title: "Серия", body: [{ el: "streak", of: k }] },
        { key: `${k}_calendar`, title: "Как идёт", caption: "Доля выполненного за день", body: [{ el: "heatmap", of: k, value: "rate", range: "@last12w" }] },
      );
      break;
    case "list": {
      const money = fields.find((f) => isNumeric(f) && UNITS[f.unit]?.dimension === "money");
      out.home = { key: `${k}_open`, title: `${track.name}: осталось`, body: [{ el: "stat", of: k, value: "open", range: "@today" }] };
      out.screen.push({ key: `${k}_items`, title: track.name, body: [{ el: "marks", of: k, add: true }] });
      if (money) out.screen.push({ key: `${k}_spent`, title: "Потрачено за месяц", size: "half", body: [{ el: "stat", of: k, value: money.key, fn: "sum", range: "@thisMonth" }] });
      break;
    }
    case "catalog":
      out.screen.push({ key: `${k}_rows`, title: track.name, body: [{ el: "list", of: k, columns: ["name", ...fields.slice(0, 4).map((f) => f.key)], limit: 50 }] });
      break;
    case "follow":
      out.home = { key: `${k}_today`, title: track.name, body: [{ el: "marks", of: k }] };
      if (num) out.screen.push({ key: `${k}_trend`, title: `${num.name} по дням`, body: [{ el: "line", of: k, value: num.key, fn: "avg", range: "@last30d" }] });
      out.screen.push({ key: `${k}_last`, title: "Последние отметки", body: [{ el: "table", of: k, columns: ["date", "slot", ...recorded], limit: 8, range: "@last30d" }] });
      break;
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

  const mentioned = new Set();
  for (const screen of out.screens || []) for (const card of screen.cards || []) for (const el of card.body || []) if (el.of) mentioned.add(el.of);
  const takenCards = new Set([...live(spec?.cards).map((c) => c.key), ...(out.screens || []).flatMap((s) => (s.cards || []).map((c) => c.key))]);
  for (const track of fresh) {
    if (mentioned.has(track.key)) continue;
    const { home, screen } = defaultCards(track);
    const place = (card) => {
      // A default key never collides with a card of the space or of the bundle.
      const key = takenCards.has(card.key) ? keyFromName(card.key, "card", takenCards) : card.key;
      takenCards.add(key);
      return { ...card, key };
    };
    out.screens ||= [];
    if (home) {
      let main = out.screens.find((s) => s.key === "home");
      if (!main) { main = { key: "home", cards: [] }; out.screens.push(main); }
      (main.cards ||= []).push(place(home));
    }
    if (screen.length) {
      let own = out.screens.find((s) => s.key === track.key);
      if (!own) { own = spec?.screens?.[track.key] && !spec.screens[track.key].archived ? { key: track.key, cards: [] } : { key: track.key, name: track.name, ...(track.icon ? { icon: track.icon } : {}), cards: [] }; out.screens.push(own); }
      (own.cards ||= []).push(...screen.map(place));
    }
  }
  if (out.screens && !out.screens.length) delete out.screens;
  return out;
}
