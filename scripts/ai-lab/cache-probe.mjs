// Checks what routerai.ru passes through to a model (#60): whether it keeps
// `cache_control` on the system prompt and reports `cached_tokens`, and how
// it treats `temperature` and `reasoning.effort`. The prompt and the tools are
// the assistant's own, captured from one turn of the app's agent loop.
// Usage: node scripts/ai-lab/cache-probe.mjs [model]
import { rai } from "./rai.mjs";
import { TODAY, makeState } from "./fixture.mjs";
import { createThread } from "../../mobile-shell/core/assistant-thread.js";
import { createAssistant } from "../../mobile-shell/services/assistant/ai-tools.js";

const model = process.argv[2] || "anthropic/claude-haiku-5.5";

let captured = null;
await createAssistant({
  provider: { complete: async (request) => ((captured = request), { ok: true, message: { content: "ok" } }) },
  getState: () => makeState(),
  today: () => TODAY,
}).run(createThread({ page: "ration", mode: "plan" }), "Сделай завтра день на 1800 ккал");
const [system, ...messages] = captured.messages;

function request(fields) {
  return {
    model,
    messages: [
      { role: "system", content: [{ type: "text", text: system.content, cache_control: { type: "ephemeral" } }] },
      ...messages,
    ],
    tools: captured.tools,
    tool_choice: "auto",
    max_tokens: 2000,
    ...fields,
  };
}

function report(label, answer) {
  const usage = answer.json?.usage || {};
  console.log(`${label}: HTTP ${answer.status}, ${answer.ms} мс`);
  if (answer.status !== 200) return console.log(`  ${JSON.stringify(answer.json).slice(0, 400)}`);
  const message = answer.json.choices?.[0]?.message || {};
  console.log(`  usage ${JSON.stringify(usage)}`);
  console.log(`  tool_calls ${(message.tool_calls || []).map((call) => call.function?.name).join(", ") || "—"}; text ${JSON.stringify(String(message.content || "").slice(0, 120))}`);
}

console.log(`model ${model}; system ${system.content.length} chars, tools ${captured.tools.length}`);
report("1. cache_control, effort low", await rai("/api/v1/chat/completions", request({ reasoning: { effort: "low" } })));
report("2. same request again", await rai("/api/v1/chat/completions", request({ reasoning: { effort: "low" } })));
report("3. temperature 0.2", await rai("/api/v1/chat/completions", request({ reasoning: { effort: "low" }, temperature: 0.2 })));
report("4. no reasoning field", await rai("/api/v1/chat/completions", request({})));
