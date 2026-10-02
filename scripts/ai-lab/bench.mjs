import { mkdirSync, writeFileSync } from "node:fs";
import { rai, netStats } from "./rai.mjs";
import { makeState } from "./fixture.mjs";
import { SCENARIOS } from "./scenarios.mjs";
import { runGlm } from "./glm.mjs";
import { runJev } from "./jev.mjs";

const [,, which = "both", repsArg = "1", only = ""] = process.argv;
const reps = Number(repsArg);
const runners = { jev: runJev, glm: runGlm };
const results = [];
const usage = async () => (await rai("/api/v1/key", null, "GET")).json.data.usage;
for (const name of which === "both" ? ["jev", "glm"] : [which]) {
  const u0 = await usage();
  for (const sc of SCENARIOS.filter((s) => !only || only.split(",").includes(s.id))) {
    for (let rep = 0; rep < reps; rep++) {
      const before = makeState();
      let out;
      try { out = await runners[name](structuredClone(before), sc.prompt); }
      catch (e) { out = { state: before, reply: "", trace: [], error: String(e.message || e), ms: 0, calls: 0, cost: 0 }; }
      const checks = sc.check(before, out.state, out.reply || "");
      const passed = checks.filter(([, ok]) => ok).length;
      const row = { model: name, id: sc.id, rep, score: passed / checks.length, passed, total: checks.length, failed: checks.filter(([, ok]) => !ok).map(([l]) => l), ms: out.ms, calls: out.calls, tokensIn: out.tokensIn, tokensOut: out.tokensOut, reasoning: out.reasoning, cost: out.cost, reply: out.reply, error: out.error, trace: out.trace };
      results.push(row);
      console.log(`${name} ${sc.id}#${rep} ${passed}/${checks.length} ${out.ms}ms calls=${out.calls} cost=${(out.cost || 0).toFixed(4)} ${out.error ? "ERR " + out.error : ""}\n   reply: ${(out.reply || "").replace(/\s+/g, " ").slice(0, 220)}\n   failed: ${row.failed.join("; ")}`);
      for (const t of out.trace) console.log("   ·", JSON.stringify(t).slice(0, 400));
    }
  }
  const u1 = await usage();
  console.log(`== ${name}: retries ${netStats.retries} ${JSON.stringify(netStats.failures)}`);
  console.log(`== ${name}: billed usage delta ${(u1 - u0).toFixed(4)} ₽`);
  results.push({ model: name, billedDelta: u1 - u0 });
}
const outDir = new URL("../../output/ai-lab/", import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL(`results-${which}-${Date.now()}.json`, outDir), JSON.stringify(results, null, 1));
