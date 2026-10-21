// Runs the object-space Ассистент on the real model with five requests on the
// demo space: three plan changes, a tracker and a request that code must
// refuse. Every proposal is applied to a scratch copy to prove it fits. Spends
// the local routerai key (never printed); results go to
// output/ai-lab/assistant-bench.txt.
import fs from "node:fs";
import { KEY, rai } from "./rai.mjs";
import { createRouterAiProvider, fetchTransport } from "../../mobile-shell/services/assistant/ai-provider.js";
import { createCatalogService } from "../../mobile-shell/services/catalog/catalog.js";
import { openObjectStore, localDateKey } from "../../mobile-shell/objects/core/store.js";
import { demoLegacyState, legacyToObjects } from "../../mobile-shell/objects/core/migrate.js";
import { applyProposal, createObjectAssistant, newThread } from "../../mobile-shell/objects/core/assistant.js";

const TODAY = localDateKey();
const REQUESTS = [
  ["fish dinner", "замени ужин сегодня на что-то с рыбой", "proposal"],
  ["week 2000", "составь неделю на 2000 ккал с 130 г белка с понедельника", "either"],
  ["run on wednesdays", "добавь бег по средам на 30 минут", "proposal"],
  ["weight diary", "сделай дневник веса", "proposal"],
  ["900 kcal", "хочу 900 ккал в день", "refuse"],
];

const lines = [];
const log = (line) => { lines.push(line); console.log(line); };

const real = createRouterAiProvider({ getKey: () => KEY, transport: fetchTransport(fetch) });
const catalog = createCatalogService({ fetchImpl: fetch });

log(`assistant bench, today ${TODAY}, model ${real.model}`);
const total = { calls: 0, prompt: 0, completion: 0, cached: 0 };

// A trivial request first: a key without balance would fail all five requests
// the same way and burn nothing but time.
const probe = await real.complete({ messages: [{ role: "user", content: "Скажи: ок" }] });
if (!probe.ok) {
  const key = await rai("/api/v1/key", null, "GET").catch(() => null);
  log(`NOT RUN: the provider refused a one-word request (${probe.kind}: ${probe.reason}); key balance left: ${key?.json?.data?.limit_remaining ?? "unknown"}`);
  fs.mkdirSync("output/ai-lab", { recursive: true });
  fs.writeFileSync("output/ai-lab/assistant-bench.txt", lines.join(String.fromCharCode(10)) + String.fromCharCode(10));
  process.exit(1);
}

for (const [id, request, expect] of REQUESTS) {
  const store = openObjectStore({ storage: null, today: () => TODAY });
  store.replaceAll(legacyToObjects(demoLegacyState(TODAY), { today: TODAY }));
  const used = { calls: 0, prompt: 0, completion: 0, cached: 0 };
  const provider = {
    ...real,
    async complete(payload) {
      used.calls += 1;
      const answer = await real.complete(payload);
      const usage = answer.ok ? answer.usage : null;
      used.prompt += usage?.prompt_tokens || 0;
      used.completion += usage?.completion_tokens || 0;
      used.cached += usage?.prompt_tokens_details?.cached_tokens || 0;
      return answer;
    },
  };
  const assistant = createObjectAssistant({ provider, getState: () => store.state(), catalog, today: () => TODAY });
  const thread = newThread();
  const started = Date.now();
  const result = await assistant.run(thread, request);
  const ms = Date.now() - started;
  for (const key of Object.keys(total)) total[key] += used[key];

  const names = new Map(thread.messages.flatMap((m) => m.tool_calls || []).map((c) => [c.id, c.function.name]));
  const trace = thread.messages.filter((m) => m.role === "tool").map((m) => {
    const out = JSON.parse(m.content);
    const name = names.get(m.tool_call_id);
    return out.ok === false ? `${name}:REFUSED` : name;
  });
  const refused = thread.messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content)).filter((o) => o.ok === false && (o.problems || o.error)).map((o) => (o.problems || [o.error]).join("; ")).filter((t) => !/Нет (типа|связи)/.test(t));
  const proposals = thread.proposals;
  const applied = proposals.map((p) => {
    const outcome = applyProposal(store, thread, p.id);
    return outcome.ok ? "applies" : `DOES NOT APPLY: ${outcome.reason}`;
  });
  const verdict = expect === "refuse" && proposals.length ? "UNEXPECTED: a proposal exists for a request that must be refused"
    : expect === "proposal" && !proposals.length ? "UNEXPECTED: no proposal"
    : proposals.length ? "proposal" : "no proposal (refused)";
  log(`\n${id}: ${verdict}; model calls ${used.calls}; ${ms} ms; tokens in ${used.prompt} (cached ${used.cached}) out ${used.completion}; ok=${result.ok}`);
  log(`  tools: ${trace.join(", ") || "-"}`);
  for (const [index, p] of proposals.entries()) log(`  proposal ${p.kind} «${p.summary}» ${applied[index]}${p.preview?.days?.length ? `; days ${p.preview.days.map((d) => `${d.date} ${d.before.kcal}→${d.after.kcal}`).join(", ")}` : ""}${p.preview?.rows ? `; rows ${p.preview.rows.map((r) => r[1]).join(" | ")}` : ""}`);
  for (const text of refused.slice(0, 4)) log(`  code refused: ${text.slice(0, 300)}`);
  log(`  reply: ${thread.log.filter((e) => e.type === "assistant").at(-1)?.text || thread.log.filter((e) => e.type === "error").at(-1)?.text || "-"}`);
}
log(`\ntotal: model calls ${total.calls}; tokens in ${total.prompt} (cached ${total.cached}) out ${total.completion}`);
fs.mkdirSync("output/ai-lab", { recursive: true });
fs.writeFileSync("output/ai-lab/assistant-bench.txt", `${lines.join("\n")}\n`);
