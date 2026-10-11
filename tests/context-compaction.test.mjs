import assert from "node:assert/strict";
import test from "node:test";

import { COMPACTION, STALE_READ, compactedMessages, pruneReads } from "../mobile-shell/services/assistant/context-compaction.js";

const call = (id, name) => ({ id, type: "function", function: { name, arguments: "{}" } });
const human = (content) => ({ role: "user", content });
const toolTurn = (id, name, content) => [
  { role: "assistant", content: "", tool_calls: [call(id, name)] },
  { role: "tool", tool_call_id: id, content },
];

function conversation() {
  return [
    human("Что у меня завтра?"),
    ...toolTurn("c1", "get_plan", '{"days":[1]}'),
    ...toolTurn("c2", "set_special_day", '{"ok":true,"proposalId":"p1"}'),
    { role: "assistant", content: "Предложил день без мяса." },
    human("А каталог?"),
    ...toolTurn("c3", "get_catalog", '{"products":[]}'),
    { role: "assistant", content: "Вот каталог." },
    human("Сделай на неделю"),
    ...toolTurn("c4", "get_profile", '{"profile":{}}'),
  ];
}

// Every tool result follows the assistant message that called it.
function chainIsWhole(messages) {
  const called = new Set();
  return messages.every((message) => {
    (message.tool_calls || []).forEach((item) => called.add(item.id));
    return message.role !== "tool" || called.has(message.tool_call_id);
  });
}

test("compaction: old reads become a label, fresh reads and writes stay, the chain stays whole", () => {
  const { messages, pruned } = pruneReads(conversation());
  assert.equal(pruned, 1);
  const result = (id) => messages.find((message) => message.tool_call_id === id).content;
  assert.equal(result("c1"), `${STALE_READ} get_plan]`, "a read before the last two messages of the person");
  assert.equal(result("c2"), '{"ok":true,"proposalId":"p1"}', "a write is not a read");
  assert.equal(result("c3"), '{"products":[]}', "a read after them is fresh");
  assert.equal(result("c4"), '{"profile":{}}');
  assert.equal(messages.length, conversation().length);
  assert.ok(chainIsWhole(messages));
  assert.equal(pruneReads(messages).pruned, 0, "a label is not pruned twice");
});

test("compaction: after the note the conversation opens with the person, the note and the pending Предложения", () => {
  const proposals = [
    { id: "p1", status: "pending", summary: "Особый день · 12 окт." },
    { id: "p0", status: "applied", summary: "Новый план с 5 окт." },
  ];
  const said = ["Что у меня завтра?", "А каталог?", "Сделай на неделю"];
  const messages = compactedMessages({ messages: pruneReads(conversation()).messages, said, note: "Человек хочет меньше мяса.", proposals, rate: 0.3 });
  assert.equal(messages[0].role, "user");
  assert.match(messages[0].content, /Записка:\nЧеловек хочет меньше мяса\./);
  assert.match(messages[0].content, /1\. Что у меня завтра\?\n2\. А каталог\?/);
  assert.match(messages[0].content, /"id":"p1"/);
  assert.doesNotMatch(messages[0].content, /"id":"p0"/, "applied ones live in the note");
  assert.deepEqual(messages.slice(1), conversation().slice(-3), "the last turn as it was");
  assert.ok(chainIsWhole(messages));
});

test("compaction: the person's earlier words are kept newest first within the budget", () => {
  const long = "слово ".repeat(4000);
  const said = [`старое ${long}`, `среднее ${long}`, `новое ${long}`, "последнее"];
  const [first] = compactedMessages({ messages: [human("последнее")], said, note: "Записка.", proposals: [], rate: COMPACTION.humanBudget / (long.length * 2.5) });
  assert.match(first.content, /1\. среднее/);
  assert.match(first.content, /2\. новое/);
  assert.doesNotMatch(first.content, /старое/);
  assert.match(first.content, /Самые ранние сообщения \(1\) вошли только в записку/);
});
