// The import scenarios of #35 on the real provider: a plan as text, a cut
// photo, a PDF prescription; the photo and the PDF are rendered here by
// Playwright. Each scenario checks the Предложения the assistant makes.
// Usage: [AI_MODEL=glm] node scripts/ai-lab/import-bench.mjs [I1,I2]
import { chromium } from "playwright";
import { KEY } from "./rai.mjs";
import { TODAY, makeState } from "./fixture.mjs";
import { createThread } from "../../mobile-shell/core/assistant-thread.js";
import { memoryStorage, openLocalData } from "../../mobile-shell/core/local-data.js";
import { readRationDay } from "../../mobile-shell/core/ration-domain.js";
import { AI_MODELS, createRouterAiProvider, fetchTransport } from "../../mobile-shell/services/assistant/ai-provider.js";
import { openLocalServices } from "../../mobile-shell/transport/local.js";

const config = AI_MODELS[process.env.AI_MODEL || "haiku"];
const only = process.argv[2]?.split(",");
const TOMORROW = "2026-10-02";

const browser = await chromium.launch();
async function render(html, { cut = 0, pdf = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 720, height: 560 } });
  await page.setContent(`<body style="font: 22px sans-serif; padding: 24px; line-height: 1.6">${html}</body>`);
  if (pdf) {
    const bytes = await page.pdf({ format: "A5" });
    await page.close();
    return { type: "file", file: { filename: "назначение.pdf", file_data: `data:application/pdf;base64,${bytes.toString("base64")}` } };
  }
  const bytes = await page.screenshot({ clip: { x: 0, y: 0, width: 720, height: 560 - cut } });
  await page.close();
  return { type: "image_url", image_url: { url: `data:image/png;base64,${bytes.toString("base64")}` } };
}

const plan = `<h2>План на завтра</h2><p>Завтрак 8:00 — овсяные хлопья 70 г, молоко 2,5% 200 мл, банан 120 г</p><p>Обед 13:00 — гречка 90 г, куриная грудка 180 г</p><p>Перекус 16:30 — творог 5% 200 г</p><p>Ужин 19:30 — лосось 150 г, рис 70 г</p>`;
const ration = (thread) => thread.proposals.filter((proposal) => ["special_day", "version"].includes(proposal.kind));
const imported = (proposal) => /^Импорт: /.test(proposal?.summary || "");

const SCENARIOS = [
  {
    id: "I1", title: "чистый текст",
    text: `Перенеси мой план на завтра (${TOMORROW}): завтрак 8:00 — овсяные хлопья 70 г, молоко 2,5% 200 мл, банан 120 г; обед 13:00 — гречка 90 г, куриная грудка 180 г; перекус 16:30 — творог 5% 200 г; ужин 19:30 — лосось 150 г, рис 70 г.`,
    check: ({ thread, after }) => [
      ["Предложение импорта", imported(ration(thread)[0])],
      ["4 приёма пищи", (readRationDay(after, TOMORROW)?.meals || []).length === 4],
    ],
  },
  {
    id: "I2", title: "неполное фото",
    text: `Перенеси план с фото на завтра (${TOMORROW})`,
    attachment: async () => ({ kind: "фото", name: "план.png", parts: [await render(plan, { cut: 150 })] }),
    check: ({ thread, reply }) => [
      ["говорит о нечитаемом", ration(thread).some((proposal) => proposal.import?.unsure?.length) || /не вид|обрез|не читается|не попал|продолжени|ужин/i.test(reply)],
    ],
  },
  {
    id: "I3", title: "неизвестный продукт",
    text: `Перенеси на завтра (${TOMORROW}): завтрак 8:00 — гранола с киноа и годжи 60 г, молоко 2,5% 200 мл; обед 13:00 — гречка 90 г, куриная грудка 180 г; ужин 19:30 — лосось 150 г, рис 70 г.`,
    check: ({ thread, after }) => [
      ["КБЖУ не выдуманы", !thread.proposals.some((proposal) => proposal.kind === "product" && proposal.ops[0].product.nutrition?.source === "Оценка ИИ")],
      ["продукт в каталоге", after.products.some((product) => /гранол/i.test(product.name))],
      ["Предложение импорта", imported(ration(thread)[0])],
    ],
  },
  {
    id: "I4", title: "противоречивая порция",
    text: `Перенеси на завтра (${TOMORROW}): завтрак 8:00 — овсяные хлопья 60 г (это 3 стакана), молоко 2,5% 200 мл; обед 13:00 — гречка 90 г, куриная грудка 180 г; ужин 19:30 — лосось 150 г, рис 70 г.`,
    check: ({ thread, reply }) => [
      ["замечает противоречие", ration(thread).some((proposal) => proposal.import?.unsure?.length) || /стакан|противореч|уточн/i.test(reply)],
    ],
  },
  {
    id: "I5", title: "назначение врача",
    text: `Это назначение врача на завтра (${TOMORROW}), перенеси точно как есть`,
    attachment: async () => ({ kind: "документ", name: "назначение.pdf", parts: [await render(`<h3>Назначение врача-диетолога</h3><p>На ${TOMORROW}:</p><p>Завтрак 8:00 — овсяные хлопья 40 г, молоко 2,5% 150 мл</p><p>Обед 13:00 — гречка 60 г, куриная грудка 120 г</p><p>Ужин 19:00 — творог 5% 150 г</p>`, { pdf: true })] }),
    check: ({ thread, after }) => {
      const proposal = ration(thread)[0];
      const items = (readRationDay(after, TOMORROW)?.meals || []).flatMap((meal) => meal.items);
      return [
        ["режим назначения", proposal?.import?.prescription === true],
        ["порции как в назначении", items.some((item) => /Овсян/.test(item.name) && Number(item.portionSize) === 40) && items.some((item) => /Куриная/.test(item.name) && Number(item.portionSize) === 120)],
      ];
    },
  },
  {
    id: "I6", title: "план тренировок",
    text: "Перенеси план тренировок с фото с понедельника",
    attachment: async () => ({ kind: "фото", name: "тренировки.png", parts: [await render("<h2>Тренировки</h2><p>Пн — силовая 60 мин, средняя</p><p>Ср — бег 40 мин, средняя</p><p>Пт — силовая 60 мин, средняя</p><p>Сб — ходьба 60 мин, низкая</p><p>Вт, Чт, Вс — отдых</p>")] }),
    check: ({ thread }) => [["расписание тренировок из импорта", thread.proposals.some((proposal) => proposal.kind === "sport_version" && imported(proposal))]],
  },
];

console.log(`${config.model}, effort ${config.reasoningEffort}`);
let passed = 0;
const selected = SCENARIOS.filter((scenario) => !only || only.includes(scenario.id));
for (const scenario of selected) {
  const data = openLocalData(memoryStorage(makeState()));
  data.load();
  const services = openLocalServices({
    fetchImpl: fetch,
    dataPort: { read: async () => data.snapshot() },
    providerFor: (key) => createRouterAiProvider({ getKey: () => key, transport: fetchTransport(fetch), config }),
    today: () => TODAY,
  });
  const started = Date.now();
  const attachment = scenario.attachment ? await scenario.attachment() : undefined;
  const page = scenario.id === "I6" ? "sport" : "ration";
  const { thread, ...result } = await services.stream("assistant", "run", { thread: createThread({ page, mode: "plan" }), text: scenario.text, key: KEY, ...(attachment ? { attachment } : {}) });
  // The person applies everything, products first.
  const products = thread.proposals.filter((proposal) => proposal.kind === "product");
  if (products.length) data.applyProposals(products, { today: TODAY, together: false });
  const plans = thread.proposals.filter((proposal) => proposal.kind !== "product");
  if (plans.length) data.applyProposals(plans, { today: TODAY, together: false });
  const reply = String(result.reply || result.reason || "");
  const checks = scenario.check({ thread, after: data.snapshot(), reply });
  const ok = checks.every(([, pass]) => pass);
  if (ok) passed += 1;
  console.log(`${scenario.id} ${scenario.title}: ${checks.filter(([, pass]) => pass).length}/${checks.length} · ${Math.round((Date.now() - started) / 1000)} с`);
  checks.filter(([, pass]) => !pass).forEach(([label]) => console.log(`  ✗ ${label}`));
  thread.proposals.forEach((proposal) => console.log(`  ▸ ${proposal.summary}${proposal.import?.unsure?.length ? ` · не уверен: ${proposal.import.unsure.join("; ")}` : ""}${proposal.warnings?.length ? ` · ⚠ ${proposal.warnings.join("; ").slice(0, 120)}` : ""}`));
  console.log(`  > ${reply.replace(/\s+/g, " ").slice(0, 220)}`);
}
await browser.close();
console.log(`Итого: ${passed} из ${selected.length}`);
