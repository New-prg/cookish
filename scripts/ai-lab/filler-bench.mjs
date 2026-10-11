// The Заполнитель (#65) on the real provider and Open Food Facts: a batch of
// products without КБЖУ goes through the Service as in the app, and the Core
// takes the answer.
// Usage: [AI_MODEL=glm] node scripts/ai-lab/filler-bench.mjs ["Гречка" "Творог" …]
import { KEY } from "./rai.mjs";
import { memoryStorage, openLocalData } from "../../mobile-shell/core/local-data.js";
import { AI_MODELS, createRouterAiProvider, fetchTransport } from "../../mobile-shell/services/assistant/ai-provider.js";
import { openLocalServices } from "../../mobile-shell/transport/local.js";

const config = AI_MODELS[process.env.AI_MODEL || "haiku"];
const names = process.argv.slice(2).length ? process.argv.slice(2) : ["Гречка", "Простоквашино молоко 2,5%", "Творог"];

const data = openLocalData(memoryStorage());
data.load();
names.forEach((name) => data.saveProduct({ name, unit: "г" }));
let requests = 0;
let cost = 0;
const transport = fetchTransport(fetch);
const services = openLocalServices({
  fetchImpl: fetch,
  dataPort: { read: async () => data.snapshot() },
  providerFor: (key) => createRouterAiProvider({
    getKey: () => key,
    config,
    transport: async (request) => {
      const response = await transport(request);
      requests += 1;
      try {
        cost += JSON.parse(response.text).usage?.cost || 0;
      } catch {
        // Not a completion.
      }
      return response;
    },
  }),
});

const started = Date.now();
const products = data.snapshot().products.map(({ id, name, unit, nutrition }) => ({ id, name, unit, nutrition }));
const result = await services.request("filler", "fill", { products, key: KEY });
if (!result.ok) {
  console.log(`Ошибка: ${result.reason}`);
  process.exit(1);
}
const applied = data.applyFillerBatch(result);
console.log(`${config.model}: ${Math.round((Date.now() - started) / 1000)} с, вызовов ${requests}, ${cost.toFixed(3)} ₽; записано ${applied.filled}`);
const { products: after, filler } = data.snapshot();
after.forEach((product) => {
  const question = filler.questions.find((item) => item.productId === product.id);
  const estimate = filler.proposals.find((item) => item.ops[0].product.id === product.id);
  const line = product.nutrition ? `${product.nutrition.calories} ккал · ${product.nutrition.source}${product.nutrition.sourceRef ? ` (${product.nutrition.sourceRef})` : ""}`
    : question ? `вопрос: ${question.candidates.map((card) => `${card.name} ${card.nutrition.calories}`).join(" / ")}`
    : estimate ? `оценка ${estimate.ops[0].product.nutrition.calories} ккал`
    : "без исхода";
  console.log(`  ${product.name}: ${line}`);
});
if (filler.misses.length) console.log(`  не найдено: ${filler.misses.map((miss) => miss.name).join(", ")}`);
