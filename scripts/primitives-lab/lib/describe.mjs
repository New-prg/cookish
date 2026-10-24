// Reads the kit's part of a space from the store state (the storage mapping of
// design/synthesis.md §2) and says in plain Russian what it holds. Used by the
// «Готово» line of check.mjs and by judge-packet.mjs, so both describe the same
// thing. Nothing here trusts what a model said about its own answer.
const KIND = {
  log: "журнал записей (свободные записи, сколько угодно в день)",
  habit: "привычка (отметка по расписанию на каждый день)",
  list: "список (позиции с отметкой «сделано»)",
  catalog: "справочник (строки, на которые ссылаются другие трекеры)",
  follow: "отметки к классическим приёмам пищи или тренировкам",
};
const UNMARKED = {
  ignore: "день без отметки не считается ни выполненным, ни пропущенным",
  missed: "день без отметки считается пропуском",
  assumed: "день без отметки считается выполненным",
};
const FORMAT = { number: "число", text: "текст", select: "выбор из списка", checkbox: "да/нет", date: "дата", time: "время", formula: "вычисляется", object: "ссылка", objects: "ссылки", json: "данные", datetime: "дата и время" };
const FN = { sum: "сумма", avg: "среднее", min: "минимум", max: "максимум", count: "число записей", last: "последнее значение", first: "первое значение", latest: "последнее значение", distinct: "число разных значений" };
const EL = {
  stat: "число", meter: "шкала прогресса к цели", bars: "столбчатый график", line: "линейный график", spark: "мини-график",
  heatmap: "календарь-теплокарта по дням", table: "таблица", list: "список", quick: "кнопки быстрой записи", form: "форма записи",
  marks: "отметки по расписанию (кнопки состояния)", streak: "серия дней подряд", embed: "готовый блок классического приложения", p: "текст", empty: "подсказка пустого состояния",
};
const VIRTUAL = {
  done: "выполнено", skipped: "пропущено", due: "запланировано", rate: "доля выполненного", open: "осталось", count: "число записей",
  kcal: "съедено ккал (по отметкам)", protein: "съедено белка", fat: "съедено жиров", carbs: "съедено углеводов", kcal_planned: "запланировано ккал",
  protein_planned: "запланировано белка", burned: "потрачено ккал", burned_planned: "запланировано потратить ккал", minutes: "минут тренировок",
  spent: "потрачено на покупки", bought: "куплено позиций",
};
const SOURCES = { ration: "классический Рацион (план и отметки приёмов пищи)", sport: "классический Спорт (план и отметки тренировок)", shopping: "классические Покупки", product: "каталог продуктов" };

const live = (o) => o && !o.archivedAt;
const q = (s) => `«${s}»`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function rangeRu(range) {
  if (!range) return "";
  const m = /^@last(\d+)([dwm])$/.exec(range);
  if (m) return `последние ${m[1]} ${{ d: "дн.", w: "нед.", m: "мес." }[m[2]]}`;
  return { "@today": "сегодня", "@yesterday": "вчера", "@thisWeek": "эта неделя", "@thisMonth": "этот месяц" }[range] || range;
}

function trackKey(state, of) {
  if (!of) return null;
  if (state.types[`tr_${of}`]?.kit) return of;
  return Object.values(state.types).find((t) => t.kit?.track === of)?.kit.track || null;
}

function fieldsOf(state, type) {
  return (type.relations || []).map((k) => state.relations[k]).filter((r) => r?.kit?.track === type.kit?.track && r.kit.field);
}

function fieldRu(state, rel) {
  const k = rel.kit;
  const parts = [FORMAT[rel.format] || rel.format];
  if (rel.unit) parts.push(`единица ${rel.unit}`);
  if (rel.min != null || rel.max != null) parts.push(`от ${rel.min ?? "…"} до ${rel.max ?? "…"}`);
  if (rel.step != null) parts.push(`шаг ${rel.step}`);
  if (rel.options?.length) parts.push(`варианты: ${rel.options.map((o) => o.name).join(", ")}`);
  if (Array.isArray(k.labels) && k.labels.some(Boolean)) parts.push(`подписи шкалы: ${k.labels.map((s) => s || "·").join(" | ")}`);
  if (rel.format === "formula" && rel.formula) parts.push(`формула ${rel.formula}`);
  if (rel.format === "object" || rel.format === "objects") {
    const target = rel.target || rel.to || rel.targetType;
    if (target) parts.push(`на ${String(target).replace(/^tr_/, "")}`);
  }
  if (k.goal != null) parts.push(`цель: ${k.goalType === "max" ? "не больше" : "не меньше"} ${k.goal}${k.goalPer ? ` в ${{ day: "день", week: "неделю", month: "месяц" }[k.goalPer] || k.goalPer}` : ""}`);
  if (k.planned) parts.push("плановое значение у позиций, отметка «изменил» может его заменить");
  if (k.on?.length) parts.push(`спрашивается при отметках: ${k.on.join(", ")}`);
  if (k.hint) parts.push(`подсказка: ${k.hint}`);
  return `поле ${q(rel.name)} (${k.field}): ${parts.join("; ")}`;
}

function itemRu(o) {
  const p = o.props || {};
  const bits = [];
  if (p.kit_every) bits.push(`повтор: ${p.kit_every}`);
  if (p.kit_at) bits.push(`время дня: ${p.kit_at}`);
  if (p.kit_from) bits.push(`с ${p.kit_from}`);
  if (p.kit_until) bits.push(`до ${p.kit_until}`);
  if (p.kit_plan && Object.keys(p.kit_plan).length) bits.push(`план: ${Object.entries(p.kit_plan).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  return `${q(o.name)}${bits.length ? ` (${bits.join("; ")})` : ""}`;
}

function sourceRu(state, of) {
  if (!of) return "без источника";
  const key = trackKey(state, of);
  if (key) return `трекер ${q(state.types[`tr_${key}`].name)}`;
  return SOURCES[of] || `источник ${of}`;
}

function valueRu(state, of, value) {
  if (!value) return "";
  const key = trackKey(state, of);
  if (key) {
    const rel = fieldsOf(state, state.types[`tr_${key}`]).find((r) => r.kit.field === value);
    if (rel) return `${q(rel.name)}${rel.unit ? `, ${rel.unit}` : ""}`;
  }
  return VIRTUAL[value] ? `${VIRTUAL[value]} (${value})` : `${value}`;
}

export function elementRu(state, el) {
  const name = EL[el.el] || el.el;
  if (el.el === "p" || el.el === "empty") return `${name}: ${q(el.text ?? el.content ?? "")}`;
  const used = new Set(["el", "of", "value", "fn", "range", "where", "by"]);
  const rest = Object.entries(el).filter(([k]) => !used.has(k)).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`);
  const bits = [];
  if (el.of) bits.push(`источник: ${sourceRu(state, el.of)}`);
  if (el.value) bits.push(`значение: ${valueRu(state, el.of, el.value)}`);
  if (el.fn) bits.push(`${FN[el.fn] || el.fn}`);
  if (el.range) bits.push(`период: ${rangeRu(el.range)}`);
  if (el.by) bits.push(`по: ${el.by}`);
  if (el.where) bits.push(`только где ${el.where}`);
  if (rest.length) bits.push(rest.join(", "));
  let writes = "";
  if (el.el === "quick") writes = " Нажатие записывает значение от имени человека.";
  if (el.el === "form") writes = " Отправка записывает значения полей от имени человека.";
  if (el.el === "marks") writes = " Нажатие на состояние записывает отметку от имени человека.";
  return `${name}${bits.length ? ` (${bits.join("; ")})` : ""}.${writes}`;
}

// → { tracks: [{key, name, lines[], entries}], screens: [{key, name, cards: [{key, lines[]}]}] }
export function readKit(state) {
  const tracks = Object.values(state.types).filter((t) => t.kit?.track && !t.kit.archived).map((t) => {
    const key = t.kit.track;
    const k = t.kit;
    const lines = [`${t.icon || ""} ${q(t.name)} (${key}): ${KIND[k.kind] || k.kind}.`.trim()];
    if (k.states?.length) lines.push(`Состояния отметки: ${k.states.map((s) => `${s}${k.labels?.[s] ? ` (кнопка «${k.labels[s]}»)` : ""}`).join(", ")}.`);
    if (k.unmarked) lines.push(`Без отметки: ${UNMARKED[k.unmarked] || k.unmarked}.`);
    if (k.grace) lines.push(`Серия переживает пропусков: ${k.grace}.`);
    if (k.times) lines.push(`Норма: ${k.times} раз в ${k.per === "week" ? "неделю" : "день"}.`);
    if (k.follows) lines.push(`Привязано к классическому разделу: ${SOURCES[k.follows] || k.follows}.`);
    for (const rel of fieldsOf(state, t)) lines.push(`${fieldRu(state, rel)}.`);
    const items = Object.values(state.objects).filter((o) => o.type === "track_item" && o.props?.kit_track === key && live(o));
    if (items.length) lines.push(`Позиции (${items.length}): ${items.map(itemRu).join("; ")}.`);
    const entries = Object.values(state.objects).filter((o) => o.type === t.key && live(o)).length;
    return { key, name: t.name, lines, entries };
  });

  const screenObjs = Object.values(state.objects).filter((o) => o.type === "kit_screen" && live(o));
  const keyOfScreen = (id) => state.objects[id]?.props?.kit_key || String(id).replace(/^sc_/, "");
  const cards = Object.values(state.objects).filter((o) => o.type === "kit_card" && live(o));
  const keys = new Set(["home", ...screenObjs.map((s) => s.props.kit_key)]);
  const screens = [...keys].map((key) => {
    const own = screenObjs.find((s) => s.props.kit_key === key);
    const mine = cards.filter((c) => keyOfScreen(c.props?.kit_screen) === key).sort((a, b) => (a.props.kit_order ?? 0) - (b.props.kit_order ?? 0));
    return {
      key,
      name: own?.name || (key === "home" ? "Главная" : key),
      cards: mine.map((c) => ({
        key: c.props.kit_key || c.id,
        name: c.name,
        lines: [
          `Карточка ${q(c.name)} (${c.props.kit_key || c.id}${c.props.kit_size ? `, ${c.props.kit_size === "half" ? "половина ширины" : "во всю ширину"}` : ""})${c.props.description ? `, подпись: ${q(c.props.description)}` : ""}:`,
          ...(c.props.kit_body || []).map((el, i) => `  ${i + 1}. ${elementRu(state, el)}`),
        ],
        body: c.props.kit_body || [],
      })),
    };
  }).filter((s) => s.cards.length || s.key !== "home");
  return { tracks, screens };
}

// What changed between two spaces, by the description lines themselves.
export function diffKit(before, after) {
  const b = readKit(before);
  const a = readKit(after);
  const tracks = a.tracks.map((t) => {
    const prev = b.tracks.find((x) => x.key === t.key);
    return { ...t, status: !prev ? "новое" : same(prev.lines, t.lines) ? "без изменений" : "изменено" };
  });
  const removedTracks = b.tracks.filter((t) => !a.tracks.some((x) => x.key === t.key)).map((t) => ({ ...t, status: "удалено" }));
  const screens = a.screens.map((s) => {
    const prev = b.screens.find((x) => x.key === s.key);
    const cards = s.cards.map((c) => {
      const old = prev?.cards.find((x) => x.key === c.key);
      return { ...c, status: !old ? "новое" : same(old.lines, c.lines) ? "без изменений" : "изменено" };
    });
    const removedCards = (prev?.cards || []).filter((c) => !s.cards.some((x) => x.key === c.key)).map((c) => ({ ...c, status: "удалено" }));
    return { ...s, status: prev || s.key === "home" ? "" : "новый", cards, removedCards };
  });
  const removedScreens = b.screens.filter((s) => !a.screens.some((x) => x.key === s.key)).map((s) => ({ ...s, status: "удалён", cards: [], removedCards: s.cards }));
  return { tracks, removedTracks, screens, removedScreens };
}

const screenTouched = (s) => s.cards.some((c) => c.status !== "без изменений") || s.removedCards.length > 0 || s.status === "новый";

// Keys of the screens a person must look at: new or changed cards, new screens,
// the screens of removed cards.
export function changedScreens(before, after) {
  return diffKit(before, after).screens.filter(screenTouched).map((s) => s.key);
}

export function describeMarkdown(before, after) {
  const d = diffKit(before, after);
  const out = ["### Данные и логика"];
  const mark = (s) => (s === "без изменений" ? "" : ` [${s}]`);
  if (!d.tracks.length && !d.removedTracks.length) out.push("Трекеров нет.");
  for (const t of d.tracks) out.push(`- Трекер${mark(t.status)}: ${t.lines[0]}`, ...t.lines.slice(1).map((l) => `  - ${l}`), `  - Записей в хранилище: ${t.entries}.`);
  for (const t of d.removedTracks) out.push(`- Трекер [удалён]: ${t.lines[0]}`);
  out.push("", "### Экраны");
  for (const s of d.screens) {
    out.push(`- Экран ${q(s.name)} (${s.key})${s.status ? ` [${s.status}]` : ""}${s.cards.length ? "" : ": карточек нет"}`);
    for (const c of s.cards) out.push(`  - ${c.lines[0]}${mark(c.status)}`, ...c.lines.slice(1).map((l) => `    ${l.trim()}`));
    for (const c of s.removedCards) out.push(`  - Карточка ${q(c.name)} [удалена]`);
  }
  for (const s of d.removedScreens) out.push(`- Экран ${q(s.name)} (${s.key}) [удалён]`);
  return out.join("\n");
}

// One line for «Готово: …».
export function builtLine(before, after) {
  const d = diffKit(before, after);
  const parts = [];
  const tr = d.tracks.filter((t) => t.status !== "без изменений");
  if (tr.length) parts.push(`трекеры: ${tr.map((t) => `${t.name}${t.status === "изменено" ? " (изменён)" : ""}`).join(", ")}`);
  if (d.removedTracks.length) parts.push(`убраны трекеры: ${d.removedTracks.map((t) => t.name).join(", ")}`);
  const sc = d.screens.filter(screenTouched);
  if (sc.length) parts.push(`экраны: ${sc.map((s) => `${s.key} (карточек затронуто ${s.cards.filter((c) => c.status !== "без изменений").length})`).join(", ")}`);
  const rc = d.screens.reduce((n, s) => n + s.removedCards.length, 0);
  if (rc) parts.push(`убрано карточек: ${rc}`);
  return parts.length ? parts.join("; ") : "ничего не построено, ответ только текстом";
}

// Machine-readable counts for verdict.json and the report.
export function builtCounts(before, after) {
  const d = diffKit(before, after);
  const touched = (xs) => xs.filter((x) => x.status !== "без изменений").length;
  const counts = {
    tracksNew: d.tracks.filter((t) => t.status === "новое").length,
    tracksChanged: d.tracks.filter((t) => t.status === "изменено").length,
    tracksRemoved: d.removedTracks.length,
    screensTouched: d.screens.filter(screenTouched).length,
    cardsTouched: d.screens.reduce((n, s) => n + touched(s.cards), 0),
    cardsRemoved: d.screens.reduce((n, s) => n + s.removedCards.length, 0),
    screensRemoved: d.removedScreens.length,
  };
  return { ...counts, empty: Object.values(counts).every((n) => n === 0) };
}
