// Pure helpers of the chart kit: calendar keys, ranges and week/month buckets,
// Russian number and date formats, axis ticks and the shape of series data.
// No DOM, so it runs in node and in the page. Dates are calendar keys
// (ГГГГ-ММ-ДД) and are computed in UTC, so a key never shifts with the device
// time zone. Weeks start on Monday. The single-file gallery strips the import
// below; nothing it draws resolves a range.
import { RANGE_LIMITS, resolveRange } from "../core/query.js";

const DAY = 86400000;
const stamp = (key) => Date.parse(`${key}T00:00:00Z`);
const keyOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// A yes/no attribute of a markup element: edit="yes", search="true".
export const isOn = (value) => value === true || ["yes", "true", "да", "1"].includes(String(value ?? "").trim().toLowerCase());

export const isDateKey = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(stamp(value));
export const shiftDate = (key, n) => keyOf(stamp(key) + n * DAY);
export const daysBetween = (a, b) => Math.round((stamp(b) - stamp(a)) / DAY);
export const weekdayIndex = (key) => (new Date(stamp(key)).getUTCDay() + 6) % 7; // 0 = Monday
export const weekStart = (key) => shiftDate(key, -weekdayIndex(key));
export const monthStart = (key) => `${key.slice(0, 7)}-01`;
export const monthEnd = (key) => keyOf(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0));
export const shiftMonth = (key, n) => {
  const d = new Date(stamp(monthStart(key)));
  return keyOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
};

export const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
export const WEEKDAYS_LONG = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
export const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const MONTHS_OF = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export const MONTHS_LONG = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

// -- ranges ---------------------------------------------------------------------
export const RANGE_PATTERN = /^@(today|yesterday|all|thisWeek|thisMonth|last(\d{1,3})(d|w|m))$/;

export function rangeProblem(token) {
  const m = RANGE_PATTERN.exec(token || "");
  if (!m) return "период: @today, @yesterday, @last7d, @last30d, @last12w, @last6m, @thisWeek, @thisMonth или @all";
  if (m[2]) {
    const n = Number(m[2]);
    const max = RANGE_LIMITS[m[3]];
    if (n < 1 || n > max) return `период @last${m[2]}${m[3]}: число от 1 до ${max}`;
  }
  return null;
}

// {from, to} of a range token: the one resolver of core/query.js, so queries,
// charts and the validator read a period the same way. Weeks and months run to
// their end, so a chart of «эта неделя» shows the days still to come as empty;
// the others end today.
export { resolveRange };

// The range right before: same length, so a stat can say «+12 % к прошлой неделе».
// A period still running is compared with the same number of days of the last one.
export function previousRange(token, today) {
  if (token === "@all") throw new Error("за всё время сравнивать не с чем: уберите compare или возьмите конечный период");
  const cur = resolveRange(token, today);
  const m = RANGE_PATTERN.exec(token);
  const elapsed = daysBetween(cur.from, cur.to < today ? cur.to : today) + 1;
  let from;
  if (m[1] === "thisWeek") from = shiftDate(cur.from, -7);
  else if (m[1] === "thisMonth") from = shiftMonth(cur.from, -1);
  else if (m[3] === "m") from = shiftMonth(cur.from, -Number(m[2]));
  else from = shiftDate(cur.from, -elapsed);
  return { from, to: shiftDate(from, elapsed - 1) };
}

export function periodName(token) {
  const m = RANGE_PATTERN.exec(token || "");
  if (!m) return "прошлому периоду";
  if (m[1] === "today") return "вчера";
  if (m[1] === "yesterday") return "позавчера";
  if (m[1] === "thisWeek") return "прошлой неделе";
  if (m[1] === "thisMonth") return "прошлому месяцу";
  if (m[1] === "all") return "прошлому периоду";
  const n = Number(m[2]);
  if (m[3] === "d") return n === 1 ? "вчера" : n === 7 ? "прошлой неделе" : `предыдущим ${n} ${plural(n, "дню", "дням", "дням")}`;
  if (m[3] === "w") return n === 1 ? "прошлой неделе" : `предыдущим ${n} ${plural(n, "неделе", "неделям", "неделям")}`;
  return n === 1 ? "прошлому месяцу" : `предыдущим ${n} ${plural(n, "месяцу", "месяцам", "месяцам")}`;
}

export function rangeCaption(token) {
  const m = RANGE_PATTERN.exec(token || "");
  if (!m) return "";
  if (m[1] === "today") return "сегодня";
  if (m[1] === "yesterday") return "вчера";
  if (m[1] === "thisWeek") return "эта неделя";
  if (m[1] === "thisMonth") return "этот месяц";
  if (m[1] === "all") return "за всё время";
  const n = Number(m[2]);
  if (m[3] === "d") return n === 1 ? "за сутки" : `за ${n} ${plural(n, "день", "дня", "дней")}`;
  if (m[3] === "w") return n === 1 ? "за неделю" : `за ${n} ${plural(n, "неделю", "недели", "недель")}`;
  return n === 1 ? "за месяц" : `за ${n} ${plural(n, "месяц", "месяца", "месяцев")}`;
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// -- buckets --------------------------------------------------------------------
export const BY = Object.freeze(["day", "week", "month"]);

// A day falls into a bucket named by its first day: itself, the Monday of its
// week, or the month as ГГГГ-ММ.
export function bucketKey(date, by = "day") {
  const day = String(date).slice(0, 10);
  if (by === "week") return weekStart(day);
  if (by === "month") return day.slice(0, 7);
  return day;
}

export function bucketsOf({ from, to }, by = "day") {
  const out = [];
  if (by === "month") {
    for (let d = monthStart(from); d.slice(0, 7) <= to.slice(0, 7); d = shiftMonth(d, 1)) out.push(d.slice(0, 7));
  } else if (by === "week") {
    for (let d = weekStart(from); d <= to; d = shiftDate(d, 7)) out.push(d);
  } else {
    for (let d = from; d <= to; d = shiftDate(d, 1)) out.push(d);
  }
  return out;
}

export const bucketFirstDay = (key) => (key.length === 7 ? `${key}-01` : key);

// -- formats --------------------------------------------------------------------
const NUMBER = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const NUMBER_1 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const NUMBER_2 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

export function fmtNum(value, digits = null) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const v = Number(value);
  if (digits === 0) return NUMBER.format(v);
  if (digits === 2) return NUMBER_2.format(v);
  if (digits === 1) return NUMBER_1.format(v);
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${NUMBER_1.format(v / 1e6)} млн`;
  if (Number.isInteger(v) || abs >= 1000) return NUMBER.format(v);
  return NUMBER_1.format(v);
}

// Axis ticks: compact from 1 000 up («1,5 тыс.»).
export function fmtAxis(value) {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${NUMBER_1.format(value / 1e6)} млн`;
  if (abs >= 1000) return `${NUMBER_1.format(value / 1000)} тыс.`;
  return NUMBER_2.format(value);
}

export const fmtValue = (value, unit = "", digits = null) => {
  const text = fmtNum(value, digits);
  return unit && text !== "—" ? `${text} ${unit}` : text;
};

const parts = (key) => [Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))];

export function dateLabel(key, by = "day", style = "short") {
  const [y, mo, d] = parts(bucketFirstDay(key));
  if (by === "month") return style === "long" ? `${MONTHS_LONG[mo]} ${y}` : MONTHS[mo];
  if (style === "weekday") return WEEKDAYS[weekdayIndex(bucketFirstDay(key))];
  if (style === "long") {
    if (by === "week") return `неделя с ${d} ${MONTHS_OF[mo]}`;
    return `${WEEKDAYS[weekdayIndex(key)]}, ${d} ${MONTHS_OF[mo]}`;
  }
  return `${d} ${MONTHS[mo]}`;
}

// -- axis -----------------------------------------------------------------------
export function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
}

// Ticks over [min, max] that start and end on round numbers.
export function niceTicks(min, max, count = 4) {
  if (!(max > min)) {
    const base = Number.isFinite(min) ? min : 0;
    max = base + 1;
    min = base;
  }
  const step = niceStep((max - min) / count);
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { ticks, min: lo, max: hi, step };
}

// -- the shape of series data ----------------------------------------------------
// SeriesData is what bars, lines, sparks and the heatmap draw:
//   { by, unit, label, fn, goal, buckets: [key], series: [{ key, label, color, values: [number|null] }] }
// Code may hand over simpler data; this turns it into SeriesData.
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

export function normalizeSeries(data, { by = "day", unit = "", goal = null, label = "", fn = "sum" } = {}) {
  if (isObj(data) && Array.isArray(data.buckets) && Array.isArray(data.series)) {
    return {
      by: data.by || by, unit: data.unit ?? unit, label: data.label ?? label, fn: data.fn ?? fn, goal: data.goal ?? goal,
      buckets: data.buckets.slice(),
      series: data.series.map((s, i) => ({ key: s.key ?? String(i), label: s.label ?? s.key ?? "", color: s.color ?? i, values: s.values.map(numOrNull) })),
    };
  }
  const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.points) ? data.points : [];
  if (isObj(data) && !Array.isArray(data)) { by = data.by || by; unit = data.unit ?? unit; goal = data.goal ?? goal; label = data.label ?? label; }
  const points = list.map((p, i) => (isObj(p)
    ? { x: String(p.date ?? p.x ?? p.label ?? i), value: numOrNull(p.value), series: p.series ?? null, seriesLabel: p.seriesLabel ?? p.series ?? null }
    : { x: String(i), value: numOrNull(p), series: null, seriesLabel: null }));
  const buckets = [];
  for (const p of points) if (!buckets.includes(p.x)) buckets.push(p.x);
  if (buckets.every((b) => isDateKey(b))) buckets.sort();
  const order = [];
  for (const p of points) if (!order.some((s) => s.key === p.series)) order.push({ key: p.series, label: p.seriesLabel });
  const series = order.map((s, i) => ({
    key: s.key ?? "value",
    label: s.label ?? label,
    color: i,
    values: buckets.map((b) => points.find((p) => p.x === b && p.series === s.key)?.value ?? null),
  }));
  return { by, unit, label, fn, goal, buckets, series };
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const hasValues = (s) => Boolean(s && s.series.some((line) => line.values.some((v) => v != null)));
export const colorSlot = (i) => (i >= 0 && i < 6 ? `var(--chart-${i + 1})` : "var(--viz-other)");

// The label of a bucket on an axis, given how many fit.
export function axisLabel(key, by, style) {
  if (!isDateKey(bucketFirstDay(key))) return String(key);
  return dateLabel(key, by, style);
}

// -- reading the schema of a state (no imports: a state is plain data) -----------
export const sourceTypeOf = (state, set) => set?.props?.query?.source?.type || null;

export function dateRelationOf(state, typeKey) {
  return (state.types?.[typeKey]?.relations || []).find((k) => ["date", "datetime"].includes(state.relations?.[k]?.format)) || null;
}

export const isNumericRelation = (state, key) => {
  const rel = state.relations?.[key];
  return Boolean(rel && (rel.format === "number" || (rel.format === "formula" && (rel.unit || rel.dimension))));
};

// Energy eaten per day, in kcal. The app refuses a plan below 1 200 kcal; a chart goal below it
// would tell the person that eating less than that is a success.
export const KCAL_GOAL_FLOOR = 1200;
export const isEnergyIntake = (rel) => Boolean(rel && rel.dimension === "energy" && rel.key !== "kcalBurned" && !/burn|sport|расход|трат/i.test(`${rel.key} ${rel.name}`));

// Whether the data of an element holds anything to show; every element has an
// explicit empty state for the opposite case.
export function isEmptyData(tag, data) {
  if (data == null) return true;
  if (tag === "c-stat" || tag === "c-meter") return data.value == null && !(data.segments?.length);
  if (tag === "c-table" || tag === "c-list") return !(data.rows?.length);
  return !hasValues(normalizeSeries(data));
}
