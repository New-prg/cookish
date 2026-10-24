// What an element or a track does on its own, the part of an app that its markup
// does not state and that a judge reading only the markup would miss: the limit
// colours of a meter, the undo toast after a tap, how a mark is taken back, what
// an embed shows, where a follow track asks its questions. One line per element
// kind, built from the kit's catalogue where the catalogue says it (the element's
// own doc, the attributes it accepts) and from the way the elements are drawn
// (viz/kit.js, viz/charts.js, kit/inputs.js, kit/bind.js) where it does not.
// Nothing here is written per corpus item, and nothing flatters: what an element
// does not do is said as plainly as what it does.
//
// `info` is what describe.mjs knows of the element's source:
//   { track: { kind, states, labels, grace, unmarked, follows, avoid, quota, fields } | null,
//     field: { name, goal, goalType, goalPer, unit } | null }
import { ELEMENTS, FIELD_ATTRS } from "../../../mobile-shell/objects/kit/catalogue.js";

const has = (kind, attr) => Boolean(ELEMENTS[kind]?.attrs?.[attr]);
const UNDO = "После нажатия внизу на 7 секунд появляется «Сохранено» с кнопкой «Отменить»: она возвращает прежние данные.";
const STATE_RU = { done: "сделано", changed: "изменено", skipped: "пропущено" };

const stateNames = (track) => (track?.states || []).map((s) => `«${track.labels?.[s] || STATE_RU[s] || s}»`).join(", ");


function meter(el, { field }) {
  const limit = field?.goalType === "max";
  const base = limit
    ? "Полоса к лимиту поля (не больше): до 90 % подпись «осталось N», с 90 % «близко к лимиту», выше 100 % полоса красная и «превышено на N»"
    : "Полоса к цели поля (не меньше): подпись «осталось N», при достижении «цель достигнута», полоса больше цели не растёт";
  const parts = [base, "период по умолчанию берётся из периода цели поля (день, неделя, месяц)"];
  if (el.category) parts.push("category делит полосу на цветные части с подписями");
  parts.push("пока записей нет, показывает «0 из цели», а не пустой блок");
  return `${parts.join("; ")}.`;
}

function bars(el, { field }) {
  const goal = field?.goal != null ? `; цель поля рисуется линией с подписью «Цель ${field.goal}${field.unit ? ` ${field.unit}` : ""}»` : "; цели у поля нет, линии цели нет";
  const over = field?.goal != null ? ", столбцы выше цели или лимита не меняют цвет" : "";
  return `Столбцы по ${{ day: "дням", week: "неделям", month: "месяцам" }[el.by || "day"]}${goal}${over}; касание столбца показывает значение; без данных за период «Пока нет данных за этот период».${el.category ? " category делит столбцы на цветные ряды с легендой." : ""}`;
}

function rowsLine(el, kind, { track } = {}) {
  const sort = el.sort ? `по полю «${el.sort}»` : track?.kind === "catalog" ? "строки справочника по порядку списка" : "новые сверху";
  const parts = [`Строки ${sort}, не больше ${el.limit || (kind === "list" ? 6 : 8)}; остальные скрыты (${kind === "list" ? "«и ещё N»" : "«Показано N из M»"})`];
  const editing = has(kind, "edit") && (el.edit === true || el.edit === "yes");
  parts.push(editing ? "касание строки открывает окно с полями записи, «Сохранить» и «Удалить» (с «Отменить»)" : "строки только для чтения: править или удалить запись с этого экрана нельзя");
  if (has(kind, "search")) parts.push(el.search === true || el.search === "yes" ? "над строками есть поиск по тексту" : "поиска по строкам нет");
  if (kind === "list" && (el.add === true || el.add === "yes")) parts.push("под списком форма «Добавить»: название и поля, создаёт новую строку (с «Отменить»)");
  parts.push("пусто — «Пока нет данных за этот период»");
  return `${parts.join("; ")}.`;
}

function quick() {
  return `Одно касание сразу записывает значения за сегодня как запись человека, без подтверждения и формы; значение проходит проверку границ поля. ${UNDO}`;
}

function form(el, { track }) {
  const required = (track?.fields || []).filter((f) => f.required && f.type !== "calc").map((f) => `«${f.name}»`);
  const parts = [
    "Поля по типам (число — строка с границами поля, шкала — кнопки с подписями, выбор и ссылка — кнопки, а при больше 8 вариантов список, да/нет, время, дата)",
    "«Записать» создаёт запись за сегодня; «Другой день» открывает дату не позже сегодня",
    required.length ? `обязательные поля: ${required.join(", ")}` : "обязательных полей нет, но пустую форму не отправить: нужно хотя бы одно поле",
    "число вне границ даёт ошибку под полем, запись не создаётся",
  ];
  return `${parts.join("; ")}. ${UNDO}`;
}

function marks(el, { track }) {
  const kind = track?.kind;
  const parts = [];
  if (kind === "follow") parts.push(`Строки берутся из плана классического раздела на сегодня (приём пищи или тренировка), своих позиций нет; без плана на день «В плане на этот день нет приёмов»`);
  else if (kind === "list") parts.push("Строка на каждую позицию списка, у каждой одна отметка в жизни; пустой список «В списке пока ничего нет»");
  else parts.push("Строка на каждую позицию, запланированную на сегодня; если на сегодня ничего нет, «На этот день ничего не запланировано»");
  const buttons = stateNames(track);
  if (buttons) parts.push(`кнопки состояний: ${buttons}; отметка одна на позицию и день, повторное касание другой кнопки меняет её, а не добавляет вторую`);
  parts.push("у отмеченной строки есть «Снять отметку»: отметка убирается совсем");
  const asked = (track?.fields || []).filter((f) => f.type !== "calc");
  if (asked.length && kind !== "follow") parts.push(`состояние, для которого поля спрашиваются, сначала открывает мини-форму (${asked.map((f) => `«${f.name}»`).join(", ")}${asked.some((f) => f.planned) ? "; плановые поля спрашиваются только при «изменено», у позиции их значение берётся из плана" : ""})`);
  if (kind !== "follow") parts.push("под строками «Отмечено X из Y»");
  if ((el.add === true || el.add === "yes") && kind !== "follow") parts.push("кнопка «Добавить» создаёт новую позицию на месте");
  if (has("marks", "date")) parts.push(`можно отметить и прошлые дни (до 7 назад) через переключатель вчера и сегодня${el.date ? `; открывается на «${el.date === "@yesterday" ? "вчера" : "сегодня"}»` : ""}`);
  else parts.push("отметить можно только сегодняшний день, прошлые дни из этого элемента не отметить");
  return `${parts.join("; ")}. ${UNDO}`;
}

function streak(el, { track, field }) {
  const kind = track?.kind;
  const unit = track?.quota?.per === "week" ? "недель" : "дней";
  let day;
  if (kind === "log") day = field?.goal != null || (track.fields || []).some((f) => f.goal != null) ? "день засчитан, если цель поля выполнена (у лимита — не превышена)" : "день засчитан, если есть хотя бы одна запись";
  else if (track?.quota) day = `${track.quota.per === "week" ? "неделя" : "день"} засчитан${track.quota.per === "week" ? "а" : ""}, когда отметок набралось ${track.quota.times}`;
  else day = "день засчитан, если все запланированные на него позиции выполнены; одна пропущенная делает день пропущенным";
  const unmarked = { ignore: "день без отметки серию не прибавляет и не рвёт", missed: "прошлый день без отметки считается пропуском и рвёт серию", assumed: "прошлый день без отметки считается выполненным" }[track?.unmarked] || "";
  const grace = track?.grace != null ? `серию переживают до ${track.grace} пропущенных ${unit} подряд` : "один пропуск серию не рвёт";
  return `Три числа: текущая серия подряд (${unit}), лучшая серия и «X из Y» за последние 30 ${unit === "дней" ? "дней" : "недель"}; ${day}; ${unmarked ? `${unmarked}; ` : ""}${grace}; сегодняшний день без отметки серию не рвёт. Пока отметок нет, «Серия начнётся с первой отметки».`;
}

const EMBEDS = {
  "ration-today": "Классический блок «Сегодня в Рационе», его ведёт Рацион, а не трекеры этого приложения: съедено из цели ккал с полосой, белки, жиры и углеводы, затем приёмы пищи дня с кнопками «съедено», «изменено», «не съедено»; без плана «На сегодня в Рационе ничего нет». Полей трекеров под приёмами в нём нет.",
  "sport-today": "Классический блок «Спорт сегодня», его ведёт Спорт, а не трекеры этого приложения: минуты фактически из плановых и ккал, затем тренировки дня с кнопками «выполнено», «изменено», «пропущено»; без плана «Сегодня тренировок нет». Полей трекеров под тренировками в нём нет.",
  requests: "Классический блок «Покупки»: до 4 открытых запросов на покупку со счётчиком «куплено из N», полосой и суммой потрачено; без них «Открытых запросов нет». Это запросы классических Покупок, а не позиции трекеров этого приложения.",
};

// One line for an element, or "" when the element has nothing to add.
export function elementBehaviour(el, info = {}) {
  switch (el.el) {
    case "stat": return `Одно число за период${el.compare === true || el.compare === "yes" ? `, под ним процент к прошлому такому же периоду (зелёный при сдвиге в сторону good=${el.good || "up"})` : ", без сравнения с прошлым периодом"}; цели и предела у числа нет, оно не краснеет; без данных «Пока нет данных за этот период».`;
    case "meter": return meter(el, info);
    case "bars": return bars(el, info);
    case "line": return `Линия по ${{ day: "дням", week: "неделям", month: "месяцам" }[el.by || "day"]}${info.field?.goal != null ? `; цель поля рисуется линией с подписью «Цель ${info.field.goal}»` : ""}; касание показывает значение; без данных «Пока нет данных за этот период».`;
    case "spark": return `${ELEMENTS.spark.doc.replace(/\.$/, "")}: форма ряда, подписей значений нет.`;
    case "heatmap": return `${ELEMENTS.heatmap.doc.replace(/\.$/, "")}; дни без записей остаются пустыми клетками.`;
    case "table": return rowsLine(el, "table", info);
    case "list": return rowsLine(el, "list", info);
    case "quick": return quick();
    case "form": return form(el, info);
    case "marks": return marks(el, info);
    case "streak": return streak(el, info);
    case "embed": return EMBEDS[el.what] || "";
    case "empty": return "Надпись показывается всегда, а не только когда данных нет.";
    case "p": return "Статичный текст, ничего не считает.";
    default: return "";
  }
}

// Lines for a track that hold for the whole track, wherever its elements are.
export function trackBehaviour(track) {
  const out = [];
  if (track.kind === "log") out.push(`Записи за день складываются в итог дня (вода, ккал, ₽, мин, км, г — суммой; вес, шкалы и поля без единицы — средним за день). ${has("list", "edit") ? "На экранах запись правится и удаляется только через список или таблицу с edit, иначе её можно лишь отменить сразу после записи." : "На экранах приложения запись не правится и не удаляется, её можно только отменить сразу после записи."}`);
  if (track.kind === "follow") {
    const skipped = FIELD_ATTRS.on?.values?.includes("skipped");
    const where = track.follows === "sport" ? "тренировкой" : "приёмом пищи";
    const fields = track.fields.filter((f) => f.type !== "calc");
    out.push(`Вопросы трека задаёт страница дня классического раздела, не экран приложения: под каждым ${where} с планом стоят поля ${fields.map((f) => `«${f.name}»`).join(", ") || "(полей нет)"} и кнопка «Записать» (после отметки «Обновить» и «Снять отметку»); задаются они у ${skipped ? "выполненного (и у пропущенного, если у поля on=skipped)" : "выполненного, у пропущенного приёма вопросов нет"}. На своём экране отметки видны только если там есть элемент marks этого трека.`);
  }
  if (track.kind === "habit" || track.kind === "list") out.push("Позиция появляется в отметках с даты начала (по умолчанию день создания): за дни до неё отметить нельзя.");
  if (track.kind === "catalog") out.push("Справочник не хранит дни и записей не ведёт: его строки видны через таблицу или список на экране или как варианты выбора в полях других трекеров.");
  return out;
}
