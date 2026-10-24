// A kit screen on the page. The cards of a `kit_screen` object (storage mapping in
// synthesis §2) are drawn in order: each card becomes the closed markup of
// cardMarkup, which must pass validateMarkup before it reaches the DOM; the
// elements take their data from kit/bind.js; a tap on an input arrives as a
// `kit-action` event and is turned into ops by kit/actions.js, applied as the
// person with the page's undo toast; a tap on a row of a list or table with edit
// arrives as `kit-edit` and opens the sheet of ui/rowedit.js, whose save and delete
// take the same way.
//
//   mountScreen(host, store, "home")          cards of one screen into `host`
//   followControls(store, "ration", date, slot, mealState)  the controls of follow tracks under one meal
//   screenInfo(state, key), keptScreens(state)   a screen's name and the list «Мои разделы»
import "../viz/kit.js";
import "./inputs.js";
import { parseMarkup } from "../viz/validate.js";
import { applyUndoable, h, toast } from "../ui/dom.js";
import { openRowEditor } from "../ui/rowedit.js";
import { addItemOps, entryOps, formOps, itemOps, markOps, quickOps, unmarkOps } from "./actions.js";
import { resolveBinding } from "./bind.js";
import { asksField, describeField, entriesOf, itemsOf, listTracks } from "./ledger.js";
import { checkCardMarkup } from "./markup.js";
import { isDateKey, isOn, shiftDate } from "../viz/util.js";

// -- reading the space -----------------------------------------------------------------
const live = (obj) => obj && !obj.archivedAt;
const byOrder = (a, b) => (a.props.kit_order ?? 0) - (b.props.kit_order ?? 0) || a.id.localeCompare(b.id);

export function screenInfo(state, key) {
  const obj = state.objects[`sc_${key}`];
  if (!live(obj) || obj.type !== "kit_screen") return null;
  return { key, id: obj.id, name: obj.name || key, icon: obj.props.kit_icon || "", order: obj.props.kit_order ?? 0 };
}

// The screens a person opens from the list «Мои разделы»: every one but home.
export function keptScreens(state) {
  return Object.values(state.objects)
    .filter((obj) => obj.type === "kit_screen" && live(obj) && obj.props.kit_key !== "home")
    .sort(byOrder)
    .map((obj) => screenInfo(state, obj.props.kit_key));
}

const cardOf = (obj) => ({
  key: obj.props.kit_key || obj.id,
  title: obj.name,
  caption: obj.props.description,
  size: obj.props.kit_size === "half" ? "half" : "full",
  body: Array.isArray(obj.props.kit_body) ? obj.props.kit_body : [],
});

export function screenCards(state, key) {
  return Object.values(state.objects)
    .filter((obj) => obj.type === "kit_card" && live(obj) && obj.props.kit_screen === `sc_${key}`)
    .sort(byOrder)
    .map(cardOf);
}

// -- building a card --------------------------------------------------------------------
const textOf = (node) => node.children.filter((c) => c.type === "text").map((c) => c.text).join("").trim();
const isText = (tag) => tag === "p" || tag === "c-empty";

// What the person set on a screen and a redraw must not undo (every write redraws it):
// the text of a search box and the day of a marks pager, per element. Leaving the screen resets both.
const searches = new Map();
const pagerDays = new Map();
globalThis.addEventListener?.("hashchange", () => { searches.clear(); pagerDays.clear(); });

const MAX_ROWS = 50;

// The rows of a list or table. With search the filter needs every row, not the first few:
// the binding is asked for the most it gives and the element cuts the matches to the limit.
function rowsData(state, tag, attrs, ctx, at) {
  const shown = resolveBinding(state, { tag, ...attrs }, ctx);
  const out = { ...shown, track: attrs.of };
  if (!isOn(attrs.search)) return out;
  const all = resolveBinding(state, { tag, ...attrs, limit: MAX_ROWS }, ctx);
  const track = listTracks(state).find((t) => t.key === attrs.of);
  const words = new Map();
  if (track) {
    const textKeys = track.fields.filter((f) => f.type === "text").map((f) => f.key);
    for (const row of [...entriesOf(state, track.key, ctx), ...itemsOf(state, track.key)]) words.set(row.id, textKeys.map((key) => (row.values ?? {})[key]).filter(Boolean).join(" "));
  }
  return {
    ...out, rows: all.rows.map((row) => ({ ...row, search: words.get(row.id) })), total: all.total,
    limit: shown.rows.length, query: searches.get(at) ?? "", remember: (query) => searches.set(at, query),
  };
}

// Marks of a habit or a follow track step back day by day, up to a week.
function marksData(state, attrs, ctx, at) {
  const first = resolveBinding(state, { tag: "c-marks", ...attrs }, ctx);
  if (first.kind !== "habit" && first.kind !== "follow") return first;
  const min = shiftDate(ctx.today, -7);
  const pager = {
    today: ctx.today, min,
    at: (date) => ({ ...resolveBinding(state, { tag: "c-marks", ...attrs, date }, ctx), pager }),
    remember: (date) => pagerDays.set(at, date),
  };
  const kept = pagerDays.get(at);
  const date = isDateKey(kept) && kept >= min && kept <= ctx.today ? kept : first.date;
  return date === first.date ? { ...first, pager } : pager.at(date);
}

// A bound element is bound from the attributes that were validated, so what is
// drawn is what passed the check. A binding that fails leaves the error where
// the element would be, and keeps it there.
function bound(el, tag, attrs, state, ctx, at) {
  try {
    if (tag === "c-embed") el.data = { what: attrs.what, state, ctx };
    else if (tag === "c-marks") el.data = marksData(state, attrs, ctx, at);
    else if (tag === "c-list" || tag === "c-table") el.data = rowsData(state, tag, attrs, ctx, at);
    else el.data = resolveBinding(state, { tag, ...attrs }, ctx);
  } catch (error) {
    el.paint = () => {};
    el.fail(error);
  }
  return el;
}

function elementOf(node, state, ctx, at) {
  const el = document.createElement(node.tag);
  for (const attr of node.attrList) el.setAttribute(attr.name, attr.value);
  if (isText(node.tag)) {
    el.textContent = textOf(node);
    return el;
  }
  return bound(el, node.tag, node.attrs, state, ctx, at);
}

function cardElement(tree, state, ctx, at) {
  const card = document.createElement("c-card");
  for (const attr of tree.attrList) card.setAttribute(attr.name, attr.value);
  let row = null;
  let index = 0;
  for (const child of tree.children) {
    if (child.type !== "el") continue;
    const el = elementOf(child, state, ctx, `${at}/${index++}`);
    // Buttons that record a preset stand side by side.
    if (child.tag === "c-quick") {
      if (!row) { row = h("div", { class: "kit-row" }); card.append(row); }
      row.append(el);
      continue;
    }
    row = null;
    card.append(el);
    // A list with add carries the form that adds a row under it.
    if (child.tag === "c-list" && child.attrs.add) card.append(bound(document.createElement("c-add"), "c-add", { of: child.attrs.of }, state, ctx, null));
  }
  return card;
}

function cell(card, state, ctx, screen) {
  const checked = checkCardMarkup(card);
  if (!checked.ok) {
    console.warn(`kit: карточка «${card.key}» не показана: ${checked.messages.join(" ")}`);
    return h("div", { class: "kit-cell", "data-card": card.key, "data-size": card.size },
      h("p", { class: "kit-refused", role: "note", text: `Карточка «${card.title || card.key}» не показана: в ней есть то, что приложение не умеет рисовать.` }));
  }
  const tree = parseMarkup(checked.markup).nodes.find((node) => node.type === "el");
  return h("div", { class: "kit-cell", "data-card": card.key, "data-size": card.size }, cardElement(tree, state, ctx, `${screen}/${card.key}`));
}

// -- taps -------------------------------------------------------------------------------
function opsFor(state, detail, today) {
  const { track, date = today } = detail;
  switch (detail.do) {
    case "quick": return quickOps(state, track, detail.values, { date, today });
    case "form": return formOps(state, track, detail.values, { date, today });
    case "mark": return markOps(state, track, { item: detail.item, slot: detail.slot, date, state: detail.state, values: detail.values, today });
    case "unmark": return unmarkOps(state, track, { item: detail.item, slot: detail.slot, date, today });
    case "addItem": return addItemOps(state, track, { name: detail.name, every: detail.every, plan: detail.plan }, { today });
    case "editEntry": return entryOps(state, detail.id, detail.patch, { today });
    case "removeEntry": return entryOps(state, detail.id, { remove: true }, { today });
    case "editItem": return itemOps(state, detail.id, detail.patch, { today });
    case "endItem": return itemOps(state, detail.id, { end: true }, { today });
    case "removeItem": return itemOps(state, detail.id, { archive: true }, { today });
    default: throw new Error(`Действие «${detail.do}» приложение не знает`);
  }
}

// True when the tap was applied (or had nothing to do); a refusal is shown as a toast.
function perform(store, detail) {
  try {
    const ops = opsFor(store.state(), detail, store.today());
    return ops.length ? applyUndoable(store, ops, { summary: detail.summary }).ok : true;
  } catch (error) {
    toast(error.message, { error: true });
    return false;
  }
}

const wired = new WeakMap();

// Inputs below `root` report a tap with kit-action and a tap on a row that can be
// edited with kit-edit; this applies the first to the store and opens the sheet for the second.
export function wireActions(root, store) {
  for (const [type, handler] of wired.get(root) || []) root.removeEventListener(type, handler);
  const handlers = [
    ["kit-action", (event) => { event.stopPropagation(); perform(store, event.detail); }],
    ["kit-edit", (event) => { event.stopPropagation(); openRowEditor(store, event.detail, (detail) => perform(store, detail)); }],
  ];
  wired.set(root, handlers);
  for (const [type, handler] of handlers) root.addEventListener(type, handler);
}

// -- the screen ---------------------------------------------------------------------------
// Draws the cards of screen `key` into `host` and returns how many there were.
// Two half cards stand side by side on a wide screen and stack on a phone.
export function mountScreen(host, store, key) {
  const state = store.state();
  const ctx = { today: store.today() };
  const cards = screenCards(state, key);
  host.replaceChildren(...(cards.length ? [h("div", { class: "kit-cards" }, cards.map((card) => cell(card, state, ctx, key)))] : []));
  wireActions(host, store);
  return { cards: cards.length };
}

// -- follow tracks under a meal or a session ---------------------------------------------------
// The state a follow track is asked at, by the state of the meal or session it stands under.
const ASKED_AT = { eaten: "done", done: "done", changed: "changed", skipped: "skipped", unmarked: "done" };

// A track that follows ration or sport asks its question under each slot of the day,
// with the fields that ask at the state of that slot: what a skipped meal asks is not
// what an eaten one asks. Returns null when no track has something to ask for the slot.
export function followControls(store, area, date, slot, slotState = "unmarked") {
  const state = store.state();
  const ctx = { today: store.today() };
  const nodes = [];
  for (const track of listTracks(state)) {
    if (track.kind !== "follow" || track.follows !== area) continue;
    try {
      const wanted = ASKED_AT[slotState] ?? "done";
      const askState = track.states.includes(wanted) ? wanted : wanted === "skipped" ? null : "done";
      const asked = askState ? track.fields.filter((field) => asksField(field, askState)).map((field) => describeField(state, track, field)) : [];
      if (!asked.length) continue;
      const data = resolveBinding(state, { el: "marks", of: track.key, date }, ctx);
      const rows = data.rows.filter((row) => row.slot === slot).map((row) => ({ ...row, ask: { ...row.ask, [askState]: asked } }));
      if (!rows.length) continue;
      const marks = document.createElement("c-marks");
      marks.data = { ...data, rows, askState, compact: true, progress: null };
      nodes.push(marks);
    } catch (error) {
      console.warn(`kit: раздел «${track.key}» не показан под приёмом: ${error.message}`);
    }
  }
  if (!nodes.length) return null;
  const wrap = h("div", { class: "viz kit-follow" }, nodes);
  wireActions(wrap, store);
  return wrap;
}
