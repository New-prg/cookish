import assert from "node:assert/strict";
import test from "node:test";

import { createThread } from "../../mobile-shell/core/assistant-thread.js";
import { memoryStorage, openLocalData } from "../../mobile-shell/core/local-data.js";
import { markProposals } from "../../mobile-shell/core/proposals.js";
import { readRationDay } from "../../mobile-shell/core/ration-domain.js";
import { createMockProvider } from "../../mobile-shell/services/assistant/ai-provider.js";
import { viewDay } from "../../mobile-shell/services/assistant/ai-tools.js";
import { TODAY, makeState } from "../../scripts/ai-lab/fixture.mjs";

// The contract of the assistant Service, written against a transport.
// `makeTransport({ data, provider, today })` builds a transport whose
// assistant reads `data` through the data port and asks `provider`; the
// local transport runs it today, an HTTP adapter will run the same cases.

const TOMORROW = "2026-10-02";

const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

function openData() {
  const data = openLocalData(memoryStorage(makeState()));
  data.load();
  return data;
}

function tomorrowWithout(data, product) {
  return viewDay(data.snapshot(), TOMORROW).meals.map((meal) => ({
    name: meal.name,
    time: meal.time,
    items: meal.items.map((item) => (item.product === product ? { product: "Куриная грудка", amount: 200 } : { product: item.product, amount: item.amount })),
  }));
}

function proposing(data) {
  const turns = [
    { role: "assistant", content: "", tool_calls: [call("c1", "set_special_day", { date: TOMORROW, meals: tomorrowWithout(data, "Говядина") })] },
    { role: "assistant", content: "Готово, посмотрите карточку." },
  ];
  // Every run proposes: a tool call, then the answer.
  return createMockProvider((request, index) => turns[index % 2]);
}

export function assistantContract(name, makeTransport) {
  test(`${name}: assistant.run streams the feed and returns the thread with its Предложения`, async () => {
    const data = openData();
    const before = data.snapshot();
    const transport = await makeTransport({ data, provider: proposing(data), today: () => TODAY });
    const thread = createThread({ page: "ration", mode: "plan" });
    const events = [];

    const result = await transport.stream("assistant", "run", { thread, text: "Завтра без говядины", key: "test-key" }, { onEvent: (event) => events.push(event) });

    assert.deepEqual(events.map((event) => event.type), ["user", "proposal", "assistant"]);
    assert.equal(result.ok, true);
    assert.equal(result.reply, "Готово, посмотрите карточку.");
    assert.equal(result.thread.id, thread.id);
    assert.equal(result.thread.proposals.length, 1);
    assert.deepEqual(result.thread.proposals[0], events[1].proposal);
    assert.equal(result.thread.proposals[0].status, "pending");
    assert.deepEqual(result.thread.log.map((entry) => entry.type), ["user", "proposal", "assistant"]);
    assert.equal(result.thread.messages[0].content, "Завтра без говядины");
    assert.deepEqual(thread.messages, [], "the caller's thread is a copy");
    assert.equal(data.snapshot(), before, "the Service never writes");
  });

  test(`${name}: a provider failure is an error line, not a transport error`, async () => {
    const data = openData();
    const transport = await makeTransport({ data, provider: createMockProvider(() => "x", { hasKey: false }), today: () => TODAY });
    const events = [];
    const result = await transport.stream("assistant", "run", { thread: createThread(), text: "Привет", key: "" }, { onEvent: (event) => events.push(event) });
    assert.equal(result.ok, false);
    assert.match(result.reason, /Ключ ИИ не задан/);
    assert.equal(events.at(-1).type, "error");
    assert.equal(result.thread.log.at(-1).type, "error");
  });

  test(`${name}: an Предложение applied after the plan changed another way gets a conflict`, async () => {
    const data = openData();
    const transport = await makeTransport({ data, provider: proposing(data), today: () => TODAY });
    const first = (await transport.stream("assistant", "run", { thread: createThread(), text: "Завтра без говядины", key: "k" })).thread;
    const second = (await transport.stream("assistant", "run", { thread: createThread(), text: "Завтра без говядины", key: "k" })).thread;

    // The first thread's Предложение changes tomorrow; the second one was
    // drafted on the plan before that.
    const applied = data.applyProposals(first.proposals, { today: TODAY });
    assert.equal(applied.ok, true);
    const journal = data.snapshot().journal.length;
    const stale = data.applyProposals(second.proposals, { today: TODAY });
    markProposals(second.proposals, stale.results);

    assert.equal(stale.ok, false);
    assert.equal(second.proposals[0].status, "conflict");
    assert.match(second.proposals[0].conflict, /устарело/);
    assert.equal(data.snapshot().journal.length, journal);
    assert.equal(readRationDay(data.snapshot(), TOMORROW).source, "special");
  });

  test(`${name}: assistant.decideNudges reads the strictness from the Core`, async () => {
    const data = openData();
    data.setAssistantSettings({ strictness: "serious", howToReact: "Без упрёков" });
    const provider = createMockProvider(() => ({ role: "assistant", content: "{\"notify\": true, \"text\": \"Ужин пропущен.\"}" }));
    const transport = await makeTransport({ data, provider, today: () => TODAY });
    const decision = await transport.request("assistant", "decideNudges", {
      nudges: [{ id: "n1", kind: "meal_skipped", date: TODAY, page: "ration", text: "Ужин: не съеден" }],
      page: "ration",
      mode: "log",
      key: "k",
    });
    assert.deepEqual(decision, { ok: true, notify: true, text: "Ужин пропущен." });
    const system = provider.requests[0].messages[0].content;
    assert.match(system, /Только серьёзные|серьёзных/);
    assert.match(system, /Без упрёков/);
    const sent = JSON.parse(provider.requests[0].messages[1].content);
    assert.equal(sent.context.today, TODAY);
    assert.equal(sent.events[0].kind, "meal_skipped");
  });

  test(`${name}: assistant.checkKey answers with data`, async () => {
    const data = openData();
    const ok = await (await makeTransport({ data, provider: createMockProvider(() => "x"), today: () => TODAY })).request("assistant", "checkKey", { key: "k" });
    assert.deepEqual(ok, { ok: true, label: "mock" });
    const missing = await (await makeTransport({ data, provider: createMockProvider(() => "x", { hasKey: false }), today: () => TODAY })).request("assistant", "checkKey", { key: "" });
    assert.equal(missing.ok, false);
    assert.equal(missing.kind, "no_key");
  });
}
