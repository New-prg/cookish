// L1: the strict check of a normalized bundle against the space. Every problem
// is { path, rule, message, allowed? }: `path` names keys (tracks.water.fields.ml.goal),
// `message` is a Russian sentence that names the fix and lists the legal
// values or the nearest existing keys. Three passes, and the model sees only
// the first that fails: shape and vocabulary, then references and kind rules,
// then the safety floors, so one repair round fixes one class of mistake.
import {
  AT, BUNDLE_ATTRS, CALC_FUNCTIONS, CARD_ATTRS, ELEMENTS, ELEMENT_KEYS, EVERY, FIELD_ATTRS, FIELD_TYPES, FIELD_TYPE_KEYS, ITEM_ATTRS,
  KEYS, KINDS, KIND_KEYS, LIMITS, MARK_KINDS, NUMERIC_TYPES, RANGE_TOKENS, REMOVAL_KINDS, RESERVED, RESERVED_TRACK_KEYS, SCREEN_ATTRS, TRACK_ATTRS, VIRTUAL,
  isAt, isDate, isEvery, isKey,
} from "./catalogue.js";
import { formulaRefs, hasFunction, parseFormula } from "../core/formula.js";
import { resolveRange } from "../core/query.js";
import { bindingNumbers, calcReads, fieldNumbers, safetyFloors, sourceNumbers } from "./rules.js";
import { appSlug, isReplyOnly } from "./normalize.js";
import { mergeBundle } from "./merge.js";
import { live } from "./spec.js";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const words = (list, max = 12) => (list.length > max ? `${list.slice(0, max).join(", ")} и ещё ${list.length - max}` : list.join(", "));
const q = (text) => `«${text}»`;

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}
// Existing keys that the typo most likely meant, nearest first.
export const nearest = (key, candidates) => [...candidates].sort((a, b) => distance(String(key), a) - distance(String(key), b));

export function validateBundle(bundle, spec, ctx = {}) {
  const today = ctx.today || new Date().toISOString().slice(0, 10);
  const problems = [];
  const add = (path, rule, message, allowed) => problems.push({ path, rule, message, ...(allowed ? { allowed } : {}) });

  shapePass(bundle, spec, add);
  if (problems.length) return problems;
  const merged = mergeBundle(spec, bundle, { today, app: appSlug(bundle.name) }).spec;
  referencePass(bundle, spec, merged, add);
  if (problems.length) return problems;
  safetyPass(bundle, merged, add, ctx.request);
  return problems;
}

// ===== pass 1: shape and vocabulary =================================================
function checkValue(value, attr, path, name, add, owner) {
  const bad = (message, allowed) => add(path, "bad-value", message, allowed);
  switch (attr.type) {
    case "text":
      if (typeof value !== "string") return bad(`${q(name)} у ${owner} должно быть текстом.`);
      if (/[<>\u0000-\u001f]/.test(value)) return bad(`${q(name)} у ${owner} не может содержать символы < > и управляющие символы.`);
      if (value.length > attr.max) return add(path, "text-too-long", `${q(name)} у ${owner} длиннее ${attr.max} символов (сейчас ${value.length}). Сократите.`);
      if (!value.trim()) return bad(`${q(name)} у ${owner} пустое. Напишите текст или уберите атрибут.`);
      return;
    case "enum":
      if (!attr.values.includes(value)) bad(`${q(name)} у ${owner}: значение ${q(value)} не подходит. Допустимо: ${attr.values.join(", ")}.`, attr.values);
      return;
    case "bool":
      if (value !== true) bad(`${q(name)} у ${owner} включается записью ${name}: true; чтобы выключить, уберите атрибут.`, [true]);
      return;
    case "int":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return bad(`${q(name)} у ${owner} должно быть числом без единиц и пробелов, например ${JSON.stringify(attr.example ?? 1)}.`);
      if (attr.type === "int" && !Number.isInteger(value)) return bad(`${q(name)} у ${owner} должно быть целым числом.`);
      if ((attr.min != null && value < attr.min) || (attr.max != null && value > attr.max)) add(path, "out-of-range", `${q(name)} у ${owner}=${value} вне пределов:${attr.min != null ? ` от ${attr.min}` : ""}${attr.max != null ? ` до ${attr.max}` : ""}.`);
      return;
    }
    case "date":
      if (!isDate(value)) bad(`${q(name)} у ${owner} должна быть датой ГГГГ-ММ-ДД, например ${attr.example || "2026-10-24"}.`);
      return;
    case "list":
      if (!Array.isArray(value)) return bad(`${q(name)} у ${owner} должно быть списком [ … ].`);
      if (attr.max != null && value.length > attr.max) add(path, "limit", `${q(name)} у ${owner}: не больше ${attr.max} (сейчас ${value.length}). Оставьте самое нужное.`);
      if (attr.values) for (const v of value) if (!attr.values.includes(v)) bad(`${q(name)} у ${owner}: значение ${q(v)} не подходит. Допустимо: ${attr.values.join(", ")}.`, attr.values);
      return;
    case "pairs":
      if (!isObj(value)) return bad(`${q(name)} у ${owner} должно быть объектом вида {"ключ": значение}.`);
      if (attr.max != null && Object.keys(value).length > attr.max) add(path, "limit", `${q(name)} у ${owner}: не больше ${attr.max} пар (сейчас ${Object.keys(value).length}).`);
      if (attr.keys) for (const k of Object.keys(value)) if (!attr.keys.includes(k)) bad(`${q(name)} у ${owner}: ключ ${q(k)} не подходит. Допустимо: ${attr.keys.join(", ")}.`, attr.keys);
      for (const [k, v] of Object.entries(value)) {
        if (!["string", "number", "boolean"].includes(typeof v)) bad(`${q(name)} у ${owner}: значение ${q(k)} должно быть строкой, числом или true/false.`);
        else if (attr.type === "pairs" && typeof v === "string" && attr.max === LIMITS.label && v.length > LIMITS.label) add(path, "text-too-long", `${q(name)} у ${owner}: подпись ${q(k)} длиннее ${LIMITS.label} символов.`);
      }
      return;
    case "track": case "value": case "field":
      if (typeof value !== "string" || !value) bad(`${q(name)} у ${owner} должно быть ключом, например ${JSON.stringify(attr.example ?? "water")}.`);
      return;
    case "fields":
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return bad(`${q(name)} у ${owner} должно быть списком ключей ["a","b"].`);
      if (attr.max != null && value.length > attr.max) add(path, "limit", `${q(name)} у ${owner}: не больше ${attr.max} (сейчас ${value.length}).`);
      return;
    case "key":
      if (!isKey(attr.keyKind, value)) bad(`Ключ ${q(value)} у ${owner} не подходит: ${KEYS[attr.keyKind].doc}. Пример: ${attr.example}.`);
      return;
    default:
  }
}

function unknownKeys(obj, table, path, owner, add) {
  for (const name of Object.keys(obj)) {
    if (name in table) continue;
    const hint = ["entries", "records", "data", "values", "facts"].includes(name) && owner === "пакета"
      ? " Записи пакетом не добавляются: их вносит человек кнопками."
      : name === "id" ? " Идентификаторы пакет не содержит: объекты находятся по ключам." : "";
    add(`${path}.${name}`, "unknown-key", `У ${owner} нет атрибута ${q(name)}.${hint} Допустимо: ${Object.keys(table).join(", ")}.`, Object.keys(table));
  }
}

function shapePass(bundle, spec, add) {
  if (!isObj(bundle)) return add("", "bundle-shape", "Пакет должен быть JSON-объектом {\"v\":2,\"name\":…}.");
  const size = JSON.stringify(bundle).length;
  if (size > LIMITS.bundleChars) return add("", "bundle-too-long", `Пакет длиннее ${LIMITS.bundleChars} символов (сейчас ${size}). Сделайте его короче: меньше карточек и пунктов, без повторов.`);
  unknownKeys(bundle, BUNDLE_ATTRS, "", "пакета", add);
  for (const [name, attr] of Object.entries(BUNDLE_ATTRS)) {
    if (attr.required && !(name in bundle) && !(name === "name" && isReplyOnly(bundle))) add(name, "missing-attr", `В пакете нет ${q(name)}. ${attr.doc[0].toUpperCase()}${attr.doc.slice(1)}. Пример: ${name}: ${JSON.stringify(attr.example)}.`);
    else if (name in bundle && !["tracks", "screens", "remove"].includes(name)) checkValue(bundle[name], attr, name, name, add, "пакета");
  }
  for (const name of ["tracks", "screens", "remove"]) {
    if (!(name in bundle)) continue;
    if (!Array.isArray(bundle[name])) add(name, "bad-value", `${q(name)} должно быть списком [ … ].`);
    else if (bundle[name].length > (BUNDLE_ATTRS[name].max ?? 99)) add(name, "limit", `В пакете ${name === "tracks" ? "треков" : name === "screens" ? "экранов" : "удалений"} больше ${BUNDLE_ATTRS[name].max}. Разбейте просьбу на два пакета.`);
  }
  const seenTrack = new Set();
  (Array.isArray(bundle.tracks) ? bundle.tracks : []).forEach((t, i) => trackShape(t, i, spec, seenTrack, add));
  const seenScreen = new Set();
  const seenCard = new Set();
  (Array.isArray(bundle.screens) ? bundle.screens : []).forEach((s, i) => screenShape(s, i, spec, seenScreen, seenCard, add));
  (Array.isArray(bundle.remove) ? bundle.remove : []).forEach((r, i) => removalShape(r, i, add));
}

const keyIssue = (kind, key, path, owner, add, seen) => {
  if (typeof key !== "string" || !key) { add(path, "missing-attr", `У ${owner} нет ключа key. ${KEYS[kind].doc}.`); return false; }
  if (!isKey(kind, key)) { add(path, "bad-key", `Ключ ${q(key)} у ${owner} не подходит: ${KEYS[kind].doc}.`); return false; }
  if (seen) {
    if (seen.has(key)) { add(path, "duplicate-key", `Ключ ${q(key)} у ${owner} встречается дважды. Объедините записи или дайте разные ключи.`); return false; }
    seen.add(key);
  }
  return true;
};

function trackShape(t, i, spec, seen, add) {
  if (!isObj(t)) return add(`tracks[${i}]`, "bad-value", "Трек должен быть объектом {\"key\":…,\"name\":…,\"kind\":…}.");
  const at = `tracks.${t.key ?? i}`;
  if (!keyIssue("track", t.key, `${at}.key`, "трека", add, seen)) return;
  const existing = spec.tracks[t.key];
  if (existing?.readonly) return add(`${at}.key`, "reserved-key", `Ключ ${q(t.key)} занят классическим разделом: он только читается. Возьмите другой ключ, например ${t.key}_log.`);
  if (RESERVED_TRACK_KEYS.includes(t.key)) return add(`${at}.key`, "reserved-key", `Ключ ${q(t.key)} зарезервирован. Возьмите другой.`);
  unknownKeys(t, TRACK_ATTRS, at, `трека ${q(t.key)}`, add);
  for (const [name, attr] of Object.entries(TRACK_ATTRS)) {
    if (name === "fields" || name === "items" || name === "key") continue;
    if (name in t) checkValue(t[name], attr, `${at}.${name}`, name, add, `трека ${q(t.key)}`);
  }
  if (!existing) {
    const keys = Object.values(spec.tracks).filter((x) => !x.readonly && !x.archived).map((x) => x.key);
    for (const name of ["name", "kind"]) {
      if (name in t) continue;
      const near = nearest(t.key, keys).slice(0, 6);
      const hint = keys.length ? ` Если хотели изменить существующий трек, его ключи: ${words(near)}.` : "";
      add(`${at}.${name}`, "missing-attr", `Трека ${q(t.key)} нет, значит это новый трек, и ему нужны name и kind.${hint}`, name === "kind" ? KIND_KEYS : undefined);
    }
  }
  if ("fields" in t) {
    if (!Array.isArray(t.fields)) add(`${at}.fields`, "bad-value", "fields должно быть списком полей [ … ].");
    else {
      const seenField = new Set();
      t.fields.forEach((f, j) => fieldShape(f, j, t, existing, at, seenField, add));
    }
  }
  if ("items" in t) {
    if (!Array.isArray(t.items)) add(`${at}.items`, "bad-value", "items должно быть списком пунктов [ … ].");
    else {
      if (t.items.length > LIMITS.items) add(`${at}.items`, "limit", `В треке ${q(t.key)} пунктов больше ${LIMITS.items}. Оставьте самые нужные.`);
      const seenItem = new Set();
      t.items.forEach((item, j) => itemShape(item, j, t, existing, at, seenItem, add));
    }
  }
}

function fieldShape(f, j, t, existing, at, seen, add) {
  if (!isObj(f)) return add(`${at}.fields[${j}]`, "bad-value", "Поле должно быть объектом {\"key\":…,\"name\":…,\"type\":…}.");
  const path = `${at}.fields.${f.key ?? j}`;
  if (!keyIssue("field", f.key, `${path}.key`, `поля в треке ${q(t.key)}`, add, seen)) return;
  if (RESERVED.includes(f.key)) return add(`${path}.key`, "reserved-key", `Ключ поля ${q(f.key)} зарезервирован (${RESERVED.join(", ")}): так называются величины, которые считает приложение. Возьмите другой ключ, например ${f.key}_value.`);
  unknownKeys(f, FIELD_ATTRS, path, `поля ${q(f.key)}`, add);
  for (const [name, attr] of Object.entries(FIELD_ATTRS)) if (name !== "key" && name in f) checkValue(f[name], attr, `${path}.${name}`, name, add, `поля ${q(f.key)}`);
  if (!existing?.fields?.some((x) => x.key === f.key)) {
    for (const name of ["name", "type"]) if (!(name in f)) add(`${path}.${name}`, "missing-attr", `Поле ${q(f.key)} новое, и ему нужны name и type. type: ${FIELD_TYPE_KEYS.join(", ")}.`, name === "type" ? FIELD_TYPE_KEYS : undefined);
  }
}

function itemShape(item, j, t, existing, at, seen, add) {
  if (!isObj(item)) return add(`${at}.items[${j}]`, "bad-value", "Пункт должен быть объектом {\"name\":…,\"every\":…}.");
  const path = `${at}.items.${item.key ?? j}`;
  if (!keyIssue("item", item.key, `${path}.key`, `пункта в треке ${q(t.key)}`, add, seen)) return;
  unknownKeys(item, ITEM_ATTRS, path, `пункта ${q(item.key)}`, add);
  for (const [name, attr] of Object.entries(ITEM_ATTRS)) if (!["key", "every", "at"].includes(name) && name in item) checkValue(item[name], attr, `${path}.${name}`, name, add, `пункта ${q(item.key)}`);
  if (!("name" in item) && !existing?.items?.some((x) => x.key === item.key)) add(`${path}.name`, "missing-attr", `У нового пункта ${q(item.key)} нет name.`);
  if ("every" in item && !isEvery(item.every)) add(`${path}.every`, "bad-value", `every=${JSON.stringify(item.every)} не подходит. Допустимо: day, weekdays, weekends, список дней вроде mon,wed,fri (в порядке недели), 2d…30d, open или дата ГГГГ-ММ-ДД. Время суток пишется отдельно: at="morning".`, [...Object.keys(EVERY.words), "mon,wed,fri", "2d…30d", "ГГГГ-ММ-ДД"]);
  if ("at" in item && !isAt(item.at)) add(`${path}.at`, "bad-value", `at=${JSON.stringify(item.at)} не подходит. Допустимо: ${Object.keys(AT.words).join(", ")} или время ЧЧ:ММ. Это порядок в списке, не будильник.`, Object.keys(AT.words));
}

function screenShape(s, i, spec, seen, seenCard, add) {
  if (!isObj(s)) return add(`screens[${i}]`, "bad-value", "Экран должен быть объектом {\"key\":…,\"cards\":[…]}.");
  const at = `screens.${s.key ?? i}`;
  if (!keyIssue("screen", s.key, `${at}.key`, "экрана", add, seen)) return;
  unknownKeys(s, SCREEN_ATTRS, at, `экрана ${q(s.key)}`, add);
  for (const [name, attr] of Object.entries(SCREEN_ATTRS)) if (name !== "key" && name !== "cards" && name in s) checkValue(s[name], attr, `${at}.${name}`, name, add, `экрана ${q(s.key)}`);
  if (!spec.screens[s.key] && s.key !== "home" && !("name" in s)) add(`${at}.name`, "missing-attr", `Экрана ${q(s.key)} нет, значит это новый экран, и ему нужно name.`);
  if (Array.isArray(s.order) && s.order.some((k) => typeof k !== "string")) add(`${at}.order`, "bad-value", "В order нужны ключи карточек строками [\"a\",\"b\"].");
  if (!("cards" in s)) return;
  if (!Array.isArray(s.cards)) return add(`${at}.cards`, "bad-value", "cards должно быть списком карточек [ … ].");
  if (s.cards.length > LIMITS.cards) add(`${at}.cards`, "limit", `На экране ${q(s.key)} карточек больше ${LIMITS.cards}. Разбейте экран на два.`);
  s.cards.forEach((c, j) => cardShape(c, j, s, spec, seenCard, at, add));
}

function cardShape(c, j, screen, spec, seen, at, add) {
  if (!isObj(c)) return add(`${at}.cards[${j}]`, "bad-value", "Карточка должна быть объектом {\"title\":…,\"body\":[…]}.");
  const path = `${at}.cards.${c.key ?? j}`;
  if (!keyIssue("card", c.key, `${path}.key`, "карточки", add, seen)) return;
  unknownKeys(c, CARD_ATTRS, path, `карточки ${q(c.key)}`, add);
  for (const [name, attr] of Object.entries(CARD_ATTRS)) if (name !== "key" && name !== "body" && name in c) checkValue(c[name], attr, `${path}.${name}`, name, add, `карточки ${q(c.key)}`);
  const existing = spec.cards[c.key];
  if (!existing) {
    const keys = live(spec.cards).map((x) => x.key);
    for (const name of ["title", "body"]) if (!(name in c)) add(`${path}.${name}`, "missing-attr", `Карточки ${q(c.key)} нет, значит это новая карточка, и ей нужен ${name}.${keys.length ? ` Если хотели изменить существующую, её ключи: ${words(nearest(c.key, keys).slice(0, 8))}.` : ""}`);
  }
  if (!("body" in c)) return;
  if (!Array.isArray(c.body) || !c.body.length) return add(`${path}.body`, "bad-value", "body должно быть непустым списком элементов [{\"el\":…}].");
  if (c.body.length > LIMITS.elements) add(`${path}.body`, "limit", `В карточке ${q(c.key)} элементов больше ${LIMITS.elements}. Вынесите лишние в другую карточку.`);
  c.body.forEach((el, k) => elementShape(el, k, c, path, add));
}

function elementShape(el, k, card, path, add) {
  const at = `${path}.body[${k}]`;
  if (!isObj(el)) return add(at, "bad-value", "Элемент должен быть объектом {\"el\":\"meter\",\"of\":…}.");
  const spec = ELEMENTS[el.el];
  if (!spec) return add(`${at}.el`, "unknown-element", `Элемента ${q(el.el)} нет. Допустимы: ${ELEMENT_KEYS.join(", ")}.`, ELEMENT_KEYS);
  for (const name of Object.keys(el)) {
    if (name === "el" || name in spec.attrs) continue;
    const hint = name === "goal" || name === "goalType" ? " Цель задаётся один раз в поле трека (goal в объявлении поля), а не в элементе." : name === "set" ? " Данные берутся из трека: of=\"ключ трека\"." : "";
    add(`${at}.${name}`, "unknown-attr", `У ${spec.tag} нет атрибута ${q(name)}.${hint} Допустимо: ${Object.keys(spec.attrs).join(", ") || "никаких"}.`, Object.keys(spec.attrs));
  }
  for (const [name, attr] of Object.entries(spec.attrs)) {
    if (name in el) checkValue(el[name], attr, `${at}.${name}`, name, add, spec.tag);
    else if (attr.required) add(`${at}.${name}`, "missing-attr", `У ${spec.tag} нет обязательного атрибута ${q(name)}: ${attr.doc}. Пример: ${name}: ${JSON.stringify(attr.example)}.`);
  }
}

function removalShape(r, i, add) {
  const at = `remove[${i}]`;
  if (!isObj(r)) return add(at, "bad-value", "Удаление должно быть объектом {\"card\":\"ключ\"}.");
  const keys = Object.keys(r);
  if (keys.length !== 1 || !(keys[0] in REMOVAL_KINDS)) return add(at, "bad-removal", `В удалении ровно один ключ из ${Object.keys(REMOVAL_KINDS).join(", ")}, например {"card":"weight_chart"}.`, Object.keys(REMOVAL_KINDS));
  const [kind] = keys;
  if (typeof r[kind] !== "string") return add(`${at}.${kind}`, "bad-value", `${kind}: нужно ${REMOVAL_KINDS[kind]}.`);
  const parts = r[kind].split(".");
  if ((kind === "item" || kind === "field") && parts.length !== 2) add(`${at}.${kind}`, "bad-value", `${kind}: нужно ${REMOVAL_KINDS[kind]}.`);
}

// ===== pass 2: references and kind rules ============================================
function referencePass(bundle, spec, merged, add) {
  const declaredTracks = new Set((bundle.tracks || []).map((t) => t.key));
  const removed = removalChecks(bundle, spec, add);
  for (const decl of bundle.tracks || []) trackRules(decl, spec, merged, add);

  const declaredCards = new Set();
  for (const screen of bundle.screens || []) {
    for (const card of screen.cards || []) {
      declaredCards.add(card.key);
      const before = spec.cards[card.key];
      if (before && !before.archived && before.screen !== screen.key) {
        add(`screens.${screen.key}.cards.${card.key}.key`, "card-moved", `Карточка ${q(card.key)} уже есть на экране ${q(before.screen)}, ключ карточки один на всё приложение. Дайте новой карточке другой ключ, например ${card.key}_2.`);
      }
      if (removed.cards.has(card.key)) add(`screens.${screen.key}.cards.${card.key}.key`, "remove-and-declare", `Карточка ${q(card.key)} и объявлена, и убирается в одном пакете. Оставьте что-то одно.`);
      (card.body || []).forEach((el, i) => elementRules(el, `screens.${screen.key}.cards.${card.key}.body[${i}]`, merged, add));
    }
  }
  for (const screen of bundle.screens || []) orderRules(screen, merged, add);
  // Cards the bundle did not write but whose track it changed must still hold.
  for (const card of live(merged.cards)) {
    if (declaredCards.has(card.key)) continue;
    const touched = (card.body || []).some((el) => declaredTracks.has(el.of));
    if (!touched || !spec.cards[card.key]) continue;
    (card.body || []).forEach((el, i) => {
      if (!declaredTracks.has(el.of)) return;
      const before = [];
      elementRules(el, `cards.${card.key}.body[${i}]`, merged, (path, rule, message, allowed) => before.push({ path, rule, message: `Карточка ${q(card.key)} уже есть и перестала подходить: ${message} Исправьте её в этом же пакете или уберите (remove card).`, allowed }));
      for (const p of before) add(p.path, p.rule, p.message, p.allowed);
    });
  }
}

// order lists the keys of cards that stand on the screen once the bundle is merged.
function orderRules(screen, merged, add) {
  if (!Array.isArray(screen.order)) return;
  const here = live(merged.cards).filter((c) => c.screen === screen.key).sort((a, b) => a.order - b.order).map((c) => c.key);
  const path = `screens.${screen.key}.order`;
  for (const key of screen.order) {
    if (!here.includes(key)) add(path, "unknown-key", `На экране ${q(screen.key)} нет карточки ${q(key)}. Карточки экрана: ${words(here, 20) || "нет ни одной"}. Скопируйте ключи из списка.`, here);
  }
  if (new Set(screen.order).size !== screen.order.length) add(path, "bad-value", "В order ключи не повторяются.");
}

function removalChecks(bundle, spec, add) {
  const removed = { cards: new Set(), tracks: new Set() };
  (bundle.remove || []).forEach((r, i) => {
    const at = `remove[${i}]`;
    const [kind] = Object.keys(r);
    const value = r[kind];
    const [first, second] = value.split(".");
    switch (kind) {
      case "card": {
        const cards = live(spec.cards).map((c) => c.key);
        if (!cards.includes(value)) add(`${at}.card`, "unknown-key", `Карточки ${q(value)} нет. Карточки в пространстве: ${words(nearest(value, cards), 20) || "нет ни одной"}. Скопируйте ключ из списка.`, cards);
        removed.cards.add(value);
        break;
      }
      case "track": {
        const tracks = Object.values(spec.tracks).filter((t) => !t.readonly && !t.archived).map((t) => t.key);
        if (!tracks.includes(value)) add(`${at}.track`, "unknown-key", `Трека ${q(value)} нет. Треки в пространстве: ${words(nearest(value, tracks), 20) || "нет ни одного"}. Классические разделы убрать нельзя.`, tracks);
        removed.tracks.add(value);
        break;
      }
      case "screen": {
        const screens = live(spec.screens).map((s) => s.key).filter((k) => k !== "home");
        if (value === "home") add(`${at}.screen`, "bad-value", "Главный экран home убрать нельзя: уберите его карточки по одной (remove card).");
        else if (!screens.includes(value)) add(`${at}.screen`, "unknown-key", `Экрана ${q(value)} нет. Экраны в пространстве: ${words(nearest(value, screens), 20) || "нет ни одного"}.`, screens);
        break;
      }
      case "item": {
        const track = spec.tracks[first];
        const keys = (track?.items || []).filter((x) => !x.archived).map((x) => x.key);
        if (!track || track.readonly || track.archived) add(`${at}.item`, "unknown-key", `Трека ${q(first)} нет. Пишите item в виде трек.пункт, например vitamins.vit_d.`);
        else if (!keys.includes(second)) add(`${at}.item`, "unknown-key", `Пункта ${q(second)} в треке ${q(first)} нет. Пункты: ${words(nearest(second, keys), 20) || "нет ни одного"}.`, keys);
        break;
      }
      case "field": {
        const track = spec.tracks[first];
        const keys = (track?.fields || []).map((x) => x.key);
        if (!track || track.readonly || track.archived) add(`${at}.field`, "unknown-key", `Трека ${q(first)} нет. Пишите field в виде трек.поле, например bench.note.`);
        else if (!keys.includes(second)) add(`${at}.field`, "unknown-key", `Поля ${q(second)} в треке ${q(first)} нет. Поля: ${words(nearest(second, keys), 20) || "нет ни одного"}.`, keys);
        else {
          const reader = track.fields.find((f) => f.type === "calc" && f.key !== second && formulaVars(f.calc).has(second));
          if (reader && !(bundle.remove || []).some((x) => x.field === `${first}.${reader.key}`)) {
            add(`${at}.field`, "field-in-use", `Поле ${q(second)} читает расчётное поле ${q(reader.key)}. Уберите и его тоже: добавьте {"field":"${first}.${reader.key}"}.`);
          }
        }
        break;
      }
      default:
    }
  });
  return removed;
}

const formulaVars = (calc) => { try { return formulaRefs(parseFormula(calc)).vars; } catch { return new Set(); } };

function trackRules(decl, spec, merged, add) {
  const track = merged.tracks[decl.key];
  const before = spec.tracks[decl.key];
  const at = `tracks.${decl.key}`;
  if (before && decl.kind && decl.kind !== before.kind) {
    add(`${at}.kind`, "kind-change", `Трек ${q(decl.key)} уже создан как ${before.kind}, рецепт менять нельзя. Заведите новый трек с другим ключом, а этот уберите (remove track), если он не нужен.`);
    return;
  }
  for (const name of Object.keys(decl)) {
    const attr = TRACK_ATTRS[name];
    if (attr?.kinds && !attr.kinds.includes(track.kind)) {
      add(`${at}.${name}`, "kind-attr", `Атрибут ${q(name)} есть только у ${attr.kinds.map((k) => `kind=${k}`).join(", ")}, а ${q(decl.key)} имеет kind=${track.kind}. Уберите ${name}${name === "items" ? " (для пунктов возьмите kind=habit или list)" : ""}.`, attr.kinds);
    }
  }
  if (track.kind === "follow" && !track.follows) add(`${at}.follows`, "missing-attr", `Трек follow привязан к приёмам Рациона или тренировкам Спорта, поэтому ему нужен follows: ration или sport.`, ["ration", "sport"]);
  if ((track.times != null) !== (track.per != null)) add(`${at}.${track.times != null ? "per" : "times"}`, "missing-attr", "times и per пишутся вместе: сколько отметок в период (times) и за какой период (per: day или week).");
  if (track.states && MARK_KINDS.includes(track.kind)) {
    if (!track.states.includes("done")) add(`${at}.states`, "bad-value", "В states должна быть кнопка done («сделано»): без неё нечего отмечать.", ["done"]);
    if (new Set(track.states).size !== track.states.length) add(`${at}.states`, "bad-value", "В states кнопки не повторяются.");
    for (const key of Object.keys(track.labels || {})) if (!track.states.includes(key)) add(`${at}.labels.${key}`, "bad-value", `Подпись для ${q(key)} не нужна: этой кнопки в states нет (${track.states.join(", ")}).`, track.states);
  }
  if (track.fields.length > LIMITS.fields) add(`${at}.fields`, "limit", `В треке ${q(track.key)} полей больше ${LIMITS.fields}. Оставьте самые нужные.`);
  if (liveItemsOf(track).length > LIMITS.items) add(`${at}.items`, "limit", `В треке ${q(track.key)} пунктов больше ${LIMITS.items}. Уберите лишние (remove item).`);
  for (const f of decl.fields || []) fieldRules(track, before, f, merged, add);
  for (const item of decl.items || []) itemRules(track, item, add);
}

const liveItemsOf = (track) => (track.items || []).filter((i) => !i.archived);

// Lists in the markup surface are comma-separated, so a comma inside one entry splits it in two.
function commaRule(text, path, what, add) {
  if (typeof text === "string" && text.includes(",")) {
    add(path, "comma", `${what} ${q(text)} содержит запятую, а списки в разметке пишутся через запятую: запись разорвётся на две. Уберите запятую или замените её словом, например ${q(text.replace(/\s*,\s*/g, " и "))}.`);
  }
}

function fieldRules(track, before, decl, merged, add) {
  const field = track.fields.find((f) => f.key === decl.key);
  if (!field) return;
  const path = `tracks.${track.key}.fields.${field.key}`;
  const info = FIELD_TYPES[field.type];
  if (!info) return;
  const previous = before?.fields?.find((f) => f.key === field.key);
  const retired = before?.usage?.retired?.[field.key];
  if (previous && previous.type !== field.type && (before.usage?.fields?.[field.key] || 0) > 0) {
    add(`${path}.type`, "type-change-used", `У поля ${q(field.key)} уже есть записи (${before.usage.fields[field.key]}), тип ${previous.type} менять нельзя. Добавьте новое поле с другим ключом, а это уберите (remove field), если не нужно.`);
  }
  if (!previous && retired && retired.type !== field.type && retired.used > 0) {
    add(`${path}.type`, "type-change-used", `Поле ${q(field.key)} когда-то было убрано, но его значения (${retired.used}) остались как ${retired.type}. Верните тип ${retired.type} или возьмите другой ключ поля.`);
  }
  for (const name of Object.keys(decl)) {
    if (["key", "name", "type"].includes(name)) continue;
    if (!info.attrs.includes(name)) add(`${path}.${name}`, "field-attr", `Атрибут ${q(name)} не подходит полю типа ${field.type}. У ${field.type} допустимы: ${info.attrs.join(", ")}.`, info.attrs);
  }
  for (const name of Object.keys(field)) {
    if (["key", "name", "type", "optionIds"].includes(name) || decl[name] !== undefined || info.attrs.includes(name)) continue;
    add(`${path}.${name}`, "field-attr", `После изменения типа поле ${q(field.key)} (${field.type}) сохранило атрибут ${q(name)}, который ему не подходит. Допустимы: ${info.attrs.join(", ")}.`);
  }
  if (track.kind === "catalog" && field.type === "calc") add(`${path}.type`, "kind-attr", "Расчётные поля (calc) в справочнике не нужны: строки справочника только хранят значения. Возьмите number.");
  if (("on" in decl) && !MARK_KINDS.includes(track.kind)) add(`${path}.on`, "kind-attr", `on (при каких отметках спрашивать поле) есть только у habit, list и follow, а ${q(track.key)} имеет kind=${track.kind}. Уберите on.`);
  if (("planned" in decl) && !["habit", "list"].includes(track.kind)) add(`${path}.planned`, "kind-attr", `planned (плановое значение у пункта) есть только у habit и list, а ${q(track.key)} имеет kind=${track.kind}. Уберите planned.`);
  if (field.type === "choice") (field.options || []).forEach((option) => commaRule(option, `${path}.options`, "Вариант", add));
  if (field.type === "scale") (field.labels || []).forEach((label) => commaRule(label, `${path}.labels`, "Подпись шкалы", add));
  if (field.type === "choice") {
    const options = field.options || [];
    if (options.length < 2 || options.length > LIMITS.options) add(`${path}.options`, "bad-value", `У поля choice нужно от 2 до ${LIMITS.options} вариантов в options (сейчас ${options.length}). Пример: ["утром","вечером"].`);
    if (new Set(options).size !== options.length || options.some((o) => typeof o !== "string" || !o.trim() || o.length > LIMITS.optionChars)) add(`${path}.options`, "bad-value", `Варианты options — разные непустые строки до ${LIMITS.optionChars} символов.`);
  }
  if (field.min != null && field.max != null && field.min > field.max) add(`${path}.min`, "bad-value", `min=${field.min} больше max=${field.max}. Поменяйте их местами.`);
  if (field.type === "scale") {
    const steps = (field.max ?? 5) - (field.min ?? 1) + 1;
    if (steps < 2 || steps > 11 || !Number.isInteger(steps)) add(`${path}.max`, "bad-value", "Шкала scale имеет от 2 до 11 целых шагов, например min=1, max=5.");
    else if (field.labels && field.labels.length !== steps) add(`${path}.labels`, "bad-value", `Подписей labels ${field.labels.length}, а шагов шкалы ${steps}. Напишите по одной подписи на шаг (пустая строка пропускает).`);
  }
  if (field.goal != null && !(field.goal > 0)) add(`${path}.goal`, "bad-value", "goal должен быть больше нуля. Чтобы убрать цель, напишите goal: 0.");
  if (field.goal != null && !NUMERIC_TYPES.includes(field.type)) add(`${path}.goal`, "bad-value", `Цель можно поставить только числовому полю (${NUMERIC_TYPES.join(", ")}), а ${q(field.key)} имеет тип ${field.type}.`);
  if ((decl.goalType !== undefined || decl.goalPer !== undefined) && field.goal == null) add(`${path}.goal`, "missing-attr", "goalType и goalPer работают только вместе с goal. Добавьте goal или уберите их.");
  if (field.type === "calc") calcRules(track, field, path, add);
  if (field.type === "link") {
    const target = merged.tracks[field.to];
    if (field.to === "product") return;
    const catalogs = Object.values(merged.tracks).filter((t) => t.kind === "catalog" && !t.archived).map((t) => t.key);
    if (!target || target.archived || target.kind !== "catalog") {
      add(`${path}.to`, "unknown-key", `Поле link ссылается на ${q(field.to)}, а такого справочника нет. Справочники (kind=catalog) в пространстве и пакете: ${words(catalogs) || "нет ни одного"}; можно также product. Объявите справочник в этом же пакете.`, [...catalogs, "product"]);
    }
  }
}

function calcRules(track, field, path, add) {
  let ast;
  try { ast = parseFormula(field.calc); } catch (error) {
    return add(`${path}.calc`, "bad-calc", `Формула ${q(field.calc)} не читается: ${error.message}. Формула — числа, ключи полей этого трека, + - * /, скобки и функции ${CALC_FUNCTIONS.join(", ")}.`);
  }
  if (field.calc.length > LIMITS.formula) return add(`${path}.calc`, "bad-calc", `Формула длиннее ${LIMITS.formula} символов. Упростите.`);
  const refs = formulaRefs(ast);
  const keys = track.fields.map((f) => f.key);
  for (const fn of refs.calls) {
    if (!hasFunction(fn) || !CALC_FUNCTIONS.includes(fn)) add(`${path}.calc`, "bad-calc", `Функции ${q(fn)} в calc нет. Допустимы: ${CALC_FUNCTIONS.join(", ")}.`, CALC_FUNCTIONS);
  }
  if (refs.fields.size) add(`${path}.calc`, "bad-calc", "В calc нельзя ходить по точке (a.b): формула читает только поля своего трека по ключу.");
  for (const name of refs.vars) {
    if (name === "date" || name === "today") continue;
    if (name === field.key) add(`${path}.calc`, "bad-calc", `Поле ${q(field.key)} читает само себя. Считайте по другим полям: ${words(keys.filter((k) => k !== field.key)) || "их пока нет"}.`);
    else if (!keys.includes(name)) add(`${path}.calc`, "bad-calc", `В calc есть ${q(name)}, а такого поля в треке ${q(track.key)} нет. Поля трека: ${words(keys.filter((k) => k !== field.key)) || "нет других"}. Формула читает только поля своего трека.`, keys);
  }
  // a cycle among calc fields
  const calcs = Object.fromEntries(track.fields.filter((f) => f.type === "calc").map((f) => [f.key, f.calc]));
  const seen = new Set();
  const walk = (key, trail) => {
    if (trail.includes(key)) return add(`${path}.calc`, "bad-calc", `Расчётные поля читают друг друга по кругу (${[...trail, key].join(" → ")}). Разорвите круг.`);
    if (seen.has(key) || !calcs[key]) return;
    seen.add(key);
    for (const name of formulaVars(calcs[key])) walk(name, [...trail, key]);
  };
  walk(field.key, []);
}

function itemRules(track, decl, add) {
  const item = track.items.find((i) => i.key === decl.key);
  if (!item) return;
  const path = `tracks.${track.key}.items.${item.key}`;
  commaRule(item.name, `${path}.name`, "Название пункта", add);
  if (track.kind === "catalog") {
    for (const name of ["every", "at", "from", "until"]) if (name in decl) add(`${path}.${name}`, "kind-attr", `Строки справочника не имеют расписания: ${name} не нужен. Оставьте name и plan.`);
  }
  if (track.kind === "list" && "every" in decl && decl.every !== "open" && !isDate(decl.every)) add(`${path}.every`, "kind-attr", "В списке пункты без расписания (every: open). Для повторяющихся дел возьмите kind=habit.");
  if (item.from && item.until && item.from > item.until) add(`${path}.until`, "bad-value", `until=${item.until} раньше from=${item.from}. Поменяйте даты.`);
  for (const [key, value] of Object.entries(decl.plan || {})) {
    const field = track.fields.find((f) => f.key === key);
    const keys = track.fields.filter((f) => f.type !== "calc" && (track.kind === "catalog" || f.planned)).map((f) => f.key);
    if (!field) { add(`${path}.plan.${key}`, "unknown-key", `В треке ${q(track.key)} нет поля ${q(key)}. Поля, которым можно задать план: ${words(keys) || "нет таких"}.`, keys); continue; }
    if (field.type === "calc") { add(`${path}.plan.${key}`, "bad-value", `Поле ${q(key)} расчётное, плана у него нет.`); continue; }
    if (track.kind !== "catalog" && !field.planned) { add(`${path}.plan.${key}`, "bad-value", `Поле ${q(key)} не плановое. Добавьте planned: true в объявление поля ${q(key)}.`); continue; }
    const problem = valueProblem(field, value);
    if (problem) add(`${path}.plan.${key}`, "bad-value", `План ${q(key)}=${JSON.stringify(value)}: ${problem}`);
  }
}

// Whether a literal fits a field: null when it does, else the reason.
function valueProblem(field, value) {
  switch (field.type) {
    case "number": case "scale":
      if (typeof value !== "number" || !Number.isFinite(value)) return `нужно число${field.unit ? ` в ${field.unit}` : ""}.`;
      if (field.min != null && value < field.min) return `не меньше ${field.min}.`;
      if (field.max != null && value > field.max) return `не больше ${field.max}.`;
      return null;
    case "choice": return field.options?.includes(value) ? null : `нужен один из вариантов: ${words(field.options || [])}.`;
    case "yesno": return typeof value === "boolean" ? null : "нужно true или false.";
    case "text": return typeof value === "string" ? null : "нужен текст.";
    case "time": return typeof value === "string" && AT_TIME.test(value) ? null : "нужно время ЧЧ:ММ.";
    case "date": return isDate(value) ? null : "нужна дата ГГГГ-ММ-ДД.";
    default: return null;
  }
}
const AT_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// -- elements ---------------------------------------------------------------------
function bucketCount(token, by) {
  const { from, to } = resolveRange(token, "2026-06-15");
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (by === "week") return Math.ceil((days + ((new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7)) / 7);
  if (by === "month") return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
  return days;
}

function trackFor(el, merged, path, add) {
  const keys = Object.values(merged.tracks).filter((t) => !t.archived).map((t) => t.key);
  const track = merged.tracks[el.of];
  if (!track || track.archived) {
    const near = nearest(el.of, keys).slice(0, 8);
    add(`${path}.of`, "unknown-key", track?.archived
      ? `Трек ${q(el.of)} убирается в этом пакете, показывать его нельзя. Уберите и элемент.`
      : `Трека ${q(el.of)} нет. Ключи треков и классических разделов: ${words(near, 20)}. Новый трек объявите в tracks этого же пакета.`, keys);
    return null;
  }
  return track;
}

function resolveValue(track, name) {
  const field = track.fields.find((f) => f.key === name);
  if (field) return { field, numeric: Boolean(field.virtual) || FIELD_TYPES[field.type]?.numeric };
  if (track.readonly) return null;
  if (name in VIRTUAL.any) return { virtual: name, numeric: true };
  if (MARK_KINDS.includes(track.kind) && VIRTUAL.marks.kinds.includes(track.kind) && name in VIRTUAL.marks.values) return { virtual: name, numeric: true };
  return null;
}

const valuesOf = (track) => [
  ...track.fields.map((f) => f.key),
  ...(track.readonly ? [] : Object.keys(VIRTUAL.any)),
  ...(!track.readonly && VIRTUAL.marks.kinds.includes(track.kind) ? Object.keys(VIRTUAL.marks.values) : []),
];

function columnsFor(track) {
  const cols = [];
  if (track.kind !== "catalog") cols.push("date");
  if (MARK_KINDS.includes(track.kind) && track.kind !== "follow") cols.push("item");
  if (MARK_KINDS.includes(track.kind)) cols.push("state");
  if (track.kind === "follow") cols.push("slot");
  if (track.kind === "catalog") cols.push("name");
  return cols;
}

function elementRules(el, path, merged, add) {
  const spec = ELEMENTS[el.el];
  if (!spec || spec.noTrack || spec.text) return;
  if (!el.of) return;
  const track = trackFor(el, merged, path, add);
  if (!track) return;
  const label = spec.tag;
  const fields = track.fields;
  if (track.readonly && !spec.sources) {
    return add(`${path}.of`, "source-readonly", `${q(el.of)} — классический раздел: приложение его только читает, записывать или отмечать в нём элементом нельзя. Для ${label} возьмите свой трек; из ${el.of} можно показывать числа элементами stat, meter, bars, line, spark и heatmap.`);
  }
  if (!track.readonly && !spec.kinds.includes(track.kind)) {
    return add(`${path}.el`, "kind-element", `${label} не работает с треком ${q(track.key)} (kind=${track.kind}). Он подходит для: ${spec.kinds.join(", ")}.${el.el === "marks" || el.el === "streak" ? " Привычки и списки отмечаются, журнал записывается формой form или кнопкой quick." : ""}`, spec.kinds);
  }
  if (spec.display && spec.bound) {
    const rangeOptional = !spec.needsRange || (spec.rangeUnlessCatalog && track.kind === "catalog");
    if (!el.range && !rangeOptional) add(`${path}.range`, "missing-attr", `У ${label} нет range: период нужен каждому элементу с данными. Допустимо: ${RANGE_TOKENS.join(", ")}.`, RANGE_TOKENS);
  }
  if (spec.needsValue) {
    if (!el.value && el.fn !== "count") add(`${path}.value`, "missing-attr", `У ${label} нет value: что считать. Поля трека ${q(track.key)} и величины: ${words(valuesOf(track))}. Либо укажите fn: "count" для числа записей.`, valuesOf(track));
  }
  if (el.value) {
    const target = resolveValue(track, el.value);
    if (!target) {
      add(`${path}.value`, "unknown-key", `В треке ${q(track.key)} нет поля или величины ${q(el.value)}. Поля: ${words(fields.map((f) => f.key)) || "нет"}; величины: ${words(valuesOf(track).filter((k) => !fields.some((f) => f.key === k)))}. Напишите value: ${JSON.stringify(nearest(el.value, valuesOf(track))[0] ?? "ml")}.`, valuesOf(track));
    } else {
      const fn = el.fn || "sum";
      if (!target.numeric && fn !== "count" && spec.needsValue) {
        const numeric = fields.filter((f) => FIELD_TYPES[f.type]?.numeric || f.virtual).map((f) => f.key);
        add(`${path}.fn`, "fn-not-numeric", `Поле ${q(el.value)} (${target.field.type}) не число: fn=${fn} его не считает. Возьмите числовое поле (${words(numeric) || "в треке нет числовых"}) или fn: "count".`, numeric);
      }
      if (el.el === "meter") meterRules(track, el, target, path, add);
    }
  } else if (el.el === "meter") add(`${path}.value`, "missing-attr", `meter показывает значение против цели, ему нужен value — поле с целью.`);
  if (track.kind === "catalog" && el.el === "stat" && el.fn !== "count") add(`${path}.fn`, "kind-element", `У справочника ${q(track.key)} stat считает строки: напишите fn: "count".`, ["count"]);
  if (el.where) whereRules(track, el.where, path, add, merged);
  if (el.category) {
    const field = fields.find((f) => f.key === el.category);
    const splits = fields.filter((f) => f.type === "choice" || f.type === "link").map((f) => f.key);
    if (!field || !["choice", "link"].includes(field.type)) add(`${path}.category`, "unknown-key", `Разбить на ряды можно по полю choice или link. В треке ${q(track.key)} такие поля: ${words(splits) || "нет ни одного"}.`, splits);
  }
  if (spec.display && el.range && ["bars", "line", "spark", "heatmap"].includes(el.el) && RANGE_TOKENS.includes(el.range)) bucketRules(el, path, add);
  if (spec.rows) rowRules(track, el, path, add);
  if (el.el === "quick") quickRules(track, el, path, add);
  if (el.el === "form") formRules(track, el, path, add);
  if (el.el === "list" && el.add && !["catalog", "list"].includes(track.kind)) add(`${path}.add`, "kind-element", `add у list добавляет строку справочника или пункт списка; у трека ${q(track.key)} (kind=${track.kind}) записи вносит form или quick. Уберите add.`);
  if (el.el === "marks" && el.add && !["habit", "list"].includes(track.kind)) add(`${path}.add`, "kind-element", "add разрешает добавлять пункты на месте и работает у habit и list.");
  if (el.el === "streak") {
    const goal = fields.some((f) => f.goal != null);
    if (track.kind !== "habit" && !goal) add(`${path}.of`, "kind-element", `streak считает дни по привычке или по цели поля. Добавьте goal в объявление поля трека ${q(track.key)} или возьмите kind=habit.`);
  }
}

function meterRules(track, el, target, path, add) {
  if (track.readonly) return;
  if (target.field && target.field.goal == null) {
    add(`${path}.value`, "no-goal", `У поля ${q(target.field.key)} трека ${q(track.key)} нет цели, а meter её требует. Добавьте goal в объявление поля ${q(target.field.key)} или возьмите stat.`);
  } else if (target.virtual) {
    add(`${path}.value`, "no-goal", `${q(el.value)} — величина без цели, meter её не показывает. Возьмите stat, а для meter — поле с goal.`);
  }
}

function whereRules(track, where, path, add, merged) {
  if (track.readonly) return add(`${path}.where`, "where-source", `У классического раздела ${q(track.key)} нет полей для where. Уберите where.`);
  for (const [key, value] of Object.entries(where)) {
    const field = track.fields.find((f) => f.key === key);
    const keys = track.fields.filter((f) => f.type !== "calc").map((f) => f.key);
    if (!field) { add(`${path}.where.${key}`, "unknown-key", `В треке ${q(track.key)} нет поля ${q(key)} для where. Поля: ${words(keys)}.`, keys); continue; }
    if (field.type === "choice" && !field.options?.includes(String(value))) add(`${path}.where.${key}`, "bad-value", `Вариант ${q(value)} не из списка поля ${q(key)}: ${words(field.options || [])}.`, field.options);
    if (field.type === "yesno" && typeof value !== "boolean") add(`${path}.where.${key}`, "bad-value", `Для поля yesno в where нужно true или false.`);
    const rows = field.type === "link" && field.to !== "product" ? merged.tracks[field.to]?.items?.filter((i) => !i.archived) : null;
    if (rows && !rows.some((i) => i.key === value || i.name === value)) {
      add(`${path}.where.${key}`, "bad-value", `В справочнике ${q(field.to)} нет строки ${q(value)}. Ключи строк: ${words(rows.map((i) => i.key)) || "справочник пока пуст"}. Напишите where: {"${key}": "${nearest(String(value), rows.map((i) => i.key))[0] ?? "ключ"}"}.`, rows.map((i) => i.key));
    }
  }
}

function bucketRules(el, path, add) {
  const by = el.by || "day";
  const bucket = el.el === "heatmap" || el.el === "spark" ? "day" : by;
  const n = bucketCount(el.range, bucket);
  if (el.el === "bars" && n < 2) add(`${path}.range`, "range-too-short", "Для столбцов нужно хотя бы два периода: возьмите @last7d, @last30d или @last12w.");
  if (el.el === "bars" && n > LIMITS.bars) add(`${path}.by`, "too-many-points", `Столбцов получается ${n}, а читаются не больше ${LIMITS.bars}. Возьмите by: "week" или by: "month", или период короче.`, ["week", "month"]);
  if (el.el === "line" && n < 3) add(`${path}.range`, "range-too-short", "Для линии нужно хотя бы три точки: возьмите период @last7d или длиннее.");
  if (el.el === "line" && n > LIMITS.points) add(`${path}.by`, "too-many-points", `Точек получается ${n}, а нужно не больше ${LIMITS.points}. Возьмите by: "week".`, ["week"]);
  if (el.el === "spark" && n < 3) add(`${path}.range`, "range-too-short", "Мини-график нужен хотя бы на три дня: возьмите @last7d или @last30d.");
  if (el.el === "heatmap" && (n < 14 || n > LIMITS.heatmapDays)) add(`${path}.range`, "range-too-short", `Календарь показывает от 14 дней до 27 недель: возьмите @last12w или @last90d.`, ["@last12w", "@last90d"]);
}

function rowRules(track, el, path, add) {
  const allowed = [...columnsFor(track), ...track.fields.map((f) => f.key)];
  for (const column of el.columns || []) {
    if (!allowed.includes(column)) add(`${path}.columns`, "unknown-key", `Столбца ${q(column)} нет. У трека ${q(track.key)} столбцы: ${words(allowed)}.`, allowed);
  }
  if (new Set(el.columns || []).size !== (el.columns || []).length) add(`${path}.columns`, "bad-value", "В columns столбцы не повторяются.");
  if (el.sort && !allowed.includes(el.sort)) add(`${path}.sort`, "unknown-key", `Сортировать можно по: ${words(allowed)}.`, allowed);
}

function quickRules(track, el, path, add) {
  const entries = Object.entries(el.values || {});
  if (!entries.length) return add(`${path}.values`, "missing-attr", `У quick нет values. Напишите значения полей: {"${track.fields.find((f) => f.type === "number")?.key ?? "ml"}": 250}.`);
  const recordable = track.fields.filter((f) => f.type !== "calc");
  for (const [key, value] of entries) {
    const field = recordable.find((f) => f.key === key);
    if (!field) { add(`${path}.values.${key}`, "unknown-key", `В треке ${q(track.key)} нет поля ${q(key)} для записи. Поля: ${words(recordable.map((f) => f.key)) || "нет"}. Напишите values: {"${nearest(key, recordable.map((f) => f.key))[0] ?? "ml"}": 250}.`, recordable.map((f) => f.key)); continue; }
    const problem = valueProblem(field, value);
    if (problem) add(`${path}.values.${key}`, "bad-value", `Значение ${q(key)}=${JSON.stringify(value)}: ${problem}`);
  }
}

function formRules(track, el, path, add) {
  const recordable = track.fields.filter((f) => f.type !== "calc");
  if (!recordable.length) return add(`${path}.of`, "kind-element", `В треке ${q(track.key)} нет полей, которые можно записать: форме нечего спрашивать. Добавьте поля в объявление трека.`);
  const keys = el.fields || [];
  for (const key of keys) {
    const field = track.fields.find((f) => f.key === key);
    if (!field) add(`${path}.fields`, "unknown-key", `В треке ${q(track.key)} нет поля ${q(key)}. Поля: ${words(recordable.map((f) => f.key))}.`, recordable.map((f) => f.key));
    else if (field.type === "calc") add(`${path}.fields`, "bad-value", `Поле ${q(key)} расчётное, его нельзя вводить. Уберите его из fields: оно посчитается само.`);
  }
  if (new Set(keys).size !== keys.length) add(`${path}.fields`, "bad-value", "В fields поля не повторяются.");
  if (el.fields) for (const field of recordable) if (field.required && !keys.includes(field.key)) add(`${path}.fields`, "bad-value", `Поле ${q(field.key)} обязательное, оно должно быть в fields.`);
}

// ===== pass 3: safety floors ========================================================
function safetyPass(bundle, merged, add, request) {
  const facts = { goals: [], calcs: [], texts: [] };
  const lookup = (key) => merged.tracks[key] || null;
  const supplied = sourceNumbers(bundle, request);
  for (const decl of bundle.tracks || []) {
    const track = merged.tracks[decl.key];
    for (const f of decl.fields || []) {
      const field = track.fields.find((x) => x.key === f.key);
      const ref = `tracks.${track.key}.fields.${field.key}`;
      if (field.goal != null) facts.goals.push({ ref: `${ref}.goal`, key: field.key, name: field.name, unit: field.unit, goal: field.goal, per: field.goalPer });
      if (field.type === "calc") {
        const own = (key) => track.fields.find((x) => x.key === key);
        facts.calcs.push({ ref: `${ref}.calc`, name: field.name, unit: field.unit, readsUnits: calcReads(field.calc, (key) => (own(key) ? { unit: own(key).unit, calc: own(key).calc } : null)) });
      }
      if (field.hint) facts.texts.push({ ref: `${ref}.hint`, text: field.hint, allowed: new Set([...fieldNumbers(field), ...supplied]) });
    }
  }
  for (const screen of bundle.screens || []) {
    for (const card of screen.cards || []) {
      const allowed = new Set([...bindingNumbers(card.body, lookup), ...supplied]);
      const ref = `screens.${screen.key}.cards.${card.key}`;
      if (card.title) facts.texts.push({ ref: `${ref}.title`, text: card.title, allowed });
      if (card.caption) facts.texts.push({ ref: `${ref}.caption`, text: card.caption, allowed });
      (card.body || []).forEach((el, i) => { if (el.text) facts.texts.push({ ref: `${ref}.body[${i}].text`, text: el.text, allowed }); });
    }
  }
  if (bundle.reply) facts.texts.push({ ref: "reply", text: bundle.reply, allowed: supplied });
  for (const p of safetyFloors(facts)) add(p.ref, p.rule, p.message);
}
