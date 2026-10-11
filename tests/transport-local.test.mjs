import assert from "node:assert/strict";
import test from "node:test";

import { ServiceError } from "../mobile-shell/services/service-error.js";
import { createLocalTransport, openLocalServices } from "../mobile-shell/transport/local.js";
import { TRANSPORT_ERROR_TEXTS, TransportError } from "../mobile-shell/transport/protocol.js";
import { assistantContract } from "./contracts/assistant-contract.mjs";
import { catalogContract } from "./contracts/catalog-contract.mjs";

catalogContract("local transport", ({ fetchImpl }) => openLocalServices({ fetchImpl }));
assistantContract("local transport", ({ data, provider, today }) => openLocalServices({
  fetchImpl: async () => {
    throw new Error("No network in tests.");
  },
  dataPort: { read: async () => data.snapshot() },
  providerFor: () => provider,
  today,
}));

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("the request should fail");
}

test("local transport: the request and the answer are copies, as over a network", async () => {
  let received = null;
  const kept = { items: [{ name: "Кефир" }] };
  const transport = createLocalTransport({
    echo: {
      take(payload) {
        received = payload;
        payload.items.push({ name: "Хлеб" });
        return kept;
      },
    },
  });
  const state = Object.freeze({ items: Object.freeze([Object.freeze({ name: "Молоко" })]) });

  const answer = await transport.request("echo", "take", state);

  assert.deepEqual(state.items, [{ name: "Молоко" }]);
  assert.notEqual(received, state);
  assert.equal(Object.isFrozen(received), false);
  assert.deepEqual(answer, kept);
  assert.notEqual(answer, kept);
  answer.items[0].name = "Ряженка";
  assert.equal(kept.items[0].name, "Кефир");
});

test("local transport: functions do not cross the boundary either way", async () => {
  const transport = createLocalTransport({
    echo: {
      take: () => ({ ok: true }),
      give: () => ({ run: () => {} }),
    },
  });
  const sent = await rejection(transport.request("echo", "take", { callback: () => {} }));
  assert.ok(sent instanceof TransportError);
  assert.equal(sent.kind, "not_serializable");
  assert.equal(sent.message, TRANSPORT_ERROR_TEXTS.not_serializable);

  const answered = await rejection(transport.request("echo", "give", {}));
  assert.equal(answered.kind, "not_serializable");
});

test("local transport: an unknown service or method is not_found, including inherited names", async () => {
  const transport = createLocalTransport({ echo: { take: () => ({}) } });
  for (const [service, method] of [["missing", "take"], ["echo", "missing"], ["echo", "toString"], ["echo", "constructor"], ["toString", "call"], ["__proto__", "hasOwnProperty"]]) {
    const error = await rejection(transport.request(service, method, {}));
    assert.equal(error.kind, "not_found", `${service}.${method}`);
  }
});

test("local transport: a Service error keeps its kind and text, other errors stay inside", async () => {
  const transport = createLocalTransport({
    echo: {
      refuse: async () => {
        throw new ServiceError("bad_request", "Введите от 8 до 14 цифр штрихкода.");
      },
      crash: () => {
        throw new Error("secret stack detail sk-123");
      },
    },
  });
  const refused = await rejection(transport.request("echo", "refuse", {}));
  assert.ok(refused instanceof TransportError);
  assert.equal(refused.kind, "bad_request");
  assert.equal(refused.message, "Введите от 8 до 14 цифр штрихкода.");

  const crashed = await rejection(transport.request("echo", "crash", {}));
  assert.equal(crashed.kind, "internal");
  assert.equal(crashed.message, TRANSPORT_ERROR_TEXTS.internal);
  assert.doesNotMatch(crashed.message, /secret|sk-123/);
});

test("local transport: a stream delivers copies of the events before the answer", async () => {
  const order = [];
  const sent = { step: 1 };
  const transport = createLocalTransport({
    echo: {
      async work(payload, { emit }) {
        emit(sent);
        sent.step = 2;
        emit({ step: 3 });
        return { done: payload.count };
      },
    },
  });
  const answer = await transport.stream("echo", "work", { count: 1 }, { onEvent: (event) => order.push(event) });
  assert.deepEqual(order, [{ step: 1 }, { step: 3 }]);
  assert.notEqual(order[0], sent);
  assert.deepEqual(answer, { done: 1 });
  assert.deepEqual(await transport.request("echo", "work", { count: 2 }), { done: 2 }, "without a listener the events are dropped");
});

test("local transport: the Service handles a request later, on the copy made when it was sent", async () => {
  const order = [];
  const transport = createLocalTransport({ echo: { take: (payload) => order.push(`handled ${payload.count}`) } });
  const payload = { count: 1 };
  const pending = transport.request("echo", "take", payload);
  payload.count = 2;
  order.push("returned");
  assert.ok(pending instanceof Promise);
  await pending;
  assert.deepEqual(order, ["returned", "handled 1"]);
});
