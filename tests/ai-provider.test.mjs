import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_KEY_STORAGE,
  AI_PROVIDER_CONFIG,
  AiError,
  aiConsentStore,
  aiKeyStore,
  createMockProvider,
  createRouterAiProvider,
  fetchTransport,
  nativeTransport,
} from "../mobile-shell/ai-provider.js";
import { STORAGE_KEY, browserStorage, openLocalData } from "../mobile-shell/local-data.js";

const KEY = "sk-test-secret-123";

function memoryLocalStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

// A scripted transport: each call takes the next answer; answers are
// { status, body } objects, AiError instances to throw, or "hang".
function scriptedTransport(answers) {
  const calls = [];
  const transport = async (request) => {
    calls.push(request);
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer === "hang") return new Promise(() => {});
    if (answer instanceof AiError) throw answer;
    return { status: answer.status, text: typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body ?? {}) };
  };
  return { transport, calls };
}

function provider(answers, config = {}) {
  const { transport, calls } = scriptedTransport(answers);
  const sleeps = [];
  const instance = createRouterAiProvider({
    getKey: () => KEY,
    transport,
    config: { ...config },
    sleep: async (ms) => { sleeps.push(ms); },
  });
  return { instance, calls, sleeps };
}

const completion = (content) => ({ status: 200, body: { choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 10 } } });

test("provider: a chat completion goes to routerai.ru with the configured model", async () => {
  const { instance, calls } = provider([completion("Привет")]);
  const result = await instance.complete({ messages: [{ role: "user", content: "Привет" }] });
  assert.equal(result.ok, true);
  assert.equal(result.message.content, "Привет");
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.method, "POST");
  assert.equal(call.url, "https://routerai.ru/api/v1/chat/completions");
  assert.equal(call.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(call.timeoutMs, 120_000);
  const body = JSON.parse(call.body);
  assert.equal(body.model, "z-ai/glm-5.3-flash");
  assert.equal(body.temperature, 0.2);
  assert.deepEqual(body.reasoning, { effort: "low" });
  assert.equal(AI_PROVIDER_CONFIG.model, "z-ai/glm-5.3-flash");
});

test("provider: tools are offered with automatic choice", async () => {
  const { instance, calls } = provider([completion("ok")]);
  const tools = [{ type: "function", function: { name: "get_plan", parameters: { type: "object", properties: {} } } }];
  await instance.complete({ messages: [], tools });
  const body = JSON.parse(calls[0].body);
  assert.deepEqual(body.tools, tools);
  assert.equal(body.tool_choice, "auto");
});

test("provider: an empty 503 is retried, and the retry answers", async () => {
  const { instance, calls, sleeps } = provider([{ status: 503, body: "" }, completion("Готово")]);
  const result = await instance.complete({ messages: [] });
  assert.equal(result.ok, true);
  assert.equal(result.message.content, "Готово");
  assert.equal(calls.length, 2);
  assert.equal(sleeps.length, 1);
});

test("provider: at most two retries on 5xx, then a server error", async () => {
  const { instance, calls } = provider([{ status: 503, body: "" }]);
  const result = await instance.complete({ messages: [] });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "server");
  assert.equal(calls.length, 3);
});

test("provider: network errors are retried", async () => {
  const { instance, calls } = provider([new AiError("network"), new AiError("network"), completion("Есть связь")]);
  const result = await instance.complete({ messages: [] });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 3);
});

test("provider: a request that does not answer in time ends with a timeout", async () => {
  const { instance, calls } = provider(["hang"], { timeoutMs: 20 });
  const result = await instance.complete({ messages: [] });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "timeout");
  assert.match(result.reason, /не ответил/);
  assert.equal(calls.length, 1, "a timeout is not retried");
  assert.equal(calls[0].signal.aborted, true, "the request is aborted");
});

test("provider: a wrong key is reported without the key itself", async () => {
  const { instance, calls } = provider([{ status: 401, body: { error: { message: `Invalid key ${KEY}` } } }]);
  const result = await instance.checkKey();
  assert.equal(result.ok, false);
  assert.equal(result.kind, "auth");
  assert.equal(calls.length, 1, "4xx is not retried");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].url, "https://routerai.ru/api/v1/key");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(KEY));
});

test("provider: a working key is confirmed by GET /api/v1/key", async () => {
  const { instance } = provider([{ status: 200, body: { data: { label: "test", usage: 1.5, limit: null } } }]);
  const result = await instance.checkKey();
  assert.deepEqual(result, { ok: true, label: "test", usage: 1.5, limit: null });
});

test("provider: without a key nothing is sent", async () => {
  const { transport, calls } = scriptedTransport([completion("x")]);
  const instance = createRouterAiProvider({ getKey: () => "", transport });
  const result = await instance.complete({ messages: [] });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "no_key");
  assert.equal(calls.length, 0);
  assert.equal(instance.hasKey(), false);
});

test("provider: a broken body is a bad response", async () => {
  const { instance } = provider([{ status: 200, body: "<html>" }]);
  const result = await instance.complete({ messages: [] });
  assert.equal(result.kind, "bad_response");
});

test("fetch transport: a thrown fetch is a network error", async () => {
  const transport = fetchTransport(async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(transport({ method: "GET", url: "https://routerai.ru/api/v1/key" }), (error) => error.kind === "network");
  const ok = fetchTransport(async () => ({ status: 200, text: async () => "{}" }));
  assert.deepEqual(await ok({ method: "GET", url: "https://routerai.ru/api/v1/key" }), { status: 200, text: "{}" });
});

test("native transport: the Android bridge answers through a callback", async () => {
  const host = {};
  const sent = [];
  const transport = nativeTransport({ aiRequest: (id, payload) => sent.push({ id, payload: JSON.parse(payload) }) }, host);
  const pending = transport({ method: "POST", url: "https://routerai.ru/api/v1/chat/completions", headers: { A: "b" }, body: "{}", timeoutMs: 1000 });
  assert.equal(sent[0].payload.url, "https://routerai.ru/api/v1/chat/completions");
  host.__onNativeAiResponse(sent[0].id, JSON.stringify({ status: 200, body: "{\"x\":1}" }));
  assert.deepEqual(await pending, { status: 200, text: "{\"x\":1}" });

  const failing = transport({ method: "GET", url: "https://routerai.ru/api/v1/key" });
  host.__onNativeAiResponse(sent[1].id, JSON.stringify({ error: "timeout" }));
  await assert.rejects(failing, (error) => error.kind === "timeout");
});

test("key store: the key lives apart from the local data", () => {
  const storage = memoryLocalStorage();
  const keys = aiKeyStore(storage);
  assert.equal(keys.read(), "");
  assert.equal(keys.write(`  ${KEY}  `), true);
  assert.equal(keys.read(), KEY);
  assert.equal(storage.getItem(AI_KEY_STORAGE), KEY);

  const data = openLocalData(browserStorage(storage));
  data.load();
  data.setRationProfile({ targetCalories: 2000 });
  assert.doesNotMatch(storage.getItem(STORAGE_KEY), new RegExp(KEY), "the key never enters the data blob");
  data.clear();
  assert.equal(keys.read(), KEY);

  keys.clear();
  assert.equal(keys.read(), "");
  assert.equal(storage.getItem(AI_KEY_STORAGE), null);
});

test("consent: the provider warning is accepted once", () => {
  const storage = memoryLocalStorage();
  const consent = aiConsentStore(storage);
  assert.equal(consent.accepted(), false);
  consent.accept();
  assert.equal(aiConsentStore(storage).accepted(), true);
});

test("mock provider: records requests and answers from a script", async () => {
  const mock = createMockProvider((request, index) => `ответ ${index}`);
  const first = await mock.complete({ messages: [{ role: "user", content: "a" }] });
  assert.equal(first.message.content, "ответ 0");
  assert.equal(mock.requests.length, 1);
  const offline = createMockProvider(() => "x", { hasKey: false });
  assert.equal((await offline.complete({})).kind, "no_key");
});
