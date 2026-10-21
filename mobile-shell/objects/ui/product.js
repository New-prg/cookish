// The product catalog on objects: «Найти КБЖУ» in the reference and Open Food
// Facts, a barcode scan, and the Заполнитель КБЖУ for one product or all
// products without КБЖУ. Reference and Open Food Facts cards the Заполнитель
// finds are written at once with an undo; its estimates and questions wait
// for the person, and nothing is written until they answer.
import { cardOps, createOp, fillProducts, findProductByName, isBarcode, nutritionLine, nutritionOfProduct, offCards, needsNutrition, productsToFill, referenceCards, cardIsFull } from "../core/catalog.js";
import { FILLER_BATCH, checkedCard } from "../../core/filler.js";
import { NUTRITION_SOURCES } from "../../core/nutrition-source.js";
import { createCatalogService } from "../../services/catalog/catalog.js";
import { createFillerService } from "../../services/filler/filler-service.js";
import { platformFetch } from "../../ui/platform.js";
import { aiKey, aiProvider, NO_AI_KEY, withAiConsent } from "./ai.js";
import { act, go, hrefFor, nameOf, rerender, store } from "./runtime.js";
import { empty, fill, h, openSheet, progressBar, toast } from "./dom.js";

const catalog = createCatalogService({ fetchImpl: platformFetch(window) });
const filler = createFillerService({ providerFor: () => aiProvider, catalog });

// One run takes at most this many products; the rest wait for the next run.
const BULK_LIMIT = 25;

// What waits for the person, by product: { kind: "card", card, note? } an
// estimate to apply, { kind: "choose", candidates } and { kind: "replace",
// candidates } questions. Kept in memory: a restart asks again.
const pending = new Map();
const job = { busy: false, ids: new Set(), done: 0, total: 0, error: "", failed: new Set() };
const watchers = new Set();

// The page redraws itself on a store write; sheets and job changes get here.
function changed() {
  rerender();
  for (const refresh of [...watchers]) refresh();
}

function watch(node, refresh) {
  const watcher = () => {
    if (node.isConnected) refresh();
    else watchers.delete(watcher);
  };
  watchers.add(watcher);
}

const hasKey = () => Boolean(aiKey.read());

// The Android scanner answers through one global callback.
export const canScan = () => Boolean(window.NativeCookish?.scanBarcode);
let onScan = null;
window.__onNativeBarcodeScan = (payload) => {
  let result = null;
  try {
    result = JSON.parse(payload);
  } catch {
    result = null;
  }
  const done = onScan;
  onScan = null;
  if (!result?.ok) {
    if (!result?.cancelled) toast("Не удалось распознать штрихкод.", { error: true });
    return;
  }
  done?.(result.barcode);
};

function scanBarcode(done) {
  if (!canScan()) return;
  onScan = done;
  window.NativeCookish.scanBarcode();
}

function applyCard(productId, card, { confirmed } = {}) {
  const state = store.state();
  const result = act(cardOps(state, productId, card, { confirmed }), { summary: `КБЖУ «${nameOf(state.objects[productId])}» · ${card.label}` });
  if (result.ok) {
    pending.delete(productId);
    changed();
  }
  return result;
}

// Cards from an answer of the person are checked again, as the legacy Core does.
function applyChecked(productId, card) {
  const checked = checkedCard(card);
  if (!checked) {
    toast("Эти КБЖУ не прошли проверку: выберите другой вариант.", { error: true });
    return;
  }
  applyCard(productId, { ...checked, name: card.name }, checked.label === NUTRITION_SOURCES.estimate ? { confirmed: false } : {});
}

// Reference and Open Food Facts cards go in as one change of the assistant,
// which «Отменить» takes back. If a rule of the plan refuses, the person
// decides instead.
function writeFilled(filled) {
  if (!filled.length) return null;
  const state = store.state();
  const names = filled.map(({ productId }) => `«${nameOf(state.objects[productId])}»`).join(", ");
  const result = store.apply(filled.map(({ productId, card }) => cardOps(state, productId, card)), { actor: "ai", summary: `КБЖУ ${names}` });
  if (result.ok) return { names, changeSetId: result.changeSetId };
  filled.forEach(({ productId, card }) => pending.set(productId, { kind: "card", card, note: result.reason }));
  return null;
}

async function runFill(ids, hints = {}) {
  if (job.busy || !ids.length) return;
  ids.forEach((id) => pending.delete(id));
  Object.assign(job, { busy: true, ids: new Set(ids), done: 0, total: ids.length, error: "", failed: new Set() });
  changed();
  const written = [];
  const tally = { asked: 0, left: 0 };
  for (let from = 0; from < ids.length && !job.error; from += FILLER_BATCH) {
    const batch = ids.slice(from, from + FILLER_BATCH);
    const out = await fillProducts({ filler, state: store.state(), ids: batch, hints });
    if (!out.ok) {
      Object.assign(job, { error: out.reason, failed: new Set(ids) });
      break;
    }
    const wrote = writeFilled(out.filled);
    if (wrote) written.push(wrote);
    out.cards.forEach(({ productId, card }) => pending.set(productId, { kind: "card", card }));
    out.questions.forEach(({ productId, kind, candidates }) => pending.set(productId, { kind, candidates }));
    const outcomes = new Set([...out.filled, ...out.cards, ...out.questions].map((entry) => entry.productId));
    tally.asked += out.cards.length + out.questions.length + (wrote ? 0 : out.filled.length);
    tally.left += batch.filter((id) => !outcomes.has(id)).length;
    job.done += batch.length;
    changed();
  }
  job.busy = false;
  job.ids = new Set();
  summarize(written, tally);
  changed();
}

function summarize(written, tally) {
  if (job.error) {
    toast(job.error, { error: true });
    return;
  }
  const parts = [
    written.length ? `КБЖУ заполнены: ${written.map((entry) => entry.names).join(", ")}.` : "",
    tally.asked ? "Ждут вашего ответа или оценки." : "",
    tally.left ? `Не нашлось: ${tally.left}.` : "",
  ].filter(Boolean);
  toast(parts.join(" ") || "Заполнитель ничего не нашёл.", {
    error: !parts.length,
    undo: written.length ? () => {
      const back = store.apply(written.map((entry) => ({ op: "revert", changeSetId: entry.changeSetId })), { actor: "human", summary: "Отмена: КБЖУ от Заполнителя" });
      toast(back.ok ? "Отменено" : back.reason, { error: !back.ok });
    } : null,
  });
}

// ----- Waiting estimates and questions -----

function pendingCards(only = null) {
  const state = store.state();
  return [...pending].flatMap(([id, entry]) => {
    const obj = state.objects[id];
    if ((only && id !== only) || !obj || obj.archivedAt) return [];
    if (entry.kind === "choose" && !needsNutrition(obj) && !job.busy) return [];
    return [entry.kind === "card" ? proposalCard(obj, entry) : questionCard(obj, entry)];
  });
}

const dismiss = (id) => { pending.delete(id); changed(); };

function proposalCard(obj, entry) {
  const estimate = entry.card.label === NUTRITION_SOURCES.estimate;
  return h("article", { class: "card filler-card", "data-filler": obj.id },
    h("div", { class: "row-line" }, h("span", { class: "row-title", text: obj.name }), h("span", { class: "filler-tag", text: entry.card.label })),
    h("p", { class: "row-sub", text: `Сейчас: ${nutritionLine(nutritionOfProduct(obj))}` }),
    h("p", { class: "filler-new", text: `Станет: ${nutritionLine(entry.card.nutrition)}` }),
    estimate ? h("p", { class: "hint", text: "Продукта нет в справочнике и Open Food Facts, поэтому ИИ оценил КБЖУ сам. Проверьте цифры." }) : null,
    entry.note ? h("p", { class: "hint", text: entry.note }) : null,
    h("div", { class: "actions" },
      h("button", { class: "btn btn-quiet", onclick: () => dismiss(obj.id) }, "Убрать"),
      h("button", { class: "btn btn-primary", onclick: () => applyChecked(obj.id, entry.card) }, "Применить"),
    ),
  );
}

function questionCard(obj, entry) {
  const replace = entry.kind === "replace";
  const answer = (input) => {
    const text = input.value.trim();
    if (text) { pending.delete(obj.id); runFill([obj.id], { [obj.id]: text }); }
  };
  const input = h("input", { class: "input", type: "text", maxlength: "200", placeholder: "Жирность, марка…", "aria-label": "Ответ своими словами" });
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") answer(input); });
  return h("article", { class: "card filler-card", "data-filler": obj.id },
    h("div", { class: "row-line" }, h("span", { class: "row-title", text: obj.name }), h("span", { class: "filler-tag", text: "Вопрос" })),
    h("p", { class: "hint", text: replace
      ? `Вы вводили КБЖУ «${obj.name}» сами. Заменить их значениями «${entry.candidates[0].label}»?`
      : `Какой именно продукт «${obj.name}»? Выберите вариант, напишите своими словами или отсканируйте штрихкод.` }),
    replace
      ? [
        h("p", { class: "filler-new", text: `Станет: ${nutritionLine(entry.candidates[0].nutrition)}` }),
        h("div", { class: "actions" },
          h("button", { class: "btn btn-quiet", onclick: () => dismiss(obj.id) }, "Оставить мои"),
          h("button", { class: "btn btn-primary", onclick: () => applyChecked(obj.id, entry.candidates[0]) }, "Заменить"),
        ),
      ]
      : [
        h("div", { class: "pick-list" }, entry.candidates.map((card) => h("button", { class: "row row-btn", onclick: () => applyChecked(obj.id, card) },
          h("span", { class: "row-main" },
            h("span", { class: "row-title", text: [card.brand, card.name].filter(Boolean).join(" · ") }),
            h("span", { class: "row-sub", text: `${nutritionLine(card.nutrition)} · ${card.label}` }),
          ),
        ))),
        h("div", { class: "search-row" }, input, h("button", { class: "btn btn-quiet", onclick: () => answer(input) }, "Ответить")),
        h("div", { class: "actions" },
          h("button", { class: "btn btn-quiet", onclick: () => dismiss(obj.id) }, "Пропустить"),
          canScan() ? h("button", { class: "btn btn-quiet", onclick: () => scanBarcode(async (code) => {
            const found = await offCards(catalog, code);
            const card = found.cards.find((item) => cardIsFull(item));
            if (card) applyChecked(obj.id, card);
            else toast(found.problem || "В Open Food Facts нет КБЖУ для этого штрихкода.", { error: true });
          }) }, "Сканировать штрихкод") : null,
        ),
      ],
  );
}

// ----- The page of a product -----

export function productSection(state, obj) {
  const busy = job.busy && job.ids.has(obj.id);
  return h("section", { class: "block", "aria-label": "Каталог" },
    h("h2", { class: "section-title", text: "Каталог и ИИ" }),
    h("div", { class: "card filler-tools" },
      needsNutrition(obj) ? h("p", { class: "hint", text: "КБЖУ ещё нет. Найдите продукт в каталоге или попросите ИИ." }) : null,
      h("div", { class: "actions" },
        h("button", { class: "btn btn-primary", onclick: () => findSheet({ product: obj }) }, "Найти КБЖУ"),
        canScan() ? h("button", { class: "btn btn-quiet", onclick: () => scanBarcode((code) => findSheet({ product: obj, query: code })) }, "Сканировать штрихкод") : null,
        h("button", { class: "btn btn-quiet", disabled: job.busy || !hasKey(), onclick: () => withAiConsent(() => runFill([obj.id])) }, busy ? "Заполняю…" : "Заполнить с ИИ"),
      ),
      hasKey() ? null : h("p", { class: "builder-note builder-error", text: NO_AI_KEY }),
      busy ? h("p", { class: "hint", role: "status", text: "Заполнитель ищет КБЖУ…" }) : null,
      job.error && !job.busy && job.failed.has(obj.id) ? h("p", { class: "builder-note builder-error", role: "alert", text: job.error }) : null,
    ),
    pendingCards(obj.id),
  );
}

// ----- «Найти КБЖУ» and «Добавить из каталога» -----

// With `product` the picked card fills that product; without, it makes a new
// product, or offers the one of the same name that already exists.
function findSheet({ product = null, query = product?.name || "" } = {}) {
  openSheet(product ? "Найти КБЖУ" : "Добавить из каталога", (close) => {
    const view = { cards: [], problem: "", busy: false, searched: "", clash: null, seq: 0 };
    const input = h("input", { class: "input", type: "search", enterkeyhint: "search", placeholder: "Название или штрихкод", "aria-label": "Название или штрихкод", maxlength: "100", value: query });
    const results = h("div", { class: "catalog" });

    function pick(card) {
      if (product) {
        if (applyCard(product.id, card, { confirmed: true }).ok) close();
        return;
      }
      const same = findProductByName(store.state(), card.name);
      if (same) {
        view.clash = { product: same, card };
        render();
        return;
      }
      const made = act(createOp(store.state(), card), { summary: `Продукт «${card.name}»` });
      if (made.ok) {
        close();
        go(hrefFor(store.state().objects[made.ids[0]]));
      }
    }

    const row = (card) => h("button", { class: "row row-btn", disabled: !cardIsFull(card), onclick: () => pick(card) },
      h("span", { class: "row-main" },
        h("span", { class: "row-title", text: [card.brand, card.name].filter(Boolean).join(" · ") }),
        h("span", { class: "row-sub", text: `${cardIsFull(card) ? nutritionLine(card.nutrition) : "в карточке нет КБЖУ"} · ${card.label}` }),
      ),
    );

    function clashPanel() {
      const { product: same, card } = view.clash;
      return h("div", { class: "card filler-card", role: "group", "aria-label": "Такой продукт уже есть" },
        h("p", { class: "row-title", text: `«${same.name}» уже есть в продуктах` }),
        h("p", { class: "hint", text: `Новый не создаём. Можно открыть его или обновить его КБЖУ данными «${card.label}».` }),
        h("div", { class: "actions" },
          h("button", { class: "btn btn-quiet", onclick: () => { close(); go(hrefFor(same)); } }, "Открыть"),
          h("button", { class: "btn btn-primary", onclick: () => { if (applyCard(same.id, card, { confirmed: true }).ok) close(); } }, "Обновить КБЖУ"),
          h("button", { class: "btn btn-quiet", onclick: () => { view.clash = null; render(); } }, "Не надо"),
        ),
      );
    }

    function render() {
      const named = !product && view.searched ? findProductByName(store.state(), view.searched) : null;
      fill(results,
        view.clash ? clashPanel() : null,
        named && !view.clash ? h("div", { class: "banner" }, h("span", { text: `«${named.name}» уже есть в продуктах` }), h("button", { class: "btn btn-quiet", onclick: () => { close(); go(hrefFor(named)); } }, "Открыть")) : null,
        view.cards.length ? h("div", { class: "pick-list", role: "list", "aria-label": "Найдено" }, view.cards.map(row)) : null,
        view.busy ? h("p", { class: "hint", role: "status", text: "Ищу в Open Food Facts…" }) : null,
        view.problem ? h("p", { class: "builder-note builder-error", role: "alert", text: view.problem }) : null,
        !view.busy && view.searched && !view.cards.length && !view.problem ? empty("Ничего не нашлось") : null,
        h("p", { class: "field-hint", text: "Справочник общих продуктов (USDA) и Open Food Facts. КБЖУ на 100 г или 100 мл." }),
      );
    }

    async function search() {
      const text = input.value.trim();
      if (!text) return;
      const seq = ++view.seq;
      Object.assign(view, { cards: isBarcode(text) ? [] : referenceCards(text), problem: "", busy: true, searched: text, clash: null });
      render();
      const found = await offCards(catalog, text);
      if (seq !== view.seq || !results.isConnected) return;
      Object.assign(view, { cards: [...view.cards, ...found.cards], problem: found.problem, busy: false });
      render();
    }

    input.addEventListener("keydown", (event) => { if (event.key === "Enter") search(); });
    render();
    if (query.trim()) search();
    return [
      h("div", { class: "search-row" }, input, h("button", { class: "btn btn-primary", onclick: search }, "Найти")),
      canScan() ? h("button", { class: "btn btn-quiet btn-block", onclick: () => scanBarcode((code) => { if (!results.isConnected) return; input.value = code; search(); }) }, "Сканировать штрихкод") : null,
      results,
    ];
  });
}

// ----- The Продукты type screen -----

export const catalogAction = () => h("button", { class: "btn btn-quiet btn-small", onclick: catalogMenu }, "Каталог");

function catalogMenu() {
  openSheet("Каталог продуктов", (close) => {
    const missing = productsToFill(store.state()).length;
    const item = (title, sub, open) => h("button", { class: "row row-btn", onclick: () => { close(); open(); } },
      h("span", { class: "row-main" }, h("span", { class: "row-title", text: title }), h("span", { class: "row-sub", text: sub })),
    );
    return h("div", { class: "pick-list" },
      item("Добавить из каталога", "Справочник общих продуктов и Open Food Facts", () => findSheet()),
      item("Заполнить КБЖУ с ИИ", missing ? `Без КБЖУ: ${missing}` : "У всех продуктов есть КБЖУ", fillSheet),
    );
  });
}

function fillSheet() {
  openSheet("Заполнить КБЖУ с ИИ", () => {
    const body = h("div", { class: "form catalog" });
    function render() {
      const todo = productsToFill(store.state());
      // A product that already waits for an answer is not sent again.
      const queue = todo.filter((obj) => !pending.has(obj.id)).slice(0, BULK_LIMIT);
      fill(body,
        h("p", { class: "hint", text: todo.length
          ? `Без КБЖУ: ${todo.length}. Заполнитель ищет их в справочнике и Open Food Facts, а если не находит, оценивает сам. Оценки вы применяете по одной.`
          : "У всех продуктов есть КБЖУ." }),
        hasKey() ? null : h("p", { class: "builder-note builder-error", text: NO_AI_KEY }),
        h("button", { class: "btn btn-primary btn-block", disabled: job.busy || !hasKey() || !queue.length, onclick: () => withAiConsent(() => runFill(queue.map((obj) => obj.id))) },
          job.busy ? "Заполняю…" : queue.length ? `Заполнить с ИИ (${queue.length})` : "Заполнить с ИИ"),
        todo.length - pending.size > BULK_LIMIT && !job.busy ? h("p", { class: "field-hint", text: `За один раз ${BULK_LIMIT} продуктов, остальные следующим запуском.` }) : null,
        job.busy ? [progressBar(job.done, job.total), h("p", { class: "hint", role: "status", text: `Готово ${job.done} из ${job.total}` })] : null,
        job.error ? h("p", { class: "builder-note builder-error", role: "alert", text: job.error }) : null,
        pendingCards(),
      );
    }
    render();
    watch(body, render);
    return body;
  });
}
