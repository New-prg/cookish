// The manual: the system prompt of the model that builds a person's app. The
// lists, attributes and docs come from the catalogue, the defaults from
// expandDefaults and the space from printSpec, so a word exists in one place.
// Written here: the sentences around them and the samples, which use subjects
// that no corpus request has, so the manual never hands out an answer.
// tests/kit-manual.test.mjs fails when a catalogue entry is missing from the
// text, when a sample or an example does not pass checkBundle, and when a
// "wrong" line below stops being wrong.
import {
  AT, BUNDLE_ATTRS, BY, BY_FIELD_TYPES, BY_WORDS, CALC_FUNCTIONS, CARD_ATTRS, COLUMNS, ELEMENTS, ELEMENT_KEYS, ENERGY_FLOOR, EVERY, FIELD_ATTRS, FIELD_TYPES, FIELD_TYPE_KEYS,
  FNS, FOLLOWS, GOAL_PERS, GOAL_TYPES, ITEM_ATTRS, KINDS, KIND_KEYS, LIMITS, MARK_KINDS, RANGES, REMOVAL_KINDS, SCREEN_ATTRS, SOURCES, STATES, TRACK_ATTRS,
  UNIT_KEYS, UNMARKED, VIRTUAL,
} from "./catalogue.js";
import { expandDefaults } from "./defaults.js";
import { DECISIONS } from "./examples/decisions.js";
import { EXAMPLES, exampleById } from "./examples/index.js";
import { bundleToMarkup } from "./markup.js";
import { applyBundle, checkBundle } from "./pipeline.js";
import { printSpec, readSpec } from "./spec.js";
import { openObjectStore } from "../core/store.js";
import { escapeAttr } from "../viz/validate.js";

// target: the prompt for an empty or demo space, what a typical request costs.
// cap: a space that has grown; its summary shrinks to keys, the rest stays.
export const MANUAL_BUDGET = Object.freeze({ target: 9000, cap: 11000 });
export const estimateTokens = (text) => Math.ceil(String(text).length / 3.2);

const EXAMPLE_TODAY = "2026-10-24";
const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const list = (words) => words.join(", ");
const emptyState = () => openObjectStore({ storage: null, today: () => EXAMPLE_TODAY }).state();

// -- printing in either surface -----------------------------------------------------

// JSON that breaks only where a line would run long. A broken object keeps its
// plain values together on one line and gives each nested value its own.
const isPlain = (value) => value === null || typeof value !== "object" || (Array.isArray(value) && value.every((item) => item === null || typeof item !== "object"));

export function formatJson(value, indent = 0, width = 170) {
  const flat = JSON.stringify(value);
  if (value === null || typeof value !== "object" || flat.length + indent <= width) return flat;
  const pad = " ".repeat(indent + 1);
  const close = " ".repeat(indent);
  if (Array.isArray(value)) return `[\n${value.map((item) => pad + formatJson(item, indent + 1, width)).join(",\n")}\n${close}]`;
  const rows = [];
  let plain = [];
  const flush = () => { if (plain.length) rows.push(pad + plain.join(",")); plain = []; };
  for (const [key, item] of Object.entries(value)) {
    const long = typeof item === "string" && item.length > 50;
    if (isPlain(item) && !long) { plain.push(`${JSON.stringify(key)}:${JSON.stringify(item)}`); continue; }
    flush();
    rows.push(`${pad}${JSON.stringify(key)}: ${formatJson(item, indent + 1, width)}`);
  }
  flush();
  return `{\n${rows.join(",\n")}\n${close}}`;
}

const printBundle = (bundle, surface) => (surface === "html" ? bundleToMarkup(bundle) : formatJson(bundle));

// The answer a model gives: the reply first, then the bundle.
export function printAnswer(example, surface) {
  return printBundle(example.bundle ? { reply: example.reply, ...example.bundle } : { reply: example.reply }, surface);
}

// One declaration or element on one line. In markup it is cut out of a printed
// bundle; the wrapper only gives the node a legal parent.
const WRAPPERS = {
  el: (node) => ({ v: 2, name: "x", screens: [{ key: "s", cards: [{ key: "c", title: "t", body: [node] }] }] }),
  field: (node) => ({ v: 2, name: "x", tracks: [{ key: "t", name: "T", kind: "log", fields: [node] }] }),
  item: (node) => ({ v: 2, name: "x", tracks: [{ key: "t", name: "T", kind: "habit", items: [node] }] }),
  remove: (node) => ({ v: 2, name: "x", remove: [node] }),
  track: (node) => ({ v: 2, name: "x", tracks: [node] }),
};

export function snippet(kind, node, surface) {
  if (surface !== "html") return JSON.stringify(node);
  const tag = { el: node.el === "p" ? "<p" : `<c-${node.el}`, field: "<c-field", item: "<c-item", remove: "<c-remove", track: "<c-track" }[kind];
  const line = bundleToMarkup(WRAPPERS[kind](node)).split("\n").map((row) => row.trim()).find((row) => row.startsWith(tag));
  return line || JSON.stringify(node);
}

// -- the examples that fit the request -----------------------------------------------

const TAG_WORDS = [
  ["patch", /убер|удал|скрой|поменя|измени|переимен|перестав|сделай цел|поставь цел|добавь (на|в|ещё|еще|к)|теперь/i],
  ["remove", /убер|удал|скрой/i],
  ["home", /на главн/i],
  ["goal", /цел[ьиюе]|норм[ау]|не больше|не меньше|хотя бы|лимит|предел/i],
  ["goalmax", /не больше|максимум|лимит|предел|не превыш/i],
  ["log", /записыва|веду|считай|считать|учёт|учет|журнал|трекер|дневник|замер|вноси|подход|повтор/i],
  ["habit", /привычк|кажд|ежедневн|по утрам|по вечерам|по будням|отмеча|курс|принима|раз в недел|расписан/i],
  ["streak", /сери[яюи]/i],
  ["avoid", /не (ем|пью|курю|трачу)|без (сладк|алкогол|сахар|кофе|курени)|срыв/i],
  ["list", /список|чек-?лист|купить|покупк|собрать|взять|сборы/i],
  ["catalog", /справочник|каталог|маршрут|коллекц|завед|перечень|рецепт/i],
  ["follow", /к (каждому )?(приём|прием|тренировк)|после (еды|приём|прием|тренировк)/i],
  ["ration", /калори|белк|жир|углевод|рацион|кбжу/i],
  ["source", /калори|белк|жир|углевод|рацион|кбжу|потратил|сколько .*(сжёг|сжег)/i],
  ["embed", /раздел|экран|на главн.*(план|рацион|тренировк)|из плана/i],
  ["screen", /раздел|экран/i],
  ["quick", /кнопк|одним нажатием|быстр|\+\s?\d/i],
  ["form", /ввод|вводить|записыва|подход|повтор|сколько .*(км|кг|мин|раз|длин|штук)/i],
  ["calc", /сумм|произведен|темп|скорост|среднее|умнож|поделить|вычисл|посчита|километр/i],
  ["scale", /шкал|оценк|от 1 до|баллов|насколько/i],
  ["choice", /вариант|вкус|выбрать|категор|стиль|вид /i],
  ["link", /маршрут|упражнени|из списка|справочник/i],
  ["schedule", /утр|вечер|днём|на ночь|будн|выходн|кажд/i],
  ["time", /во сколько|время|в \d{1,2}(:\d\d)? час|\d{1,2}:\d\d/i],
  ["text", /заметк|коротко|комментар|опиши/i],
  ["quota", /раз в недел|хотя бы|\d+ раз/i],
  ["yesno", /были ли|да или нет|был ли|есть ли/i],
  ["heatmap", /календар/i],
  ["line", /график|динамик|тренд|как меняется/i],
  ["bars", /по дням|по неделям|столбц|сравни/i],
  ["counter", /сколько раз|на этой недел|сколько .*(сделал|полил|пропустил)/i],
  ["missed", /пропуст|пропуск|не сделан|забыл/i],
  ["weekdays", /по (понедельник|вторник|сред|четверг|пятниц|суббот|воскресень)|по будням|в будни|по выходным|раз в \d дн|(^|[ ,;:])(пн|вт|ср|чт|пт|сб|вс)[ ,;:]/i],
  ["month", /за месяц|в месяц|этот месяц|за последний месяц/i],
  ["frequency", /чаще|как часто|больше всего|по вариант|каких больше|куда (хож|езж)/i],
  ["course", /курс|на \d+ дн|две недели|экзамен|челлендж|программ/i],
  ["money", /цен[аыуе]|стоимост|₽|руб|трат|потрат|стоит/i],
  ["pace", /в день до конца|сколько ещё можно|сколько можно/i],
  ["delta", /последн(ее|ий|юю|его)|что изменилось|изменил|прирост|разниц|сколько проех/i],
  ["expire", /срок[а-я]* (годн|действ)|годност|истека|портит|срок действия/i],
  ["search", /искать|поиск|найти/i],
  ["edit", /править|исправ|редактир/i],
  ["refuse", /доз[ауы]|диагноз|лечени|похуд|схуд/i],
];

export const requestTags = (request) => new Set(TAG_WORDS.filter(([, pattern]) => pattern.test(String(request || ""))).map(([tag]) => tag));

const primaryKind = (example) => example.tags.find((tag) => KIND_KEYS.includes(tag));

// Three examples: the best by tag overlap, spread over kinds, the closest to the
// request last; with a patch one when the space already has tracks, because the
// first patch is the hardest. It comes last only when the request is a change.
export function pickExamples(request, { patch = false, limit = 3 } = {}) {
  const wanted = requestTags(request);
  const overlap = (example) => example.tags.filter((tag) => wanted.has(tag)).length;
  const rank = (pool, bonus = () => 0) => pool.map((example, index) => ({ example, index, score: overlap(example) + bonus(example) })).sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen = [];
  const pool = EXAMPLES.filter((example) => !example.after && example.bundle);
  const kinds = new Set();
  while (chosen.length < limit - (patch ? 1 : 0) && pool.length) {
    const best = rank(pool, (example) => (kinds.has(primaryKind(example)) ? 0 : 0.5))[0].example;
    pool.splice(pool.indexOf(best), 1);
    kinds.add(primaryKind(best));
    chosen.push(best);
  }
  chosen.reverse();
  if (patch) {
    const best = rank(EXAMPLES.filter((example) => example.after))[0].example;
    if (wanted.has("patch")) chosen.push(best);
    else chosen.unshift(best);
  }
  return chosen;
}

// -- the space a patch example starts from ------------------------------------------

function applyExample(example, state) {
  const checked = checkBundle(example.bundle, state, { today: EXAMPLE_TODAY });
  if (!checked.ok) throw new Error(`пример ${example.id} не проходит проверку: ${checked.problems.map((problem) => problem.message).join("; ")}`);
  const store = openObjectStore({ storage: null, today: () => EXAMPLE_TODAY });
  store.replaceAll(state);
  const applied = applyBundle(store, checked);
  if (!applied.ok) throw new Error(`пример ${example.id} не применился: ${applied.reason}`);
  return store.state();
}

// The space before `example`: its `after` examples applied one by one to
// `state` (an empty space by default), by the real pipeline, so the summary
// the model reads next to a patch example is true.
export function priorState(example, { state = emptyState() } = {}) {
  return (example.after || []).reduce((current, id) => {
    const earlier = exampleById(id);
    return applyExample(earlier, priorState(earlier, { state: current }));
  }, state);
}

// The space as the model reads it. The sources are left out: the vocabulary
// section already lists them.
function summaryMarkup(summary) {
  const attrs = (pairs) => pairs.filter(([, value]) => value != null && value !== "").map(([name, value]) => ` ${kebab(name)}="${escapeAttr(String(Array.isArray(value) ? value.join(",") : value))}"`).join("");
  const tracks = (summary.tracks || []).map((track) => {
    const fields = (track.fields || []).map((field) => `    <c-field${attrs(Object.entries(typeof field === "string" ? { key: field } : field))}/>`);
    const items = track.items?.length ? [`    <c-items keys="${track.items.join(",")}"/>`] : [];
    const head = attrs(Object.entries(track).filter(([name]) => name !== "fields" && name !== "items"));
    return fields.length || items.length ? `  <c-track${head}>\n${[...fields, ...items].join("\n")}\n  </c-track>` : `  <c-track${head}/>`;
  });
  const screens = (summary.screens || []).map((screen) => {
    const cards = (screen.cards || []).map((card) => (typeof card === "string" ? `    <c-card key="${card}"/>` : `    <c-card${attrs([["key", card.key], ["title", card.title], ["shows", (card.shows || []).join("; ")]])}/>`));
    return `  <c-screen${attrs([["key", screen.key], ["name", screen.name]])}>\n${cards.join("\n")}\n  </c-screen>`;
  });
  return `<c-space>\n${[...tracks, ...screens].join("\n")}\n</c-space>`;
}

export const hasTracks = (state) => Object.values(readSpec(state).tracks).some((track) => !track.readonly && !track.archived);

// A space that lives long outgrows the prompt. Past this size the summary
// loses detail step by step: fields shrink to keys, cards to keys, tracks to
// their name and kind, then to key and kind, screens to keys. Keys are what a
// change needs, so they stay.
export const SPACE_CHARS = 4800;
const SHRINK = [
  (summary) => ({ ...summary, tracks: summary.tracks.map((track) => ({ ...track, fields: track.fields.map((field) => field.key) })) }),
  (summary) => ({ ...summary, screens: summary.screens.map((screen) => ({ ...screen, cards: screen.cards.map((card) => card.key) })) }),
  (summary) => ({ ...summary, tracks: summary.tracks.map(({ key, name, kind }) => ({ key, name, kind })) }),
  (summary) => ({ ...summary, tracks: summary.tracks.map(({ key, kind }) => ({ key, kind })) }),
  (summary) => ({ ...summary, screens: summary.screens.map(({ key, cards }) => ({ key, cards })) }),
];

function summaryOf(state, surface) {
  const { sources: _, ...full } = printSpec(readSpec(state), { summary: true });
  if (!hasTracks(state) && full.screens.every((screen) => !screen.cards.length)) return "Пока пусто: ничего не собрано, на главной нет карточек.";
  const print = (summary) => (surface === "html" ? summaryMarkup(summary) : formatJson(summary));
  let summary = full;
  let text = print(summary);
  for (const shrink of SHRINK) {
    if (text.length <= SPACE_CHARS) break;
    summary = shrink(summary);
    text = print(summary);
  }
  return text;
}

const priorCache = new Map();
function priorSummary(example, surface) {
  const key = `${example.id}:${surface}`;
  if (!priorCache.has(key)) priorCache.set(key, summaryOf(priorState(example), surface));
  return priorCache.get(key);
}

// -- samples: the catalogue's own examples name subjects of the corpus ------------------

// One field per type and one element per kind, in the subjects of the examples
// of this directory. The test runs them through checkBundle on a space that
// holds those examples.
export const FIELD_SAMPLES = Object.freeze({
  number: { key: "portions", name: "Порций", type: "number", unit: "порц.", min: 1, max: 10, goal: 2, goalType: "max", goalPer: "day" },
  scale: { key: "calm", name: "Спокойствие", type: "scale", min: 1, max: 5, labels: ["тревожно", "", "нормально", "", "спокойно"] },
  text: { key: "feel", name: "Самочувствие", type: "text" },
  choice: { key: "flavor", name: "Вкус", type: "choice", options: ["шоколад", "ваниль", "ягоды"] },
  yesno: { key: "warm", name: "Размялся", type: "yesno" },
  date: { key: "valid_to", name: "Действует до", type: "date" },
  time: { key: "ate_at", name: "Во сколько", type: "time", required: true },
  calc: { key: "km", name: "Пройдено", type: "calc", calc: "rounds * lap / 1000", unit: "км" },
  link: { key: "route", name: "Маршрут", type: "link", to: "routes", required: true },
});

export const ELEMENT_SAMPLES = Object.freeze({
  stat: { el: "stat", of: "ski", value: "km", fn: "sum", range: "@last30d", compare: true, good: "up" },
  meter: { el: "meter", of: "shakes", value: "portions" },
  bars: { el: "bars", of: "ski", value: "km", fn: "sum", by: "week", range: "@last12w" },
  line: { el: "line", of: "meditate", value: "calm", fn: "avg", range: "@last30d" },
  spark: { el: "spark", of: "ski", value: "rounds", fn: "sum", range: "@last30d" },
  heatmap: { el: "heatmap", of: "meditate", value: "rate", range: "@last12w" },
  table: { el: "table", of: "ski", columns: ["date", "rounds", "lap", "km"], limit: 6, range: "@last30d" },
  list: { el: "list", of: "rides", columns: ["date", "route", "mins"], limit: 6, range: "@last30d" },
  p: { el: "p", text: "Отмечайте вещи, когда кладёте их в сумку." },
  empty: { el: "empty", text: "Записей пока нет." },
  quick: { el: "quick", of: "shakes", values: { portions: 1 }, label: "+1 порция" },
  form: { el: "form", of: "ski", fields: ["rounds", "lap"] },
  marks: { el: "marks", of: "gymbag", add: true },
  streak: { el: "streak", of: "floss" },
  embed: { el: "embed", what: "ration-today" },
});

// What each block of the classic sections shows.
export const EMBED_NOTES = Object.freeze({
  "ration-today": "приёмы пищи сегодня с отметками",
  "sport-today": "тренировки сегодня с отметками",
  requests: "запросы на покупки с отметкой «куплено»",
});

// The attributes that hold pairs show one sample instead of the catalogue's.
const PAIR_SAMPLES = Object.freeze({ values: { portions: 1 }, where: { route: "damba" }, plan: { km: 18 }, labels: { done: "принял" } });
const pairsText = (sample, surface) => (surface === "html" ? Object.entries(sample).map(([key, value]) => `${key}=${value}`).join(",") : JSON.stringify(sample));

function docOf(name, attr, surface) {
  if (name === "what" && attr.values) return `какой блок: ${attr.values.map((value) => `${value} (${EMBED_NOTES[value]})`).join(", ")}`;
  if (attr.type !== "pairs" || !PAIR_SAMPLES[name]) return attr.doc;
  return attr.doc.replace(/\{[^}]*\}/, pairsText(PAIR_SAMPLES[name], surface));
}

// -- sections -------------------------------------------------------------------------

const markFlag = (attr) => (attr.required ? "*" : attr.requiredOnCreate ? "+" : "");
const attrName = (name, surface) => (surface === "html" ? kebab(name) : name);

function contract(surface, refusal) {
  const html = surface === "html";
  const envelope = html
    ? `ОТВЕТ
Один <c-bundle v="2" name="Название">…</c-bundle>, без текста вокруг и без \`\`\`. Первым внутри <c-reply>1–3 предложения человеку</c-reply>, дальше <c-track>, <c-screen>, <c-remove>: только то, что нужно этой просьбе.
Атрибуты: список пишется через запятую (options="утром,вечером"), пары как ключ=значение (values="portions=1", where="route=damba"), «да» это yes, имя goalType пишется goal-type. Элемент это один тег: <c-meter of="…" value="…"/>.`
    : `ОТВЕТ
Один JSON-объект, без текста вокруг и без \`\`\`:
{"reply":"…","v":2,"name":"Название","tracks":[…],"screens":[…],"remove":[…]}
reply: 1–3 предложения человеку по-русски: что собрано и где это найти. Если что-то выбрал сам, скажи об этом.
name: название изменения. tracks, screens, remove: пиши только то, что нужно этой просьбе.`;
  return `Ты собираешь приложение для одного человека из готовых деталей. Кода, стилей, ссылок и картинок у тебя нет, только детали из этого описания.

${envelope}
Если просьбу нельзя выполнить этими деталями или она небезопасна, отвечай только словами: ${html ? "<c-reply>…</c-reply>" : "{\"reply\":\"…\"}"}, без ${html ? "<c-bundle>" : "v, name и tracks"}. Честно скажи почему и что можно сделать вместо. Пример:
${printAnswer(refusal, surface)}
Если просьба расплывчата, не задавай вопрос: собери маленькое разумное приложение (один–три простых трека) и назови свой выбор в reply.
Если проверка вернёт ошибки, исправь только их и пришли ответ целиком.`;
}

function world(surface) {
  const names = surface === "html" ? "<c-track>, <c-screen>, <c-card>" : "tracks, screens, cards";
  return `КАК УСТРОЕНО ПРИЛОЖЕНИЕ (${names})
Всё, что человек ведёт, это трек: прогулки, привычка, список, справочник. Трек хранит записи и отметки, их вносит только человек кнопками; ты записи не создаёшь.
Экран состоит из карточек, карточка из 1–${LIMITS.elements} элементов: числа, графики, кнопки, формы. Экран home это главная, он есть всегда.
Ключ, которого нет в пространстве, создаёт новое. Ключ, который уже есть, меняет только написанное. remove убирает.
Рацион (ration), Спорт (sport) и Покупки (shopping) уже есть в приложении: их числа можно показывать, но писать в них нельзя.`;
}

// What a person says → the kind. The catalogue's own `when` lines name subjects
// of the corpus, so the table is worded here, one line per kind.
const WISH = Object.freeze({
  log: "число или событие, которое человек вносит, когда оно случилось; записей может быть много в день: прогулка, поездка, порция, самочувствие",
  habit: "повторяется по расписанию, отмечается «сделал» или «пропустил»: зарядка, нить для зубов, «не пить алкоголь»",
  list: "разовые пункты, каждый отмечается один раз: сборы в зал, дела",
  catalog: "постоянный перечень, на который ссылаются записи другого трека: маршруты, сорта чая. Строки в items пишешь ты, если они названы; если человек должен пополнять перечень сам, поставь на экран list с add",
  follow: "вопрос или поле к каждому приёму пищи (follows: ration) или тренировке (follows: sport) из плана: был ли в приёме десерт",
});

// A piece of a checked answer, cut out by key; see examples/decisions.js.
const attrsText = (node, names, surface) => names
  .map((name) => (surface === "html" ? `${kebab(name)}="${escapeAttr(String(node[name]))}"` : `"${name}":${JSON.stringify(node[name])}`))
  .join(surface === "html" ? " " : ",");

export function pieceNode(piece) {
  if (piece.node) return { kind: "el", node: piece.node };
  const bundle = exampleById(piece.base).bundle;
  if (piece.card) {
    const card = bundle.screens.flatMap((screen) => screen.cards || []).find((candidate) => candidate.key === piece.card);
    return { kind: "el", node: card.body[piece.at] };
  }
  const track = bundle.tracks.find((candidate) => candidate.key === piece.track);
  return { kind: "attrs", node: piece.item === undefined ? track : track.items[piece.item] };
}

const pieceText = (piece, surface) => {
  const { kind, node } = pieceNode(piece);
  return kind === "el" ? snippet("el", node, surface) : attrsText(node, piece.attrs, surface);
};

function wishTable(surface) {
  const rows = KIND_KEYS.map((key) => `- ${key} (${KINDS[key].name}): ${WISH[key]}.`);
  const decisions = DECISIONS.map((row) => `- «${row.wish}»: ${row.say}${row.show.length ? ` Так: ${row.show.map((piece) => pieceText(piece, surface)).join("  ")}` : ""}`);
  return `ЧТО ВЫБРАТЬ
Тип трека (kind):
${rows.join("\n")}
Нужно число каждый раз (километры, порции): log. Нужна галочка по расписанию: habit. Серия дней без числа: habit. «Не делать» это habit с avoid.
Только цифры Рациона, Спорта или Покупок: треков не нужно, элементы с of=ration, sport или shopping.
От слов человека к деталям (после текста кусок проверенного ответа):
${decisions.join("\n")}
Ещё: свои варианты это поле choice, перечень со свойствами catalog и поле link, оценка поле scale.
Поменять или убрать то, что уже собрано: те же ключи из «Пространства» и remove, заново не собирай. Карточка с известным key: её body заменяется целиком. Переставить карточки: у экрана order со списком ключей, они встанут первыми по порядку, остальные следом.`;
}

// Enums that no line of the vocabulary prints yet: the ones of the elements, the cards and the tracks.
function otherEnums() {
  const printed = new Set(["kind", "unit", "type", "fn", "range", "by", "goalType", "goalPer", "unmarked", "follows", "v"]);
  const found = new Map();
  for (const attrs of [...Object.values(ELEMENTS).map((element) => element.attrs), CARD_ATTRS, TRACK_ATTRS, FIELD_ATTRS]) {
    for (const [name, attr] of Object.entries(attrs)) {
      if (attr.type === "enum" && !printed.has(name) && !found.has(name)) found.set(name, attr.values.map(String).join(" | "));
    }
  }
  return [...found].map(([name, values]) => `${name}: ${values}`);
}

// The formula functions in one line each; the catalogue lists only their names.
export const CALC_DOCS = Object.freeze({
  if: "if(условие, да, нет)",
  coalesce: "coalesce(a, b): первое непустое",
  round: "round(x) или round(x, шаг)",
  floor: "floor(x)",
  ceil: "ceil(x)",
  abs: "abs(x)",
  min: "min(a, b)",
  max: "max(a, b)",
  days: "days(дата1, дата2): дней между датами",
  addDays: "addDays(дата, n)",
  weekday: "weekday(дата): день недели, 0 воскресенье … 6 суббота",
  spanHours: "spanHours(от, до): часы между двумя временами ЧЧ:ММ, через полночь тоже",
});

const sourceValue = (v) => `${v.key} (${v.name.toLowerCase()}${v.unit && !v.name.toLowerCase().split(" ").includes(v.unit.toLowerCase()) ? `, ${v.unit}` : ""})`;

// The range grammar with the forms a model may copy: the plain words on one line, each N form on its own.
function rangeLines() {
  const words = RANGES.filter((r) => r.examples.length === 1 && r.examples[0] === r.token && r.token !== "@all");
  const forms = RANGES.filter((r) => !words.includes(r));
  return [
    `  ${words.map((r) => `${r.token} (${r.doc})`).join(", ")}`,
    ...forms.map((r) => `  ${r.token}${r.examples[0] === r.token ? "" : ` (${r.examples.join(", ")})`}: ${r.doc}`),
  ];
}

function vocabulary() {
  const sources = Object.entries(SOURCES).map(([key, source]) => `${key}: ${list(source.values.map(sourceValue))}`);
  return `СЛОВАРИ (бери слова только отсюда)
kind: ${list(KIND_KEYS)}
type поля: ${list(FIELD_TYPE_KEYS)}
unit: ${list(UNIT_KEYS)}
every: ${EVERY.doc}
at: ${AT.doc}
fn (как свести значения):
${Object.entries(FNS).map(([name, doc]) => `  ${name}: ${doc}`).join("\n")}
range (период, одно слово):
${rangeLines().join("\n")}
by (у bars и line): ${Object.keys(BY).join(", ")}; у bars ещё ключ поля (${BY_FIELD_TYPES.join(", ")}) или слово ${Object.entries(BY_WORDS).map(([word, doc]) => `${word} (${doc})`).join(", ")}: столбец на каждое значение
goalType: ${Object.keys(GOAL_TYPES).join(" | ")}. goalPer: ${Object.keys(GOAL_PERS).join(" | ")}
states: ${list(STATES)}. unmarked: ${Object.keys(UNMARKED).join(" | ")}. follows: ${Object.keys(FOLLOWS).join(" | ")}
${otherEnums().join(". ")}
Величины value у habit и list: ${Object.entries(VIRTUAL.marks.values).map(([key, doc]) => `${key} (${doc})`).join(", ")}. У любого трека: ${Object.keys(VIRTUAL.any).join(", ")}.
Источники of (только читаются):
${sources.map((line) => `  ${line}`).join("\n")}
Столбцы table и list: ${Object.keys(COLUMNS).join(", ")} и ключи полей.
Функции calc: ${CALC_FUNCTIONS.map((name) => CALC_DOCS[name]).join("; ")}.`;
}

function attrLine(name, attr, surface) {
  const only = attr.kinds && attr.kinds.length < KIND_KEYS.length ? ` Только для ${list(attr.kinds)}.` : "";
  return `  ${attrName(name, surface)}${markFlag(attr)}: ${docOf(name, attr, surface)}.${only}`;
}

const COMMON_FIELD_ATTRS = Object.freeze(["on", "required", "hint"]);

function declarations(surface) {
  const html = surface === "html";
  const block = (title, attrs, skip = []) => `${title}\n${Object.entries(attrs).filter(([name]) => !skip.includes(name)).map(([name, attr]) => attrLine(name, attr, surface)).join("\n")}`;
  const types = FIELD_TYPE_KEYS.map((key) => {
    const type = FIELD_TYPES[key];
    const own = type.attrs.filter((a) => !COMMON_FIELD_ATTRS.includes(a));
    return `  ${key}: ${snippet("field", FIELD_SAMPLES[key], surface)} ${type.doc}.${own.length ? ` Допустимы: ${list(own.map((a) => attrName(a, surface)))}.` : ""}`;
  });
  const removals = Object.entries(REMOVAL_KINDS).map(([key, doc]) => `${key} — ${doc.replace(/,? например .*$/, "")}`);
  return `ОБЪЯВЛЕНИЯ (* обязательно, + обязательно для нового ключа)
${block(html ? "<c-bundle>" : "Пакет", BUNDLE_ATTRS, ["tracks", "screens", "remove"])}
${block(html ? "<c-track> (внутри <c-field> и <c-item>)" : "Трек (tracks)", TRACK_ATTRS, html ? ["fields", "items"] : [])}
${block(html ? "<c-field>" : "Поле (fields)", FIELD_ATTRS)}
Поле по типам (у всех, кроме calc, ещё ${list(COMMON_FIELD_ATTRS)}; у calc hint):
${types.join("\n")}
${block(html ? "<c-item>" : "Пункт (items)", ITEM_ATTRS)}
${block(html ? "<c-screen> (внутри <c-card>)" : "Экран (screens)", SCREEN_ATTRS, html ? ["cards"] : [])}
${block(html ? "<c-card> (внутри элементы)" : "Карточка (cards)", CARD_ATTRS, html ? ["body"] : [])}
Убрать (${html ? "<c-remove>" : "remove"}), ровно один ключ в записи: ${removals.join("; ")}.`;
}

// Where an element works, printed once per group instead of once per element.
function placementLines(heading) {
  const groups = new Map();
  for (const key of ELEMENT_KEYS) {
    const kinds = KIND_KEYS.filter((kind) => (ELEMENTS[key].kinds || []).includes(kind));
    if (!kinds.length || kinds.length === KIND_KEYS.length) continue;
    groups.set(list(kinds), [...(groups.get(list(kinds)) || []), heading(key)]);
  }
  const needing = (test) => ELEMENT_KEYS.filter((key) => test(ELEMENTS[key])).map(heading);
  const rangeless = needing((e) => e.needsRange && e.rangeUnlessCatalog);
  return [
    ...[...groups].map(([kinds, names]) => `  ${names.join(", ")}: только треки ${kinds}`),
    `  В of можно ration, sport, shopping: ${needing((e) => e.sources).join(", ")}.`,
    `  range обязателен: ${needing((e) => e.needsRange).join(", ")}${rangeless.length ? `; у справочника не нужен: ${rangeless.join(", ")}` : ""}. У meter период берётся из цели поля.`,
  ];
}

function elementLines(surface) {
  const html = surface === "html";
  const heading = (key) => (html ? ELEMENTS[key].tag : key);
  const counts = new Map();
  const seen = (name, attr) => `${name}\u0000${docOf(name, attr, surface)}`;
  for (const element of Object.values(ELEMENTS)) for (const [name, attr] of Object.entries(element.attrs)) counts.set(seen(name, attr), (counts.get(seen(name, attr)) || 0) + 1);
  const shared = new Map([...counts].filter(([, n]) => n > 1).map(([key]) => key.split("\u0000")));
  const lines = ELEMENT_KEYS.map((key) => {
    const element = ELEMENTS[key];
    const doc = element.doc.replace(/\.$/, "");
    if (element.text) {
      return `${heading(key)}: ${doc}. ${html ? "Текст пишется внутри тега." : "Атрибут: text*."} Пример: ${snippet("el", ELEMENT_SAMPLES[key], surface)}`;
    }
    const names = Object.entries(element.attrs).map(([name, attr]) => {
      const required = attr.required || (name === "value" && element.needsValue);
      return `${attrName(name, surface)}${required ? "*" : ""}${shared.has(name) ? "" : ` (${docOf(name, attr, surface)})`}`;
    });
    const notes = [
      element.needsGoal ? "У поля должна быть цель." : "",
      element.needsHabitOrGoal ? "Нужен habit или поле с целью." : "",
    ].filter(Boolean);
    return `${heading(key)}: ${doc}. Атрибуты: ${names.join(", ")}. ${notes.join(" ")} Пример: ${snippet("el", ELEMENT_SAMPLES[key], surface)}`.replace(/ {2,}/g, " ");
  });
  const common = [...shared].filter(([name]) => name !== "range").map(([name, doc]) => `  ${attrName(name, surface)}: ${doc}.`);
  return `ЭЛЕМЕНТЫ КАРТОЧКИ
${lines.join("\n")}
Где работают:
${placementLines(heading).join("\n")}
Общие атрибуты:
${common.join("\n")}`;
}

// One fresh track per case; the table below is what expandDefaults makes of it,
// and the test pins the same cases. `when` says what makes the case.
const NUMBER = (extra = {}) => ({ key: "n", name: "Число", type: "number", ...extra });
export const DEFAULT_CASES = Object.freeze([
  { kind: "log", when: "число копится за день", track: { kind: "log", fields: [NUMBER({ unit: "мл", goal: 2000 })] } },
  { kind: "log", when: "один счётчик (порц., шт., раз)", track: { kind: "log", fields: [NUMBER({ unit: "порц.", goal: 2, goalType: "max" })] } },
  { kind: "log", when: "измерение без цели (температура, рост)", track: { kind: "log", fields: [NUMBER({ unit: "см" })] } },
  { kind: "habit", when: "обычная", track: { kind: "habit", items: [{ name: "Пункт" }] } },
  { kind: "habit", when: "у пункта есть until (курс)", track: { kind: "habit", items: [{ name: "Пункт", until: "2026-11-06" }] } },
  { kind: "list", when: "обычный", track: { kind: "list", items: [{ name: "Пункт" }] } },
  { kind: "list", when: "в поле ₽ planned: true", track: { kind: "list", fields: [NUMBER({ unit: "₽", planned: true })], items: [{ name: "Пункт", plan: { n: 100 } }] } },
  { kind: "catalog", when: "любой", track: { kind: "catalog", fields: [{ key: "note", name: "Заметка", type: "text" }] } },
  { kind: "follow", when: "есть поле-число", track: { kind: "follow", follows: "ration", fields: [{ key: "lvl", name: "Уровень", type: "scale" }] } },
  { kind: "follow", when: "есть поле choice", track: { kind: "follow", follows: "ration", fields: [{ key: "feel", name: "Как", type: "choice", options: ["хорошо", "плохо"] }] } },
]);

// An element as the table names it: its tag and the attributes that make it that card.
const briefEl = (el) => {
  const extra = [
    el.goal && `goal ${el.goal}`,
    ["last", "delta", "count"].includes(el.fn) && `fn ${el.fn}`,
    el.by && `by ${el.by}`,
    el.rows && `rows ${el.rows}`,
    el.where && `where ${Object.entries(el.where).map(([key, value]) => `${key} ${value}`).join(", ")}`,
    el.el === "stat" && el.range === "@thisMonth" && "range @thisMonth",
    el.el === "bars" && el.value === "done" && "value done",
    el.add && "add",
    el.edit && "edit",
    el.search && "search",
  ].filter(Boolean);
  return extra.length ? `${el.el} (${extra.join(", ")})` : el.el;
};

export function defaultsFor(track) {
  const none = { tracks: {}, screens: {}, cards: {} };
  const expanded = expandDefaults(none, { v: 2, name: "Демо", tracks: [{ key: "demo", name: "Демо", ...track }] }, { today: EXAMPLE_TODAY });
  const shown = (screens) => screens.flatMap((s) => s.cards || []).flatMap((c) => c.body || []);
  return {
    track: expanded.tracks[0],
    home: shown((expanded.screens || []).filter((s) => s.key === "home")),
    own: shown((expanded.screens || []).filter((s) => s.key !== "home")),
  };
}

// What the app adds by itself, printed from the function that adds it.
function defaultsTable() {
  const rows = DEFAULT_CASES.map(({ kind, when, track }) => {
    const { home, own } = defaultsFor(track);
    return `- ${kind}, ${when}: на главную ${home.length ? list(home.map(briefEl)) : "ничего"}; на экран ${own.length ? list(own.map(briefEl)) : "ничего"}.`;
  });
  return `ЧТО ПРИЛОЖЕНИЕ ДОБАВЛЯЕТ САМО
Если в ответе у трека нет ни одной карточки, приложение соберёт экраны по типу трека. Если карточка есть только на главной, экран трека с историей приложение добавит всё равно.
${rows.join("\n")}
Кнопки по умолчанию: ${MARK_KINDS.map((kind) => `${kind} ${list(KINDS[kind].defaults.states)}`).join(", ")}; unmarked ${[...new Set(MARK_KINDS.map((kind) => KINDS[kind].defaults.unmarked))].join(", ")}. avoid=true у habit: день без отметки удался (unmarked assumed), кнопки «держусь» и «сорвался», серия считает дни без срывов.
Поэтому самый короткий верный ответ это один трек. Свои экраны и карточки пиши, когда человек просит конкретный вид.`;
}

// Mistakes a weak model makes, each proved wrong by the validator in the test:
// `base` is an example, `at` the path of the node in its bundle, `kind` what
// the node is, `wrong` the node with the slip, `rule` the problem the
// validator must give for it, `say` why in a few words.
export const MISTAKES = Object.freeze([
  { id: "no-range", base: "ski", at: ["screens", 1, "cards", 1, "body", 0], kind: "el", rule: "missing-attr", say: "у bars, line, stat, spark, heatmap, table и list нужен range",
    wrong: { el: "bars", of: "ski", value: "km", fn: "sum", by: "week" } },
  { id: "meter-without-goal", base: "ski", at: ["screens", 1, "cards", 0, "body", 0], kind: "el", rule: "no-goal", say: "meter берёт цель из поля: у поля нужен goal, иначе возьми stat",
    wrong: { el: "meter", of: "ski", value: "rounds", fn: "sum" } },
  { id: "every-in-words", base: "flossing", at: ["tracks", 0, "items", 0], kind: "item", rule: "bad-value", say: "расписание every отдельно, время суток at отдельно",
    wrong: { name: "Почистить нитью", every: "каждый вечер" } },
  { id: "reserved-key", base: "ski", at: ["tracks", 0, "fields", 0], kind: "field", rule: "reserved-key", say: "count, done, rate, open, date и ещё несколько слов заняты приложением",
    wrong: { key: "count", name: "Кругов", type: "number", min: 1, max: 100 } },
]);

function mistakeLines(surface) {
  return MISTAKES.map((mistake) => {
    const right = mistake.at.reduce((node, key) => node[key], exampleById(mistake.base).bundle);
    return `✗ ${snippet(mistake.kind, mistake.wrong, surface)}\n✓ ${snippet(mistake.kind, right, surface)}  (${mistake.say})`;
  });
}

function rules(surface) {
  const limits = `до ${LIMITS.tracks} треков, ${LIMITS.fields} полей в треке, ${LIMITS.items} пунктов в треке, ${LIMITS.screens} экранов, ${LIMITS.cards} карточек на экране, ${LIMITS.elements} элемента в карточке, ${LIMITS.bundleChars} знаков во всём ответе`;
  return `ПРАВИЛА
1. Ключи: латиница в нижнем регистре, цифры и _, с буквы. Ключи пространства копируй из «Пространства», похожие не придумывай.
2. Новый ключ создаёт: у трека нужны name и kind, у поля name и type, у экрана name, у карточки title и body. Существующий ключ меняет только написанное.
3. Цель пишется один раз, в поле: goal, goalType, goalPer. В элементы число-цель не пишут: meter, bars и line берут её сами (goal due у meter привычки это не число).
4. value это ключ поля того же трека или слово из словарей. У каждого элемента один источник of.
5. fn: sum для того, что копится за день (порции, минуты, километры, деньги), avg для измерений и оценок.
6. Записи вносит человек. В ответе нет значений записей, id, ссылок, картинок, скриптов и стилей.
7. Безопасность: цель по энергии ниже ${ENERGY_FLOOR} ккал в день не ставь. Дозы лекарств и добавок (мг, мкг, МЕ, таб.) не считай и не пиши в calc. Чисел о человеке (его показателей, калорий, доз) в названиях, подписях и reply не пиши: числа показывают элементы. Не стыди за срывы.
8. Не обещай того, чего в приложении нет: напоминаний, уведомлений, ввода из датчиков и других приложений. Записи вносит человек, скажи это в reply, если просят иначе. Обещай в reply только то, что показывают карточки ответа.
9. Новая карточка встаёт в конец экрана; переставить можно order у экрана.
10. Лимиты: ${limits}.

ЧАСТЫЕ ОШИБКИ (✗ неверно, ✓ верно)
${mistakeLines(surface).join("\n")}`;
}

const WEEKDAY_NAMES = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const dayAfter = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// Dates the model would otherwise count by hand and get wrong.
function todayLine(today) {
  if (!today) return "";
  const weekday = WEEKDAY_NAMES[new Date(`${today}T00:00:00Z`).getUTCDay()];
  const ahead = [1, 2, 3, 6, 7, 13, 14, 29, 30].map((n) => `+${n} д. ${dayAfter(today, n)}`);
  return `Сегодня ${today}, ${weekday}. Даты вперёд: ${ahead.join(", ")}. Пункт на N дней: from сегодня, until сегодня плюс N−1 дней.\n`;
}

function spaceSection(state, surface, today) {
  return `ПРОСТРАНСТВО ЧЕЛОВЕКА СЕЙЧАС
${todayLine(today)}Ключи отсюда копируй, когда меняешь или убираешь.
${summaryOf(state, surface)}`;
}

function examplesSection(request, state, surface) {
  const picked = pickExamples(request, { patch: hasTracks(state) });
  const blocks = picked.map((example, index) => {
    const before = example.after ? `\nВ пространстве уже было:\n${priorSummary(example, surface)}` : "";
    return `Пример ${index + 1}.${before}\nПросьба: «${example.request}»\nОтвет:\n${printAnswer(example, surface)}`;
  });
  return `ПРИМЕРЫ\n${blocks.join("\n\n")}`;
}

const REFUSAL = EXAMPLES.find((example) => !example.bundle);

// The parts in reading order.
export function manualParts(state, { surface = "json", request = "", today = null } = {}) {
  return [
    ["contract", contract(surface, REFUSAL)],
    ["world", world(surface)],
    ["wish", wishTable(surface)],
    ["vocabulary", vocabulary()],
    ["declarations", declarations(surface)],
    ["elements", elementLines(surface)],
    ["defaults", defaultsTable()],
    ["rules", rules(surface)],
    ["examples", examplesSection(request, state, surface)],
    ["space", spaceSection(state, surface, today)],
    ["request", `ПРОСЬБА ЧЕЛОВЕКА\n«${String(request).trim()}»\nОтветь ${surface === "html" ? "<c-reply> и <c-bundle>" : "одним JSON-объектом"} по правилам выше.`],
  ].map(([id, text]) => ({ id, text }));
}

export function renderManual(state, options = {}) {
  return manualParts(state, options).map((part) => part.text).join("\n\n");
}

// What does not depend on the person: the assistant carries it in the
// description of its propose_space tool.
export function renderReference(surface = "json") {
  const keep = new Set(["world", "wish", "vocabulary", "declarations", "elements", "defaults", "rules"]);
  return manualParts(emptyState(), { surface }).filter((part) => keep.has(part.id)).map((part) => part.text).join("\n\n");
}
