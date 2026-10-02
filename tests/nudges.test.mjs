import assert from "node:assert/strict";
import test from "node:test";

import { createMockProvider } from "../mobile-shell/ai-provider.js";
import { NUDGE_QUEUE_LIMIT, STRICTNESS_LEVELS, createNudgeWorker, decideNudges, parseDecision } from "../mobile-shell/nudges.js";
import { memoryStorage, openLocalData, todayDateKey } from "../mobile-shell/local-data.js";

const today = todayDateKey();

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function blob() {
  return {
    schemaVersion: 13,
    products: [{ id: "product_tea", name: "Чай", unit: "г" }],
    requests: [],
    ration: {
      versions: [{
        id: "version_1",
        owner: "local",
        effectiveFrom: addDays(today, -5),
        cycle: {
          anchor: addDays(today, -5),
          weekdayBinding: false,
          days: [{ id: "cycle_1", meals: [
            { id: "meal_1", name: "Завтрак", time: "08:00", items: [{ id: "item_1", productId: "product_tea", name: "Чай" }] },
            { id: "meal_2", name: "Ужин", time: "19:00", items: [] },
          ] }],
        },
      }],
      specialDays: {},
      history: {},
    },
  };
}

function openData(storage = memoryStorage(blob())) {
  const data = openLocalData(storage);
  data.load();
  return { data, storage };
}

const queue = (data) => data.snapshot().assistant.nudges;

// Timers the test fires by hand.
function manualTimers() {
  const pending = [];
  return {
    setTimeout: (callback, delay) => {
      const timer = { callback, delay };
      pending.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      const index = pending.indexOf(timer);
      if (index >= 0) pending.splice(index, 1);
    },
    pending,
    async fire() {
      const timer = pending.shift();
      await timer?.callback();
    },
  };
}

function worker(data, provider, options = {}) {
  return createNudgeWorker({
    provider,
    store: {
      pending: () => data.snapshot().assistant.nudges,
      settings: () => data.snapshot().assistant.settings,
      finish: (ids, text) => data.finishNudges(ids, text),
    },
    buildContext: () => ({ page: "Рацион" }),
    ...options,
  });
}

const decision = (value) => () => ({ role: "assistant", content: JSON.stringify(value) });

test("nudges: every deviation in История питания queues a Тычок", () => {
  const { data } = openData();
  assert.equal(data.markRationMeal(today, "meal_1", "changed").nudges, 1);
  data.markRationMeal(today, "meal_2", "skipped");
  data.recordRationDiscrepancy(today, "meal_1", { kind: "replaced", productId: "product_tea", name: "Чай", replacedName: "Кофе" });
  data.transferRationMeals(today, "meal_2", 30);
  const kinds = queue(data).map((item) => item.kind);
  assert.deepEqual(kinds, ["meal_changed", "meal_skipped", "discrepancy", "meal_transferred"]);
  const [changed, skipped, discrepancy, transfer] = queue(data);
  assert.equal(changed.date, today);
  assert.equal(changed.page, "ration");
  assert.match(changed.text, /Завтрак/);
  assert.match(skipped.text, /Ужин: не съеден/);
  assert.match(discrepancy.text, /заменён продукт «Чай» на «Кофе»/);
  assert.match(transfer.text, /\+30 мин/);
});

test("nudges: «не отмечено», «съедено» and a repeated mark are not deviations", () => {
  const { data } = openData();
  data.markRationMeal(today, "meal_1", "eaten");
  data.markRationMeal(today, "meal_1", "unmarked");
  data.markRationMeal(addDays(today, -1), "meal_1", "skipped");
  data.markRationMeal(addDays(today, -1), "meal_1", "skipped");
  data.removeRationDiscrepancy(today, "meal_1", 0);
  data.addRationMeal(addDays(today, 1));
  assert.equal(queue(data).length, 1, "only the first «не съедено» counts");
});

test("nudges: the queue survives a restart and is bounded", () => {
  const storage = memoryStorage(blob());
  const { data } = openData(storage);
  for (let index = 0; index < NUDGE_QUEUE_LIMIT + 3; index += 1) {
    data.markRationMeal(today, "meal_1", index % 2 ? "skipped" : "changed");
  }
  const reopened = openData(storage).data;
  assert.equal(queue(reopened).length, NUDGE_QUEUE_LIMIT);
});

test("nudges: offline the queue waits, and a burst goes out as one call", async () => {
  const { data } = openData();
  const timers = manualTimers();
  let online = false;
  const provider = createMockProvider(decision({ notify: true, text: "Ужин пропущен. Перенести его на завтра?" }));
  const nudges = worker(data, provider, { timers, isOnline: () => online });

  data.markRationMeal(today, "meal_1", "changed");
  nudges.schedule();
  data.markRationMeal(today, "meal_2", "skipped");
  nudges.schedule();
  data.recordRationDiscrepancy(today, "meal_1", { kind: "excluded", productId: "product_tea", name: "Чай" });
  nudges.schedule();
  assert.equal(timers.pending.length, 1, "several marks within the window share one timer");
  assert.equal(timers.pending[0].delay, 30_000);

  await timers.fire();
  assert.equal(provider.requests.length, 0, "no call offline");
  assert.equal(queue(data).length, 3);

  online = true;
  const result = await nudges.run();
  assert.equal(result.ok, true);
  assert.equal(provider.requests.length, 1, "one call for the whole burst");
  const sent = JSON.parse(provider.requests[0].messages[1].content);
  assert.equal(sent.events.length, 3);
  assert.deepEqual(provider.requests[0].responseFormat, { type: "json_object" });
  assert.equal(queue(data).length, 0);
  assert.equal(data.snapshot().assistant.notice.text, "Ужин пропущен. Перенести его на завтра?");
});

test("nudges: notify=false leaves no badge", async () => {
  const { data } = openData();
  data.markRationMeal(today, "meal_2", "skipped");
  const provider = createMockProvider(decision({ notify: false, text: "" }));
  await worker(data, provider, { timers: manualTimers() }).run();
  assert.equal(provider.requests.length, 1);
  assert.equal(data.snapshot().assistant.notice, null);
  assert.equal(queue(data).length, 0);
});

test("nudges: without a key or the provider warning nothing is sent", async () => {
  const { data } = openData();
  data.markRationMeal(today, "meal_2", "skipped");
  const noKey = createMockProvider(decision({ notify: true, text: "x" }), { hasKey: false });
  assert.equal((await worker(data, noKey, { timers: manualTimers() }).run()).waiting, true);
  const provider = createMockProvider(decision({ notify: true, text: "x" }));
  assert.equal((await worker(data, provider, { timers: manualTimers(), allowed: () => false }).run()).waiting, true);
  assert.equal(provider.requests.length, 0);
  assert.equal(queue(data).length, 1);
});

test("nudges: a network failure keeps the queue and retries later", async () => {
  const { data } = openData();
  data.markRationMeal(today, "meal_2", "skipped");
  const timers = manualTimers();
  const { AiError } = await import("../mobile-shell/ai-provider.js");
  const provider = createMockProvider(() => new AiError("network"));
  const result = await worker(data, provider, { timers }).run();
  assert.equal(result.ok, false);
  assert.equal(queue(data).length, 1);
  assert.equal(timers.pending.length, 1);
  assert.equal(timers.pending[0].delay, 5 * 60_000);
});

test("nudges: the strictness paragraph and «Как реагировать» are in the prompt", async () => {
  const { data } = openData();
  data.setAssistantSettings({ strictness: "serious", howToReact: "Коротко и без упрёков" });
  assert.equal(data.setAssistantSettings({ strictness: "loud" }).ok, false);
  const provider = createMockProvider(decision({ notify: false }));
  await decideNudges(provider, { nudges: [{ kind: "meal_skipped", date: today, text: "Ужин: не съеден" }], settings: data.snapshot().assistant.settings, context: {} });
  const system = provider.requests[0].messages[0].content;
  assert.ok(system.includes(STRICTNESS_LEVELS.serious.prompt));
  assert.match(system, /Как реагировать \(пожелание человека\): Коротко и без упрёков/);
  assert.doesNotMatch(system, new RegExp(STRICTNESS_LEVELS.any.prompt.slice(0, 30)));
});

test("nudges: the default strictness reacts to any deviation", () => {
  const { data } = openData();
  assert.deepEqual(data.snapshot().assistant.settings, { strictness: "any", howToReact: "" });
  assert.equal(STRICTNESS_LEVELS.any.label, "Любое отклонение");
});

test("nudges: decisions in code fences are read; broken ones are not", () => {
  assert.deepEqual(parseDecision("```json\n{\"notify\": true, \"text\": \"Привет\"}\n```"), { notify: true, text: "Привет" });
  assert.deepEqual(parseDecision("{\"notify\": true, \"text\": \"\"}"), { notify: false, text: "" });
  assert.equal(parseDecision("не JSON"), null);
});
