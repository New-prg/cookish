// Runs the scenarios through the app module mobile-shell/ai-tools.js with the
// real provider: the same agent loop, gate and proposals as the app. All
// proposals of a run are applied at once, then the scenario checks the state.
// Usage: node scripts/ai-lab/app-bench.mjs [S1,S2]
import { KEY } from "./rai.mjs";
import { SCENARIOS } from "./scenarios.mjs";
import { TODAY, makeState } from "./fixture.mjs";
import { createRouterAiProvider, fetchTransport } from "../../mobile-shell/ai-provider.js";
import { createAssistant, createThread } from "../../mobile-shell/ai-tools.js";
import { memoryStorage, openLocalData } from "../../mobile-shell/local-data.js";

const only = process.argv[2]?.split(",");
let passed = 0;
const selected = SCENARIOS.filter((scenario) => !only || only.includes(scenario.id));
for (const scenario of selected) {
  const data = openLocalData(memoryStorage(makeState()));
  data.load();
  const before = data.snapshot();
  const provider = createRouterAiProvider({ getKey: () => KEY, transport: fetchTransport(fetch) });
  const assistant = createAssistant({ provider, getState: () => data.snapshot(), changePlan: data.changePlan, today: () => TODAY });
  const thread = createThread({ page: "ration", mode: "plan" });
  const started = Date.now();
  const result = await assistant.run(thread, scenario.prompt);
  const applied = thread.proposals.length ? assistant.apply(thread.proposals) : null;
  const checks = scenario.check(before, data.snapshot(), result.reply || "");
  const ok = checks.filter(([, pass]) => pass).length;
  if (ok === checks.length) passed += 1;
  console.log(`${scenario.id} ${scenario.title}: ${ok}/${checks.length} · ${Math.round((Date.now() - started) / 1000)} с · предложений ${thread.proposals.length}${applied && !applied.ok ? " (не применились)" : ""}`);
  checks.filter(([, pass]) => !pass).forEach(([label]) => console.log(`  ✗ ${label}`));
  thread.log.filter((entry) => entry.type === "progress").forEach((entry) => console.log(`  · ${entry.text}`));
  console.log(`  > ${String(result.reply || result.reason || "").slice(0, 200)}`);
}
console.log(`Итого: ${passed} из ${selected.length}`);
