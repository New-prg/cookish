// The single source of the kit vocabulary: kinds with their defaults, field
// types, units, schedules, ranges, functions, virtual values and the UI
// elements with every attribute. The validator, the normalizer, the defaults,
// the markup validator and the model manual all read this file, so a word
// exists in exactly one place. Data first; the few functions are derivations.

import { RANGE_LIMITS, RANGE_WORDS, parseLastRange } from "../core/query.js";

export const BUNDLE_VERSION = 2;

export const LIMITS = Object.freeze({
  bundleChars: 9000, tracks: 4, fields: 10, items: 30, screens: 4, cards: 10, elements: 4,
  name: 60, title: 60, caption: 120, text: 200, hint: 80, reply: 400, label: 30, icon: 8,
  options: 12, optionChars: 30, columns: 5, rows: 50, formula: 200, where: 2, values: 4, plan: 6,
  bars: 60, points: 400, heatmapDays: 189,
});

// -- keys ----------------------------------------------------------------------
// Lower-case Latin, digits and single underscores, starting with a letter.
export const KEYS = Object.freeze({
  track: { min: 2, max: 20, doc: "ключ трека: латиница в нижнем регистре, цифры и _, от 2 до 20 символов" },
  field: { min: 1, max: 16, doc: "ключ поля: латиница в нижнем регистре, цифры и _, до 16 символов" },
  item: { min: 2, max: 30, doc: "ключ пункта: латиница в нижнем регистре, цифры и _, до 30 символов" },
  screen: { min: 2, max: 20, doc: "ключ экрана: латиница в нижнем регистре, цифры и _, до 20 символов" },
  card: { min: 2, max: 30, doc: "ключ карточки: латиница в нижнем регистре, цифры и _, до 30 символов" },
});
const KEY_SHAPE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
export const isKey = (kind, key) => typeof key === "string" && KEY_SHAPE.test(key) && key.length >= KEYS[kind].min && key.length <= KEYS[kind].max && !Object.hasOwn(Object.prototype, key);

// -- kinds ---------------------------------------------------------------------
export const STATES = Object.freeze(["done", "changed", "skipped"]);
export const STATE_LABELS = Object.freeze({ done: "сделано", changed: "изменено", skipped: "пропущено" });
export const UNMARKED = Object.freeze({
  ignore: "день без отметки ничего не считает (по умолчанию)",
  missed: "прошлый день без отметки считается пропуском",
  assumed: "прошлый день без отметки считается выполненным; отмечают только срывы",
});

// `marks` kinds hold one mark per (item, date) or per (slot, date); the others
// hold free entries or catalogue rows. `avoid` flips a habit to «не делать».
export const KINDS = Object.freeze({
  log: {
    name: "Журнал", marks: false, items: false, fact: true, order: 1,
    doc: "Записи без расписания, сколько угодно в день.",
    when: "человек вносит измерение или событие, когда оно случилось: вода, вес, сон, подходы, настроение",
    defaults: { states: [], unmarked: null, grace: null },
  },
  habit: {
    name: "Привычка", marks: true, items: true, fact: true, order: 2,
    doc: "Пункты по расписанию; на каждый день и пункт одна отметка.",
    when: "повторяется по расписанию и отмечается «сделал» или «пропустил»: витамины, зарядка, «не есть сладкое»",
    defaults: { states: ["done", "skipped"], unmarked: "ignore", grace: 0 },
  },
  list: {
    name: "Список", marks: true, items: true, fact: true, order: 3,
    doc: "Пункты без расписания, каждый отмечается один раз.",
    when: "разовый список, пункты добавляют и отмечают выполненными: покупки, дела, сборы",
    defaults: { states: ["done"], unmarked: "ignore", grace: null },
  },
  catalog: {
    name: "Справочник", marks: false, items: true, fact: false, order: 4,
    doc: "Названия с полями; строки справочника — пункты, на них ссылаются поля других треков.",
    when: "постоянный перечень, на который ссылаются записи других треков: упражнения, лекарства, рецепты",
    defaults: { states: [], unmarked: null, grace: null },
  },
  follow: {
    name: "Дополнение к приёмам", marks: true, items: false, fact: true, order: 5,
    doc: "Отметка к каждому приёму пищи или тренировке из Рациона и Спорта.",
    when: "нужно добавить вопрос к приёмам пищи или тренировкам, которые ведёт Рацион или Спорт: сытость, самочувствие после тренировки",
    defaults: { states: ["done"], unmarked: "ignore", grace: null },
  },
});
export const KIND_KEYS = Object.freeze(Object.keys(KINDS));
export const MARK_KINDS = Object.freeze(KIND_KEYS.filter((k) => KINDS[k].marks));

// avoid="yes" on a habit: unmarked days count as kept, the buttons are renamed.
export const AVOID = Object.freeze({
  unmarked: "assumed",
  labels: Object.freeze({ done: "держусь", skipped: "сорвался" }),
});

export const FOLLOWS = Object.freeze({
  ration: "приёмы пищи Рациона",
  sport: "тренировки Спорта",
  shopping: "покупки из Запросов: поле спрашивают, когда позиция куплена",
});

// -- field types ---------------------------------------------------------------
// `format` is the store format of the relation; `numeric` types take sum, avg,
// min and max; `attrs` lists the field attributes the type accepts.
export const FIELD_TYPES = Object.freeze({
  number: { format: "number", numeric: true, doc: "число, можно с единицей и целью", attrs: ["unit", "min", "max", "step", "goal", "goalType", "goalPer", "planned", "on", "required", "hint"], example: { key: "ml", name: "Выпито", type: "number", unit: "мл", min: 1, max: 5000, goal: 2000 } },
  scale: { format: "number", numeric: true, doc: "оценка по шкале от min до max (по умолчанию 1–5), подписи labels по шагам", attrs: ["min", "max", "labels", "planned", "on", "required", "hint"], defaults: { min: 1, max: 5 }, example: { key: "level", name: "Насколько сыт", type: "scale", min: 1, max: 5, hint: "1 — голоден, 5 — объелся" } },
  text: { format: "text", numeric: false, doc: "короткий текст", attrs: ["on", "required", "hint"], example: { key: "note", name: "Заметка", type: "text" } },
  choice: { format: "select", numeric: false, doc: "один вариант из списка options (2–12)", attrs: ["options", "on", "required", "hint"], example: { key: "mood", name: "Настроение", type: "choice", options: ["хорошее", "обычное", "плохое"] } },
  yesno: { format: "checkbox", numeric: false, doc: "да или нет", attrs: ["on", "required", "hint"], example: { key: "slept_well", name: "Выспался", type: "yesno" } },
  date: { format: "date", numeric: false, doc: "дата", attrs: ["on", "required", "hint"], example: { key: "since", name: "С какого дня", type: "date" } },
  time: { format: "time", numeric: false, doc: "время суток ЧЧ:ММ", attrs: ["planned", "on", "required", "hint"], example: { key: "lay", name: "Лёг", type: "time", required: true } },
  calc: { format: "formula", numeric: true, doc: "считается сама по другим полям трека, записать её нельзя", attrs: ["calc", "unit", "goal", "goalType", "goalPer", "hint"], example: { key: "volume", name: "Тоннаж", type: "calc", calc: "sets * reps * weight", unit: "кг" } },
  link: { format: "object", numeric: false, doc: "ссылка на строку справочника (to — ключ трека kind=catalog) или на продукт (to=\"product\")", attrs: ["to", "on", "required", "hint"], example: { key: "exercise", name: "Упражнение", type: "link", to: "exercises", required: true } },
});
export const FIELD_TYPE_KEYS = Object.freeze(Object.keys(FIELD_TYPES));
export const NUMERIC_TYPES = Object.freeze(FIELD_TYPE_KEYS.filter((t) => FIELD_TYPES[t].numeric));

export const GOAL_TYPES = Object.freeze({ min: "цель надо достичь (по умолчанию)", max: "лимит: больше цели плохо" });
export const GOAL_PERS = Object.freeze({ day: "в день (по умолчанию)", week: "в неделю", month: "в месяц" });
export const ENERGY_FLOOR = 1200;

// -- units ---------------------------------------------------------------------
// unit → { dimension, dose }. A dose unit never takes part in a formula: the app
// records doses and shows trends, it does not calculate them.
export const UNITS = Object.freeze({
  "мл": { dimension: "volume" }, "л": { dimension: "volume" },
  "г": { dimension: "mass" }, "кг": { dimension: "mass" },
  "мг": { dimension: "mass", dose: true }, "мкг": { dimension: "mass", dose: true },
  "МЕ": { dimension: null, dose: true }, "таб.": { dimension: "count", dose: true },
  "ккал": { dimension: "energy" },
  "₽": { dimension: "money" },
  "шт.": { dimension: "count" }, "раз": { dimension: "count" }, "подх.": { dimension: "count" }, "шагов": { dimension: "count" }, "стр.": { dimension: "count" }, "порц.": { dimension: "count" },
  "мин": { dimension: "duration" }, "ч": { dimension: "duration" }, "сек": { dimension: "duration" },
  "км": { dimension: null }, "м": { dimension: null }, "см": { dimension: null },
  "%": { dimension: "ratio" }, "°C": { dimension: null }, "уд./мин": { dimension: null },
  "мм рт. ст.": { dimension: "pressure" }, "ммоль/л": { dimension: "glucose" },
  "очк.": { dimension: null }, "баллов": { dimension: null },
});
export const UNIT_KEYS = Object.freeze(Object.keys(UNITS));
export const UNIT_ALIASES = Object.freeze({
  ml: "мл", l: "л", g: "г", kg: "кг", mg: "мг", mcg: "мкг", ug: "мкг", iu: "МЕ", ме: "МЕ", kcal: "ккал", cal: "ккал", rub: "₽", руб: "₽", "руб.": "₽", р: "₽", "р.": "₽", rur: "₽",
  шт: "шт.", pcs: "шт.", "таб": "таб.", "таблетка": "таб.", "таблеток": "таб.", min: "мин", minutes: "мин", h: "ч", hr: "ч", hours: "ч", час: "ч", часов: "ч", sec: "сек", s: "сек",
  km: "км", m: "м", cm: "см", "°c": "°C", c: "°C", bpm: "уд./мин", "уд/мин": "уд./мин", "мм.рт.ст.": "мм рт. ст.", "ммртст": "мм рт. ст.", mmol: "ммоль/л", "ммоль": "ммоль/л", steps: "шагов", шаги: "шагов", шаг: "шагов",
});

// -- schedule -----------------------------------------------------------------
export const WEEKDAYS = Object.freeze(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export const WEEKDAY_ALIASES = Object.freeze({ пн: "mon", вт: "tue", ср: "wed", чт: "thu", пт: "fri", сб: "sat", вс: "sun" });
export const EVERY = Object.freeze({
  words: Object.freeze({ day: "каждый день", weekdays: "по будням", weekends: "по выходным", open: "без срока: пункт ждёт, пока его отметят" }),
  days: WEEKDAYS,
  interval: Object.freeze({ min: 2, max: 30, doc: "2d…30d: раз в N дней от даты from" }),
  doc: "day, weekdays, weekends, список дней вроде mon,wed,fri, 2d…30d, open или одна дата ГГГГ-ММ-ДД",
});
const INTERVAL = /^(\d{1,2})d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (value) => typeof value === "string" && DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export function isEvery(value) {
  if (typeof value !== "string") return false;
  if (value in EVERY.words || isDate(value)) return true;
  const m = INTERVAL.exec(value);
  if (m) return Number(m[1]) >= EVERY.interval.min && Number(m[1]) <= EVERY.interval.max;
  const days = value.split(",");
  return days.every((d) => WEEKDAYS.includes(d)) && new Set(days).size === days.length && days.every((d, i) => i === 0 || WEEKDAYS.indexOf(d) > WEEKDAYS.indexOf(days[i - 1]));
}

export const AT = Object.freeze({
  words: Object.freeze({ morning: "утром", noon: "днём", evening: "вечером", night: "на ночь" }),
  order: Object.freeze({ morning: 1, noon: 2, evening: 3, night: 4 }),
  doc: "morning, noon, evening, night или время ЧЧ:ММ; только упорядочивает список, это не будильник",
});
export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isAt = (value) => typeof value === "string" && (value in AT.words || TIME_OF_DAY.test(value));

// -- ranges, functions, virtual values ----------------------------------------
// One grammar: the words below and @lastNd, @lastNw, @lastNm. `token` is how the
// manual prints a form, `examples` are tokens a model can copy as they are.
export const RANGES = Object.freeze([
  { token: "@today", examples: ["@today"], doc: "сегодня" },
  { token: "@yesterday", examples: ["@yesterday"], doc: "вчера" },
  { token: "@lastNd", examples: ["@last7d", "@last30d", "@last90d"], doc: `последние N дней, N от 1 до ${RANGE_LIMITS.d}` },
  { token: "@lastNw", examples: ["@last8w", "@last12w"], doc: `последние N недель, с понедельника, N от 1 до ${RANGE_LIMITS.w}` },
  { token: "@lastNm", examples: ["@last3m", "@last6m"], doc: `последние N месяцев, с первого числа, N от 1 до ${RANGE_LIMITS.m}` },
  { token: "@thisWeek", examples: ["@thisWeek"], doc: "эта неделя, с понедельника" },
  { token: "@thisMonth", examples: ["@thisMonth"], doc: "этот месяц" },
  { token: "@all", examples: ["@all"], doc: "всё время: от первой записи или создания трека до сегодня; у bars и line с @all нужен by: week или month" },
]);
export const RANGE_EXAMPLES = Object.freeze(RANGES.flatMap((r) => r.examples));
export const RANGE_HELP = `Допустимо: ${RANGES.map((r) => r.token).join(", ")}; например ${RANGE_EXAMPLES.join(", ")}.`;
export const LAST_UNITS = Object.freeze({ d: "дней", w: "недель", m: "месяцев" });

// null when the token is in the grammar, else the Russian reason with the legal forms.
export function rangeProblem(token) {
  if (typeof token !== "string") return `период пишется строкой. ${RANGE_HELP}`;
  if (RANGE_WORDS.includes(token)) return null;
  const last = parseLastRange(token);
  if (!last) return `период ${JSON.stringify(token)} не подходит. ${RANGE_HELP}`;
  const max = RANGE_LIMITS[last.unit];
  if (last.n < 1 || last.n > max) return `в периоде ${token} N должно быть от 1 до ${max} (${LAST_UNITS[last.unit]}). ${RANGE_HELP}`;
  return null;
}
export const isRange = (token) => rangeProblem(token) === null;

export const FNS = Object.freeze({
  sum: "сумма за день, затем за период",
  avg: "среднее по дням с данными: мл, ккал, ₽, мин, км и г сначала суммируются за день, вес, шкала и поле без единицы сначала усредняются за день",
  min: "наименьшее: дневной итог для мл, ккал, ₽, мин, иначе наименьшая запись",
  max: "наибольшее: дневной итог для мл, ккал, ₽, мин, иначе наибольшая запись",
  count: "число записей (value не нужен)",
  last: "значение последней записи периода",
  first: "значение первой записи периода",
  delta: "последняя запись минус первая (только stat и meter)",
});
export const FN_KEYS = Object.freeze(Object.keys(FNS));
export const BY = Object.freeze({ day: "по дням", week: "по неделям", month: "по месяцам" });
// Besides a time step, bars take `by` as a field key or one of these words: one bar per value.
export const BY_WORDS = Object.freeze({ item: "по пунктам", state: "по отметкам", slot: "по приёмам или тренировкам" });
export const BY_FIELD_TYPES = Object.freeze(["choice", "text", "yesno", "link"]);
export const CATEGORY_FIELD_TYPES = Object.freeze(["choice", "link", "text"]);

// where: a value may start with an operator. `state` also reads done for a changed mark.
export const WHERE_OPS = Object.freeze({ "=": "равно (по умолчанию)", "!=": "не равно", "<": "меньше", "<=": "не больше", ">": "больше", ">=": "не меньше" });
export const WHERE_KEYS = Object.freeze({
  state: "отметка: done (включая changed), changed, skipped, open (ещё не отмечено)",
  item: "ключ пункта habit, list или catalog",
  date: "дата записи",
});
export const WHERE_STATES = Object.freeze(["done", "changed", "skipped", "open"]);
const CONDITION = /^(!=|<=|>=|=|<|>)\s*([\s\S]*)$/;
// "<=+7d" → { op: "<=", value: "+7d" }; a plain value is "=".
export function splitCondition(raw) {
  if (typeof raw !== "string") return { op: "=", value: raw };
  const m = CONDITION.exec(raw.trim());
  return m ? { op: m[1], value: m[2].trim() } : { op: "=", value: raw };
}
// where written as text, "state!=done,expires<=+7d" → { state: "!=done", expires: "<=+7d" }; null when a part has no key.
export function wherePairs(text) {
  const out = {};
  for (const part of String(text ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^([A-Za-z][A-Za-z0-9_]*)\s*(!=|<=|>=|=|<|>)\s*([\s\S]+)$/.exec(part);
    if (!m) return null;
    out[m[1]] = m[2] === "=" ? m[3].trim() : `${m[2]}${m[3].trim()}`;
  }
  return out;
}
const RELATIVE_DAY = /^@?(?:(today|yesterday|tomorrow)|([+-]\d+)d)$/;
// today, yesterday, tomorrow, +7d, -30d, a date: the calendar day it means, null if it is none.
export function dayToken(value, today) {
  const text = String(value ?? "").trim();
  if (isDate(text)) return text;
  const m = RELATIVE_DAY.exec(text);
  if (!m) return null;
  const shift = m[1] ? { today: 0, yesterday: -1, tomorrow: 1 }[m[1]] : Number(m[2]);
  return new Date(Date.parse(`${today}T00:00:00Z`) + shift * 86400000).toISOString().slice(0, 10);
}

// Functions a calc field may call; the formula language has more, the kit keeps to these.
export const CALC_FUNCTIONS = Object.freeze(["if", "coalesce", "round", "floor", "ceil", "abs", "min", "max", "days", "addDays", "weekday", "spanHours"]);

const money = (key, name) => ({ key, name, unit: "₽" });
export const SOURCES = Object.freeze({
  ration: {
    name: "Рацион", icon: "🍽", slots: true, doc: "съеденное по отметкам в Рационе (читается, не записывается); by: slot — по приёмам",
    values: [
      { key: "kcal", name: "Ккал", unit: "ккал" }, { key: "protein", name: "Белки", unit: "г" }, { key: "fat", name: "Жиры", unit: "г" }, { key: "carbs", name: "Углеводы", unit: "г" },
      { key: "kcal_planned", name: "Ккал по плану", unit: "ккал" }, { key: "protein_planned", name: "Белки по плану", unit: "г" }, { key: "skipped", name: "Пропущено приёмов", unit: "шт." },
      { key: "meals", name: "Съедено приёмов", unit: "шт." }, { key: "meals_planned", name: "Приёмов по плану", unit: "шт." },
    ],
  },
  sport: {
    name: "Спорт", icon: "🏃", slots: true, doc: "тренировки и активности из Спорта (читается, не записывается); by: slot — по тренировкам",
    values: [
      { key: "burned", name: "Сожжено", unit: "ккал" }, { key: "burned_planned", name: "Сожжено по плану", unit: "ккал" }, { key: "minutes", name: "Минут", unit: "мин" },
      { key: "sessions", name: "Тренировок сделано", unit: "шт." }, { key: "sessions_planned", name: "Тренировок по плану", unit: "шт." },
    ],
  },
  shopping: {
    name: "Покупки", icon: "🛒", doc: "покупки из Запросов (читается, не записывается)",
    values: [money("spent", "Потрачено"), { key: "bought", name: "Куплено позиций", unit: "шт." }],
  },
});
export const SOURCE_KEYS = Object.freeze(Object.keys(SOURCES));

// Virtual values are counted by the engine, not stored; they are never field keys.
export const VIRTUAL = Object.freeze({
  any: Object.freeze({ count: "число записей" }),
  marks: Object.freeze({
    kinds: ["habit", "list"],
    values: Object.freeze({ done: "отмечено выполненным", skipped: "отмечено пропущенным", due: "должно быть сделано", rate: "доля выполненного, от 0 до 1", open: "ещё не отмечено" }),
  }),
  sources: SOURCES,
});
export const VIRTUAL_UNITS = Object.freeze({ done: "шт.", skipped: "шт.", due: "шт.", open: "шт.", count: "шт.", rate: null });
// Words a field key may not take: virtual values, record columns and formula words.
export const RESERVED = Object.freeze([
  "count", ...Object.keys(VIRTUAL.marks.values),
  "date", "item", "state", "slot", "name", "id", "this", "today", "profile", "true", "false", "null",
]);
export const COLUMNS = Object.freeze({ date: "дата записи", item: "название пункта", state: "отметка", slot: "приём", name: "название строки справочника" });

// Classic words that cannot be track keys.
export const RESERVED_TRACK_KEYS = Object.freeze([...SOURCE_KEYS, "home"]);

// -- shapes of the declarations -----------------------------------------------
const A = (type, doc, extra = {}) => ({ type, doc, ...extra });

export const BUNDLE_ATTRS = Object.freeze({
  v: A("enum", "версия формата, всегда 2", { values: [2], required: true, example: 2 }),
  name: A("text", "название приложения, до 60 символов; им подписывается изменение", { max: LIMITS.name, required: true, example: "Вода" }),
  reply: A("text", "1–3 предложения человеку; чисел о человеке здесь нет", { max: LIMITS.reply, example: "Собрал учёт воды с целью." }),
  tracks: A("list", "объявления треков", { max: LIMITS.tracks }),
  screens: A("list", "объявления экранов с карточками", { max: LIMITS.screens }),
  remove: A("list", "что убрать: по одному ключу в записи", { max: 12 }),
});

export const TRACK_ATTRS = Object.freeze({
  key: A("key", "ключ трека; новый ключ создаёт трек, существующий меняет его", { keyKind: "track", required: true, example: "water" }),
  name: A("text", "название трека", { max: LIMITS.name, requiredOnCreate: true, example: "Вода" }),
  icon: A("text", "один значок-эмодзи", { max: LIMITS.icon, example: "💧" }),
  kind: A("enum", "рецепт трека: log, habit, list, catalog или follow", { values: KIND_KEYS, requiredOnCreate: true, example: "log" }),
  avoid: A("bool", "привычка «не делать»: день без отметки считается удавшимся, кнопки «держусь» и «сорвался»", { kinds: ["habit"], example: true }),
  states: A("list", "какие кнопки отметки есть и в каком порядке: done, changed, skipped", { kinds: MARK_KINDS, values: STATES, example: ["done", "skipped"] }),
  labels: A("pairs", "свои подписи кнопок: {\"done\":\"принял\"}", { kinds: MARK_KINDS, keys: STATES, max: LIMITS.label, example: { done: "принял" } }),
  unmarked: A("enum", "как считать прошлый день без отметки: ignore, missed или assumed", { kinds: MARK_KINDS, values: Object.keys(UNMARKED), example: "ignore" }),
  grace: A("int", "сколько пропущенных дней серия переживает, 0–3", { kinds: ["habit"], min: 0, max: 3, example: 1 }),
  times: A("int", "сколько отметок в период нужно для «выполнено», 1–7 (вместе с per)", { kinds: ["habit"], min: 1, max: 7, example: 3 }),
  per: A("enum", "период для times: day или week", { kinds: ["habit"], values: ["day", "week"], example: "week" }),
  follows: A("enum", "к чему привязан трек follow: ration (приёмы), sport (тренировки) или shopping (купленные позиции)", { kinds: ["follow"], values: Object.keys(FOLLOWS), requiredFor: "follow", example: "ration" }),
  fields: A("list", "поля трека, до 10", { max: LIMITS.fields }),
  items: A("list", "пункты: расписание habit и list, строки catalog; до 30", { kinds: ["habit", "list", "catalog"], max: LIMITS.items }),
});

export const FIELD_ATTRS = Object.freeze({
  key: A("key", "ключ поля внутри трека, не зарезервированное слово", { keyKind: "field", required: true, example: "ml" }),
  name: A("text", "название поля", { max: LIMITS.name, requiredOnCreate: true, example: "Выпито" }),
  type: A("enum", "тип поля", { values: FIELD_TYPE_KEYS, requiredOnCreate: true, example: "number" }),
  unit: A("enum", "единица измерения из списка", { values: UNIT_KEYS, example: "мл" }),
  min: A("number", "наименьшее допустимое значение", { example: 1 }),
  max: A("number", "наибольшее допустимое значение", { example: 5000 }),
  step: A("number", "шаг ввода", { example: 0.5 }),
  options: A("list", "варианты choice: от 2 до 12 строк", { max: LIMITS.options, example: ["утром", "вечером"] }),
  labels: A("list", "подписи шагов scale, по одной на шаг, пустая строка пропускает", { example: ["голоден", "", "норма", "", "переел"] }),
  calc: A("text", "формула по ключам полей этого трека", { max: LIMITS.formula, example: "sets * reps * weight" }),
  to: A("text", "ключ трека kind=catalog или product", { example: "exercises" }),
  goal: A("number", "цель, объявляется один раз на поле; 0 снимает цель", { example: 2000 }),
  goalType: A("enum", "min — цель достичь, max — лимит", { values: Object.keys(GOAL_TYPES), example: "min" }),
  goalPer: A("enum", "за какой период цель", { values: Object.keys(GOAL_PERS), example: "day" }),
  planned: A("bool", "пункты несут плановое значение (число, scale, время), отметка «изменил» его заменяет", { example: true }),
  on: A("list", "при каких отметках спрашивать поле: done, changed, skipped (для skipped нужна кнопка skipped в states)", { values: STATES, example: ["done"] }),
  required: A("bool", "поле обязательно при записи", { example: true }),
  hint: A("text", "подсказка под полем, без чисел о человеке", { max: LIMITS.hint, example: "1 — голоден, 5 — объелся" }),
});

export const ITEM_ATTRS = Object.freeze({
  key: A("key", "ключ пункта; если не задан, берётся из названия", { keyKind: "item", example: "vit_d" }),
  name: A("text", "название пункта", { max: LIMITS.name, requiredOnCreate: true, example: "Витамин D" }),
  every: A("text", EVERY.doc, { example: "day" }),
  at: A("text", AT.doc, { example: "morning" }),
  from: A("date", "с какого дня пункт действует; по умолчанию день создания", { example: "2026-10-24" }),
  until: A("date", "по какой день пункт действует", { example: "2026-12-31" }),
  plan: A("pairs", "плановые значения полей {\"dose\":1}", { example: { dose: 1 } }),
});

export const SCREEN_ATTRS = Object.freeze({
  key: A("key", "ключ экрана; home — главный, он есть всегда", { keyKind: "screen", required: true, example: "water" }),
  name: A("text", "название экрана", { max: LIMITS.name, requiredOnCreate: true, example: "Вода" }),
  icon: A("text", "значок экрана", { max: LIMITS.icon, example: "💧" }),
  cards: A("list", "карточки экрана, до 10", { max: LIMITS.cards }),
  order: A("list", "ключи карточек этого экрана по порядку: перечисленные встанут первыми в этом порядке, остальные следом", { max: LIMITS.cards, example: ["water_today", "water_week"] }),
});

export const CARD_ATTRS = Object.freeze({
  key: A("key", "ключ карточки; если не задан, берётся из заголовка", { keyKind: "card", example: "water_today" }),
  title: A("text", "заголовок карточки, без чисел о человеке", { max: LIMITS.title, requiredOnCreate: true, example: "Вода сегодня" }),
  caption: A("text", "подпись под заголовком, без чисел о человеке", { max: LIMITS.caption, example: "Последние 7 дней" }),
  size: A("enum", "full — во всю ширину, half — половина", { values: ["full", "half"], example: "full" }),
  body: A("list", "от 1 до 4 элементов; задаёт карточку целиком", { max: LIMITS.elements, requiredOnCreate: true }),
});

export const REMOVAL_KINDS = Object.freeze({
  card: "ключ карточки", track: "ключ трека", screen: "ключ экрана", item: "трек.пункт, например vitamins.vit_d", field: "трек.поле, например bench.note",
});

// -- UI elements ---------------------------------------------------------------
const OF = A("track", "ключ трека или классического источника ration, sport, shopping", { required: true, example: "water" });
const VALUE = A("value", "ключ поля трека или виртуальная величина (done, rate, open, count…)", { example: "ml" });
const FN = A("enum", "как свести значения: sum, avg, min, max, count; avg, min и max у воды, ккал, денег и минут считаются по дневным итогам, avg у веса и шкал по дневным средним", { values: FN_KEYS, example: "sum" });
const RANGE = A("range", "период из списка range", { example: "@last7d" });
const WHERE = A("pairs", "фильтр записей {\"поле\":\"значение\"}, до 2 условий; значение может начинаться со знака !=, <, <=, >, >= и называть день как today, +7d, -30d; ключи: поля трека, state (done, changed, skipped, open), item, date; ссылку можно назвать ключом или именем строки", { max: LIMITS.where, example: { expires: "<=+7d" } });
const BY_TIME = A("enum", "шаг по времени: day, week, month", { values: Object.keys(BY), example: "week" });
const BY_BARS = A("by", "по времени day, week, month или по значению: поле choice, text, yesno, link либо item, state, slot", { example: "week" });
const CATEGORY = A("field", "поле choice, link или text, по которому разбить на ряды", { example: "mood" });
const ROWS = A("enum", "items — считать пункты (строки справочника, пункты habit и list), а не записи; у справочника всегда так", { values: ["items"], kinds: ["habit", "list", "catalog"], example: "items" });
const PACE = A("enum", "left — сколько ещё можно или нужно в день до конца недели или месяца цели; нужно поле с goalPer week или month", { values: ["left"], example: "left" });
const EDIT = A("bool", "строка открывается на правку: «Сохранить» и «Удалить»", { example: true });
const SEARCH = A("bool", "над списком строка поиска", { example: true });
const COLUMNS_ATTR = A("fields", "столбцы: ключи полей и date, item, state, slot, name; до 5", { max: LIMITS.columns, example: ["date", "ml"] });
const LIMIT = A("int", "сколько строк показать, 1–50", { min: 1, max: LIMITS.rows, example: 5 });

// kinds: which track kinds the element works on; sources: whether ration, sport
// and shopping are allowed in `of`. bound displays need `range` unless noted.
export const ELEMENTS = Object.freeze({
  stat: {
    tag: "c-stat", bound: true, display: true, kinds: ["log", "habit", "list", "catalog", "follow"], sources: true, needsValue: true, needsRange: true,
    doc: "Одно число за период; с rows: items считает пункты, а не записи.",
    attrs: { of: OF, value: VALUE, fn: FN, range: RANGE, where: WHERE, rows: ROWS, pace: PACE, compare: A("bool", "сравнить с прошлым периодом", { example: true }), spark: A("bool", "добавить мини-график", { example: true }), good: A("enum", "какое направление хорошее: up, down, none", { values: ["up", "down", "none"], example: "up" }) },
    example: { el: "stat", of: "water", value: "ml", fn: "sum", range: "@last7d", compare: true, good: "up" },
  },
  meter: {
    tag: "c-meter", bound: true, display: true, kinds: ["log", "habit", "list", "follow"], sources: true, needsValue: true, needsRange: false, needsGoal: true,
    doc: "Значение против цели поля; период по умолчанию берётся из goalPer поля. У привычки goal: due берёт цель из расписания: «3 из 14».",
    attrs: { of: OF, value: VALUE, fn: FN, range: RANGE, where: WHERE, category: CATEGORY, pace: PACE, goal: A("enum", "due — цель из расписания привычки: «3 из 14»; value done, период @all для курса с until", { values: ["due"], kinds: ["habit"], example: "due" }) },
    example: { el: "meter", of: "water", value: "ml" },
  },
  bars: {
    tag: "c-bars", bound: true, display: true, kinds: ["log", "habit", "list", "catalog", "follow"], sources: true, needsValue: true, needsRange: true,
    doc: "Столбцы по дням, неделям или месяцам; цель поля рисуется линией. С by по полю, item, state или slot — столбец на каждое значение.",
    attrs: { of: OF, value: VALUE, fn: FN, range: RANGE, by: BY_BARS, category: CATEGORY, stack: A("enum", "stacked — друг на друге, grouped — рядом", { values: ["stacked", "grouped"], example: "stacked" }), where: WHERE, rows: ROWS },
    example: { el: "bars", of: "water", value: "ml", fn: "sum", range: "@last7d" },
  },
  line: {
    tag: "c-line", bound: true, display: true, kinds: ["log", "habit", "list", "follow"], sources: true, needsValue: true, needsRange: true,
    doc: "Линия во времени.",
    attrs: { of: OF, value: VALUE, fn: FN, range: RANGE, by: BY_TIME, category: CATEGORY, area: A("bool", "залить площадь под линией", { example: true }), where: WHERE },
    example: { el: "line", of: "weight", value: "kg", fn: "avg", range: "@last30d" },
  },
  spark: {
    tag: "c-spark", bound: true, display: true, kinds: ["log", "habit", "list", "follow"], sources: true, needsValue: true, needsRange: true,
    doc: "Мини-график без осей.",
    attrs: { of: OF, value: VALUE, fn: FN, range: RANGE, where: WHERE },
    example: { el: "spark", of: "bench", value: "volume", fn: "sum", range: "@last30d" },
  },
  heatmap: {
    tag: "c-heatmap", bound: true, display: true, kinds: ["log", "habit", "list", "follow"], sources: true, needsValue: true, needsRange: true,
    doc: "Календарь по неделям, цвет по значению дня.",
    attrs: { of: OF, value: VALUE, fn: FN, range: RANGE, where: WHERE },
    example: { el: "heatmap", of: "vitamins", value: "rate", range: "@last12w" },
  },
  table: {
    tag: "c-table", bound: true, display: true, rows: true, kinds: ["log", "habit", "list", "catalog", "follow"], sources: false, needsRange: true, rangeUnlessCatalog: true,
    doc: "Таблица записей; у справочника и с rows: items — пунктов с плановыми значениями и состоянием.",
    attrs: { of: OF, columns: COLUMNS_ATTR, limit: LIMIT, sort: A("field", "поле для сортировки", { example: "date" }), order: A("enum", "asc или desc", { values: ["asc", "desc"], example: "desc" }), range: RANGE, where: WHERE, rows: ROWS, edit: EDIT, search: SEARCH },
    example: { el: "table", of: "bench", columns: ["date", "sets", "reps", "weight"], limit: 6, range: "@last90d" },
  },
  list: {
    tag: "c-list", bound: true, display: true, rows: true, kinds: ["log", "habit", "list", "catalog", "follow"], sources: false, needsRange: true, rangeUnlessCatalog: true,
    doc: "Строки записей; у справочника и с rows: items — пунктов с плановыми значениями и состоянием.",
    attrs: { of: OF, columns: COLUMNS_ATTR, limit: LIMIT, sort: A("field", "поле для сортировки", { example: "date" }), order: A("enum", "asc или desc", { values: ["asc", "desc"], example: "desc" }), range: RANGE, where: WHERE, rows: ROWS, edit: EDIT, search: SEARCH, add: A("bool", "форма под списком: название и поля трека, чтобы человек добавлял строки сам; только у справочника и списка", { example: true }) },
    example: { el: "list", of: "water", columns: ["date", "ml"], limit: 5, range: "@last30d" },
  },
  p: {
    tag: "p", display: false, text: true, kinds: [], sources: false,
    doc: "Короткий абзац пояснения, без чисел о человеке.",
    attrs: { text: A("text", "текст до 200 символов", { max: LIMITS.text, required: true, example: "Отмечайте приём сразу после еды." }) },
    example: { el: "p", text: "Отмечайте приём сразу после еды." },
  },
  empty: {
    tag: "c-empty", display: false, text: true, kinds: [], sources: false,
    doc: "Подсказка на пустом месте: одна фраза.",
    attrs: { text: A("text", "текст до 200 символов", { max: LIMITS.text, required: true, example: "Записей пока нет." }) },
    example: { el: "empty", text: "Записей пока нет." },
  },
  quick: {
    tag: "c-quick", bound: false, input: true, kinds: ["log", "habit", "list"], sources: false,
    doc: "Кнопка записи одним касанием: пишет значения values как запись за сегодня.",
    attrs: { of: OF, values: A("pairs", "значения полей {\"ml\":250}, до 4; число внутри min и max поля", { required: true, max: LIMITS.values, example: { ml: 250 } }), label: A("text", "подпись кнопки, до 30 символов; по умолчанию собирается из значений", { max: LIMITS.label, example: "Стакан" }) },
    example: { el: "quick", of: "water", values: { ml: 250 } },
  },
  form: {
    tag: "c-form", bound: false, input: true, kinds: ["log", "habit", "list"], sources: false,
    doc: "Форма записи с полями; по умолчанию все поля, кроме calc.",
    attrs: { of: OF, fields: A("fields", "поля формы по порядку; calc сюда нельзя", { example: ["sets", "reps", "weight"] }) },
    example: { el: "form", of: "bench", fields: ["sets", "reps", "weight"] },
  },
  marks: {
    tag: "c-marks", bound: false, input: true, kinds: ["habit", "list", "follow"], sources: false,
    doc: "Что отметить: сегодняшние пункты привычки, открытые пункты списка, приёмы дня для follow.",
    attrs: { of: OF, add: A("bool", "разрешить добавлять пункты на месте (для list)", { example: true }), date: A("enum", "день, с которого открываются отметки: @today или @yesterday", { values: ["@today", "@yesterday"], example: "@today" }) },
    example: { el: "marks", of: "vitamins" },
  },
  streak: {
    tag: "c-streak", bound: false, input: false, kinds: ["habit", "log", "list", "follow"], sources: false, needsHabitOrGoal: true,
    doc: "Серия: текущая (при grace 0 срыв начинает её заново), лучшая и доля за 30 дней; срыв стирает только текущую.",
    attrs: { of: OF },
    example: { el: "streak", of: "vitamins" },
  },
  embed: {
    tag: "c-embed", bound: false, input: true, kinds: [], sources: false, noTrack: true,
    doc: "Готовый блок классического раздела на экране.",
    attrs: { what: A("enum", "ration-today, sport-today или requests", { values: ["ration-today", "sport-today", "requests"], required: true, example: "ration-today" }) },
    example: { el: "embed", what: "ration-today" },
  },
});
export const ELEMENT_KEYS = Object.freeze(Object.keys(ELEMENTS));
export const BOUND_ELEMENTS = Object.freeze(ELEMENT_KEYS.filter((k) => ELEMENTS[k].bound));

// A boolean in the bundle is JSON `true`; the markup spells it yes. `isOn` reads both.
export const isOn = (value) => value === true || value === "yes";

// -- the markup validator ------------------------------------------------------
// viz/validate.js knows the types text, enum, bool, number, key, keys and range.
// Every element becomes one of its component entries; `kit` carries what the
// markup validator cannot check alone (bindings are checked against the space).
function markupType(attr) {
  switch (attr.type) {
    case "enum": return { type: "enum", values: attr.values.map(String) };
    case "bool": return { type: "bool" };
    case "int": return { type: "number", integer: true, min: attr.min ?? 0, max: attr.max ?? 1e6 };
    case "number": return { type: "number", min: attr.min ?? -1e9, max: attr.max ?? 1e9 };
    case "text": return { type: "text", max: attr.max ?? LIMITS.text };
    case "fields": return { type: "keys" };
    case "pairs": return { type: "text", max: 80 };
    case "range": return { type: "range" };
    case "by": return { type: "text", max: 40 };
    case "track": case "value": case "field": return { type: "key" };
    default: return { type: "text", max: LIMITS.text };
  }
}

export function componentsForMarkup() {
  const out = {};
  for (const [key, el] of Object.entries(ELEMENTS)) {
    const attrs = {};
    for (const [name, attr] of Object.entries(el.attrs)) {
      attrs[name === "goalType" ? "goal-type" : name] = markupType(attr);
    }
    out[el.tag] = {
      doc: el.doc,
      attrs: { title: { type: "text", max: LIMITS.title }, ...attrs },
      ...(el.text ? { text: true } : {}),
      ...(el.bound ? { bound: true } : {}),
      children: [],
      kit: { el: key, required: Object.entries(el.attrs).filter(([, a]) => a.required).map(([n]) => n), needsRange: Boolean(el.needsRange), needsGoal: Boolean(el.needsGoal), input: Boolean(el.input) },
    };
  }
  return out;
}

// -- small derivations ---------------------------------------------------------
export const unitInfo = (unit) => UNITS[unit] || null;
export const isDoseUnit = (unit) => Boolean(UNITS[unit]?.dose);

// Does a day's worth of this unit add up (water, kcal, money, minutes, doses)? Body
// measurements do not: кг is the weight of the person (food is weighed in г), and a
// field without a unit is a score or a count of something per entry.
const ADDITIVE_DIMENSIONS = Object.freeze(["volume", "energy", "money", "count", "duration", "mass"]);
const ADDITIVE_UNITS = Object.freeze(["км", "м"]);
export const isAdditiveUnit = (unit) => unit !== "кг" && (ADDITIVE_UNITS.includes(unit) || ADDITIVE_DIMENSIONS.includes(UNITS[unit]?.dimension));
export const stateLabel = (track, state) => track?.labels?.[state] || (track?.avoid && AVOID.labels[state]) || STATE_LABELS[state];
