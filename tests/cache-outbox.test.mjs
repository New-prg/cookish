import assert from "node:assert/strict";
import test from "node:test";

import { openCache } from "../mobile-shell/core/cache.js";
import { CACHE_WINDOW, addDays, cacheSlice } from "../mobile-shell/core/cache-window.js";
import { openGuest } from "../mobile-shell/core/guest.js";
import { memoryStorage, openLocalData, readRationHistoryDay, todayDateKey } from "../mobile-shell/core/local-data.js";
import { readRationDay } from "../mobile-shell/core/ration-domain.js";
import { openLocalServices } from "../mobile-shell/transport/local.js";

const today = todayDateKey();
const tomorrow = addDays(today, 1);

function planBlob() {
  return {
    schemaVersion: 12,
    products: [{ id: "product_oats", name: "Овсянка", unit: "г", nutrition: { calories: 350, protein: 12, fat: 6, carbs: 60, fiber: 10 } }],
    requests: [],
    ration: {
      versions: [{
        id: "version_1",
        owner: "local",
        effectiveFrom: addDays(today, -60),
        createdAt: "2026-01-01T00:00:00.000Z",
        cycle: {
          anchor: addDays(today, -60),
          weekdayBinding: false,
          days: [{ id: "cycle_1", meals: [
            { id: "meal_1", name: "Завтрак", time: "08:00", items: [{ id: "item_1", productId: "product_oats", name: "Овсянка", portionSize: 80 }] },
            { id: "meal_2", name: "Ужин", time: "19:00", items: [{ id: "item_2", productId: "product_oats", name: "Овсянка", portionSize: 60 }] },
          ] }],
        },
      }],
      specialDays: {},
      history: {
        [`local|${addDays(today, -20)}`]: { date: addDays(today, -20), owner: "local", versionId: "version_1", meals: { meal_1: { state: "eaten" } } },
        [`local|${addDays(today, -3)}`]: { date: addDays(today, -3), owner: "local", versionId: "version_1", meals: { meal_2: { state: "skipped" } } },
      },
    },
  };
}

function manualTimers() {
  const pending = [];
  return {
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      pending.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      const index = pending.indexOf(timer);
      if (index >= 0) pending.splice(index, 1);
    },
    pending,
  };
}

// One full Core behind the local transport and a phone (Cache + Outbox) over
// it; `device()` adds another phone over the same full Core.
function world(blob = planBlob()) {
  const coreStorage = memoryStorage(blob);
  const ledger = memoryStorage();
  let online = true;
  const transport = openLocalServices({
    fetchImpl: async () => {
      throw new Error("No network in tests.");
    },
    core: { storage: coreStorage, ledger },
    reachable: () => online,
  });
  function device(guestId = "guest_a") {
    const conflicts = [];
    const outbox = memoryStorage();
    const cache = openCache({
      storage: memoryStorage(),
      outbox,
      transport,
      guestId,
      timers: manualTimers(),
      onConflict: (items) => conflicts.push(...items),
    });
    cache.load();
    return { cache, outbox, conflicts };
  }
  return {
    transport,
    ledger,
    device,
    setOnline: (value) => {
      online = value;
    },
    core: () => openLocalData(coreStorage).load(),
  };
}

const sliceOf = (state) => JSON.stringify(cacheSlice(state, { today }));

test("cache: the first start builds the Cache from the full Core and loses nothing", async () => {
  const blob = planBlob();
  const { device, core } = world(blob);
  const before = core();
  const { cache } = device();
  assert.equal(cache.isEmpty(), true);
  assert.equal((await cache.build()).ok, true);
  assert.equal(cache.isEmpty(), false);
  assert.equal((await cache.build()).changed, false, "a filled Cache builds once");

  assert.equal(sliceOf(cache.snapshot()), sliceOf(core()));
  assert.deepEqual(core(), before, "the full Core keeps everything");
  assert.ok(readRationHistoryDay(core(), addDays(today, -20)), "a day past the window stays in the full Core");
  assert.equal(readRationHistoryDay(cache.snapshot(), addDays(today, -20)), null, "the Cache keeps only its window");
  assert.equal(readRationHistoryDay(cache.snapshot(), addDays(today, -3)).meals.meal_2.state, "skipped");
});

test("cache: offline marks, purchases, plan and product edits wait in the Outbox and all arrive later", async () => {
  const { device, core, setOnline } = world();
  const { cache } = device();
  await cache.refresh();
  setOnline(false);

  assert.equal(cache.markRationMeal(today, "meal_1", "eaten").ok, true);
  const product = cache.saveProduct({ name: "Кефир", unit: "л" });
  assert.equal(product.ok, true);
  const meal = cache.addRationMeal(tomorrow);
  assert.equal(meal.ok, true);
  const request = cache.createRequest();
  assert.equal(cache.saveRequestItems(request.requestId, [{ productId: product.productId, name: "Кефир", quantity: 2 }]).ok, true);
  assert.equal(cache.markBought(request.requestId, product.productId, { quantity: 2, price: 180 }).ok, true);

  // The person sees everything at once; the full Core has none of it yet.
  assert.equal(readRationHistoryDay(cache.snapshot(), today).meals.meal_1.state, "eaten");
  assert.equal(readRationDay(cache.snapshot(), tomorrow).meals.length, 3);
  assert.equal(cache.pendingCount(), 6);
  assert.equal(core().products.length, 1);
  assert.deepEqual((await cache.flush()).offline, true);
  assert.equal(cache.pendingCount(), 6);

  setOnline(true);
  const delivered = await cache.flush();
  assert.equal(delivered.sent, 6);
  assert.deepEqual(delivered.rejected, []);
  assert.equal(cache.pendingCount(), 0);
  const full = core();
  assert.equal(readRationHistoryDay(full, today).meals.meal_1.state, "eaten");
  assert.ok(full.products.some((value) => value.id === product.productId), "the full Core made the same product id");
  assert.equal(readRationDay(full, tomorrow).meals.length, 3);
  assert.equal(full.requests[0].id, request.requestId);
  assert.equal(full.journal.at(-1).id, cache.snapshot().journal.at(-1).id, "the same change set id on both sides");
  assert.equal(sliceOf(cache.snapshot()), sliceOf(full), "the Cache matches the full Core");
});

test("cache: a second delivery of the same commands changes nothing", async () => {
  const { device, core, transport } = world();
  const { cache, outbox } = device();
  await cache.refresh();
  cache.saveProduct({ name: "Хлеб", unit: "шт." });
  cache.markRationMeal(today, "meal_2", "skipped");
  const batch = outbox.read();
  await cache.flush();
  const once = core();

  // The answer was lost: the phone sends the same batch again.
  const again = await transport.request("core", "apply", { guestId: "guest_a", commands: batch });
  assert.ok(again.results.every((result) => result.ok && result.duplicate));
  assert.deepEqual(core(), once);
  assert.equal(core().products.filter((product) => product.name === "Хлеб").length, 1);
  assert.equal(core().assistant.nudges.length, 1);
});

test("cache: a command to a meal removed meanwhile rolls back and tells the person why", async () => {
  const { device, core, setOnline } = world();
  const phone = device("guest_a");
  const other = device("guest_a");
  await phone.cache.refresh();
  await other.cache.refresh();

  setOnline(false);
  assert.equal(phone.cache.recordRationDiscrepancy(tomorrow, "meal_2", { kind: "excluded", productId: "product_oats", name: "Овсянка" }).ok, false, "the future has no История");
  assert.equal(phone.cache.markRationMeal(today, "meal_2", "changed").ok, true);
  assert.equal(readRationHistoryDay(phone.cache.snapshot(), today).meals.meal_2.state, "changed");

  // Meanwhile the evening meal is removed from today on another device.
  setOnline(true);
  assert.equal(other.cache.removeRationMeal(today, "meal_2").ok, true);
  await other.cache.flush();
  assert.equal(readRationDay(core(), today).meals.some((meal) => meal.id === "meal_2"), false);

  const result = await phone.cache.flush();
  assert.equal(result.rejected.length, 1);
  assert.equal(phone.conflicts.length, 1);
  assert.equal(phone.conflicts[0].name, "markRationMeal");
  assert.ok(phone.conflicts[0].reason, "the person sees why");
  assert.equal(readRationHistoryDay(phone.cache.snapshot(), today)?.meals?.meal_2, undefined, "the mark is rolled back");
  assert.equal(readRationDay(phone.cache.snapshot(), today).meals.some((meal) => meal.id === "meal_2"), false);
  assert.equal(sliceOf(phone.cache.snapshot()), sliceOf(core()));
});

test("cache: commands made during a delivery replay on top of the full Core", async () => {
  const { device, core } = world();
  const { cache } = device();
  await cache.refresh();
  cache.saveProduct({ name: "Сыр", unit: "г" });
  const delivery = cache.flush();
  cache.saveProduct({ name: "Мёд", unit: "г" });
  await delivery;
  const names = cache.snapshot().products.map((product) => product.name);
  assert.ok(names.includes("Сыр") && names.includes("Мёд"));
  assert.equal(cache.pendingCount(), 1);
  await cache.flush();
  assert.equal(cache.pendingCount(), 0);
  assert.equal(sliceOf(cache.snapshot()), sliceOf(core()));
});

test("cache: windows pulled before a delivery do not hide the delivered command", async () => {
  const { transport, core } = world();
  // A network: the first refresh answers only after the delivery.
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let holdNext = false;
  const slow = {
    async request(service, method, payload) {
      const answer = transport.request(service, method, payload);
      if (method === "pull" && holdNext) {
        holdNext = false;
        await held;
      }
      return answer;
    },
  };
  const cache = openCache({ storage: memoryStorage(), outbox: memoryStorage(), transport: slow, timers: manualTimers() });
  cache.load();
  await cache.build();

  holdNext = true;
  const stale = cache.refresh();
  const product = cache.saveProduct({ name: "Орехи", unit: "г" });
  await cache.flush();
  release();
  await stale;
  assert.ok(cache.snapshot().products.some((item) => item.id === product.productId), "the delivered product stays in the Cache");
  assert.equal(sliceOf(cache.snapshot()), sliceOf(core()));
});

test("cache: scrolling past the window loads the days from the full Core", async () => {
  const { device, setOnline } = world();
  const { cache } = device();
  await cache.refresh();
  const far = addDays(today, -20);
  assert.equal(readRationHistoryDay(cache.snapshot(), far), null);

  setOnline(false);
  assert.equal((await cache.ensureRange(far)).offline, true);
  setOnline(true);
  assert.equal((await cache.ensureRange(far)).ok, true);
  assert.equal(readRationHistoryDay(cache.snapshot(), far).meals.meal_1.state, "eaten");

  // A refresh keeps what the session loaded.
  await cache.refresh();
  assert.equal(readRationHistoryDay(cache.snapshot(), far).meals.meal_1.state, "eaten");
  assert.equal((await cache.ensureRange(addDays(today, -5))).ok, true, "days inside the window need no request");
});

test("cache: windows hold open requests, the newest closed ones and the last change sets", async () => {
  const blob = planBlob();
  blob.requests = Array.from({ length: CACHE_WINDOW.closedRequests + 5 }, (_, index) => ({
    id: `request_${index}`,
    status: "done",
    createdAt: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
    updatedAt: `2026-02-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
    completedAt: `2026-02-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
    items: [{ productId: "product_oats", quantity: 1 }],
    responses: [{ id: `response_${index}`, createdAt: "2026-02-01T10:00:00.000Z", items: [{ productId: "product_oats", quantity: 1, price: 10 }] }],
  }));
  blob.requests.push({ id: "request_open", status: "open", createdAt: "2025-01-01T10:00:00.000Z", updatedAt: "2025-01-01T10:00:00.000Z", items: [{ productId: "product_oats", quantity: 2 }], responses: [] });
  const { device } = world(blob);
  const { cache } = device();
  await cache.refresh();
  assert.ok(cache.snapshot().requests.some((request) => request.id === "request_open"), "an open request is always there");
  assert.equal(cache.snapshot().requests.length, CACHE_WINDOW.closedRequests + 1);
  assert.equal(cache.olderRequests, 5);
  await cache.loadOlderRequests();
  assert.equal(cache.snapshot().requests.length, CACHE_WINDOW.closedRequests + 6);
  assert.equal(cache.olderRequests, 0);

  for (let index = 0; index < CACHE_WINDOW.changeSets + 5; index += 1) cache.setRationProfile({ targetCalories: 1500 + index });
  await cache.flush();
  assert.equal(cache.snapshot().journal.length, CACHE_WINDOW.changeSets);
});

test("cache: a Закладка is a header in the Cache and loads whole when it opens", async () => {
  const { device, setOnline } = world();
  const { cache } = device();
  await cache.refresh();
  const bookmark = { id: "bookmark_1", title: "Завтрак", page: "ration", mode: "plan", messages: [{ role: "user", content: "Привет" }], proposals: [{ id: "p1" }], log: [] };
  assert.equal(cache.saveBookmark(bookmark).ok, true);
  await cache.flush();
  const [header] = cache.snapshot().assistant.bookmarks;
  assert.equal(header.header, true);
  assert.equal(header.proposalCount, 1);
  assert.deepEqual(header.messages, []);
  const whole = await cache.bookmark("bookmark_1");
  assert.equal(whole.messages[0].content, "Привет");
  setOnline(false);
  assert.equal(await cache.bookmark("bookmark_1"), null, "offline a header cannot open");
});

test("cache: the guest is created once and registered with the first delivery", async () => {
  const guestStorage = memoryStorage();
  const guest = openGuest(guestStorage);
  assert.match(guest.id, /^guest_/);
  assert.equal(openGuest(guestStorage).id, guest.id);

  const { device, ledger } = world();
  const { cache } = device(guest.id);
  await cache.refresh();
  cache.saveProduct({ name: "Чай", unit: "г" });
  await cache.flush();
  assert.equal(ledger.read().guestId, guest.id);
});

test("cache: the developer flag turns the transport off for every request", async () => {
  const { transport, setOnline } = world();
  setOnline(false);
  await assert.rejects(transport.request("catalog", "productByBarcode", { barcode: "4600000000001" }), (error) => error.kind === "network");
  await assert.rejects(transport.request("core", "pull", { today }), (error) => error.kind === "network");
});
