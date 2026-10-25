// L0: from "a model wrote something" to a bundle object. Takes a string (a
// fenced block and prose around it are tolerated) or an object and fixes only
// slips that have exactly one reading: letter case, `-` in keys, number formats,
// `yes`/`да`, comma lists, word forms of ranges and schedules. Every fix is
// reported as a Russian sentence. Anything with two readings is left alone for
// the validator to name.
import {
  AT, BUNDLE_VERSION, ELEMENTS, ELEMENT_KEYS, KEYS, TIME_OF_DAY, UNIT_ALIASES, UNIT_KEYS, WEEKDAYS, WEEKDAY_ALIASES, isEvery, isRange, wherePairs,
} from "./catalogue.js";

const TRANSLIT = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
const PREFIX = { track: "t", field: "f", item: "i", screen: "s", card: "c" };

// A readable key from a name: «Витамин D» → vitamin_d. `taken` holds the keys
// already used next to it, so two names never share one.
export function keyFromName(name, kind, taken = new Set()) {
  const { min, max } = KEYS[kind];
  let base = String(name ?? "").toLowerCase().split("").map((c) => TRANSLIT[c] ?? (/[a-z0-9]/.test(c) ? c : "_")).join("").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!/^[a-z]/.test(base)) base = `${PREFIX[kind]}_${base}`.replace(/_$/, "");
  base = base.slice(0, max).replace(/_$/, "") || "x";
  if (base.length < min) base = `${PREFIX[kind]}_${base}`;
  let key = base;
  for (let n = 2; taken.has(key); n++) {
    const tail = `_${n}`;
    key = `${base.slice(0, max - tail.length).replace(/_$/, "")}${tail}`;
  }
  return key;
}

// The slug that marks every object a bundle made («Вода» → voda).
export const appSlug = (name) => keyFromName(name, "track").slice(0, 20).replace(/_$/, "") || "app";

const cut = (text, n = 40) => (text.length > n ? `${text.slice(0, n)}…` : text);

// -- word tables -----------------------------------------------------------------
const table = (entries) => Object.fromEntries(Object.entries(entries).flatMap(([canon, words]) => [[canon, canon], ...words.map((w) => [w, canon])]));
const ALIAS = {
  kind: table({ log: ["журнал", "лог", "записи", "запись", "journal", "diary", "tracker"], habit: ["привычка", "habits"], list: ["список", "checklist", "todo"], catalog: ["справочник", "каталог", "catalogue", "directory"], follow: ["дополнение"] }),
  type: table({ number: ["int", "integer", "float", "decimal", "numeric", "num", "число", "целое", "дробное"], text: ["string", "str", "textarea", "текст", "строка"], choice: ["select", "enum", "choices", "option", "выбор"], yesno: ["bool", "boolean", "checkbox", "toggle", "да/нет"], scale: ["rating", "slider", "шкала", "оценка"], date: ["дата"], time: ["время"], calc: ["formula", "computed", "расчёт", "формула"], link: ["ref", "reference", "relation", "ссылка"] }),
  fn: table({ sum: ["total", "сумма", "итого", "суммa"], avg: ["average", "mean", "среднее", "average"], min: ["minimum", "минимум"], max: ["maximum", "максимум"], count: ["количество", "кол-во"], last: ["latest", "последнее", "последний"], first: ["earliest", "первое", "первый"], delta: ["change", "diff", "difference", "изменение", "разница"] }),
  rows: table({ items: ["item", "пункты", "позиции", "строки"] }),
  pace: table({ left: ["remaining", "осталось", "остаток"] }),
  by: table({ day: ["daily", "days", "день", "дни", "по дням"], week: ["weekly", "weeks", "неделя", "недели", "по неделям"], month: ["monthly", "months", "месяц", "месяцы", "по месяцам"] }),
  stack: table({ stacked: ["stack", "с накоплением"], grouped: ["group", "рядом"] }),
  good: table({ up: ["higher", "increase", "рост", "вверх"], down: ["lower", "decrease", "снижение", "вниз"], none: ["neutral", "нет"] }),
  order: table({ asc: ["ascending", "по возрастанию"], desc: ["descending", "по убыванию"] }),
  size: table({ full: ["wide", "большая", "во всю ширину"], half: ["small", "половина", "половинная"] }),
  goalType: table({ min: ["minimum", "reach", "target", "at_least", "достичь", "не меньше"], max: ["maximum", "limit", "at_most", "лимит", "не больше"] }),
  goalPer: table({ day: ["daily", "per_day", "в день", "день", "сутки"], week: ["weekly", "per_week", "в неделю", "неделя"], month: ["monthly", "per_month", "в месяц", "месяц"] }),
  per: table({ day: ["daily", "в день", "день"], week: ["weekly", "в неделю", "неделя"] }),
  unmarked: table({ ignore: ["ignored", "none"], missed: ["miss", "skipped", "skip"], assumed: ["assume", "done"] }),
  follows: table({ ration: ["рацион"], sport: ["спорт"], shopping: ["покупки", "запросы", "requests"] }),
  what: table({ "ration-today": ["ration_today", "rationtoday", "рацион"], "sport-today": ["sport_today", "sporttoday", "спорт"], requests: ["запросы", "request"] }),
};
const EVERY_WORDS = table({ day: ["daily", "everyday", "every_day", "каждый день", "ежедневно", "каждый_день"], weekdays: ["weekday", "workdays", "будни", "по будням", "рабочие дни"], weekends: ["weekend", "выходные", "по выходным"], open: ["без срока", "бессрочно"] });
const AT_WORDS = table({ morning: ["утро", "утром", "с утра", "am"], noon: ["день", "днём", "днем", "day", "afternoon", "midday", "обед"], evening: ["вечер", "вечером", "pm"], night: ["ночь", "ночью", "на ночь", "перед сном"] });
const DAY_NAMES = (() => {
  const full = { mon: ["monday", "понедельник"], tue: ["tuesday", "вторник"], wed: ["wednesday", "среда"], thu: ["thursday", "четверг"], fri: ["friday", "пятница"], sat: ["saturday", "суббота"], sun: ["sunday", "воскресенье"] };
  return { ...table(full), ...WEEKDAY_ALIASES };
})();

function aliasRange(value) {
  const v = value.trim().toLowerCase().replace(/\s+/g, " ").replace(/^@/, "");
  const words = { today: "@today", сегодня: "@today", yesterday: "@yesterday", вчера: "@yesterday", week: "@thisWeek", thisweek: "@thisWeek", "this week": "@thisWeek", неделя: "@thisWeek", "эта неделя": "@thisWeek", month: "@thisMonth", thismonth: "@thisMonth", "this month": "@thisMonth", месяц: "@thisMonth", "этот месяц": "@thisMonth", all: "@all", alltime: "@all", "all time": "@all", "всё время": "@all", "все время": "@all", "за всё время": "@all", "за все время": "@all" };
  if (words[v]) return words[v];
  const m = /^(?:last|за|последние|последний|последняя)?\s*(\d{1,3})\s*(d|w|m|days?|weeks?|months?|дн\S*|нед\S*|мес\S*)$/.exec(v);
  if (!m) return null;
  const unit = m[2][0] === "d" || m[2][0] === "д" ? "d" : m[2][0] === "w" || m[2][0] === "н" ? "w" : "m";
  const token = `@last${Number(m[1])}${unit}`;
  return isRange(token) ? token : null;
}

// An answer in words only: a refusal or a question. It changes nothing and has no name.
export function isReplyOnly(bundle) {
  if (!bundle || typeof bundle !== "object" || typeof bundle.reply !== "string" || !bundle.reply.trim() || "name" in bundle) return false;
  return ["tracks", "screens", "remove"].every((key) => !(key in bundle) || (Array.isArray(bundle[key]) && !bundle[key].length));
}

// -- the normalizer ---------------------------------------------------------------
export function extractJson(text) {
  const source = String(text ?? "");
  const fenced = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(source);
  const body = fenced ? fenced[1] : source;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) return { error: "В ответе нет JSON-объекта. Верните один объект {\"v\":2,\"name\":…} без пояснений вокруг." };
  const slice = body.slice(start, end + 1);
  try {
    return { value: JSON.parse(slice) };
  } catch {
    try {
      return { value: JSON.parse(slice.replace(/,\s*([}\]])/g, "$1")), fixed: "Лишние запятые перед закрывающими скобками убраны." };
    } catch (error) {
      return { error: `JSON не читается: ${error.message}. Проверьте кавычки, запятые и скобки.` };
    }
  }
}

export function normalizeBundle(raw, { spec = null } = {}) {
  const changes = [];
  const note = (text) => { if (!changes.includes(text) && changes.length < 40) changes.push(text); };
  let source = raw;
  if (typeof raw === "string") {
    const parsed = extractJson(raw);
    if (parsed.error) return { bundle: null, changes, problems: [{ path: "", rule: "not-json", message: parsed.error }] };
    if (parsed.fixed) note(parsed.fixed);
    if (raw.trim().startsWith("{") === false) note("JSON выделен из текста вокруг него.");
    source = parsed.value;
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { bundle: null, changes, problems: [{ path: "", rule: "not-json", message: "Пакет должен быть JSON-объектом {\"v\":2,\"name\":…,\"tracks\":[…]}." }] };
  }
  const input = JSON.parse(JSON.stringify(source));
  if (input.bundle && typeof input.bundle === "object" && !("tracks" in input) && !("screens" in input) && !("remove" in input)) {
    const { bundle, ...rest } = input;
    Object.assign(input, bundle, rest);
    delete input.bundle;
    note("Пакет вынут из поля bundle.");
  }

  const num = (value, where) => {
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;
    const text = value.trim().replace(/[\s ]/g, "").replace(",", ".");
    if (/^-?\d+(\.\d+)?$/.test(text)) { note(`${where}: «${cut(value)}» записано числом ${text}.`); return Number(text); }
    return value;
  };
  const bool = (value, where) => {
    if (typeof value === "boolean") return value;
    const word = String(value).trim().toLowerCase();
    if (["yes", "да", "true", "1", "on", ""].includes(word)) { if (value !== true) note(`${where}: «${cut(String(value))}» записано как true.`); return true; }
    if (["no", "нет", "false", "0", "off"].includes(word)) { note(`${where}: «${cut(String(value))}» значит «выключено», атрибут убран.`); return undefined; }
    return value;
  };
  const key = (value, where) => {
    if (typeof value !== "string") return value;
    let text = value.trim().toLowerCase();
    if (/[а-яё]/.test(text)) text = text.split("").map((c) => TRANSLIT[c] ?? c).join("");
    text = text.replace(/[\s-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    if (text !== value) note(`${where}: ключ «${cut(value)}» записан как «${text}».`);
    return text;
  };
  const alias = (value, name, where, extra = null) => {
    if (typeof value !== "string") return value;
    const word = value.trim().toLowerCase().replace(/\s+/g, " ");
    const hit = (extra || ALIAS[name])?.[word];
    if (hit && hit !== value) { note(`${where}: «${cut(value)}» записано как «${hit}».`); return hit; }
    return value;
  };
  const list = (value, where, { split = /\s*,\s*/ } = {}) => {
    if (typeof value !== "string") return value;
    const parts = value.split(split).map((s) => s.trim()).filter(Boolean);
    note(`${where}: строка разбита на список.`);
    return parts;
  };
  const pairs = (value, where, convert = (v) => v) => {
    if (typeof value !== "string") return value;
    const out = {};
    for (const part of value.split(/\s*[,;]\s*/).filter(Boolean)) {
      const m = /^([^=:]+?)\s*[=:]\s*(.+)$/.exec(part);
      if (!m) return value;
      out[m[1].trim()] = convert(m[2].trim());
    }
    note(`${where}: строка «${cut(value)}» записана парами.`);
    return out;
  };
  const numericValue = (v) => (/^-?\d+([.,]\d+)?$/.test(v) ? Number(v.replace(",", ".")) : v);
  const trimText = (value, where) => {
    if (typeof value !== "string") return value;
    const t = value.trim().replace(/\s+/g, " ");
    if (t !== value) note(`${where}: лишние пробелы убраны.`);
    return t;
  };
  const objectsOf = (value, field = "key") => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      note("Список, записанный объектом, превращён в массив.");
      return Object.entries(value).map(([k, v]) => ({ [field]: k, ...(v && typeof v === "object" ? v : {}) }));
    }
    return value;
  };
  const clean = (obj) => { for (const k of Object.keys(obj)) if (obj[k] === undefined || obj[k] === null || obj[k] === "") delete obj[k]; return obj; };

  const bundle = {};
  if (input.v === undefined) { bundle.v = BUNDLE_VERSION; note("Версия формата дописана: v=2."); }
  else {
    const n = Number(typeof input.v === "string" ? input.v.trim().replace(/^v/i, "") : input.v);
    bundle.v = Number.isFinite(n) ? n : input.v;
    if (bundle.v !== input.v) note(`v: «${cut(String(input.v))}» записано как ${bundle.v}.`);
  }
  for (const name of Object.keys(input)) if (!["v", "tracks", "screens", "remove"].includes(name)) bundle[name] = input[name];
  if (typeof bundle.name === "string") bundle.name = trimText(bundle.name, "name");
  if (typeof bundle.reply === "string") bundle.reply = trimText(bundle.reply, "reply");
  clean(bundle);

  // -- tracks
  const tracks = input.tracks === undefined ? undefined : objectsOf(input.tracks);
  if (Array.isArray(tracks)) {
    bundle.tracks = tracks.map((t) => {
      if (!t || typeof t !== "object" || Array.isArray(t)) return t;
      const track = { ...t };
      if ("key" in track) track.key = key(track.key, "tracks");
      const at = `трек «${track.key}»`;
      if ("name" in track) track.name = trimText(track.name, at);
      if ("kind" in track) track.kind = alias(track.kind, "kind", `${at}, kind`);
      for (const flag of ["avoid"]) if (flag in track) track[flag] = bool(track[flag], `${at}, ${flag}`);
      if ("states" in track) track.states = list(track.states, `${at}, states`);
      if (Array.isArray(track.states)) track.states = track.states.map((s) => alias(s, "states", `${at}, states`, { готово: "done", сделано: "done", изменено: "changed", пропущено: "skipped" }));
      if (track.labels && typeof track.labels === "object" && !Array.isArray(track.labels)) for (const k of Object.keys(track.labels)) track.labels[k] = trimText(track.labels[k], `${at}, labels`);
      if ("unmarked" in track) track.unmarked = alias(track.unmarked, "unmarked", `${at}, unmarked`);
      for (const n of ["grace", "times"]) if (n in track) track[n] = num(track[n], `${at}, ${n}`);
      if ("per" in track) track.per = alias(track.per, "per", `${at}, per`);
      if ("follows" in track) track.follows = alias(track.follows, "follows", `${at}, follows`);
      if ("fields" in track) {
        const fields = objectsOf(track.fields);
        if (Array.isArray(fields)) {
          track.fields = fields.map((f) => (f && typeof f === "object" && !Array.isArray(f) ? field(f, at) : f));
        } else track.fields = fields;
      }
      if ("items" in track) {
        const items = Array.isArray(track.items) ? track.items.map((i) => (typeof i === "string" ? { name: i } : i)) : track.items;
        if (Array.isArray(track.items) && track.items.some((i) => typeof i === "string")) note(`${at}: пункты-строки записаны объектами с name.`);
        if (Array.isArray(items)) {
          const taken = new Set();
          track.items = items.map((i) => (i && typeof i === "object" && !Array.isArray(i) ? item(i, at, taken) : i));
        } else track.items = items;
      }
      return clean(track);
    });
  } else if (tracks !== undefined) bundle.tracks = tracks;

  function field(f, at) {
    const out = { ...f };
    if ("key" in out) out.key = key(out.key, `${at}, поле`);
    const here = `поле «${out.key}»`;
    if ("name" in out) out.name = trimText(out.name, here);
    if ("type" in out) out.type = alias(out.type, "type", `${here}, type`);
    if ("unit" in out && typeof out.unit === "string") {
      const unit = out.unit.trim();
      const hit = UNIT_KEYS.includes(unit) ? unit : UNIT_ALIASES[unit.toLowerCase()] ?? UNIT_KEYS.find((u) => u.toLowerCase() === unit.toLowerCase());
      if (hit && hit !== out.unit) note(`${here}: единица «${out.unit}» записана как «${hit}».`);
      out.unit = hit || unit;
    }
    for (const n of ["min", "max", "step", "goal"]) if (n in out) out[n] = num(out[n], `${here}, ${n}`);
    if ("options" in out) {
      out.options = list(out.options, `${here}, options`);
      if (Array.isArray(out.options)) out.options = out.options.map((o) => (typeof o === "string" ? o.trim() : o));
    }
    if ("labels" in out) out.labels = list(out.labels, `${here}, labels`);
    if (typeof out.calc === "string") out.calc = trimText(out.calc, `${here}, calc`);
    if ("to" in out) out.to = key(out.to, `${here}, to`);
    if ("goalType" in out) out.goalType = alias(out.goalType, "goalType", `${here}, goalType`);
    if ("goal_type" in out) { out.goalType = alias(out.goal_type, "goalType", `${here}, goalType`); delete out.goal_type; note(`${here}: goal_type записано как goalType.`); }
    if ("goalPer" in out) out.goalPer = alias(out.goalPer, "goalPer", `${here}, goalPer`);
    if ("per" in out && !("goalPer" in out)) { out.goalPer = alias(out.per, "goalPer", `${here}, goalPer`); delete out.per; note(`${here}: per записано как goalPer.`); }
    for (const flag of ["planned", "required"]) if (flag in out) out[flag] = bool(out[flag], `${here}, ${flag}`);
    if ("on" in out) out.on = list(out.on, `${here}, on`);
    if ("hint" in out) out.hint = trimText(out.hint, `${here}, hint`);
    return clean(out);
  }

  function item(i, at, taken) {
    const out = { ...i };
    if ("name" in out) out.name = trimText(out.name, `${at}, пункт`);
    if ("key" in out) out.key = key(out.key, `${at}, пункт`);
    else if (typeof out.name === "string" && out.name) out.key = keyFromName(out.name, "item", taken);
    if (typeof out.key === "string") taken.add(out.key);
    const here = `пункт «${out.name ?? out.key}»`;
    if ("every" in out) out.every = every(out.every, here);
    if ("at" in out) out.at = atOf(out.at, here);
    for (const n of ["from", "until"]) if (typeof out[n] === "string") out[n] = out[n].trim();
    if ("plan" in out) {
      out.plan = pairs(out.plan, `${here}, plan`, numericValue);
      if (out.plan && typeof out.plan === "object" && !Array.isArray(out.plan)) {
        out.plan = Object.fromEntries(Object.entries(out.plan).map(([k, v]) => [key(k, `${here}, plan`), typeof v === "string" ? numericValue(v) : v]));
      }
    }
    return clean(out);
  }

  function every(value, where) {
    if (Array.isArray(value)) value = value.join(",");
    if (typeof value !== "string") return value;
    const text = value.trim().toLowerCase().replace(/\s+/g, " ");
    if (isEvery(text)) return text;
    let fixed = EVERY_WORDS[text];
    if (!fixed) {
      const interval = /^(?:every|каждые?|раз в)?\s*(\d{1,2})\s*(?:d|days?|дн\S*|день)$/.exec(text);
      if (interval) fixed = `${Number(interval[1])}d`;
    }
    if (!fixed) {
      const days = text.split(/[\s,;]+/).filter(Boolean).map((d) => DAY_NAMES[d]);
      if (days.length && days.every(Boolean) && new Set(days).size === days.length) fixed = days.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)).join(",");
    }
    if (fixed && isEvery(fixed)) { note(`${where}: every «${cut(value)}» записано как «${fixed}».`); return fixed; }
    return value;
  }

  function atOf(value, where) {
    if (typeof value !== "string") return value;
    const text = value.trim().toLowerCase().replace(/\s+/g, " ");
    if (text in AT.words || TIME_OF_DAY.test(text)) return text;
    const word = AT_WORDS[text];
    if (word) { note(`${where}: at «${cut(value)}» записано как «${word}».`); return word; }
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(text);
    if (m) { const t = `${m[1].padStart(2, "0")}:${m[2]}`; if (TIME_OF_DAY.test(t)) { note(`${where}: время «${value}» записано как «${t}».`); return t; } }
    return value;
  }

  // -- screens and cards
  const screens = input.screens === undefined ? undefined : objectsOf(input.screens);
  const cardKeys = new Set();
  if (Array.isArray(screens)) {
    bundle.screens = screens.map((s) => {
      if (!s || typeof s !== "object" || Array.isArray(s)) return s;
      const screen = { ...s };
      if ("key" in screen) screen.key = key(screen.key, "screens");
      else if (typeof screen.name === "string") { screen.key = keyFromName(screen.name, "screen"); note(`Ключ экрана «${screen.name}» составлен из названия: ${screen.key}.`); }
      const at = `экран «${screen.key}»`;
      if ("name" in screen) screen.name = trimText(screen.name, at);
      if ("order" in screen) {
        screen.order = list(screen.order, `${at}, order`);
        if (Array.isArray(screen.order)) screen.order = screen.order.map((k) => key(k, `${at}, order`));
      }
      if ("cards" in screen) {
        const cards = objectsOf(screen.cards);
        if (Array.isArray(cards)) screen.cards = cards.map((c) => (c && typeof c === "object" && !Array.isArray(c) ? card(c, at) : c));
        else screen.cards = cards;
      }
      return clean(screen);
    });
  } else if (screens !== undefined) bundle.screens = screens;

  function card(c, at) {
    const out = { ...c };
    if ("title" in out) out.title = trimText(out.title, `${at}, карточка`);
    if ("caption" in out) out.caption = trimText(out.caption, `${at}, карточка`);
    if ("key" in out) out.key = key(out.key, `${at}, карточка`);
    else if (typeof out.title === "string" && out.title) { out.key = keyFromName(out.title, "card", cardKeys); note(`Ключ карточки «${out.title}» составлен из заголовка: ${out.key}.`); }
    if (typeof out.key === "string") cardKeys.add(out.key);
    if ("size" in out) out.size = alias(out.size, "size", `карточка «${out.key}», size`);
    if ("body" in out) {
      const body = Array.isArray(out.body) ? out.body : out.body && typeof out.body === "object" ? [out.body] : out.body;
      if (body !== out.body) note(`Карточка «${out.key}»: один элемент записан списком.`);
      out.body = Array.isArray(body) ? body.map((e) => (e && typeof e === "object" && !Array.isArray(e) ? element(e, out.key) : e)) : body;
    }
    return clean(out);
  }

  function element(e, cardKey) {
    const out = { ...e };
    if (typeof out.el === "string") {
      const name = out.el.trim().toLowerCase().replace(/^c[-_]/, "").replace(/_/g, "-");
      if (name !== out.el && ELEMENT_KEYS.includes(name)) note(`Карточка «${cardKey}»: элемент «${out.el}» записан как «${name}».`);
      out.el = ELEMENT_KEYS.includes(name) ? name : out.el;
    }
    const spec = Object.hasOwn(ELEMENTS, out.el) ? ELEMENTS[out.el] : null;
    const at = `карточка «${cardKey}», ${out.el}`;
    if (!spec) return out;
    if ("goal-type" in out) { out.goalType = out["goal-type"]; delete out["goal-type"]; }
    if ("goal" in out) out.goal = num(out.goal, `${at}, goal`);
    if ("goalType" in out) out.goalType = alias(out.goalType, "goalType", `${at}, goalType`);
    for (const [name, attr] of Object.entries(spec.attrs)) {
      if (!(name in out)) continue;
      const w = `${at}, ${name}`;
      switch (attr.type) {
        case "track": case "value": case "field": out[name] = key(out[name], w); break;
        case "fields": out[name] = list(out[name], w); if (Array.isArray(out[name])) out[name] = out[name].map((k) => key(k, w)); break;
        case "bool": out[name] = bool(out[name], w); break;
        case "int": case "number": out[name] = num(out[name], w); break;
        case "pairs":
          if (name === "where" && typeof out[name] === "string") {
            const parsed = wherePairs(out[name]);
            if (parsed) { note(`${w}: строка «${cut(out[name])}» записана парами.`); out[name] = parsed; }
          }
          out[name] = pairs(out[name], w, name === "values" ? numericValue : (v) => v); if (out[name] && typeof out[name] === "object" && !Array.isArray(out[name])) out[name] = Object.fromEntries(Object.entries(out[name]).map(([k, v]) => [key(k, w), v])); break;
        case "range":
          if (typeof out[name] === "string" && !isRange(out[name])) {
            const fixed = aliasRange(out[name]);
            if (fixed) { note(`${w}: «${cut(out[name])}» записано как «${fixed}».`); out[name] = fixed; }
          }
          break;
        case "by":
          if (typeof out[name] === "string") {
            const hit = ALIAS.by[out[name].trim().toLowerCase().replace(/\s+/g, " ")];
            if (hit) { if (hit !== out[name]) note(`${w}: «${cut(out[name])}» записано как «${hit}».`); out[name] = hit; } else out[name] = key(out[name], w);
          }
          break;
        case "enum":
          if (name === "date" && typeof out[name] === "string" && !attr.values.includes(out[name])) {
            const fixed = aliasRange(out[name]);
            if (fixed && attr.values.includes(fixed)) { note(`${w}: «${cut(out[name])}» записано как «${fixed}».`); out[name] = fixed; }
          } else out[name] = alias(out[name], name, w);
          break;
        case "text": out[name] = trimText(out[name], w); break;
        default:
      }
    }
    return clean(out);
  }

  // -- removals
  if (input.remove !== undefined) {
    const raw = Array.isArray(input.remove) ? input.remove : [input.remove];
    if (!Array.isArray(input.remove)) note("Удаление записано списком.");
    bundle.remove = raw.map((r) => {
      if (typeof r === "string") {
        const m = /^(card|track|screen|item|field)\s*[:=]\s*(.+)$/.exec(r.trim());
        if (m) { note(`Удаление «${cut(r)}» записано объектом.`); r = { [m[1]]: m[2] }; } else return r;
      }
      if (!r || typeof r !== "object" || Array.isArray(r)) return r;
      const out = {};
      for (const [k, v] of Object.entries(r)) out[k] = typeof v === "string" ? v.split(".").map((p) => key(p, `remove ${k}`)).join(".") : v;
      return out;
    });
  }

  hoistGoals(bundle, spec, note);
  yesnoValues(bundle, spec, note);
  return { bundle, changes, problems: [] };
}

const YES_WORDS = ["true", "yes", "да"];
const NO_WORDS = ["false", "no", "нет"];

// Markup writes every value as text, so has=true arrives as the string "true".
// For a field of type yesno the word has one reading: the boolean.
function yesnoValues(bundle, spec, note) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const isYesno = (trackKey, fieldKey) => {
    const declared = list(list(bundle.tracks).find((t) => t?.key === trackKey)?.fields).find((f) => f?.key === fieldKey);
    const stored = spec?.tracks?.[trackKey]?.fields?.find((f) => f.key === fieldKey);
    return (declared?.type ?? stored?.type) === "yesno";
  };
  const fix = (pairs, trackKey, where) => {
    if (!pairs || typeof pairs !== "object" || Array.isArray(pairs)) return;
    for (const [fieldKey, value] of Object.entries(pairs)) {
      if (typeof value !== "string" || !isYesno(trackKey, fieldKey)) continue;
      const word = value.trim().toLowerCase();
      const fixed = YES_WORDS.includes(word) ? true : NO_WORDS.includes(word) ? false : null;
      if (fixed === null) continue;
      pairs[fieldKey] = fixed;
      note(`${where}: «${fieldKey}» — поле да/нет, «${cut(value)}» записано как ${fixed}.`);
    }
  };
  for (const track of list(bundle.tracks)) for (const item of list(track?.items)) fix(item?.plan, track.key, `пункт «${item?.key ?? item?.name}», plan`);
  for (const screen of list(bundle.screens)) {
    for (const card of list(screen?.cards)) {
      for (const el of list(card?.body)) {
        if (!el || typeof el !== "object") continue;
        fix(el.where, el.of, `карточка «${card.key}», ${el.el}, where`);
        if (el.el === "quick") fix(el.values, el.of, `карточка «${card.key}», quick, values`);
      }
    }
  }
}

// A goal written on a meter (or any chart) belongs to the field; it moves there
// when the field has none, and stays for the validator when the field disagrees.
function hoistGoals(bundle, spec, note) {
  const declared = (trackKey, fieldKey) => (Array.isArray(bundle.tracks) ? bundle.tracks : []).find((t) => t?.key === trackKey)?.fields?.find?.((f) => f?.key === fieldKey);
  const list = (v) => (Array.isArray(v) ? v : []);
  for (const screen of list(bundle.screens)) {
    for (const card of list(screen?.cards)) {
      for (const el of list(card?.body)) {
        if (!el || typeof el !== "object" || !("goal" in el)) continue;
        const goal = typeof el.goal === "number" ? el.goal : null;
        const existing = spec?.tracks?.[el.of]?.fields?.find((f) => f.key === el.value);
        const inBundle = declared(el.of, el.value);
        if (goal == null || !(existing || inBundle) || !(existing?.type === "number" || existing?.type === "calc" || inBundle?.type === "number" || inBundle?.type === "calc")) continue;
        const currentGoal = inBundle?.goal ?? existing?.goal;
        if (currentGoal != null && currentGoal !== goal) continue;
        if (currentGoal == null) {
          let target = inBundle;
          if (!target) {
            if (!Array.isArray(bundle.tracks)) bundle.tracks = [];
            let track = bundle.tracks.find((t) => t?.key === el.of);
            if (!track) { track = { key: el.of }; bundle.tracks.push(track); }
            target = { key: el.value };
            if (!Array.isArray(track.fields)) track.fields = [];
            track.fields.push(target);
          }
          target.goal = goal;
          if (el.goalType && !target.goalType) target.goalType = el.goalType;
          note(`Цель ${goal} перенесена с элемента на поле «${el.value}» трека «${el.of}»: цель задаётся один раз в поле.`);
        } else note(`Цель ${goal} на элементе убрана: она уже записана в поле «${el.value}».`);
        delete el.goal;
        delete el.goalType;
      }
    }
  }
}
