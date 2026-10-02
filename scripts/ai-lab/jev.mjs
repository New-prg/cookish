// Jev 1.13: decisions only. The model picks from options the app enumerates;
// deterministic code builds the plan and the reply text.
import { rai } from "./rai.mjs";
import { TODAY, addDays, weekday, viewDay, toDomainMeals, gateDay, run, readRationDay, readRationDayNutrition } from "./fixture.mjs";

const MODEL = "typesafe/jev-1.13";
const PRICE_IN = 0.00000456231048; // ₽/token from /models; completion is free
const DAY_NAMES = { пн: "понедельник", вт: "вторник", ср: "среда", чт: "четверг", пт: "пятница", сб: "суббота", вс: "воскресенье" };

async function decide(stats, state, questions) {
  for (const q of Object.values(questions)) if (q.type === "choice" && Array.isArray(q.criteria)) q.criteria = Object.fromEntries(q.criteria.map((c, i) => [`o${i}`, c]));
  const r = await rai("/api/v1/decisions", { model: MODEL, state, questions });
  stats.calls++; stats.ms += r.ms;
  if (r.status !== 200) throw new Error(`jev ${r.status}: ${JSON.stringify(r.json).slice(0, 300)}`);
  stats.tokensIn += r.json.usage?.input_tokens || 0; stats.tokensOut += r.json.usage?.output_tokens || 0;
  stats.decisions.push(Object.fromEntries(Object.entries(r.json.answers).map(([k, v]) => [k, v.choice ?? v.score ?? v.noul])));
  return r.json.answers;
}
const pick = (a) => a.choice;
const opt = (list, a) => (/^o[0-9]+$/.test(String(a.choice)) ? list[Number(a.choice.slice(1))] : a.choice);
const conf = (a) => a.confidence ?? 1;

const productByName = (state, name) => state.products.find((p) => p.name === name);
const kcalPerG = (p) => (p?.nutrition?.calories || 0) / 100;

// Scale every portion of a day so calories land on the profile target.
function scaleToTarget(state, meals, target) {
  const tmp = run(state, { type: "setSpecialDay", date: "2099-01-01", meals: toDomainMeals(state, meals).meals });
  const kcal = readRationDayNutrition(tmp.state, "2099-01-01").totals.calories;
  const f = kcal ? target / kcal : 1;
  return meals.map((m) => ({ ...m, items: m.items.map((i) => ({ ...i, grams: Math.round(i.grams * f / 5) * 5 })) }));
}

export async function runJev(state, prompt) {
  const stats = { calls: 0, ms: 0, tokensIn: 0, tokensOut: 0, decisions: [] };
  const t0 = Date.now(); const trace = [];
  const finish = (reply, s = state) => ({ state: s, reply, trace, ms: Date.now() - t0, calls: stats.calls, tokensIn: stats.tokensIn, tokensOut: stats.tokensOut, reasoning: 0, cost: stats.tokensIn * PRICE_IN, decisions: stats.decisions });

  // ── Stage A: router ────────────────────────────────────────────────
  const dates = Object.fromEntries(Array.from({ length: 14 }, (_, i) => {
    const d = addDays(TODAY, i);
    return [d, `${d}, ${DAY_NAMES[weekday(d)]}${i === 0 ? ", сегодня" : i === 1 ? ", завтра" : ""}`];
  }));
  const ctx = `Сегодня ${TODAY}, ${DAY_NAMES[weekday(TODAY)]}. Пользователь пишет в чат приложения-планировщика рациона: «${prompt}»`;
  const A = await decide(stats, ctx, {
    intent: { type: "choice", instructions: "Чего хочет пользователь?", criteria: {
      change_one_date: "Изменить план питания на одну конкретную дату",
      change_from_date: "Регулярно изменить план, начиная с даты и далее",
      question: "Задать вопрос о плане или КБЖУ, ничего не меняя",
      past: "Исправить прошедший день или записать, что уже съел",
      other: "Что-то другое" } },
    operation: { type: "choice", instructions: "Какое изменение плана нужно?", criteria: {
      exclude_group: "Убрать группу продуктов (мясо, рыбу, молочное и т.п.)",
      swap_product: "Заменить один продукт другим",
      drop_meal: "Убрать приём пищи или уменьшить число приёмов",
      set_calories: "Изменить калорийность",
      ask_nutrient: "Узнать калории, белки, жиры или углеводы",
      none: "Ничего из перечисленного" } },
    date: { type: "choice", instructions: "К какой дате относится просьба (первая затронутая дата)?", criteria: { ...dates, past: "Прошедшая дата", none: "Дата не указана" } },
    risk: { type: "score", instructions: "Насколько просьба опасна для здоровья взрослого?", criteria: ["безопасно", "сомнительно", "опасно: меньше 1200 ккал, голодание, лечение, признаки РПП"] },
  });
  const intent = pick(A.intent), op = pick(A.operation), date = pick(A.date);
  trace.push({ stage: "A", intent, op, date, risk: A.risk.score, conf: [conf(A.intent), conf(A.operation), conf(A.date)].map((c) => c.toFixed(2)).join("/") });

  if (A.risk.score >= 1.3) return finish("Не могу поставить такой план: он ниже безопасного минимума. Резкое снижение калорийности стоит обсудить с врачом.");
  if (intent === "past" || date === "past") return finish("Прошедшие дни ИИ не меняет. Отметьте приём пищи в Истории питания и добавьте Расхождение — план останется прежним.");
  if (Math.min(conf(A.intent), conf(A.operation)) < 0.55) return finish("Уточните, пожалуйста: изменить план или просто показать его?");

  const profile = state.ration.profile;
  const day0 = date in dates ? date : addDays(TODAY, 1);
  const view = viewDay(state, day0);

  // ── question ───────────────────────────────────────────────────────
  if (intent === "question" || op === "ask_nutrient") {
    const B = await decide(stats, ctx, { nutrient: { type: "choice", instructions: "О каком показателе спрашивают?", criteria: { calories: "калории", protein: "белок", fat: "жиры", carbs: "углеводы", fiber: "клетчатка" } } });
    const n = pick(B.nutrient); const unit = n === "calories" ? "ккал" : "г";
    const labels = { calories: "Калорий", protein: "Белка", fat: "Жиров", carbs: "Углеводов", fiber: "Клетчатки" };
    return finish(`${labels[n]} на ${view.date} (${DAY_NAMES[view.weekday]}): ${Math.round(view.totals[n])} ${unit}.`);
  }

  // ── exclude_group (one date) ───────────────────────────────────────
  if (op === "exclude_group") {
    const catalogNames = state.products.map((p) => p.name);
    const B = await decide(stats, ctx, {
      group: { type: "choice", instructions: "Какую группу продуктов убрать?", criteria: { meat: "мясо", fish: "рыба", dairy: "молочное", grains: "крупы и хлеб", sweets: "сладкое" } },
      ...Object.fromEntries(catalogNames.map((name, i) => [`p${i}`, { type: "noul", instructions: `Продукт «${name}» относится к группе, которую просят убрать?` }])),
    });
    const group = pick(B.group);
    const banned = new Set(catalogNames.filter((_, i) => B[`p${i}`].noul >= 0.5));
    trace.push({ stage: "B", group, banned: [...banned].join(", ") });
    const targets = view.meals.flatMap((m) => m.items.filter((i) => banned.has(i.product)).map((i) => ({ meal: m.name, ...i })));
    const allowed = catalogNames.filter((n) => !banned.has(n));
    const C = targets.length ? await decide(stats, ctx + `\nУбираем: ${[...banned].join(", ")}.`, Object.fromEntries(targets.map((t, i) => [`r${i}`, {
      type: "choice", instructions: `Чем заменить «${t.product} ${t.grams} г» в приёме «${t.meal}», чтобы сохранить белок и сытость?`, criteria: allowed,
    }]))) : {};
    const repl = targets.map((t, i) => ({ ...t, to: opt(allowed, C[`r${i}`]) }));
    trace.push({ stage: "C", replacements: repl.map((r) => `${r.product}→${r.to}`).join(", ") });
    let meals = view.meals.map((m) => ({ name: m.name, time: m.time, items: m.items.map((i) => {
      const r = repl.find((x) => x.meal === m.name && x.product === i.product);
      if (!r) return i;
      const grams = Math.round(i.grams * kcalPerG(productByName(state, i.product)) / kcalPerG(productByName(state, r.to)) / 5) * 5;
      return { product: r.to, grams };
    }) }));
    return writeSpecial(state, day0, meals, profile, finish, trace, `План на ${day0} без группы «${B.group.choice}»: ${repl.map((r) => `${r.product} → ${r.to}`).join(", ")}.`);
  }

  // ── swap_product (one date) ────────────────────────────────────────
  if (op === "swap_product") {
    const inDay = [...new Set(view.meals.flatMap((m) => m.items.map((i) => i.product)))];
    const B = await decide(stats, ctx, {
      from: { type: "choice", instructions: "Какой продукт убрать?", criteria: inDay },
      to: { type: "choice", instructions: "На какой продукт заменить?", criteria: state.products.map((p) => p.name) },
      meal: { type: "choice", instructions: "В каком приёме пищи?", criteria: [...view.meals.map((m) => m.name), "во всех"] },
    });
    const mealsList = [...view.meals.map((m) => m.name), "во всех"];
    const from = opt(inDay, B.from), to = opt(state.products.map((p) => p.name), B.to), mealName = opt(mealsList, B.meal);
    trace.push({ stage: "B", from, to, meal: mealName });
    const meals = view.meals.map((m) => ({ name: m.name, time: m.time, items: m.items.map((i) => (i.product === from && (mealName === "во всех" || m.name === mealName))
      ? { product: to, grams: Math.round(i.grams * kcalPerG(productByName(state, from)) / kcalPerG(productByName(state, to)) / 5) * 5 } : i) }));
    return writeSpecial(state, day0, meals, profile, finish, trace, `${day0}, ${mealName}: ${from} → ${to}.`);
  }

  // ── drop_meal (from date → new Version) ────────────────────────────
  if (op === "drop_meal") {
    const mealNames = view.meals.map((m) => m.name);
    const B = await decide(stats, ctx, { meal: { type: "choice", instructions: "Какой приём пищи убрать?", criteria: mealNames } });
    const drop = opt(mealNames, B.meal);
    trace.push({ stage: "B", drop });
    if (day0 <= TODAY) return finish("Новая версия плана может начинаться только с будущей даты.");
    const days = []; const problems = [];
    for (let k = 0; k < 7; k++) {
      const d = addDays(day0, k);
      const kept = viewDay(state, d).meals.filter((m) => m.name !== drop).map((m) => ({ name: m.name, time: m.time, items: m.items }));
      const scaled = scaleToTarget(state, kept, profile.targetCalories);
      days.push({ meals: toDomainMeals(state, scaled).meals });
    }
    const r = run(state, { type: "releaseVersion", anchor: day0, effectiveFrom: day0, weekdayBinding: true, days });
    if (!r.ok) return finish(`Не получилось: ${r.error}`);
    for (let k = 0; k < 7; k++) { const g = gateDay(r.state, addDays(day0, k)); if (!g.ok) problems.push(...g.problems); }
    trace.push({ write: "releaseVersion", gate: problems.length ? problems.join("; ") : "ok" });
    if (problems.length) return finish(`План не прошёл проверку: ${problems[0]}`);
    return finish(`С ${day0} в плане ${mealNames.length - 1} приёма пищи, «${drop}» убран, порции увеличены до цели ${profile.targetCalories} ккал.`, r.state);
  }

  return finish("Пока я умею: убрать группу продуктов, заменить продукт, убрать приём пищи и ответить про КБЖУ.");
}

function writeSpecial(state, date, meals, profile, finish, trace, okText) {
  const { meals: domain, errors } = toDomainMeals(state, meals);
  if (errors.length) return finish(`Не получилось: ${errors[0]}`);
  let r = run(state, { type: "setSpecialDay", date, meals: domain });
  if (!r.ok) return finish(`Не получилось: ${r.error}`);
  let gate = gateDay(r.state, date);
  if (!gate.ok) { // one deterministic repair: scale portions to target
    const fixed = toDomainMeals(state, scaleToTarget(state, meals, profile.targetCalories)).meals;
    r = run(state, { type: "setSpecialDay", date, meals: fixed });
    gate = gateDay(r.state, date);
    trace.push({ repair: "scaleToTarget", gate: gate.ok ? "ok" : gate.problems.join("; ") });
  }
  trace.push({ write: "setSpecialDay", date, kcal: Math.round(gate.totals.calories), protein: Math.round(gate.totals.protein), gate: gate.ok ? "ok" : gate.problems.join("; ") });
  if (!gate.ok) return finish(`План не прошёл проверку: ${gate.problems[0]}`);
  return finish(`${okText} Итого ${Math.round(gate.totals.calories)} ккал, белок ${Math.round(gate.totals.protein)} г.`, r.state);
}
