// When an item of a habit or a list is due. Pure: items are plain objects
// { key, name, every, at, from, until }, dates are calendar keys (ГГГГ-ММ-ДД)
// computed in UTC with Monday first, like viz/util.js.
import { daysBetween, shiftDate, weekdayIndex } from "../viz/util.js";

export const WEEKDAY_KEYS = Object.freeze(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export const PARTS_OF_DAY = Object.freeze({ morning: 480, noon: 720, evening: 1140, night: 1380 });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STEP = /^(\d{1,2})d$/;

// The rule behind an `every` value, or null when the value is none of the known ones.
export function parseEvery(every = "day") {
  const text = String(every ?? "").trim().toLowerCase();
  if (text === "day" || text === "weekdays" || text === "weekends" || text === "open") return { type: text };
  const step = STEP.exec(text);
  if (step) {
    const n = Number(step[1]);
    if (n === 1) return { type: "day" };
    return n >= 2 && n <= 30 ? { type: "step", n } : null;
  }
  if (DATE.test(text) && Number.isFinite(Date.parse(`${text}T00:00:00Z`))) return { type: "once", date: text };
  const days = text.split(",").map((part) => part.trim());
  if (days.length && days.every((day) => WEEKDAY_KEYS.includes(day))) return { type: "days", days: [...new Set(days.map((day) => WEEKDAY_KEYS.indexOf(day)))] };
  return null;
}

export function everyProblem(every) {
  return parseEvery(every) ? null : `«${every}»: повтор — day, weekdays, weekends, дни недели через запятую (mon,wed,fri), 2d…30d, open или дата ГГГГ-ММ-ДД`;
}

// Minutes from midnight for ordering a list: a part of the day or HH:MM; no `at` goes last.
export function atMinutes(at) {
  if (PARTS_OF_DAY[at] != null) return PARTS_OF_DAY[at];
  const m = /^(\d{2}):(\d{2})$/.exec(String(at || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : 1500;
}

export function atProblem(at) {
  return at == null || at === "" || PARTS_OF_DAY[at] != null || /^([01]\d|2[0-3]):[0-5]\d$/.test(at) ? null : `«${at}»: время — morning, noon, evening, night или ЧЧ:ММ`;
}

// Is the item due on the date? An item is never due before `from` (the day it
// was created) or after `until`. An open item is due on every day of its window.
export function dueOn(item, date) {
  const rule = parseEvery(item?.every ?? "day");
  if (!rule || !DATE.test(String(date || ""))) return false;
  if (item.from && date < item.from) return false;
  if (item.until && date > item.until) return false;
  switch (rule.type) {
    case "day":
    case "open": return true;
    case "weekdays": return weekdayIndex(date) < 5;
    case "weekends": return weekdayIndex(date) >= 5;
    case "days": return rule.days.includes(weekdayIndex(date));
    case "step": return Boolean(item.from) && daysBetween(item.from, date) % rule.n === 0;
    case "once": return date === rule.date;
  }
  return false;
}

// Every occurrence that touches the range, one per item and due date. An open
// item is one occurrence whose window runs from `from` to `until` (null: no end).
// `track` is a key or an object with a key.
export function occurrences(track, items, range) {
  const key = typeof track === "string" ? track : track?.key ?? null;
  const out = [];
  for (const item of items) {
    const rule = parseEvery(item.every ?? "day");
    if (!rule) continue;
    if (rule.type === "open") {
      const start = item.from || range.from;
      if (start > range.to || (item.until && item.until < range.from)) continue;
      out.push({ track: key, item, date: start, window: { from: start, to: item.until ?? null }, open: true });
      continue;
    }
    const first = item.from && item.from > range.from ? item.from : range.from;
    const last = item.until && item.until < range.to ? item.until : range.to;
    for (let date = first; date <= last; date = shiftDate(date, 1)) {
      if (dueOn(item, date)) out.push({ track: key, item, date, window: { from: date, to: date }, open: false });
    }
  }
  return out.sort((a, b) => a.window.from.localeCompare(b.window.from) || atMinutes(a.item.at) - atMinutes(b.item.at) || String(a.item.name).localeCompare(String(b.item.name), "ru"));
}
