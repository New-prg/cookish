// A kit screen on the page. The cards of a `kit_screen` object (storage mapping in
// synthesis §2) are drawn in order: each card becomes the closed markup of
// cardMarkup, which must pass validateMarkup before it reaches the DOM; the
// elements take their data from kit/bind.js; a tap on an input arrives as a
// `kit-action` event and is turned into ops by kit/actions.js, applied as the
// person with the page's undo toast.
//
//   mountScreen(host, store, "home")          cards of one screen into `host`
//   followControls(store, "ration", date, slot)  the controls of follow tracks under one meal
//   screenInfo(state, key), keptScreens(state)   a screen's name and the list «Мои разделы»
import "../viz/kit.js";
import "./inputs.js";
import { parseMarkup } from "../viz/validate.js";
import { applyUndoable, h, toast } from "../ui/dom.js";
import { addItemOps, formOps, markOps, quickOps, unmarkOps } from "./actions.js";
import { resolveBinding } from "./bind.js";
import { listTracks } from "./ledger.js";
import { checkCardMarkup } from "./markup.js";

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

// A bound element is bound from the attributes that were validated, so what is
// drawn is what passed the check. A binding that fails leaves the error where
// the element would be, and keeps it there.
function bound(el, tag, attrs, state, ctx) {
  try {
    el.data = tag === "c-embed" ? { what: attrs.what, state, ctx } : resolveBinding(state, { tag, ...attrs }, ctx);
  } catch (error) {
    el.paint = () => {};
    el.fail(error);
  }
  return el;
}

function elementOf(node, state, ctx) {
  const el = document.createElement(node.tag);
  for (const attr of node.attrList) el.setAttribute(attr.name, attr.value);
  if (isText(node.tag)) {
    el.textContent = textOf(node);
    return el;
  }
  return bound(el, node.tag, node.attrs, state, ctx);
}

function cardElement(tree, state, ctx) {
  const card = document.createElement("c-card");
  for (const attr of tree.attrList) card.setAttribute(attr.name, attr.value);
  let row = null;
  for (const child of tree.children) {
    if (child.type !== "el") continue;
    const el = elementOf(child, state, ctx);
    // Buttons that record a preset stand side by side.
    if (child.tag === "c-quick") {
      if (!row) { row = h("div", { class: "kit-row" }); card.append(row); }
      row.append(el);
      continue;
    }
    row = null;
    card.append(el);
    // A list with add carries the form that adds a row under it.
    if (child.tag === "c-list" && child.attrs.add) card.append(bound(document.createElement("c-add"), "c-add", { of: child.attrs.of }, state, ctx));
  }
  return card;
}

function cell(card, state, ctx) {
  const checked = checkCardMarkup(card);
  if (!checked.ok) {
    console.warn(`kit: карточка «${card.key}» не показана: ${checked.messages.join(" ")}`);
    return h("div", { class: "kit-cell", "data-card": card.key, "data-size": card.size },
      h("p", { class: "kit-refused", role: "note", text: `Карточка «${card.title || card.key}» не показана: в ней есть то, что приложение не умеет рисовать.` }));
  }
  const tree = parseMarkup(checked.markup).nodes.find((node) => node.type === "el");
  return h("div", { class: "kit-cell", "data-card": card.key, "data-size": card.size }, cardElement(tree, state, ctx));
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
    default: throw new Error(`Действие «${detail.do}» приложение не знает`);
  }
}

function perform(store, detail) {
  try {
    const ops = opsFor(store.state(), detail, store.today());
    if (ops.length) applyUndoable(store, ops, { summary: detail.summary });
  } catch (error) {
    toast(error.message, { error: true });
  }
}

const wired = new WeakMap();

// Inputs below `root` report a tap with kit-action; this applies it to the store.
export function wireActions(root, store) {
  if (wired.has(root)) root.removeEventListener("kit-action", wired.get(root));
  const handler = (event) => {
    event.stopPropagation();
    perform(store, event.detail);
  };
  wired.set(root, handler);
  root.addEventListener("kit-action", handler);
}

// -- the screen ---------------------------------------------------------------------------
// Draws the cards of screen `key` into `host` and returns how many there were.
// Two half cards stand side by side on a wide screen and stack on a phone.
export function mountScreen(host, store, key) {
  const state = store.state();
  const ctx = { today: store.today() };
  const cards = screenCards(state, key);
  host.replaceChildren(...(cards.length ? [h("div", { class: "kit-cards" }, cards.map((card) => cell(card, state, ctx)))] : []));
  wireActions(host, store);
  return { cards: cards.length };
}

// -- follow tracks under a meal or a session ---------------------------------------------------
// A track that follows ration or sport asks its question under each slot of the day.
// Returns null when no track has a row for the slot.
export function followControls(store, area, date, slot) {
  const state = store.state();
  const ctx = { today: store.today() };
  const nodes = [];
  for (const track of listTracks(state)) {
    if (track.kind !== "follow" || track.follows !== area) continue;
    try {
      const data = resolveBinding(state, { el: "marks", of: track.key, date }, ctx);
      const rows = data.rows.filter((row) => row.slot === slot);
      if (!rows.length) continue;
      const marks = document.createElement("c-marks");
      marks.data = { ...data, rows, compact: true, progress: null };
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
