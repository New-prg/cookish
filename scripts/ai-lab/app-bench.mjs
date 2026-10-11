// Runs the scenarios through the assistant Service of the app with the real
// provider: the same transport, agent loop, gate and proposals as the app. All
// proposals of a run are applied at once by the Core, then the scenario
// checks the state. AI_MODEL picks a model of AI_MODELS (haiku by default),
// AI_EFFORT overrides its reasoning effort.
// Usage: [AI_MODEL=glm] [AI_EFFORT=medium] node scripts/ai-lab/app-bench.mjs [S1,S2]
import { KEY } from "./rai.mjs";
import { SCENARIOS } from "./scenarios.mjs";
import { TODAY, makeState } from "./fixture.mjs";
import { createThread } from "../../mobile-shell/core/assistant-thread.js";
import { memoryStorage, openLocalData } from "../../mobile-shell/core/local-data.js";
import { AI_MODELS, createRouterAiProvider, fetchTransport } from "../../mobile-shell/services/assistant/ai-provider.js";
import { openLocalServices } from "../../mobile-shell/transport/local.js";

const modelName = process.env.AI_MODEL || "haiku";
const config = { ...AI_MODELS[modelName], ...(process.env.AI_EFFORT ? { reasoningEffort: process.env.AI_EFFORT } : {}) };
const only = process.argv[2]?.split(",");

// Every completion's usage, summed per scenario.
let spent;
const transport = fetchTransport(fetch);
async function countingTransport(request) {
  const response = await transport(request);
  try {
    const usage = JSON.parse(response.text).usage || {};
    spent.calls += 1;
    spent.prompt += usage.prompt_tokens || 0;
    spent.cached += usage.prompt_tokens_details?.cached_tokens || 0;
    spent.completion += usage.completion_tokens || 0;
    spent.cost += usage.cost || 0;
  } catch {
    // Not a completion: the key check or an error page.
  }
  return response;
}

console.log(`${config.model}, effort ${config.reasoningEffort}`);
let passed = 0;
const totals = { seconds: 0, cost: 0, prompt: 0, cached: 0 };
const times = [];
const selected = SCENARIOS.filter((scenario) => !only || only.includes(scenario.id));
for (const scenario of selected) {
  spent = { calls: 0, prompt: 0, cached: 0, completion: 0, cost: 0 };
  const data = openLocalData(memoryStorage(makeState()));
  data.load();
  const before = data.snapshot();
  const services = openLocalServices({
    fetchImpl: fetch,
    dataPort: { read: async () => data.snapshot() },
    providerFor: (key) => createRouterAiProvider({ getKey: () => key, transport: countingTransport, config }),
    today: () => TODAY,
  });
  const started = Date.now();
  // The time until the first Предложение reaches the feed.
  let firstProposal = 0;
  const onEvent = (event) => {
    if (event.type === "proposal" && !firstProposal) firstProposal = Date.now() - started;
  };
  const { thread, ...result } = await services.stream("assistant", "run", { thread: createThread({ page: "ration", mode: "plan" }), text: scenario.prompt, key: KEY }, { onEvent });
  const seconds = (Date.now() - started) / 1000;
  const applied = thread.proposals.length ? data.applyProposals(thread.proposals, { today: TODAY }) : null;
  const checks = scenario.check(before, data.snapshot(), result.reply || "");
  const ok = checks.filter(([, pass]) => pass).length;
  if (ok === checks.length) passed += 1;
  times.push(seconds);
  Object.assign(totals, { seconds: totals.seconds + seconds, cost: totals.cost + spent.cost, prompt: totals.prompt + spent.prompt, cached: totals.cached + spent.cached });
  const card = firstProposal ? ` · до карточки ${(firstProposal / 1000).toFixed(1)} с` : "";
  console.log(`${scenario.id} ${scenario.title}: ${ok}/${checks.length} · ${seconds.toFixed(1)} с${card} · вызовов ${spent.calls} · ${spent.cost.toFixed(3)} ₽ · кэш ${spent.prompt ? Math.round((100 * spent.cached) / spent.prompt) : 0}% · предложений ${thread.proposals.length}${applied && !applied.ok ? " (не применились)" : ""}`);
  checks.filter(([, pass]) => !pass).forEach(([label]) => console.log(`  ✗ ${label}`));
  thread.log.filter((entry) => entry.type === "progress").forEach((entry) => console.log(`  · ${entry.text}`));
  console.log(`  > ${String(result.reply || result.reason || "").replace(/\s+/g, " ").slice(0, 200)}`);
}
const median = times.sort((a, b) => a - b)[Math.floor(times.length / 2)] || 0;
console.log(`Итого ${config.model} (${config.reasoningEffort}): ${passed} из ${selected.length}, медиана ${median.toFixed(1)} с, ${totals.cost.toFixed(2)} ₽, кэш ${totals.prompt ? Math.round((100 * totals.cached) / totals.prompt) : 0}% промпта`);
