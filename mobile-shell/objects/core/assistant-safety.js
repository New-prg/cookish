// Protective mode of the Ассистент (#36) on objects: signs of an eating
// disorder or a minor in Профиль stop every change that lowers the food or
// adds workouts. Code refuses it; the prompt only says why. Same rules and
// thresholds as mobile-shell/core/safety.js; tests/objects-assistant.test.mjs
// compares the two on equivalent inputs.
import { dayActual, shiftDate, sportDay } from "./domain.js";
import { objectsOfType, profileOf } from "./values.js";

export const SAFETY = Object.freeze({
  // Учёт: at least 40% of at least 6 marked meals of 14 days not eaten.
  skippedShare: 0.4,
  skippedFrom: 6,
  skippedDays: 14,
  // A change of less than this is no change of the balance.
  slackCalories: 50,
});

const MINOR_GROUPS = Object.freeze(["child", "teen"]);

export function isMinor(state) {
  return MINOR_GROUPS.includes(String(profileOf(state)?.props.ageGroup || ""));
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

// The signs of an eating disorder in the person's words and in the marks of
// the last two weeks.
export function disorderSigns(state, words, today) {
  const signs = [];
  if ((words || []).some((text) => DISORDER_WORDS.some((pattern) => pattern.test(String(text))))) signs.push("слова человека");
  const from = shiftDate(today, -SAFETY.skippedDays);
  let marked = 0;
  let skipped = 0;
  for (const mark of objectsOfType(state, "meal_mark")) {
    const { date, mealState } = mark.props;
    if (!(date >= from && date < today) || !["eaten", "skipped", "changed"].includes(mealState)) continue;
    marked += 1;
    if (mealState === "skipped") skipped += 1;
  }
  if (marked >= SAFETY.skippedFrom && skipped / marked >= SAFETY.skippedShare) signs.push("частые «не съедено» в Учёте");
  return signs;
}

export function protectiveReasons(state, words, today) {
  return [...(isMinor(state) ? ["несовершеннолетний в профиле"] : []), ...disorderSigns(state, words, today)];
}

// What a day plans: food and workouts, in kcal.
function dayBalance(state, date) {
  return { intake: dayActual(state, date).planned.kcal, sport: Number(sportDay(state, date).planned) || 0 };
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
