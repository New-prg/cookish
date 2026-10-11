// Context compaction of an assistant thread (#61), the way coding agents do
// it (OpenCode prune, Codex handoff, Claude Code compact). When the last
// request reached 90k tokens, old read results give way to a label first; if
// the conversation is still above 60k, the model writes a note, and from then
// on it sees the note, the person's own words, the pending Предложения and the
// last turn. Only what goes to the model shrinks: the feed keeps everything.

export const COMPACTION = Object.freeze({
  threshold: 90_000,
  noteAbove: 60_000,
  // The person's earlier messages kept word for word, newest first.
  humanBudget: 10_000,
  // Reads after the last two messages of the person stay.
  freshHumanMessages: 2,
  // Until a request measures it.
  charsPerToken: 3,
});

export const STALE_READ = "[устарело — перечитай";
export const COMPACTED_TEXT = "Сжал начало разговора";

const READ_TOOLS = new Set(["search_food", "find_reference"]);

export function isReadTool(name) {
  return String(name).startsWith("get_") || READ_TOOLS.has(name);
}

export function requestChars({ system = "", tools = [], messages = [] }) {
  return String(system).length + JSON.stringify(tools).length + JSON.stringify(messages).length;
}

// Tokens per character as the last request of the thread measured them.
function tokenRate(thread) {
  return thread.promptTokens > 0 && thread.promptChars > 0 ? thread.promptTokens / thread.promptChars : 1 / COMPACTION.charsPerToken;
}

export function estimateTokens(request, thread) {
  return Math.round(requestChars(request) * tokenRate(thread));
}

// Results of reads older than the last two messages of the person become a
// label; each call keeps its result, so the chain stays whole.
export function pruneReads(messages) {
  const people = messages.flatMap((message, index) => (message.role === "user" ? [index] : []));
  const cutoff = people.length > COMPACTION.freshHumanMessages ? people[people.length - COMPACTION.freshHumanMessages] : 0;
  const names = new Map();
  messages.forEach((message) => (message.tool_calls || []).forEach((call) => names.set(call.id, call.function?.name || "")));
  let pruned = 0;
  const next = messages.map((message, index) => {
    const name = names.get(message.tool_call_id) || "";
    if (index >= cutoff || message.role !== "tool" || !isReadTool(name) || String(message.content).startsWith(STALE_READ)) return message;
    pruned += 1;
    return { ...message, content: `${STALE_READ} ${name}]` };
  });
  return { messages: next, pruned };
}

const NOTE_PROMPT = `Ты сжимаешь начало разговора человека с ассистентом Cookish (питание и тренировки), чтобы разговор можно было продолжить. Напиши записку по-русски:
- чего хочет человек;
- какие Предложения он применил, а какие убрал;
- предпочтения и ограничения, которые он высказал;
- что осталось сделать.
Пиши только то, что есть в разговоре. Цифры плана не переписывай: их можно перечитать инструментами. Не больше 300 слов.`;

const PROPOSAL_STATUS = { pending: "ждёт решения", applied: "применено", dismissed: "убрано", conflict: "устарело", reverted: "отменено" };

function transcript(messages, proposals) {
  const names = new Map();
  const lines = [];
  messages.forEach((message) => {
    if (message.role === "user") lines.push(`Человек: ${message.content}`);
    if (message.role === "assistant") {
      (message.tool_calls || []).forEach((call) => {
        names.set(call.id, call.function?.name || "");
        lines.push(`Ассистент вызвал ${call.function?.name}: ${String(call.function?.arguments || "").slice(0, 300)}`);
      });
      if (message.content) lines.push(`Ассистент: ${message.content}`);
    }
    if (message.role === "tool") lines.push(`Ответ ${names.get(message.tool_call_id) || "инструмента"}: ${String(message.content).slice(0, 500)}`);
  });
  proposals.forEach((proposal) => lines.push(`Предложение «${proposal.summary}»: ${PROPOSAL_STATUS[proposal.status] || proposal.status}`));
  return lines.join("\n");
}

export async function writeNote(provider, messages, proposals) {
  const answer = await provider.complete({
    messages: [{ role: "system", content: NOTE_PROMPT }, { role: "user", content: transcript(messages, proposals) }],
  });
  return answer.ok ? String(answer.message?.content || "").trim() : "";
}

// The conversation after the note: it opens with a message of the person
// that carries the note, their earlier words and the pending Предложения,
// then the last turn as it was. The words come from the feed, which is never
// compacted: `said` lists what the person wrote, the last message included.
export function compactedMessages({ messages, said, note, proposals, rate }) {
  const lastHuman = messages.map((message) => message.role).lastIndexOf("user");
  const earlier = said.slice(0, -1).map(String);
  const kept = [];
  let used = 0;
  for (let index = earlier.length - 1; index >= 0; index -= 1) {
    const cost = earlier[index].length * rate;
    if (kept.length && used + cost > COMPACTION.humanBudget) break;
    kept.unshift(earlier[index]);
    used += cost;
  }
  const pending = proposals.filter((proposal) => proposal.status === "pending");
  const parts = ["[Начало разговора сжато.]", "", "Записка:", note];
  if (kept.length) parts.push("", "Мои сообщения раньше последнего, дословно и по порядку:", ...kept.map((text, index) => `${index + 1}. ${text}`));
  if (earlier.length > kept.length) parts.push(`Самые ранние сообщения (${earlier.length - kept.length}) вошли только в записку.`);
  if (pending.length) parts.push("", "Предложения, которые я ещё не применил:", JSON.stringify(pending));
  return [{ role: "user", content: parts.join("\n") }, ...(lastHuman >= 0 ? messages.slice(lastHuman) : messages)];
}

// Shrinks what the model of `thread` will see; true when it did.
export async function compactThread(thread, { provider, system, tools, emit }) {
  let { messages, pruned } = pruneReads(thread.messages);
  let noted = false;
  if (estimateTokens({ system, tools, messages }, thread) > COMPACTION.noteAbove) {
    const note = await writeNote(provider, messages, thread.proposals);
    if (note) {
      const said = thread.log.filter((entry) => entry.type === "user").map((entry) => entry.text);
      messages = compactedMessages({ messages, said, note, proposals: thread.proposals, rate: tokenRate(thread) });
      noted = true;
    }
  }
  if (!pruned && !noted) return false;
  // Until the next answer measures it, at the rate of the last request.
  const promptTokens = estimateTokens({ system, tools, messages }, thread);
  thread.messages = messages;
  thread.promptChars = requestChars({ system, tools, messages });
  thread.promptTokens = promptTokens;
  emit({ type: "compacted", text: COMPACTED_TEXT });
  return true;
}
