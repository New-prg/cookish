import { readRationDayNutrition, readRationHistoryDay } from "./ration-domain.js";
import { readSportDay, readSportDayEnergy } from "./sport-domain.js";

// The safety gate (#36): rules the code checks, not the prompt. A plan whose
// every day passes the day gate may still lose weight too fast over a week;
// workouts count in the balance; signs of an eating disorder or a minor in
// Profile stop every correction towards weight loss.

export const SAFETY = Object.freeze({
  // Everyday activity on top of rest; workouts come from the plan of Спорт.
  activityFactor: 1.3,
  kcalPerKg: 7700,
  // A plan may lose at most 1% of body weight a week.
  maxWeeklyLossShare: 0.01,
  // Three days in a row with a high-intensity workout get a warning.
  hardDaysInRow: 3,
  // Учёт: at least 40% of at least 6 marked meals of 14 days not eaten.
  skippedShare: 0.4,
  skippedFrom: 6,
  skippedDays: 14,
  // A change of less than this is no change of the balance.
  slackCalories: 50,
});

// Profile writes the Russian labels; older data and the lab fixture the
// English ones.
const AGE_OF_GROUP = Object.freeze({ "Взрослый": 35, adult: 35, "Пожилой": 70, senior: 70, elderly: 70 });
const MINOR_GROUPS = Object.freeze(["Ребёнок", "Подросток", "child", "teen", "teenager"]);

export function isMinor(profile) {
  return MINOR_GROUPS.includes(String(profile?.ageGroup || ""));
}

// Energy a day takes without workouts: Mifflin–St Jeor at the age of the
// group, the sex unknown (the mean of the two constants), times everyday
// activity. Null without weight, height or an adult age group.
export function baseEnergy(profile) {
  const weight = Number(profile?.weightKg);
  const height = Number(profile?.heightCm);
  const age = AGE_OF_GROUP[String(profile?.ageGroup || "")];
  if (!(weight > 0) || !(height > 0) || !age) return null;
  return (10 * weight + 6.25 * height - 5 * age - 78) * SAFETY.activityFactor;
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day + days, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayBalance(state, date) {
  const intake = readRationDayNutrition(state, date).totals.calories;
  const sport = Number(readSportDayEnergy(state, date).planned) || 0;
  return { intake, sport };
}

// The weeks that hold a changed date, from today on: each of them may lose at
// most 1% of body weight. One problem, for the worst week.
export function weekProblems(state, dates, today) {
  const profile = state.ration?.profile || {};
  const base = baseEnergy(profile);
  if (!base || !dates?.length) return [];
  const starts = new Set();
  dates.filter((date) => date >= today).forEach((date) => {
    for (let back = 6; back >= 0; back -= 1) {
      const start = addDays(date, -back);
      if (start >= today) starts.add(start);
    }
  });
  const cache = new Map();
  const balance = (date) => {
    if (!cache.has(date)) cache.set(date, dayBalance(state, date));
    return cache.get(date);
  };
  let worst = null;
  [...starts].forEach((start) => {
    const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
    const intake = days.reduce((total, date) => total + balance(date).intake, 0);
    const sport = days.reduce((total, date) => total + balance(date).sport, 0);
    const deficit = 7 * base + sport - intake;
    if (!worst || deficit > worst.deficit) worst = { from: days[0], to: days[6], deficit, intake, sport };
  });
  const weight = Number(profile.weightKg);
  const limit = weight * SAFETY.maxWeeklyLossShare;
  const pace = worst ? worst.deficit / SAFETY.kcalPerKg : 0;
  if (!worst || pace <= limit) return [];
  const round = (value) => Math.round(value * 10) / 10;
  return [`неделя ${worst.from}–${worst.to}: еда ${Math.round(worst.intake)} ккал${worst.sport ? `, тренировки ${Math.round(worst.sport)} ккал` : ""} при расходе около ${Math.round(7 * base)} ккал без тренировок — это −${round(pace)} кг в неделю, больше 1% веса (${round(limit)} кг). Добавь еды или убери нагрузку`];
}

// Three days in a row with a high-intensity workout around the changed dates.
export function sportWarnings(state, dates) {
  const hard = (date) => (readSportDay(state, date)?.sessions || []).some((session) => session.intensity === "high");
  const warnings = new Set();
  (dates || []).forEach((date) => {
    for (let back = SAFETY.hardDaysInRow - 1; back >= 0; back -= 1) {
      const start = addDays(date, -back);
      const run = Array.from({ length: SAFETY.hardDaysInRow }, (_, index) => addDays(start, index));
      if (run.every(hard)) warnings.add(`высокая интенсивность ${SAFETY.hardDaysInRow} дня подряд (${run[0]}–${run.at(-1)}): нужен день отдыха или лёгкая тренировка`);
    }
  });
  return [...warnings];
}

// Words of the person that point to an eating disorder: restricting more and
// more, starving, purging.
const DISORDER_WORDS = [
  /(ещё|еще) меньше (есть|ккал|калори|еды)/i,
  /(совсем|вообще) ничего не (есть|ем|буду)/i,
  /не (ем|ела|ел) (уже )?\d+ (дн|день|дня|дней|сут)/i,
  /голода(ть|ю|ние|нием|нии)|голодовк/i,
  /вызыва(ю|ть|ла|л) рвот|рвоту после еды/i,
  /слабительн/i,
  /(похудеть|сбросить|скинуть) (на )?\d+ ?кг (за|в) (неделю|\d+ ?(дн|день|дня|дней))/i,
  /ненавижу (себя|сво(ё|е) тело)/i,
];

// The signs of an eating disorder in the person's words and in Учёт.
export function disorderSigns(state, words, today) {
  const signs = [];
  if ((words || []).some((text) => DISORDER_WORDS.some((pattern) => pattern.test(String(text))))) signs.push("слова человека");
  let marked = 0;
  let skipped = 0;
  for (let back = 1; back <= SAFETY.skippedDays; back += 1) {
    const meals = Object.values(readRationHistoryDay(state, addDays(today, -back))?.meals || {});
    meals.forEach((meal) => {
      if (!["eaten", "skipped", "changed"].includes(meal.state)) return;
      marked += 1;
      if (meal.state === "skipped") skipped += 1;
    });
  }
  if (marked >= SAFETY.skippedFrom && skipped / marked >= SAFETY.skippedShare) signs.push("частые «не съедено» в Учёте");
  return signs;
}

// The change lowers the food or raises the workouts of the changed days.
export function raisesDeficit(before, after, dates) {
  const change = (dates || []).reduce((total, date) => {
    const was = dayBalance(before, date);
    const now = dayBalance(after, date);
    return total + (was.intake - now.intake) + (now.sport - was.sport);
  }, 0);
  return change > SAFETY.slackCalories;
}
