// The strict validator of dashboard markup. A model writes the markup; nothing
// reaches the screen unless it passes here. Pure JS with its own small parser,
// so it runs in node, in the page and anywhere else without a DOM.
//
//   normalizeMarkup(src)            → { markup, changes }       trivial slips fixed by rule
//   parseMarkup(src)                → { nodes, problems }       the tree the renderer builds from
//   validateMarkup(src, options)    → { ok, problems, messages, markup, changes }
//
// A problem is machine-readable: { path, rule, message, allowed? }. `path` points at
// the element or attribute ("c-card[1] > c-bars[0]@fn"), `rule` is a short id, `message`
// is a Russian sentence a model can act on, `allowed` lists the legal values when the rule has them.
// `messages` is the same list as plain strings.
import {
  BY, KCAL_GOAL_FLOOR, bucketsOf, dateRelationOf, isEnergyIntake, isNumericRelation, rangeProblem, resolveRange,
} from "./util.js";

export const VERSION = "1";
export const LIMITS = Object.freeze({ elements: 16, depth: 2, text: 200, source: 6000, columns: 5, rows: 50, bars: 60, points: 400, heatmapWeeks: 27 });

const FN = ["sum", "avg", "min", "max", "count"];
const BOOL = { type: "bool" };
const TITLE = { type: "text", max: 60 };

const bound = (extra = {}) => ({
  title: TITLE,
  set: { type: "id" },
  value: { type: "key" },
  fn: { type: "enum", values: FN },
  range: { type: "range" },
  date: { type: "key" },
  unit: { type: "text", max: 12 },
  ...extra,
});

// Per tag: what it is, which attributes it takes, what may stand inside it.
export const COMPONENTS = Object.freeze({
  "c-dashboard": {
    doc: "Корень разметки. Один на весь текст, внутри всё остальное.",
    attrs: { v: { type: "enum", values: [VERSION] } },
    children: ["section", "c-grid", "c-card", "h2", "h3", "p", "c-stat", "c-meter", "c-bars", "c-line", "c-spark", "c-heatmap", "c-table", "c-list", "c-empty"],
  },
  section: { doc: "Раздел: заголовок h3 и карточки под ним.", attrs: {}, children: ["h3", "p", "c-card", "c-stat", "c-meter", "c-bars", "c-line", "c-spark", "c-heatmap", "c-table", "c-list", "c-empty"] },
  h2: { doc: "Заголовок страницы, до 200 символов, без чисел о человеке.", attrs: {}, text: true, children: [] },
  h3: { doc: "Заголовок раздела.", attrs: {}, text: true, children: [] },
  p: { doc: "Короткий абзац пояснения, без чисел о человеке.", attrs: {}, text: true, children: [] },
  "c-grid": { doc: "Сетка в 1 или 2 колонки, на телефоне колонки встают друг под друга.", attrs: { cols: { type: "enum", values: ["1", "2"] } }, children: ["c-card", "c-stat", "c-meter", "c-bars", "c-line", "c-spark", "c-heatmap", "c-table", "c-list", "c-empty"] },
  "c-card": { doc: "Карточка с заголовком title и необязательной подписью caption.", attrs: { title: TITLE, caption: { type: "text", max: 120 } }, children: ["p", "c-stat", "c-meter", "c-bars", "c-line", "c-spark", "c-heatmap", "c-table", "c-list", "c-empty"] },
  "c-stat": {
    doc: "Одно число за период. compare=\"yes\" добавляет сравнение с прошлым периодом, spark=\"yes\" мини-график, good говорит, какое направление хорошее.",
    attrs: bound({ compare: BOOL, spark: BOOL, good: { type: "enum", values: ["up", "down", "none"] } }),
    bound: true, defaults: { range: "@last7d" }, children: [],
  },
  "c-meter": {
    doc: "Значение против цели goal. goal-type=\"max\" для лимита (больше цели плохо), по умолчанию \"min\" (цель надо достичь). category разбивает на части.",
    attrs: bound({ goal: { type: "number", min: 0, max: 1e7 }, "goal-type": { type: "enum", values: ["min", "max"] }, category: { type: "key" } }),
    bound: true, defaults: { range: "@today" }, goal: "required", children: [],
  },
  "c-bars": {
    doc: "Столбцы по дням, неделям или месяцам. category разбивает на ряды (stack=\"stacked\" или \"grouped\"), goal рисует линию цели.",
    attrs: bound({ by: { type: "enum", values: BY }, category: { type: "key" }, goal: { type: "number", min: 0, max: 1e7 }, stack: { type: "enum", values: ["stacked", "grouped"] } }),
    bound: true, defaults: { range: "@last7d", by: "day" }, children: [],
  },
  "c-line": {
    doc: "Линия во времени. area=\"yes\" добавляет заливку, category разбивает на ряды, goal рисует линию цели.",
    attrs: bound({ by: { type: "enum", values: BY }, category: { type: "key" }, goal: { type: "number", min: 0, max: 1e7 }, area: BOOL }),
    bound: true, defaults: { range: "@last30d", by: "day" }, children: [],
  },
  "c-spark": { doc: "Мини-график без осей.", attrs: bound(), bound: true, defaults: { range: "@last30d" }, children: [] },
  "c-heatmap": { doc: "Календарь дней по неделям, цвет по значению дня.", attrs: bound(), bound: true, defaults: { range: "@last12w" }, children: [] },
  "c-table": {
    doc: "Таблица объектов набора. columns: до 5 связей через запятую.",
    attrs: { title: TITLE, set: { type: "id" }, columns: { type: "keys" }, limit: { type: "number", min: 1, max: LIMITS.rows, integer: true }, sort: { type: "key" }, order: { type: "enum", values: ["asc", "desc"] }, range: { type: "range" }, date: { type: "key" } },
    bound: true, rows: true, children: [],
  },
  "c-list": {
    doc: "Строки объектов набора со ссылками. columns: до 5 связей через запятую.",
    attrs: { title: TITLE, set: { type: "id" }, columns: { type: "keys" }, limit: { type: "number", min: 1, max: LIMITS.rows, integer: true }, sort: { type: "key" }, order: { type: "enum", values: ["asc", "desc"] }, range: { type: "range" }, date: { type: "key" } },
    bound: true, rows: true, children: [],
  },
  "c-empty": { doc: "Пустое состояние или подсказка, одна фраза до 200 символов.", attrs: {}, text: true, children: [] },
});

export const TAGS = Object.freeze(Object.keys(COMPONENTS));
const NUMERIC_ATTRS = new Set(["goal", "limit"]);

// -- parser ---------------------------------------------------------------------
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const decode = (text) => text.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, name) => ENTITIES[name]);
const escapeText = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text) => escapeText(text).replace(/"/g, "&quot;");
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "iframe", "noscript"]);

// Parses markup into { nodes, problems }. Problems are { rule, message, fixable, pos }.
export function parseMarkup(src) {
  const problems = [];
  const root = { type: "root", children: [] };
  const stack = [root];
  const problem = (rule, message, pos, fixable = false) => problems.push({ rule, message, pos, fixable });
  const top = () => stack[stack.length - 1];
  const n = src.length;
  let i = 0;
  while (i < n) {
    if (src[i] !== "<") {
      let j = src.indexOf("<", i);
      if (j < 0) j = n;
      top().children.push({ type: "text", text: decode(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      if (end < 0) { problem("parse-error", "Комментарий <!-- не закрыт. Закройте его -->.", i); break; }
      i = end + 3;
      continue;
    }
    if (src[i + 1] === "!" || src[i + 1] === "?") {
      problem("parse-error", "Директивы <! и <? не разрешены. Пишите только разрешённые теги.", i);
      const end = src.indexOf(">", i);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (src[i + 1] === "/") {
      const end = src.indexOf(">", i);
      if (end < 0) { problem("parse-error", "Закрывающий тег не дописан: нет символа «>».", i); break; }
      const name = src.slice(i + 2, end).trim().toLowerCase();
      i = end + 1;
      const at = stack.map((e) => e.tag).lastIndexOf(name);
      if (at < 1) { problem("stray-close", `Закрывающий тег </${name}> без открывающего. Уберите его.`, i); continue; }
      if (at !== stack.length - 1) problem("unclosed-tag", `Тег <${stack[stack.length - 1].tag}> не закрыт до </${name}>. Закройте теги в обратном порядке.`, i);
      stack.length = at;
      continue;
    }
    const open = /^<([A-Za-z][A-Za-z0-9-]*)/.exec(src.slice(i, i + 80));
    if (!open) {
      problem("parse-error", "Символ «<» в тексте нужно писать как &lt;.", i);
      top().children.push({ type: "text", text: "<" });
      i += 1;
      continue;
    }
    const el = { type: "el", tag: open[1].toLowerCase(), rawTag: open[1], attrList: [], children: [], pos: i };
    i += open[0].length;
    let closed = false;
    let selfClosing = false;
    while (i < n) {
      while (i < n && /\s/.test(src[i])) i += 1;
      if (src[i] === ">") { i += 1; closed = true; break; }
      if (src[i] === "/" && src[i + 1] === ">") { i += 2; closed = true; selfClosing = true; break; }
      const name = /^[^\s"'<>/=]+/.exec(src.slice(i));
      if (!name) { problem("parse-error", `В теге <${el.tag}> встретился лишний символ «${src[i]}».`, i); i += 1; continue; }
      i += name[0].length;
      const attr = { rawName: name[0], name: name[0].toLowerCase(), value: "", rawValue: "", hasValue: false };
      let k = i;
      while (k < n && /\s/.test(src[k])) k += 1;
      if (src[k] === "=") {
        k += 1;
        while (k < n && /\s/.test(src[k])) k += 1;
        attr.hasValue = true;
        if (src[k] === '"' || src[k] === "'") {
          const end = src.indexOf(src[k], k + 1);
          if (end < 0) { problem("parse-error", `Кавычка у атрибута «${attr.name}» не закрыта.`, k); i = n; break; }
          attr.rawValue = src.slice(k + 1, end);
          i = end + 1;
        } else {
          const bare = /^[^\s>]*/.exec(src.slice(k))[0];
          const value = bare.endsWith("/") && src[k + bare.length] === ">" ? bare.slice(0, -1) : bare;
          attr.rawValue = value;
          problem("unquoted-attr", `Значение атрибута «${attr.name}» нужно взять в кавычки: ${attr.name}="${value}".`, k, true);
          i = k + value.length;
        }
        attr.value = decode(attr.rawValue);
      }
      el.attrList.push(attr);
    }
    if (!closed) { problem("parse-error", `Тег <${el.tag}> не дописан: нет символа «>».`, el.pos); break; }
    top().children.push(el);
    if (selfClosing) {
      problem("self-closing", `Тег <${el.tag}/> нельзя закрывать самим собой: пишите пару <${el.tag}></${el.tag}>.`, el.pos, true);
      continue;
    }
    if (RAW_TEXT.has(el.tag)) {
      const close = src.toLowerCase().indexOf(`</${el.tag}`, i);
      const end = close < 0 ? n : src.indexOf(">", close);
      i = end < 0 || close < 0 ? n : end + 1;
      continue;
    }
    stack.push(el);
  }
  for (const open of stack.slice(1).reverse()) problem("unclosed-tag", `Тег <${open.tag}> не закрыт. Добавьте </${open.tag}> в конце.`, n);
  attach(root);
  return { nodes: root.children, problems };
}

// attrs: a map of the first occurrence; the others are reported by the checker.
function attach(node) {
  if (node.type === "el") {
    node.attrs = {};
    node.duplicates = [];
    for (const a of node.attrList) {
      if (a.name in node.attrs) node.duplicates.push(a.name);
      else node.attrs[a.name] = a.hasValue ? a.value : "";
    }
  }
  for (const child of node.children || []) attach(child);
}

export function serializeMarkup(nodes) {
  return nodes.map((node) => {
    if (node.type === "text") return escapeText(node.text);
    const attrs = node.attrList.map((a) => ` ${a.name}="${escapeAttr(a.value)}"`).join("");
    return `<${node.tag}${attrs}>${serializeMarkup(node.children)}</${node.tag}>`;
  }).join("");
}

// -- normalizer -----------------------------------------------------------------
const ALIASES = {
  fn: { sum: ["total", "sum", "сумма", "итого", "суммa"], avg: ["average", "mean", "avg", "среднее"], min: ["minimum", "min", "минимум"], max: ["maximum", "max", "максимум"], count: ["count", "количество", "кол-во"] },
  by: { day: ["daily", "days", "day", "день", "дни", "по дням"], week: ["weekly", "weeks", "week", "неделя", "недели", "по неделям"], month: ["monthly", "months", "month", "месяц", "месяцы", "по месяцам"] },
  stack: { stacked: ["stack", "stacked", "с накоплением"], grouped: ["group", "grouped", "рядом"] },
  good: { up: ["higher", "increase", "рост", "вверх", "up"], down: ["lower", "decrease", "снижение", "вниз", "down"], none: ["none", "neutral", "нет"] },
  "goal-type": { min: ["min", "reach", "target", "достичь"], max: ["max", "limit", "maximum", "лимит"] },
  order: { asc: ["asc", "ascending", "по возрастанию"], desc: ["desc", "descending", "по убыванию"] },
};
const RANGE_WORDS = { today: "@today", сегодня: "@today", yesterday: "@yesterday", вчера: "@yesterday", week: "@thisWeek", thisweek: "@thisWeek", неделя: "@thisWeek", month: "@thisMonth", thismonth: "@thisMonth", месяц: "@thisMonth" };

function aliasRange(value) {
  const v = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (RANGE_WORDS[v.replace(/^@/, "")]) return RANGE_WORDS[v.replace(/^@/, "")];
  const m = /^@?(?:last|за|последние)?\s*(\d{1,3})\s*(d|w|m|days?|weeks?|months?|дн\S*|нед\S*|мес\S*)$/.exec(v);
  if (!m) return null;
  const unit = m[2][0] === "d" || m[2][0] === "д" ? "d" : m[2][0] === "w" || m[2][0] === "н" ? "w" : "m";
  return `@last${Number(m[1])}${unit}`;
}

const TRUE_WORDS = new Set(["", "true", "yes", "да", "1", "on"]);
const FALSE_WORDS = new Set(["false", "no", "нет", "0", "off"]);

// Fixes slips that have exactly one reading: letter case, spaces, quotes, aliases.
// Anything else is left for the validator. Returns the markup and what changed.
export function normalizeMarkup(src) {
  const changes = [];
  if (typeof src !== "string") return { markup: "", changes };
  const { nodes, problems } = parseMarkup(src);
  if (problems.some((p) => !p.fixable)) return { markup: src, changes };
  for (const p of problems) changes.push(p.rule === "self-closing" ? "Тег, закрытый самим собой, записан парой тегов." : "Значения атрибутов взяты в кавычки.");
  const note = (text) => { if (!changes.includes(text)) changes.push(text); };
  const visit = (node) => {
    if (node.type !== "el") return;
    if (node.rawTag !== node.tag) note(`Имя тега <${node.rawTag}> приведено к нижнему регистру.`);
    const spec = COMPONENTS[node.tag];
    const kept = [];
    for (const attr of node.attrList) {
      let { name } = attr;
      if (attr.rawName !== name) note(`Имя атрибута «${attr.rawName}» приведено к нижнему регистру.`);
      if (name === "label" && spec?.attrs.title && !("title" in spec.attrs && node.attrList.some((a) => a.name === "title"))) { name = "title"; note("Атрибут label переименован в title."); }
      let value = attr.value.trim();
      if (value !== attr.value) note(`Лишние пробелы вокруг значения «${name}» убраны.`);
      const type = spec?.attrs[name];
      if (type?.type === "bool") {
        const word = value.toLowerCase();
        if (FALSE_WORDS.has(word)) { note(`Атрибут «${name}» со значением «${value}» убран: он выключен.`); continue; }
        if (TRUE_WORDS.has(word) && value !== "yes") { value = "yes"; note(`Атрибут «${name}» записан как ${name}="yes".`); }
      } else if (value === "") {
        note(`Пустой атрибут «${name}» убран.`);
        continue;
      }
      const aliasTable = ALIASES[name];
      if (aliasTable && spec?.attrs[name]) {
        const word = value.toLowerCase();
        const hit = Object.entries(aliasTable).find(([, words]) => words.includes(word));
        if (hit && hit[0] !== value) { note(`${name}="${value}" заменено на ${name}="${hit[0]}".`); value = hit[0]; }
      }
      if (name === "range" && spec?.attrs.range) {
        const fixed = aliasRange(value);
        if (fixed && fixed !== value) { note(`range="${value}" заменено на range="${fixed}".`); value = fixed; }
      }
      if (NUMERIC_ATTRS.has(name) || name === "limit") {
        const m = /^(-?\d[\d\s ]*(?:[.,]\d+)?)\s*\D{0,8}$/.exec(value);
        if (m) {
          const clean = m[1].replace(/[\s ]/g, "").replace(",", ".");
          if (clean !== value) { note(`${name}="${value}" записано числом ${name}="${clean}".`); value = clean; }
        }
      }
      if (name === "v") {
        const m = /^v?(\d+)(?:\.0+)?$/i.exec(value);
        if (m && m[1] !== value) { note(`v="${value}" записано как v="${m[1]}".`); value = m[1]; }
      }
      kept.push({ ...attr, name, value, hasValue: true });
    }
    node.attrList = kept;
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  const markup = serializeMarkup(nodes);
  return { markup: changes.length ? markup : src, changes };
}

// -- validation -----------------------------------------------------------------
const NUMBER_RE = /\d+(?:[\s ]\d{3})*(?:[.,]\d+)?/g;
const canonNumber = (text) => String(Number(text.replace(/[\s ]/g, "").replace(",", ".")));

function valueProblem(name, spec, value) {
  switch (spec.type) {
    case "text":
      if (/[<>\u0000-\u001f]/.test(value)) return { rule: "bad-value", message: `Атрибут «${name}» не может содержать символы < > и управляющие символы.` };
      if (value.length > spec.max) return { rule: "text-too-long", message: `Атрибут «${name}» длиннее ${spec.max} символов (сейчас ${value.length}). Сократите.` };
      return null;
    case "enum":
      return spec.values.includes(value) ? null : { rule: "bad-value", message: `Атрибут «${name}»: значение «${value}» не подходит. Допустимо: ${spec.values.join(", ")}.`, allowed: spec.values };
    case "bool":
      return value === "yes" ? null : { rule: "bad-value", message: `Атрибут «${name}» включается записью ${name}="yes"; чтобы выключить, уберите его.`, allowed: ["yes"] };
    case "number": {
      if (!/^-?\d+(\.\d+)?$/.test(value)) return { rule: "bad-value", message: `Атрибут «${name}» должен быть числом без единиц и пробелов, например ${name}="2000".` };
      const num = Number(value);
      if (spec.integer && !Number.isInteger(num)) return { rule: "bad-value", message: `Атрибут «${name}» должен быть целым числом.` };
      if (num < spec.min || num > spec.max) return { rule: "bad-goal", message: `Атрибут «${name}»=${value} вне допустимых пределов: от ${spec.min} до ${spec.max}.` };
      return null;
    }
    case "id":
      return /^[\w.:-]{1,80}$/.test(value) ? null : { rule: "bad-value", message: `Атрибут «${name}» должен быть идентификатором набора из списка структуры.` };
    case "key":
      return /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(value) ? null : { rule: "bad-value", message: `Атрибут «${name}» должен быть ключом связи из структуры (латиница, цифры, _).` };
    case "keys": {
      const keys = value.split(",").map((s) => s.trim());
      if (keys.length > LIMITS.columns) return { rule: "bad-value", message: `Атрибут «${name}»: не больше ${LIMITS.columns} связей.` };
      return keys.every((k) => /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)) ? null : { rule: "bad-value", message: `Атрибут «${name}» — ключи связей через запятую, например columns="date,price".` };
    }
    case "range": {
      const why = rangeProblem(value);
      return why ? { rule: "bad-value", message: `Атрибут «${name}»: ${why}.`, allowed: ["@today", "@yesterday", "@last7d", "@last30d", "@last12w", "@last6m", "@thisWeek", "@thisMonth"] } : null;
    }
  }
  return null;
}

// options: { state, today, probe(tag, attrs) → boolean | null, normalize = true }
//   state  - the object space; checks the sets, relations and the safety rules
//   probe  - tells whether a bound element has data; a dashboard where none has is refused
export function validateMarkup(src, { state = null, today = "2026-01-15", probe = null, normalize = true } = {}) {
  const problems = [];
  const add = (path, rule, message, allowed) => problems.push({ path, rule, message, ...(allowed ? { allowed } : {}) });
  if (typeof src !== "string" || !src.trim()) {
    add("c-dashboard", "no-root", "Разметка пустая. Напишите <c-dashboard v=\"1\">…</c-dashboard> с карточками внутри.");
    return finish("", []);
  }
  const fixed = normalize ? normalizeMarkup(src) : { markup: src, changes: [] };
  const markup = fixed.markup;
  if (markup.length > LIMITS.source) {
    add("c-dashboard", "too-long", `Разметка длиннее ${LIMITS.source} символов. Сделайте панель короче и проще.`);
    return finish(markup, fixed.changes);
  }
  const parsed = parseMarkup(markup);
  if (parsed.problems.length) {
    for (const p of parsed.problems) add("c-dashboard", p.rule, p.message);
    return finish(markup, fixed.changes);
  }

  // The root: exactly one <c-dashboard v="1">, nothing around it.
  const roots = parsed.nodes.filter((node) => node.type === "el");
  const stray = parsed.nodes.filter((node) => node.type === "text" && node.text.trim());
  if (stray.length) add("c-dashboard", "text-not-allowed", "Текст вне <c-dashboard> не разрешён. Весь текст пишите внутри h2, h3, p или c-empty.");
  const dash = roots.find((node) => node.tag === "c-dashboard");
  if (!dash) {
    add("c-dashboard", "no-root", "Разметка должна начинаться с <c-dashboard v=\"1\"> и заканчиваться </c-dashboard>: версия формата обязательна.");
    return finish(markup, fixed.changes);
  }
  if (roots.length > 1) add("c-dashboard", "extra-root", "Снаружи <c-dashboard> ничего быть не должно: оберните всё в один корень.");
  if (!("v" in dash.attrs)) add("c-dashboard@v", "missing-attr", `У <c-dashboard> нет атрибута v. Напишите v="${VERSION}".`, [VERSION]);
  else if (dash.attrs.v !== VERSION) add("c-dashboard@v", "bad-version", `Версия формата v="${dash.attrs.v}" не поддерживается. Поддерживается только v="${VERSION}".`, [VERSION]);
  for (const name of Object.keys(dash.attrs)) if (name !== "v") add(`c-dashboard@${name}`, "unknown-attr", `У <c-dashboard> нет атрибута «${name}». Оставьте только v.`, ["v"]);

  const stats = { elements: 0, bound: [], texts: [], numbers: new Set(), anyDeepReported: false };
  const walk = (parent, nodes, trail, depth) => {
    const seen = {};
    for (const node of nodes) {
      if (node.type === "text") {
        if (!node.text.trim()) continue;
        const spec = COMPONENTS[parent.tag];
        const path = trail || "c-dashboard";
        if (!spec?.text) { add(path, "text-not-allowed", `Текст «${clip(node.text)}» нельзя писать прямо в <${parent.tag}>. Оберните его в p, h3 или c-empty.`); continue; }
        const text = node.text.trim();
        if (text.length > LIMITS.text) add(path, "text-too-long", `Текст в <${parent.tag}> длиннее ${LIMITS.text} символов (сейчас ${text.length}). Сократите.`);
        stats.texts.push({ path, text });
        continue;
      }
      stats.elements += 1;
      seen[node.tag] = (seen[node.tag] ?? -1) + 1;
      const here = `${node.tag}[${seen[node.tag]}]`;
      const path = trail ? `${trail} > ${here}` : here;
      checkElement(parent, node, path, depth);
      walk(node, node.children, path, depth + 1);
    }
  };

  const checkElement = (parent, node, path, depth) => {
    const spec = COMPONENTS[node.tag];
    if (!spec || node.tag === "c-dashboard") {
      add(path, "unknown-tag", node.tag === "c-dashboard" ? "<c-dashboard> может быть только корнем." : `Тег <${node.tag}> не разрешён. Разрешены: ${TAGS.filter((t) => t !== "c-dashboard").join(", ")}.`, TAGS.filter((t) => t !== "c-dashboard"));
      return;
    }
    const allowedHere = COMPONENTS[parent.tag]?.children || [];
    if (!allowedHere.includes(node.tag)) add(path, "not-allowed-here", `<${node.tag}> нельзя помещать в <${parent.tag}>. Там разрешены: ${allowedHere.join(", ") || "только текст"}.`, allowedHere);
    if (depth > LIMITS.depth && !stats.anyDeepReported) {
      stats.anyDeepReported = true;
      add(path, "too-deep", `Вложенность больше ${LIMITS.depth} уровней. Допустимо c-grid > c-card > график или section > c-card > график; уберите лишний слой.`);
    }
    for (const name of node.duplicates) add(`${path}@${name}`, "duplicate-attr", `Атрибут «${name}» записан дважды. Оставьте один.`);
    for (const [name, value] of Object.entries(node.attrs)) {
      const type = spec.attrs[name];
      if (!type) {
        add(`${path}@${name}`, "unknown-attr", `У <${node.tag}> нет атрибута «${name}»${/^on|^style$|^class$|^id$|^href$|^src$/.test(name) ? " (скрипты, стили, классы и ссылки запрещены)" : ""}. Допустимы: ${Object.keys(spec.attrs).join(", ") || "никаких"}.`, Object.keys(spec.attrs));
        continue;
      }
      const why = valueProblem(name, type, value);
      if (why) add(`${path}@${name}`, why.rule, why.message, why.allowed);
      if (type.type === "number" && !why) stats.numbers.add(canonNumber(value));
      if (type.type === "range" && !why) for (const m of value.matchAll(/\d+/g)) stats.numbers.add(String(Number(m[0])));
      if ((name === "title" || name === "caption") && type.type === "text") stats.texts.push({ path: `${path}@${name}`, text: value });
    }
    if (spec.text && node.tag === "c-empty" && !node.children.some((c) => c.type === "text" && c.text.trim())) add(path, "missing-text", "В <c-empty> нужен текст: одна фраза о том, чего не хватает.");
    if (spec.bound) stats.bound.push({ node, path, parent });
  };

  walk(dash, dash.children, "", 0);
  if (stats.elements > LIMITS.elements) add("c-dashboard", "too-many-elements", `Элементов ${stats.elements}, а можно не больше ${LIMITS.elements}. Уберите лишние карточки и заголовки.`);
  if (!stats.bound.length && !problems.length) add("c-dashboard", "no-charts", "На панели нет ни одного графика или числа. Добавьте c-stat, c-meter, c-bars, c-line, c-heatmap, c-table или c-list.");

  for (const item of stats.bound) checkBound(item, state, today, add);

  // Numbers about the person come from bindings, never from the model's own text.
  for (const { path, text } of stats.texts) {
    for (const m of text.matchAll(NUMBER_RE)) {
      if (!stats.numbers.has(canonNumber(m[0]))) {
        add(path, "number-in-text", `В тексте «${clip(text)}» стоит число ${m[0].trim()}, которого нет в привязках. Не пишите числа о человеке сами: уберите число или возьмите его из goal, limit или периода.`);
      }
    }
  }

  if (probe && stats.bound.length && !problems.some((p) => /^(unknown-set|unknown-relation)$/.test(p.rule))) {
    const results = stats.bound.map(({ node }) => probe(node.tag, { ...node.attrs }));
    if (results.every((r) => r === false)) add("c-dashboard", "all-empty", "Ни в одном графике сейчас нет данных, панель была бы пустой. Выберите наборы и связи, в которых есть записи.");
  }
  return finish(markup, fixed.changes);

  function finish(text, changes) {
    return { ok: problems.length === 0, problems, messages: problems.map((p) => p.message), markup: text, changes };
  }
}

const clip = (text) => (text.length > 40 ? `${text.trim().slice(0, 40)}…` : text.trim());

function checkBound({ node, path, parent }, state, today, add) {
  const spec = COMPONENTS[node.tag];
  const a = node.attrs;
  const own = (name) => (name in a ? `${path}@${name}` : path);
  const hasTitle = Boolean(a.title) || (parent.tag === "c-card" && Boolean(parent.attrs.title));
  if (!hasTitle) add(path, "no-title", `У <${node.tag}> нет названия. Добавьте title="…" ему или его карточке <c-card title="…">.`);
  if (!a.set) {
    add(path, "missing-attr", `У <${node.tag}> нет атрибута set: график берёт данные из набора. Укажите id набора из структуры.`);
    return;
  }
  const fn = a.fn || "sum";
  if (spec.attrs.value && fn !== "count" && !a.value) add(path, "missing-attr", `У <${node.tag}> нет атрибута value: какую связь считать. Либо укажите value, либо fn="count".`);
  if (spec.goal === "required" && !a.goal) add(path, "missing-attr", `У <c-meter> нет цели goal. Без цели используйте c-stat.`);

  // Shape of the chart against its range: too few or too many marks is not a chart.
  const range = a.range || spec.defaults?.range;
  const by = a.by || spec.defaults?.by || "day";
  if (range && !rangeProblem(range)) {
    const buckets = bucketsOf(resolveRange(range, "2026-06-15"), node.tag === "c-heatmap" || node.tag === "c-spark" ? "day" : by).length;
    if (node.tag === "c-bars" && buckets < 2) add(own("range"), "range-too-short", "Для столбцов нужно хотя бы два периода: возьмите @last7d, @last30d или @last12w.");
    if (node.tag === "c-bars" && buckets > LIMITS.bars) add(own("by"), "too-many-points", `Столбцов получается ${buckets}, а читаются не больше ${LIMITS.bars}. Возьмите by="week" или by="month", или период короче.`, BY);
    if (node.tag === "c-line" && buckets < 3) add(own("range"), "range-too-short", "Для линии нужно хотя бы три точки: возьмите период @last7d или длиннее.");
    if (node.tag === "c-line" && buckets > LIMITS.points) add(own("by"), "too-many-points", `Точек получается ${buckets}, а нужно не больше ${LIMITS.points}. Возьмите by="week".`, BY);
    if (node.tag === "c-spark" && buckets < 3) add(own("range"), "range-too-short", "Мини-график нужен хотя бы на три дня: возьмите @last7d или @last30d.");
    if (node.tag === "c-heatmap" && (buckets < 14 || buckets > LIMITS.heatmapWeeks * 7)) add(own("range"), "range-too-short", `Календарь показывает от 14 дней до ${LIMITS.heatmapWeeks} недель: возьмите @last12w или @last90d.`);
  }
  if (!state) return;

  const set = state.objects?.[a.set];
  if (!set || set.type !== "set" || set.archivedAt) {
    const sets = Object.values(state.objects || {}).filter((o) => o.type === "set" && !o.archivedAt);
    add(own("set"), "unknown-set", `Набора «${a.set}» нет. Доступные наборы: ${sets.map((s) => `${s.id} («${s.name}»)`).join(", ") || "нет ни одного"}.`, sets.map((s) => s.id));
    return;
  }
  const typeKey = set.props?.query?.source?.type || null;
  const type = typeKey ? state.types?.[typeKey] : null;
  const inSet = (key) => !type || type.relations.includes(key) || ["name"].includes(key);
  const checkRel = (name, wantNumeric) => {
    const key = a[name];
    if (!key) return null;
    const rel = state.relations?.[key];
    if (!rel) { add(own(name), "unknown-relation", `Связи «${key}» нет в пространстве. Возьмите ключ из структуры${type ? ` набора «${set.name}»: ${type.relations.join(", ")}` : ""}.`, type?.relations); return null; }
    if (!inSet(key)) { add(own(name), "not-in-set", `Набор «${set.name}» состоит из объектов «${type.name}», у них нет связи «${key}» (${rel.name}). Доступные связи: ${type.relations.join(", ")}.`, type.relations); return null; }
    if (wantNumeric && !isNumericRelation(state, key)) { add(own(name), "not-numeric", `Связь «${key}» (${rel.name}) не число, ${fn === "count" ? "" : `fn="${fn}" её не считает. `}Для суммы и среднего нужна числовая связь; для подсчёта записей используйте fn="count".`); return null; }
    return rel;
  };
  const valueRel = checkRel("value", fn !== "count");
  if (node.tag === "c-table" || node.tag === "c-list") {
    if (a.columns) for (const key of a.columns.split(",").map((s) => s.trim())) {
      if (!state.relations?.[key]) add(own("columns"), "unknown-relation", `Связи «${key}» нет в пространстве.`, type?.relations);
      else if (!inSet(key)) add(own("columns"), "not-in-set", `У объектов набора «${set.name}» нет связи «${key}».`, type.relations);
    }
    if (a.sort) checkRel("sort", false);
  }
  const needsDate = Boolean(spec.attrs.value) || Boolean(a.range);
  if (needsDate) {
    let dateKey = a.date || (typeKey ? dateRelationOf(state, typeKey) : null);
    if (a.date) {
      const rel = state.relations?.[a.date];
      if (!rel) add(own("date"), "unknown-relation", `Связи «${a.date}» нет в пространстве.`);
      else if (!["date", "datetime"].includes(rel.format)) add(own("date"), "no-date-relation", `Связь «${a.date}» (${rel.name}) не дата, ряд по ней не построить.`);
      else if (!inSet(a.date)) add(own("date"), "not-in-set", `У объектов набора «${set.name}» нет связи «${a.date}».`);
    } else if (!dateKey) {
      add(path, "no-date-relation", `В наборе «${set.name}» нет связи с датой, ряд по дням не построить. Выберите набор записей с датой (трекер, покупки, тренировки).`);
    }
  }
  const cat = checkRel("category", false);
  if (cat && !["select", "object"].includes(cat.format)) add(own("category"), "bad-category", `Разбивать на ряды можно по связи-списку или ссылке, а «${a.category}» (${cat.name}) имеет формат ${cat.format}. Возьмите связь формата select или object.`);
  if (a.goal && valueRel) {
    const goal = Number(a.goal);
    if (!(goal > 0)) add(own("goal"), "bad-goal", "Цель goal должна быть больше нуля.");
    if (isEnergyIntake(valueRel) && goal < KCAL_GOAL_FLOOR) add(own("goal"), "kcal-goal-floor", `Цель по энергии ${a.goal} ккал ниже ${KCAL_GOAL_FLOOR} ккал: приложение не ставит такие цели, потому что это ниже безопасного минимума. Поставьте не меньше ${KCAL_GOAL_FLOOR} или уберите цель.`);
  }
}

// The one-line request on top of an example file: <!-- Запрос: ... -->
export function exampleRequest(markup) {
  const m = /^\s*<!--\s*([\s\S]*?)\s*-->/.exec(markup);
  return m ? m[1] : "";
}
