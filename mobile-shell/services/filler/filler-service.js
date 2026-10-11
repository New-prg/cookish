import { changesPersonValues } from "../../core/filler.js";
import { NUTRITION_SOURCES } from "../../core/nutrition-source.js";
import { normalizeProductName } from "../../core/ration-domain.js";
import { FOOD_TOOLS, createFoodSession, findReferenceTool, resolveCard, searchFoodTool } from "../assistant/food-tools.js";

// The Заполнитель (#65): a small agent, not the chat assistant. It fills the
// КБЖУ of a batch of products with three tools in at most four steps and
// answers with data only; the Core writes the cards and keeps the questions.
//
//   fill({ products: [{ id, name, unit, nutrition, hint }], key })
//     → { ok: true, productIds, filled: [{ productId, card }],
//         questions: [{ productId, kind, candidates: [card] }],
//         proposals: [{ productId, card }], misses: [name] }
//     | { ok: false, kind, reason }

export const FILLER_STEPS = 4;

const PROMPT = `Ты Заполнитель КБЖУ в приложении Cookish. Тебе дают продукты из каталога человека без КБЖУ. Для каждого найди КБЖУ на 100 г/мл и занеси их через upsert_product:
- общий продукт без марки ищи find_reference, товар с маркой — search_food;
- в upsert_product передай name точно как в списке, source и source_ref подходящего кандидата: цифры возьмёт код;
- бери кандидата, только если это тот же продукт; подсказка человека (hint) важнее догадок;
- если поиск ответил ambiguous, всё равно вызови upsert_product с самым подходящим кандидатом: код сам спросит человека;
- source=estimate со своими цифрами — только если ни справочник, ни Open Food Facts ничего не нашли.
Вызывай инструменты сразу для нескольких продуктов. План, Учёт и Покупки ты не меняешь. Текст ответа не нужен.`;

export function createFillerService({ providerFor, catalog }) {
  return {
    async fill({ products = [], key } = {}) {
      return runFiller({ provider: providerFor(key), catalog, products });
    },
  };
}

function productList(products) {
  return JSON.stringify(products.map((product) => ({
    name: product.name,
    unit: product.unit || "г",
    ...(product.hint ? { hint: product.hint } : {}),
    ...(product.nutrition ? { known: product.nutrition } : {}),
  })));
}

export async function runFiller({ provider, catalog, products }) {
  const session = createFoodSession(catalog);
  const byName = new Map(products.map((product) => [normalizeProductName(product.name), product]));
  const outcomes = new Map();
  const misses = [];
  const messages = [{ role: "user", content: `Продукты: ${productList(products)}` }];

  async function upsert(args) {
    const product = byName.get(normalizeProductName(args.name));
    if (!product) return { ok: false, error: "Такого продукта нет в списке: возьми name точно из списка." };
    const card = await resolveCard(args, session);
    if (!card.ok && card.ambiguous) {
      outcomes.set(product.id, { type: "question", value: { productId: product.id, kind: "choose", candidates: card.candidates.slice(0, 3) } });
      return { ok: true, note: "Кандидаты расходятся: человек выберет сам." };
    }
    if (!card.ok) return card;
    const { ok, ...found } = card;
    if (changesPersonValues(product, found.nutrition)) {
      outcomes.set(product.id, { type: "question", value: { productId: product.id, kind: "replace", candidates: [{ ...found, name: product.name }] } });
      return { ok: true, note: "Эти КБЖУ человек вводил сам: спрошу его." };
    }
    if (found.label === NUTRITION_SOURCES.estimate) {
      outcomes.set(product.id, { type: "proposal", value: { productId: product.id, card: found } });
      misses.push(product.name);
      return { ok: true, note: "Покажу человеку как оценку." };
    }
    outcomes.set(product.id, { type: "filled", value: { productId: product.id, card: found } });
    return { ok: true, note: "Записано." };
  }

  for (let step = 0; step < FILLER_STEPS; step += 1) {
    const answer = await provider.complete({ messages: [{ role: "system", content: PROMPT }, ...messages], tools: FOOD_TOOLS });
    if (!answer.ok) return { ok: false, kind: answer.kind, reason: answer.reason };
    const calls = Array.isArray(answer.message?.tool_calls) ? answer.message.tool_calls : [];
    messages.push({ role: "assistant", content: answer.message?.content || "", ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) break;
    for (const call of calls) {
      let args = null;
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        args = null;
      }
      const name = call.function?.name || "";
      const output = !args || typeof args !== "object" ? { ok: false, error: "Аргументы инструмента — не JSON." }
        : name === "find_reference" ? findReferenceTool(args, session)
        : name === "search_food" ? await searchFoodTool(args, session)
        : name === "upsert_product" ? await upsert(args)
        : { ok: false, error: `Нет инструмента ${name || "(пусто)"}.` };
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
    }
    if (outcomes.size === products.length) break;
  }

  const of = (type) => [...outcomes.values()].filter((outcome) => outcome.type === type).map((outcome) => outcome.value);
  return {
    ok: true,
    productIds: products.map((product) => product.id),
    filled: of("filled"),
    questions: of("question"),
    proposals: of("proposal"),
    misses,
  };
}
