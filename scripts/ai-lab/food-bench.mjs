// The КБЖУ scenarios of #64 through the assistant Service of the app, with
// the real provider and the real Open Food Facts: which source the model
// picks and whether the code accepts it.
// Usage: [AI_MODEL=glm] node scripts/ai-lab/food-bench.mjs [F1,F2]
import { KEY } from "./rai.mjs";
import { TODAY, makeState } from "./fixture.mjs";
import { createThread } from "../../mobile-shell/core/assistant-thread.js";
import { memoryStorage, openLocalData } from "../../mobile-shell/core/local-data.js";
import { AI_MODELS, createRouterAiProvider, fetchTransport } from "../../mobile-shell/services/assistant/ai-provider.js";
import { openLocalServices } from "../../mobile-shell/transport/local.js";

const config = AI_MODELS[process.env.AI_MODEL || "haiku"];
const only = process.argv[2]?.split(",");

// A state where `name` is in the catalog without КБЖУ.
function stateWithout(name) {
  const state = makeState();
  const own = state.products.find((product) => product.name === name);
  if (own) own.nutrition = null;
  else state.products.push({ id: `product_${state.products.length + 1}`, name, unit: "г", nutrition: null });
  return state;
}

const product = (thread) => thread.proposals.find((proposal) => proposal.kind === "product");
const source = (thread) => product(thread)?.ops[0].product.nutrition.source || "";

const SCENARIOS = [
  {
    id: "F1", title: "«гречка» → справочник", state: () => stateWithout("Гречка"),
    prompt: "Заполни КБЖУ продукта «Гречка».",
    check: (thread) => [
      ["КБЖУ из справочника", source(thread) === "Справочник"],
      ["в каталог сразу", product(thread)?.autoApply === true],
    ],
  },
  {
    id: "F2", title: "«Простоквашино молоко 2,5%» → OFF", state: () => makeState(),
    prompt: "Добавь в каталог молоко Простоквашино 2,5% с КБЖУ.",
    check: (thread) => [
      ["КБЖУ из Open Food Facts", source(thread) === "Open Food Facts"],
      ["со штрихкодом", /^\d{8,14}$/.test(product(thread)?.ops[0].product.barcode || "")],
    ],
  },
  {
    id: "F3", title: "«творог» без жирности → вопрос", state: () => stateWithout("Творог"),
    prompt: "Заполни КБЖУ продукта «Творог».",
    check: (thread, reply) => [
      ["ничего не записано", !thread.proposals.some((proposal) => proposal.autoApply)],
      ["спрашивает жирность или марку", /жирност|%|марк|какой|какую|штрихкод/i.test(reply) && /\?/.test(reply)],
    ],
  },
  {
    id: "F4", title: "несуществующий продукт → оценка", state: () => makeState(),
    prompt: "Добавь в каталог «пирог с визигой по рецепту бабушки» с КБЖУ.",
    check: (thread) => [
      ["Предложение с оценкой", source(thread) === "Оценка ИИ"],
      ["ждёт человека", product(thread)?.status === "pending" && !product(thread)?.autoApply],
    ],
  },
];

console.log(`${config.model}, effort ${config.reasoningEffort}`);
let passed = 0;
const selected = SCENARIOS.filter((scenario) => !only || only.includes(scenario.id));
for (const scenario of selected) {
  const data = openLocalData(memoryStorage(scenario.state()));
  data.load();
  const services = openLocalServices({
    fetchImpl: fetch,
    dataPort: { read: async () => data.snapshot() },
    providerFor: (key) => createRouterAiProvider({ getKey: () => key, transport: fetchTransport(fetch), config }),
    today: () => TODAY,
  });
  const started = Date.now();
  const { thread, ...result } = await services.stream("assistant", "run", { thread: createThread({ page: "ration", mode: "plan" }), text: scenario.prompt, key: KEY });
  const reply = String(result.reply || result.reason || "");
  const checks = scenario.check(thread, reply);
  const ok = checks.filter(([, pass]) => pass).length;
  if (ok === checks.length) passed += 1;
  console.log(`${scenario.id} ${scenario.title}: ${ok}/${checks.length} · ${Math.round((Date.now() - started) / 1000)} с`);
  checks.filter(([, pass]) => !pass).forEach(([label]) => console.log(`  ✗ ${label}`));
  thread.log.filter((entry) => entry.type === "progress").forEach((entry) => console.log(`  · ${entry.text}`));
  thread.proposals.forEach((proposal) => console.log(`  ▸ ${proposal.summary}${proposal.autoApply ? " (сразу)" : ""}`));
  console.log(`  > ${reply.replace(/\s+/g, " ").slice(0, 220)}`);
}
console.log(`Итого: ${passed} из ${selected.length}`);
