import assert from "node:assert/strict";
import test from "node:test";

import { createBatchWorker } from "../mobile-shell/core/batch-worker.js";
import { fillerPending } from "../mobile-shell/core/filler.js";
import { memoryStorage, openLocalData } from "../mobile-shell/core/local-data.js";
import { createMockProvider } from "../mobile-shell/services/assistant/ai-provider.js";
import { createServices } from "../mobile-shell/services/index.js";
import { createLocalTransport } from "../mobile-shell/transport/local.js";

const MILK = {
  code: "4607050690021",
  product_name_ru: "Молоко питьевое 2,5%",
  brands: "Простоквашино",
  quantity: "930 мл",
  nutriments: { "energy-kcal_100g": 54, proteins_100g: 3, fat_100g: 2.5, carbohydrates_100g: 4.7 },
};

let sequence = 0;
const call = (name, args) => ({ id: `call_${sequence += 1}`, type: "function", function: { name, arguments: JSON.stringify(args) } });

function setup(turns) {
  const data = openLocalData(memoryStorage());
  data.load();
  const ids = ["Пшено", "Молоко Простоквашино 2,5%", "Молоко"].map((name) => data.saveProduct({ name, unit: "г" }).productId);
  const provider = createMockProvider((request, index) => turns[index] ?? { role: "assistant", content: "" });
  const transport = createLocalTransport(createServices({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ products: [MILK] }) }),
    dataPort: { read: async () => data.snapshot() },
    providerFor: () => provider,
  }));
  const products = () => data.snapshot().products.map(({ id, name, unit, nutrition }) => ({ id, name, unit, nutrition }));
  return { data, ids, provider, transport, products };
}

test("filler service: a batch of three — two cards from the reference and Open Food Facts, one question", async () => {
  const { data, ids, provider, transport, products } = setup([
    { role: "assistant", content: "", tool_calls: [
      call("find_reference", { query: "пшено" }),
      call("search_food", { query: "Простоквашино молоко 2,5%" }),
      call("find_reference", { query: "молоко" }),
    ] },
    { role: "assistant", content: "", tool_calls: [
      call("upsert_product", { name: "Пшено", source: "reference", source_ref: "millet", calories: 1 }),
      call("upsert_product", { name: "Молоко Простоквашино 2,5%", source: "off", source_ref: MILK.code }),
      call("upsert_product", { name: "Молоко", source: "reference", source_ref: "milk-2" }),
    ] },
  ]);
  const result = await transport.request("filler", "fill", { products: products(), key: "test-key" });
  assert.equal(result.ok, true);
  assert.equal(provider.requests.length, 2, "the batch ends once every product has an outcome");
  assert.ok(provider.requests.every((request) => request.tools.map((tool) => tool.function.name).join() === "find_reference,search_food,upsert_product"));
  assert.deepEqual(result.filled.map((entry) => [entry.card.label, entry.card.nutrition.calories]), [["Справочник", 378], ["Open Food Facts", 54]]);
  assert.equal(result.questions.length, 1);
  assert.ok(result.questions[0].candidates.length >= 2 && result.questions[0].candidates.length <= 3);

  const applied = data.applyFillerBatch(result);
  assert.equal(applied.filled, 2);
  const [millet, milk, plain] = ids.map((id) => data.snapshot().products.find((product) => product.id === id));
  assert.equal(millet.nutrition.calories, 378);
  assert.equal(milk.nutrition.source, "Open Food Facts");
  assert.equal(milk.barcode, MILK.code);
  assert.equal(plain.nutrition, null);
  assert.deepEqual(data.snapshot().filler.queue, []);

  // The person picks a variant with a button.
  const [question] = data.snapshot().filler.questions;
  const picked = question.candidates.find((card) => card.sourceRef === "milk-3-2");
  assert.equal(data.answerFillerQuestion(question.id, { candidate: question.candidates.indexOf(picked) }).ok, true);
  assert.equal(data.snapshot().products.find((product) => product.id === plain.id).nutrition.calories, 61);
});

test("filler service: an estimate becomes a Предложение and a miss", async () => {
  const { data, transport, products } = setup([
    { role: "assistant", content: "", tool_calls: [
      call("upsert_product", { name: "Пшено", source: "estimate", calories: 250, protein: 5, fat: 10, carbs: 33 }),
    ] },
    { role: "assistant", content: "Готово." },
  ]);
  const result = await transport.request("filler", "fill", { products: products().slice(0, 1), key: "test-key" });
  assert.deepEqual(result.misses, ["Пшено"]);
  data.applyFillerBatch(result);
  const [proposal] = data.snapshot().filler.proposals;
  assert.equal(proposal.summary, "Оценка КБЖУ «Пшено»");
  assert.equal(data.applyFillerProposal(proposal.id).ok, true);
  assert.equal(data.snapshot().products.find((product) => product.name === "Пшено").nutrition.source, "Оценка ИИ");
  assert.deepEqual(data.snapshot().filler.proposals, []);
});

function worker(data, { key = true } = {}) {
  const batches = [];
  const instance = createBatchWorker({
    burstMs: 30_000,
    retryMs: 60_000,
    timers: { setTimeout: () => 1, clearTimeout: () => {} },
    hasKey: () => key,
    pending: () => fillerPending(data.snapshot().filler, 5),
    decide: async (entries) => {
      batches.push(entries.map((entry) => entry.productId));
      return { ok: true, productIds: entries.map((entry) => entry.productId) };
    },
    finish: (entries, result) => data.applyFillerBatch(result),
  });
  return { instance, batches };
}

test("filler worker: without a key the queue waits; switched off only «Заполнить ИИ» goes", async () => {
  const data = openLocalData(memoryStorage());
  data.load();
  const bread = data.saveProduct({ name: "Хлеб", unit: "г" }).productId;
  const cheese = data.saveProduct({ name: "Сыр", unit: "г" }).productId;

  const keyless = worker(data, { key: false });
  assert.deepEqual(await keyless.instance.run(), { ok: false, waiting: true });
  assert.deepEqual(keyless.batches, []);
  assert.equal(data.snapshot().filler.queue.length, 2, "nothing is lost");

  data.setFillerEnabled(false);
  const off = worker(data);
  assert.deepEqual(await off.instance.run(), { ok: true, sent: 0 });
  assert.deepEqual(off.batches, [], "no call with the switch off");

  data.requestFilling(cheese);
  await off.instance.run();
  assert.deepEqual(off.batches, [[cheese]]);
  assert.ok(data.snapshot().filler.queue.some((entry) => entry.productId === bread), "the rest waits for the switch");
});
