import { checkNutritionCard } from "./nutrition-check.js";
import { NUTRITION_SOURCES, nutritionSourceLabel } from "./nutrition-source.js";
import { createId } from "./replay.js";

// The Заполнитель (epic #59) as Core data: products saved without full КБЖУ
// wait in the queue; what it could not decide alone waits as questions, its
// estimates as Предложения; names found nowhere gather in `misses` for the
// next reference. It lives in the Cache and the Outbox and survives a restart.
//
//   enabled    «Заполнять КБЖУ автоматически» in Profile; off, only the
//              products the person sends with «Заполнить ИИ» (manual) go
//   queue      [{ id, productId, addedAt, manual, hint, attempts }]
//   questions  [{ id, productId, kind: "choose" | "replace", text, candidates: [card] }]
//   proposals  estimate Предложения, as the assistant makes them
//   misses     [{ name, at }]

export const REQUIRED_NUTRITION_FIELDS = Object.freeze(["calories", "protein", "fat", "carbs"]);
// A product the Заполнитель tried this many times without an outcome leaves
// the queue: it stays «нет КБЖУ» with «Заполнить ИИ».
export const FILLER_ATTEMPTS = 2;
export const FILLER_MISSES = 200;
// Products saved within 30 s go as one batch; four steps of the agent fit
// about five products.
export const FILLER_BURST_MS = 30_000;
export const FILLER_RETRY_MS = 60_000;
export const FILLER_BATCH = 5;

const CARD_LABELS = new Set([NUTRITION_SOURCES.reference, NUTRITION_SOURCES.off, NUTRITION_SOURCES.estimate]);
const NUMBERS = ["calories", "protein", "fat", "carbs", "fiber"];

function filled(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

// All four of калории, белки, жиры, углеводы are known.
export function hasNutrition(product) {
  return REQUIRED_NUTRITION_FIELDS.every((field) => filled(product?.nutrition?.[field]));
}

// The new card changes КБЖУ the person typed: that takes the person's answer,
// never a silent write. Empty fields are filled without a question.
export function changesPersonValues(product, nutrition) {
  if (!product?.nutrition || nutritionSourceLabel(product) !== NUTRITION_SOURCES.user) return false;
  return REQUIRED_NUTRITION_FIELDS.some((field) => {
    const own = product.nutrition[field];
    return filled(own) && Math.abs(Number(own) - Number(nutrition?.[field])) > 0.05;
  });
}

export function emptyFiller() {
  return { enabled: true, queue: [], questions: [], proposals: [], misses: [] };
}

const list = (value) => (Array.isArray(value) ? value : []);

export function normalizeFiller(source) {
  const base = source && typeof source === "object" ? source : {};
  return {
    ...emptyFiller(),
    ...base,
    enabled: base.enabled !== false,
    queue: list(base.queue)
      .filter((entry) => typeof entry?.productId === "string" && entry.productId)
      .map((entry) => ({
        id: String(entry.id || ""),
        productId: entry.productId,
        addedAt: String(entry.addedAt || ""),
        manual: Boolean(entry.manual),
        hint: String(entry.hint || ""),
        attempts: Number(entry.attempts) || 0,
      })),
    questions: list(base.questions).filter((question) => question?.id && question.productId),
    proposals: list(base.proposals).filter((proposal) => proposal?.id),
    misses: list(base.misses).filter((miss) => miss?.name),
  };
}

export function isQueuedForFilling(state, productId) {
  return (state.filler?.queue || []).some((entry) => entry.productId === productId);
}

export function fillerQuestionFor(state, productId) {
  return (state.filler?.questions || []).find((question) => question.productId === productId) || null;
}

// The entries the Заполнитель may take now.
export function fillerPending(filler, limit = Infinity) {
  return (filler?.queue || []).filter((entry) => filler.enabled !== false || entry.manual).slice(0, limit);
}

// After a command changed products at `now`: a product it saved without full
// КБЖУ joins the queue, unless the person is already asked about it; one that
// got them or was deleted leaves it, and a deleted product takes its
// questions and estimates along.
export function syncFillerQueue(filler, products, now) {
  const base = normalizeFiller(filler);
  const byId = new Map(products.map((product) => [product.id, product]));
  const alive = (productId) => byId.has(productId) && !byId.get(productId).deletedAt;
  const queue = base.queue.filter((entry) => alive(entry.productId) && !hasNutrition(byId.get(entry.productId)));
  const waiting = new Set([
    ...base.questions.map((question) => question.productId),
    ...base.proposals.map((proposal) => proposal.ops?.[0]?.product?.id),
  ]);
  products.forEach((product) => {
    if (product.updatedAt !== now || product.deletedAt || hasNutrition(product) || waiting.has(product.id)) return;
    if (queue.some((entry) => entry.productId === product.id)) return;
    queue.push({ id: createId("fill"), productId: product.id, addedAt: now, manual: false, hint: "", attempts: 0 });
  });
  return {
    ...base,
    queue,
    // A choice is moot once the product has КБЖУ by other means.
    questions: base.questions.filter((question) => alive(question.productId) && (question.kind === "replace" || !hasNutrition(byId.get(question.productId)))),
    proposals: base.proposals.filter((proposal) => alive(proposal.ops?.[0]?.product?.id)),
  };
}

// A card from the Service, checked again by the Core: { label, sourceRef,
// nutrition, barcode?, brand?, unit? } or null.
export function checkedCard(card) {
  if (!card || !CARD_LABELS.has(card.label)) return null;
  const nutrition = Object.fromEntries(NUMBERS.map((field) => [field, filled(card.nutrition?.[field]) ? Number(card.nutrition[field]) : null]));
  if (!checkNutritionCard(nutrition).ok) return null;
  return {
    label: card.label,
    sourceRef: String(card.sourceRef || ""),
    nutrition,
    barcode: /^\d{8,14}$/.test(String(card.barcode || "")) ? String(card.barcode) : "",
    brand: String(card.brand || ""),
    unit: String(card.unit || ""),
  };
}

// The product with the КБЖУ of `card`, keeping what the card does not know.
export function withCard(product, card, { now, actor = "ai" }) {
  return {
    ...product,
    ...(card.barcode ? { barcode: card.barcode, kind: "sku" } : {}),
    ...(card.brand && !product.brand ? { brand: card.brand } : {}),
    catalogSource: card.label,
    nutrition: {
      ...card.nutrition,
      vitamins: product.nutrition?.vitamins || "",
      minerals: product.nutrition?.minerals || "",
      basis: "100 г/мл",
      source: card.label,
      ...(card.sourceRef ? { sourceRef: card.sourceRef } : {}),
    },
    updatedAt: now,
    updatedBy: actor,
  };
}

const per100 = (nutrition) => Object.fromEntries(NUMBERS.map((field) => [field, filled(nutrition?.[field]) ? Number(nutrition[field]) : null]));

// An estimate of the Заполнитель as a Предложение of the assistant feed.
export function estimateProposal(product, card, now) {
  const next = withCard(product, card, { now });
  return {
    id: createId("proposal"),
    ref: "З",
    kind: "product",
    summary: `Оценка КБЖУ «${product.name}»`,
    page: "ration",
    dates: [],
    gateDates: [],
    ops: [{ op: "product", product: next }],
    preview: { type: "product", name: product.name, unit: product.unit, before: product.nutrition ? per100(product.nutrition) : null, after: per100(next.nutrition) },
    status: "pending",
    createdAt: now,
    filler: true,
  };
}

export function choiceQuestion(product, candidates, kind) {
  return {
    id: createId("question"),
    productId: product.id,
    kind,
    text: kind === "replace"
      ? `Вы вводили КБЖУ «${product.name}» сами. Заменить их значениями «${candidates[0].label}»?`
      : `Какой именно продукт «${product.name}»? Выберите вариант, напишите своими словами или отсканируйте штрихкод.`,
    candidates,
  };
}
