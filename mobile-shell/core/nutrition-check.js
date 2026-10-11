// The check of a КБЖУ card (#63, #64): code, not the model, decides whether
// the numbers of a card make sense before they reach the catalog. Carbs are
// the available ones, without fiber, as on Russian labels and in Open Food
// Facts; fiber gives 2 ккал/г and alcohol 7.

export const CARD_CHECK = Object.freeze({
  tolerance: 0.15,
  // Fiber and alcohol make the estimate rougher.
  looseTolerance: 0.2,
  fiberFrom: 3,
  // Below this the shares of 1-2 ккал mean nothing: tea, coffee, salt.
  slackCalories: 5,
  maxCalories: 900,
  maxMacros: 100,
  // Values rounded to 0.1 г may sum to a little over 100.
  roundingSlack: 0.5,
});

const REQUIRED = Object.freeze([
  ["calories", "калорийности"],
  ["protein", "белков"],
  ["fat", "жиров"],
  ["carbs", "углеводов"],
]);

function amount(value) {
  return value === null || value === undefined || value === "" ? NaN : Number(value);
}

export function estimateCalories({ protein, fat, carbs, fiber = 0, alcohol = 0 }) {
  return 4 * protein + 9 * fat + 4 * carbs + 2 * (Number(fiber) || 0) + 7 * (Number(alcohol) || 0);
}

// { ok, problems: [text] } for a card per 100 г/мл.
export function checkNutritionCard(nutrition) {
  const values = Object.fromEntries(REQUIRED.map(([field]) => [field, amount(nutrition?.[field])]));
  const problems = REQUIRED
    .filter(([field]) => !Number.isFinite(values[field]) || values[field] < 0)
    .map(([, label]) => `нет ${label}`);
  if (problems.length) return { ok: false, problems };
  const { calories, protein, fat, carbs } = values;
  const fiber = Number(nutrition.fiber) || 0;
  const alcohol = Number(nutrition.alcohol) || 0;
  if (calories > CARD_CHECK.maxCalories) problems.push(`${calories} ккал на 100 г — больше ${CARD_CHECK.maxCalories}`);
  if (protein + fat + carbs > CARD_CHECK.maxMacros + CARD_CHECK.roundingSlack) problems.push(`белков, жиров и углеводов вместе больше ${CARD_CHECK.maxMacros} г на 100 г`);
  const estimate = estimateCalories({ protein, fat, carbs, fiber, alcohol });
  const tolerance = fiber >= CARD_CHECK.fiberFrom || alcohol > 0 ? CARD_CHECK.looseTolerance : CARD_CHECK.tolerance;
  if (Math.abs(estimate - calories) > Math.max(tolerance * calories, CARD_CHECK.slackCalories)) {
    problems.push(`по белкам, жирам и углеводам выходит ${Math.round(estimate)} ккал, а указано ${calories} ккал`);
  }
  return { ok: problems.length === 0, problems };
}
