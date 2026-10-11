import {
  applyRationCommand,
  normalizeProductName,
  rationOwner,
  readRationDay,
  readRationDayNutrition,
  todayDateKey,
} from "./ration-domain.js";
import { readPart, restoreChangeSet, sameContent } from "./plan-journal.js";
import { sportWarnings, weekProblems } from "./safety.js";
import { applySportCommand } from "./sport-domain.js";

// Предложения of the Ассистент as data: the ops a change runs, the parts of
// the plan it read (`before`) and wrote (`after`), and its preview. The
// assistant Service drafts them on a copy of the plan; the Core applies them
// with its own command (local-data `applyProposals`) after a re-check on the
// current plan, and journals the batch with actor "ai".

export const KBJU_GATE = Object.freeze({ minCalories: 1200, tolerance: 0.15, minProteinShare: 0.75 });

// Writes the results of `applyProposals` onto the caller's copies.
export function markProposals(proposals, results) {
  const byId = new Map((results || []).map((result) => [result.id, result]));
  (proposals || []).forEach((proposal) => {
    const result = byId.get(proposal.id);
    if (!result) return;
    if (result.ok) {
      proposal.status = "applied";
      proposal.changeSetId = result.changeSetId || "";
      delete proposal.conflict;
    } else {
      proposal.status = "conflict";
      proposal.conflict = result.reason;
    }
  });
  return proposals;
}

// Marks pending Предложения that no longer apply to `state` as conflicts.
export function recheckProposals(state, proposals, day = todayDateKey()) {
  const draft = structuredClone(state);
  (proposals || []).forEach((proposal) => {
    if (proposal.status !== "pending" && proposal.status !== "conflict") return;
    const outcome = tryProposal(draft, proposal, { now: new Date().toISOString(), today: day, actor: "ai" }, day);
    if (outcome.ok) {
      proposal.status = "pending";
      delete proposal.conflict;
    } else {
      proposal.status = "conflict";
      proposal.conflict = outcome.reason;
    }
  });
  return proposals;
}

export function executeOps(draft, ops, context) {
  for (const op of ops || []) {
    if (op.op === "ration") {
      const result = applyRationCommand(draft, structuredClone(op.command), { ...context, actor: "ai" });
      if (!result.ok) return result;
    } else if (op.op === "sport") {
      const result = applySportCommand(draft, structuredClone(op.command), { ...context, actor: "ai" });
      if (!result.ok) return result;
    } else if (op.op === "product") {
      draft.products = draft.products || [];
      const product = { ...structuredClone(op.product), updatedAt: context.now, updatedBy: "ai" };
      const index = draft.products.findIndex((value) => value.id === product.id);
      if (index >= 0) draft.products[index] = { ...draft.products[index], ...product, deletedAt: "" };
      else draft.products.push(product);
    } else if (op.op === "revert") {
      const result = restoreChangeSet(draft, op.changeSetId, { now: context.now, actor: "ai" });
      if (!result.ok) return result;
    } else {
      return { ok: false, reason: "Неизвестное действие предложения." };
    }
  }
  return { ok: true };
}

// Re-checks one Предложение on `draft` and applies it there when it still fits.
export function tryProposal(draft, proposal, context, today) {
  if (proposal.status === "applied") return { ok: false, reason: "Предложение уже применено." };
  const stale = Object.keys(proposal.before || {}).filter((key) => !sameContent(readPart(draft, key), proposal.before[key]));
  if (stale.length) return { ok: false, reason: "План изменился после предложения: оно устарело." };
  if ((proposal.dates || []).some((date) => date < today)) return { ok: false, reason: "Этот день уже прошёл." };
  const trial = { ...draft, ration: structuredClone(draft.ration), products: structuredClone(draft.products || []) };
  if (draft.sport) trial.sport = structuredClone(draft.sport);
  const executed = executeOps(trial, proposal.ops, { ...context, actor: "ai" });
  if (!executed.ok) return { ok: false, reason: executed.reason };
  const missing = missingProducts(trial, proposal);
  if (missing.length) return { ok: false, reason: `Нет продукта ${missing.join(", ")}: сначала примените предложение с ним.` };
  const gate = gateProposal(trial, proposal, { today });
  if (!gate.ok) return { ok: false, reason: `Не проходит проверку КБЖУ: ${gate.problems.join("; ")}.` };
  draft.ration = trial.ration;
  draft.products = trial.products;
  if (trial.sport) draft.sport = trial.sport;
  return { ok: true, productIds: (proposal.ops || []).filter((op) => op.op === "product").map((op) => op.product.id) };
}

function missingProducts(state, proposal) {
  const live = new Set((state.products || []).filter((product) => !product.deletedAt).map((product) => product.id));
  const names = new Set();
  (proposal.ops || []).forEach((op) => {
    const command = op.command || {};
    const meals = [...(command.meals || []), ...(command.days || []).flatMap((day) => day.meals || [])];
    meals.forEach((meal) => (meal.items || []).forEach((item) => {
      if (item.productId && !live.has(item.productId)) names.add(`«${item.name || item.productId}»`);
    }));
  });
  return [...names];
}

// The КБЖУ gate is code, not the model: not below 1200 ккал, within ±15% of
// the calorie target, protein at least 75% of its target, no excluded
// products and no products without КБЖУ.
// The days a change touches: the edited ones and those its preview shows.
export function proposalDays(spec) {
  return [...new Set([...(spec.gateDates || []), ...(spec.previewDates || spec.dates || [])])].sort();
}

// The day gate for every changed day, the week gate of the safety rules
// (#36) for the weeks around them, and warnings that do not block.
export function gateProposal(state, spec, { today = todayDateKey() } = {}) {
  const checks = [
    ...(spec.gateDates || []).map((date) => ({ label: date, meals: readRationDay(state, date)?.meals || [] })),
    ...(spec.gateMeals || []),
  ];
  const problems = [];
  let totals = null;
  checks.forEach(({ label, meals }) => {
    const result = gateMeals(state, meals);
    totals = totals || result.totals;
    result.problems.forEach((problem) => problems.push(checks.length > 1 ? `${label}: ${problem}` : problem));
  });
  const days = proposalDays(spec);
  problems.push(...weekProblems(state, days, today));
  return { ok: problems.length === 0, problems, totals, warnings: sportWarnings(state, days) };
}

export function gateMeals(state, meals) {
  const profile = state.ration?.profile || {};
  const owner = rationOwner(state);
  const probeDate = "2000-01-01";
  const probe = {
    user: state.user,
    products: state.products || [],
    ration: { versions: [], history: {}, profile, specialDays: { [`${owner}|${probeDate}`]: { date: probeDate, owner, meals: meals || [] } } },
  };
  const nutrition = readRationDayNutrition(probe, probeDate);
  const totals = nutrition.totals;
  const problems = [];
  const target = Number(profile.targetCalories) || 0;
  if (totals.calories < KBJU_GATE.minCalories) {
    problems.push(`калорийность ${Math.round(totals.calories)} ккал ниже безопасного минимума ${KBJU_GATE.minCalories}`);
  }
  if (target && Math.abs(totals.calories - target) / target > KBJU_GATE.tolerance) {
    problems.push(`калорийность ${Math.round(totals.calories)} ккал отличается от цели ${target} больше чем на 15%`);
  }
  const protein = Number(profile.targetProtein) || 0;
  if (protein && totals.protein < protein * KBJU_GATE.minProteinShare) {
    problems.push(`белок ${Math.round(totals.protein)} г меньше 75% цели ${protein} г`);
  }
  const excluded = (profile.excludedProducts || []).map(normalizeProductName).filter(Boolean);
  const products = state.products || [];
  (meals || []).forEach((meal) => (meal.items || []).forEach((item) => {
    const name = normalizeProductName(products.find((product) => product.id === item.productId)?.name || item.name);
    const term = excluded.find((value) => name.includes(value));
    if (term) problems.push(`исключённый продукт «${item.name || name}»`);
  }));
  const unknown = new Set(nutrition.missing.filter((entry) => entry.reason === "no_nutrition").map((entry) => entry.itemId));
  (meals || []).forEach((meal) => (meal.items || []).forEach((item) => {
    if (unknown.has(item.id)) problems.push(`у продукта «${item.name}» нет КБЖУ: сначала find_reference / search_food и upsert_product`);
  }));
  return { ok: problems.length === 0, totals, problems: [...new Set(problems)] };
}

export function pageOf(proposals) {
  const pages = new Set(proposals.map((proposal) => proposal.page || "ration"));
  return pages.has("ration") && pages.has("sport") ? "ration+sport" : pages.has("sport") ? "sport" : "ration";
}

export function batchSummary(proposals) {
  const text = `Ассистент: ${proposals.map((proposal) => proposal.summary).join("; ")}`;
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}
