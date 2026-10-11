// Runs the scenarios through the assistant Service of the app with the real
// provider: the same transport, agent loop, gate and proposals as the app. All
// proposals of a run are applied at once by the Core, then the scenario
// checks the state.
// Usage: node scripts/ai-lab/app-bench.mjs [S1,S2]
import { KEY } from "./rai.mjs";
import { SCENARIOS } from "./scenarios.mjs";
import { TODAY, makeState } from "./fixture.mjs";
import { createThread } from "../../mobile-shell/core/assistant-thread.js";
import { memoryStorage, openLocalData } from "../../mobile-shell/core/local-data.js";
import { openLocalServices } from "../../mobile-shell/transport/local.js";

const only = process.argv[2]?.split(",");
let passed = 0;
const selected = SCENARIOS.filter((scenario) => !only || only.includes(scenario.id));
for (const scenario of selected) {
  const data = openLocalData(memoryStorage(makeState()));
  data.load();
  const before = data.snapshot();
  const services = openLocalServices({ fetchImpl: fetch, dataPort: { read: async () => data.snapshot() }, today: () => TODAY });
  const started = Date.now();
  const { thread, ...result } = await services.stream("assistant", "run", { thread: createThread({ page: "ration", mode: "plan" }), text: scenario.prompt, key: KEY });
  const applied = thread.proposals.length ? data.applyProposals(thread.proposals, { today: TODAY }) : null;
  const checks = scenario.check(before, data.snapshot(), result.reply || "");
  const ok = checks.filter(([, pass]) => pass).length;
  if (ok === checks.length) passed += 1;
  console.log(`${scenario.id} ${scenario.title}: ${ok}/${checks.length} · ${Math.round((Date.now() - started) / 1000)} с · предложений ${thread.proposals.length}${applied && !applied.ok ? " (не применились)" : ""}`);
  checks.filter(([, pass]) => !pass).forEach(([label]) => console.log(`  ✗ ${label}`));
  thread.log.filter((entry) => entry.type === "progress").forEach((entry) => console.log(`  · ${entry.text}`));
  console.log(`  > ${String(result.reply || result.reason || "").slice(0, 200)}`);
}
console.log(`Итого: ${passed} из ${selected.length}`);
