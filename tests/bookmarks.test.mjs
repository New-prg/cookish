import assert from "node:assert/strict";
import test from "node:test";

import { createMockProvider } from "../mobile-shell/ai-provider.js";
import { createAssistant, createThread, recheckProposals, viewDay } from "../mobile-shell/ai-tools.js";
import { BOOKMARK_LIMIT } from "../mobile-shell/nudges.js";
import { memoryStorage, openLocalData } from "../mobile-shell/local-data.js";
import { TODAY, makeState } from "../scripts/ai-lab/fixture.mjs";

const TOMORROW = "2026-10-02";

function bookmark(id, extra = {}) {
  return { id, title: `Тред ${id}`, page: "ration", mode: "plan", log: [{ type: "user", text: "Привет" }], messages: [{ role: "user", content: "Привет" }], proposals: [], ...extra };
}

test("bookmarks: a saved thread survives a restart and can be deleted", () => {
  const storage = memoryStorage(makeState());
  const data = openLocalData(storage);
  data.load();
  assert.deepEqual(data.snapshot().assistant.bookmarks, []);
  assert.equal(data.saveBookmark(bookmark("bookmark_a")).ok, true);
  data.saveBookmark(bookmark("bookmark_b"));
  data.saveBookmark({ ...bookmark("bookmark_a"), title: "Обновлён" });

  const reopened = openLocalData(storage);
  reopened.load();
  const list = reopened.snapshot().assistant.bookmarks;
  assert.deepEqual(list.map((item) => item.id), ["bookmark_a", "bookmark_b"], "saving again updates and lifts the bookmark");
  assert.equal(list[0].title, "Обновлён");
  assert.ok(list[0].updatedAt);

  assert.equal(reopened.removeBookmark("bookmark_a").ok, true);
  assert.deepEqual(reopened.snapshot().assistant.bookmarks.map((item) => item.id), ["bookmark_b"]);
  assert.equal(reopened.removeBookmark("missing").ok, false);
});

test("bookmarks: only the newest bookmarks are kept", () => {
  const data = openLocalData(memoryStorage(makeState()));
  data.load();
  for (let index = 0; index < BOOKMARK_LIMIT + 2; index += 1) data.saveBookmark(bookmark(`bookmark_${index}`));
  assert.equal(data.snapshot().assistant.bookmarks.length, BOOKMARK_LIMIT);
  assert.equal(data.snapshot().assistant.bookmarks[0].id, `bookmark_${BOOKMARK_LIMIT + 1}`);
});

test("bookmarks: a stale proposal from a bookmark is marked as a conflict, never applied silently", async () => {
  const state = makeState();
  const data = openLocalData(memoryStorage(state));
  data.load();
  const meals = viewDay(state, TOMORROW).meals.map((meal) => ({
    name: meal.name,
    time: meal.time,
    items: meal.items.map((item) => item.product === "Говядина" ? { product: "Куриная грудка", amount: 200 } : { product: item.product, amount: item.amount }),
  }));
  const turns = [
    { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "set_special_day", arguments: JSON.stringify({ date: TOMORROW, meals }) } }] },
    { role: "assistant", content: "Ок." },
  ];
  const assistant = createAssistant({
    provider: createMockProvider((request, index) => turns[index]),
    getState: () => data.snapshot(),
    changePlan: data.changePlan,
    today: () => TODAY,
  });
  const thread = createThread({ page: "ration", mode: "plan" });
  await assistant.run(thread, "Завтра без говядины");
  data.saveBookmark(bookmark("bookmark_x", { proposals: thread.proposals }));

  // Still fresh: the re-check keeps it pending.
  const fresh = structuredClone(data.snapshot().assistant.bookmarks[0].proposals);
  recheckProposals(data.snapshot(), fresh, TODAY);
  assert.equal(fresh[0].status, "pending");

  // The person changes tomorrow by hand: the bookmark's proposal is stale.
  const firstMeal = data.snapshot().ration.versions[0].cycle.days[4].meals[0];
  assert.equal(data.updateRationMeal(TOMORROW, firstMeal.id, { name: "Поздний завтрак" }).ok, true);
  const reopened = structuredClone(data.snapshot().assistant.bookmarks[0].proposals);
  assistant.recheck(reopened);
  assert.equal(reopened[0].status, "conflict");
  assert.match(reopened[0].conflict, /устарело/);
  const journal = data.snapshot().journal.length;
  assert.equal(assistant.apply(reopened).ok, false);
  assert.equal(data.snapshot().journal.length, journal);
});
