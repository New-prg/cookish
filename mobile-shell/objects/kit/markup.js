// Two spellings of the same IR (synthesis §1): the markup of one kit card, which
// goes through validateMarkup(…, { kit: true }) before it reaches the DOM, and
// surface S2, the whole bundle as <c-bundle> markup.
//
//   cardMarkup(card)          → '<c-card title="…"><c-meter of="water" value="ml"></c-meter></c-card>'
//   checkCardMarkup(card, o)  → validateMarkup result for that markup
//   bundleToMarkup(bundle)    → the canonical printer, what the manual shows a model
//   bundleFromMarkup(src)     → { bundle, problems, changes }, the inverse of the printer
//
// The parser is the one in viz/validate.js. bundleFromMarkup only checks the
// grammar (known tags, where they may stand, no stray text); that a key exists,
// a value is in range or a vocabulary word is allowed belongs to validateBundle.
// So an attribute it does not know is kept as a string and reaches that layer.
import { escapeAttr, escapeText, parseMarkup, validateMarkup } from "../viz/validate.js";

// Attribute kinds. A list is a comma string, pairs are k=v joined by commas
// (`npairs` turns a numeric value into a number, `spairs` keeps text).
const BUNDLE = { v: "num", name: "str" };
const TRACK = { key: "str", name: "str", icon: "str", kind: "str", states: "list", labels: "spairs", unmarked: "str", grace: "num", times: "num", per: "str", follows: "str", avoid: "bool" };
const FIELD = { key: "str", name: "str", type: "str", unit: "str", min: "num", max: "num", step: "num", options: "list", labels: "list", calc: "str", to: "str", goal: "num", goalType: "str", goalPer: "str", planned: "bool", on: "list", required: "bool", hint: "str" };
const ITEM = { key: "str", name: "str", every: "str", at: "str", from: "str", until: "str", plan: "npairs" };
const SCREEN = { key: "str", name: "str", icon: "str", order: "list" };
const CARD = { key: "str", title: "str", caption: "str", size: "str" };
const REMOVE = { card: "str", track: "str", screen: "str", item: "str", field: "str" };

// goal, goalType and unit are not part of an element any more: validateBundle moves a goal
// to its field. They are read as typed values so that step sees what the model wrote.
const CHART = { of: "str", value: "str", fn: "str", range: "str", where: "npairs", title: "str", goal: "num", goalType: "str", unit: "str" };
const ROWS = { of: "str", columns: "list", limit: "num", sort: "str", order: "str", range: "str", where: "npairs", title: "str" };
const ELEMENTS = {
  stat: { ...CHART, compare: "bool", spark: "bool", good: "str" },
  meter: { ...CHART, category: "str" },
  bars: { ...CHART, by: "str", category: "str", stack: "str" },
  line: { ...CHART, by: "str", category: "str", area: "bool" },
  spark: CHART,
  heatmap: CHART,
  table: ROWS,
  list: { ...ROWS, add: "bool" },
  quick: { of: "str", values: "npairs", label: "str" },
  form: { of: "str", fields: "list" },
  marks: { of: "str", add: "bool" },
  streak: { of: "str" },
  embed: { what: "str" },
};
// The two elements that hold text instead of attributes: <p> and <c-empty>.
const TEXT_ELEMENTS = new Set(["p", "empty"]);

const tableOf = (name) => (Object.hasOwn(ELEMENTS, name) ? ELEMENTS[name] : {});
const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const NAME = /^[a-z][a-z0-9-]*$/;
const tagOf = (el) => (el === "p" ? "p" : `c-${el}`);
const elOf = (tag) => (tag === "p" ? "p" : tag.slice(2));

// -- value <-> string ---------------------------------------------------------------
const NUMBER = /^-?\d+(\.\d+)?$/;
const TRUE_WORDS = new Set(["", "yes", "true", "да", "1"]);
const FALSE_WORDS = new Set(["no", "false", "нет", "0"]);

function readValue(kind, raw) {
  switch (kind) {
    case "num": return NUMBER.test(raw.trim()) ? Number(raw) : raw;
    case "bool": {
      const word = raw.trim().toLowerCase();
      return TRUE_WORDS.has(word) ? true : FALSE_WORDS.has(word) ? false : raw;
    }
    case "list": return raw.trim() === "" ? [] : raw.split(",").map((s) => s.trim());
    case "npairs":
    case "spairs": return readPairs(kind, raw);
    default: return raw;
  }
}

function readPairs(kind, raw) {
  const out = {};
  for (const part of raw.split(",")) {
    const text = part.trim();
    if (!text) continue;
    const at = text.indexOf("=");
    if (at < 1) return null;
    const key = text.slice(0, at).trim();
    const value = text.slice(at + 1).trim();
    if (!NAME.test(key.replace(/_/g, "-"))) return null;
    out[key] = kind === "npairs" && NUMBER.test(value) ? Number(value) : value;
  }
  return out;
}

// A comma cannot be written inside a list entry, so it is replaced by a full-width
// one and the entry stays readable; validateBundle is where such an entry is refused.
const listItem = (value) => String(value).replace(/,/g, "，");

function writeValue(kind, value) {
  if (typeof value === "string") return value;
  if (kind === "bool" && typeof value === "boolean") return value ? "yes" : "no";
  if (kind === "list" && Array.isArray(value)) return value.map(listItem).join(",");
  if ((kind === "npairs" || kind === "spairs") && value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).map(([k, v]) => `${k}=${listItem(v)}`).join(",");
  }
  return String(value);
}

// -- IR -> a tree of printable nodes ---------------------------------------------------
// { tag, attrs: [[name, text]], text?, children }
const node = (tag, attrs, children = [], text = null) => ({ tag, attrs, children, text });

function attrsOf(table, source, skip = []) {
  const out = [];
  const seen = new Set(skip);
  const put = (key, kind) => {
    seen.add(key);
    const value = source[key];
    if (value == null) return;
    out.push([kebab(key), writeValue(kind, value)]);
  };
  for (const [key, kind] of Object.entries(table)) put(key, kind);
  for (const key of Object.keys(source).sort()) if (!seen.has(key) && source[key] != null && typeof source[key] !== "object") put(key, "str");
  // A name that cannot stand in a tag is spelled so the validator names it.
  return out.map(([name, text]) => [NAME.test(name) ? name : "x-invalid", text]);
}

function elementNode(el) {
  const name = String(el?.el ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const kind = name || "unknown";
  if (TEXT_ELEMENTS.has(kind)) return node(tagOf(kind), [], [], String(el.text ?? ""));
  return node(tagOf(kind), attrsOf(tableOf(kind), el || {}, ["el"]));
}

const cardNode = (card) => node("c-card", attrsOf({ title: "str", caption: "str" }, card || {}, ["body", "key", "size"]), ((card && card.body) || []).map(elementNode));

function bundleNode(bundle) {
  const children = [];
  if (bundle.reply != null) children.push(node("c-reply", [], [], String(bundle.reply)));
  for (const track of bundle.tracks || []) {
    children.push(node("c-track", attrsOf(TRACK, track, ["fields", "items"]), [
      ...(track.fields || []).map((field) => node("c-field", attrsOf(FIELD, field))),
      ...(track.items || []).map((item) => node("c-item", attrsOf(ITEM, item))),
    ]));
  }
  for (const screen of bundle.screens || []) {
    children.push(node("c-screen", attrsOf(SCREEN, screen, ["cards"]), (screen.cards || []).map((card) => node("c-card", attrsOf(CARD, card, ["body"]), (card.body || []).map(elementNode)))));
  }
  for (const removal of bundle.remove || []) children.push(node("c-remove", attrsOf(REMOVE, removal)));
  return node("c-bundle", attrsOf(BUNDLE, bundle, ["reply", "tracks", "screens", "remove"]), children);
}

// -- printing --------------------------------------------------------------------------
// pairs: <x></x> for a node without children, as the strict validator wants; the
// bundle printer writes <x/> instead, as the manual shows it to a model.
function print(tree, { pairs, indent }, depth = 0) {
  const pad = indent ? "  ".repeat(depth) : "";
  const attrs = tree.attrs.map(([name, text]) => ` ${name}="${escapeAttr(text)}"`).join("");
  const open = `<${tree.tag}${attrs}>`;
  if (tree.text != null) return `${pad}${open}${escapeText(tree.text)}</${tree.tag}>`;
  if (!tree.children.length) return pairs ? `${pad}${open}</${tree.tag}>` : `${pad}<${tree.tag}${attrs}/>`;
  const inner = tree.children.map((child) => print(child, { pairs, indent }, depth + 1));
  return indent ? `${pad}${open}\n${inner.join("\n")}\n${pad}</${tree.tag}>` : `${open}${inner.join("")}</${tree.tag}>`;
}

// The closed markup of one card: nothing but its title, caption and elements.
export function cardMarkup(card) {
  return print(cardNode(card), { pairs: true, indent: false });
}

// The numbers in a card's words are judged where the request and the whole
// bundle are known (validateBundle, and the store as the model writes). The
// markup validator only sees the card, so its number rule would refuse a title
// the person's own request supplied, now and every time the card is drawn.
export function checkCardMarkup(card, options = {}) {
  const checked = validateMarkup(cardMarkup(card), { ...options, kit: true });
  const problems = checked.problems.filter((problem) => problem.rule !== "number-in-text");
  return { ...checked, ok: problems.length === 0, problems, messages: problems.map((problem) => problem.message) };
}

export function bundleToMarkup(bundle) {
  const onlyReply = bundle.reply != null && Object.keys(bundle).every((key) => key === "reply");
  const tree = bundleNode(bundle);
  return print(onlyReply ? tree.children[0] : tree, { pairs: false, indent: true });
}

// -- S2: markup -> IR --------------------------------------------------------------------
export function bundleFromMarkup(src) {
  const problems = [];
  const changes = [];
  const add = (path, rule, message, allowed) => problems.push({ path, rule, message, ...(allowed ? { allowed } : {}) });
  if (typeof src !== "string" || !src.trim()) {
    add("c-bundle", "no-root", "Ответ пустой. Напишите <c-bundle v=\"2\" name=\"…\">…</c-bundle> или одну фразу в <c-reply>.</c-reply>.");
    return { bundle: null, problems, changes };
  }
  const parsed = parseMarkup(src);
  // A leaf closed by itself and a bare attribute value are normal in S2.
  for (const p of parsed.problems) if (!p.fixable) add("c-bundle", p.rule, p.message);
  if (problems.length) return { bundle: null, problems, changes };

  const bundle = {};
  const tops = parsed.nodes.filter((n) => n.type === "el");
  const bundles = tops.filter((n) => n.tag === "c-bundle");
  const replies = [];
  const outside = parsed.nodes.filter((n) => n.type === "text" && n.text.trim()).map((n) => n.text.trim());
  for (const top of tops) {
    if (top.tag === "c-reply") replies.push(top);
    else if (top.tag !== "c-bundle") add(top.tag, "unknown-tag", `Тег <${top.tag}> не разрешён. В ответе бывают только <c-bundle> и <c-reply>.`, ["c-bundle", "c-reply"]);
  }
  if (!tops.length && outside.length) {
    changes.push("Фраза без разметки записана как ответ <c-reply>.");
    return { bundle: { reply: outside.join(" ") }, problems, changes };
  }
  if (!bundles.length && !replies.length) {
    add("c-bundle", "no-root", "В ответе нет <c-bundle v=\"2\" name=\"…\">…</c-bundle>. Если просьбу выполнить нельзя, напишите одну фразу в <c-reply>.</c-reply>.");
    return { bundle: null, problems, changes };
  }
  if (bundles.length > 1) add("c-bundle", "extra-root", "В ответе несколько <c-bundle>. Нужен один: сложите всё в него.");

  const root = bundles[0];
  if (root) readBundle(root, bundle, add, replies);
  const reply = replies.map(textOf).filter(Boolean).join(" ");
  if (reply) bundle.reply = reply;
  if (outside.length && bundle.reply == null) {
    bundle.reply = outside.join(" ");
    changes.push("Фраза вне разметки записана как ответ <c-reply>.");
  } else if (outside.length) {
    add("c-bundle", "text-not-allowed", "Текст вне <c-bundle> и <c-reply> не разрешён. Ответ человеку пишите внутри <c-reply>.");
  }
  return { bundle, problems, changes };
}

const textOf = (el) => el.children.filter((c) => c.type === "text").map((c) => c.text).join("").trim();

function readBundle(root, bundle, add, replies) {
  readAttrs(root, BUNDLE, bundle, "c-bundle", add);
  const seen = {};
  const here = (child) => { seen[child.tag] = (seen[child.tag] ?? -1) + 1; return `c-bundle > ${child.tag}[${seen[child.tag]}]`; };
  const lists = { tracks: [], screens: [], remove: [] };
  for (const child of root.children) {
    if (child.type === "text") {
      if (child.text.trim()) add("c-bundle", "text-not-allowed", `Текст «${clip(child.text)}» нельзя писать прямо в <c-bundle>. Ответ человеку пишите внутри <c-reply>.`);
      continue;
    }
    const path = here(child);
    if (child.tag === "c-reply") replies.push(child);
    else if (child.tag === "c-track") lists.tracks.push(readTrack(child, path, add));
    else if (child.tag === "c-screen") lists.screens.push(readScreen(child, path, add));
    else if (child.tag === "c-remove") lists.remove.push(readRemove(child, path, add));
    else add(path, "unknown-tag", `Тег <${child.tag}> нельзя писать в <c-bundle>. Там бывают c-reply, c-track, c-screen, c-remove.`, ["c-reply", "c-track", "c-screen", "c-remove"]);
  }
  for (const [key, list] of Object.entries(lists)) if (list.length) bundle[key] = list;
}

function readTrack(el, path, add) {
  const track = {};
  readAttrs(el, TRACK, track, path, add);
  const fields = [];
  const items = [];
  walkChildren(el, path, add, {
    "c-field": (child, at) => fields.push(readLeaf(child, FIELD, at, add)),
    "c-item": (child, at) => items.push(readLeaf(child, ITEM, at, add)),
  });
  if (fields.length) track.fields = fields;
  if (items.length) track.items = items;
  return track;
}

function readScreen(el, path, add) {
  const screen = {};
  readAttrs(el, SCREEN, screen, path, add);
  const cards = [];
  walkChildren(el, path, add, { "c-card": (child, at) => cards.push(readCard(child, at, add)) });
  if (cards.length) screen.cards = cards;
  return screen;
}

function readCard(el, path, add) {
  const card = {};
  readAttrs(el, CARD, card, path, add);
  const body = [];
  const seen = {};
  for (const child of el.children) {
    if (child.type === "text") {
      if (child.text.trim()) add(path, "text-not-allowed", `Текст «${clip(child.text)}» нельзя писать прямо в <c-card>. Оберните его в <p> или <c-empty>.`);
      continue;
    }
    seen[child.tag] = (seen[child.tag] ?? -1) + 1;
    const at = `${path} > ${child.tag}[${seen[child.tag]}]`;
    if (child.tag !== "p" && !/^c-[a-z][a-z0-9-]*$/.test(child.tag)) {
      add(at, "unknown-tag", `Тег <${child.tag}> нельзя писать в <c-card>. Там бывают элементы c-stat, c-meter, c-bars, c-line, c-quick, c-form, c-marks и другие c-…, а текст пишут в p.`);
      continue;
    }
    if (["c-bundle", "c-reply", "c-track", "c-field", "c-item", "c-screen", "c-card", "c-remove"].includes(child.tag)) {
      add(at, "not-allowed-here", `<${child.tag}> нельзя помещать в <c-card>. В карточке стоят только элементы.`);
      continue;
    }
    body.push(readElement(child, at, add));
  }
  card.body = body;
  return card;
}

function readElement(el, path, add) {
  const name = elOf(el.tag);
  const out = { el: name };
  if (TEXT_ELEMENTS.has(name)) {
    for (const child of el.children) if (child.type === "el") add(path, "not-allowed-here", `В <${el.tag}> можно писать только текст.`);
    out.text = textOf(el);
    for (const attr of Object.keys(el.attrs)) add(`${path}@${attr}`, "unknown-attr", `У <${el.tag}> нет атрибутов, только текст.`);
    return out;
  }
  readAttrs(el, tableOf(name), out, path, add);
  noChildren(el, path, add);
  return out;
}

function readLeaf(el, table, path, add) {
  const out = {};
  readAttrs(el, table, out, path, add);
  noChildren(el, path, add);
  return out;
}

function readRemove(el, path, add) {
  const out = {};
  readAttrs(el, REMOVE, out, path, add);
  noChildren(el, path, add);
  if (!Object.keys(out).length) add(path, "empty-remove", "В <c-remove> нужен ровно один атрибут: card, track, screen, item или field.", Object.keys(REMOVE));
  return out;
}

function noChildren(el, path, add) {
  for (const child of el.children) {
    if (child.type === "el") add(path, "not-allowed-here", `Внутри <${el.tag}> ничего писать не нужно.`);
    else if (child.text.trim()) add(path, "text-not-allowed", `Текст «${clip(child.text)}» нельзя писать внутри <${el.tag}>.`);
  }
}

// Children of a container, each routed by tag. A tag not in `handlers` is refused with the list.
function walkChildren(el, path, add, handlers) {
  const seen = {};
  const allowed = Object.keys(handlers);
  for (const child of el.children) {
    if (child.type === "text") {
      if (child.text.trim()) add(path, "text-not-allowed", `Текст «${clip(child.text)}» нельзя писать прямо в <${el.tag}>.`);
      continue;
    }
    seen[child.tag] = (seen[child.tag] ?? -1) + 1;
    const at = `${path} > ${child.tag}[${seen[child.tag]}]`;
    if (handlers[child.tag]) handlers[child.tag](child, at);
    else add(at, "not-allowed-here", `<${child.tag}> нельзя помещать в <${el.tag}>. Там разрешены: ${allowed.join(", ")}.`, allowed);
  }
}

// Attributes by the kinds of a table; an attribute outside it is kept as text.
function readAttrs(el, table, out, path, add) {
  for (const name of el.duplicates) add(`${path}@${name}`, "duplicate-attr", `Атрибут «${name}» записан дважды. Оставьте один.`);
  for (const [name, raw] of Object.entries(el.attrs)) {
    if (!NAME.test(name)) { add(`${path}@${name}`, "bad-attr-name", `Имя атрибута «${name}» не подходит: латиница, цифры и «-».`); continue; }
    const key = camel(name);
    const kind = table[key] || "str";
    const value = readValue(kind, raw);
    if (value === null) { add(`${path}@${name}`, "bad-value", `Атрибут «${name}» пишется парами ключ=значение через запятую, например ${name}="ml=250".`); continue; }
    out[key] = value;
  }
}

const clip = (text) => (text.length > 40 ? `${text.trim().slice(0, 40)}…` : text.trim());
