import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { authorBundle, repairMessage } from "../mobile-shell/objects/kit/author.js";
import * as catalogue from "../mobile-shell/objects/kit/catalogue.js";
import { DECISIONS } from "../mobile-shell/objects/kit/examples/decisions.js";
import { EXAMPLES, exampleById } from "../mobile-shell/objects/kit/examples/index.js";
import { expandDefaults } from "../mobile-shell/objects/kit/defaults.js";
import { readSpec } from "../mobile-shell/objects/kit/spec.js";
import { CALC_DOCS, DEFAULT_CASES, ELEMENT_SAMPLES, EMBED_NOTES, FIELD_SAMPLES, MANUAL_BUDGET, MISTAKES, SPACE_CHARS, defaultsFor, estimateTokens, manualParts, pickExamples, pieceNode, priorState, printAnswer, renderManual, renderReference, requestTags, snippet } from "../mobile-shell/objects/kit/manual.js";
import { bundleFromMarkup, bundleToMarkup } from "../mobile-shell/objects/kit/markup.js";
import { applyBundle, checkBundle } from "../mobile-shell/objects/kit/pipeline.js";
import { addItemOps, formOps, itemOps, markOps } from "../mobile-shell/objects/kit/actions.js";
import { resolveBinding } from "../mobile-shell/objects/kit/bind.js";
import { openObjectStore } from "../mobile-shell/objects/core/store.js";
import { createMockProvider } from "../mobile-shell/services/assistant/ai-provider.js";
import { buildDemoState } from "../mobile-shell/objects/viz/demo.js";

const TODAY = "2026-10-24";
const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(here, "../mobile-shell/objects/kit/examples");
const emptyState = () => openObjectStore({ storage: null, today: () => TODAY }).state();
const baseOf = (example) => (example.space === "demo" ? buildDemoState(TODAY) : emptyState());
const spaceOf = (example) => priorState(example, { state: baseOf(example) });
const withApps = (...ids) => {
  let state = emptyState();
  for (const id of ids) {
    const example = exampleById(id);
    const store = openObjectStore({ storage: null, today: () => TODAY });
    store.replaceAll(state);
    const applied = applyBundle(store, checkBundle(example.bundle, state, { today: TODAY }));
    assert.equal(applied.ok, true, `${id}: ${applied.reason}`);
    state = store.state();
  }
  return state;
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const SURFACES = ["json", "html"];

// -- the examples -----------------------------------------------------------------------

test("every example file is in the index, named by its id, and has the whole shape", () => {
  const files = fs.readdirSync(examplesDir).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)).sort();
  assert.deepEqual(EXAMPLES.map((example) => example.id).sort(), files);
  assert.ok(EXAMPLES.length >= 12);
  for (const example of EXAMPLES) {
    assert.match(example.request, /\S/, example.id);
    assert.match(example.reply, /[а-яё]/i, example.id);
    assert.ok(example.tags.length > 0, example.id);
    assert.ok(["empty", "demo"].includes(example.space), example.id);
    for (const id of example.after || []) assert.ok(exampleById(id)?.bundle, `${example.id}: after ${id}`);
  }
  assert.deepEqual(EXAMPLES.filter((example) => !example.bundle).map((example) => example.id), ["creatine-refuse"], "one refusal, and only the refusal has no bundle");
});

test("every example passes checkBundle on its own space and applies as one change set", () => {
  for (const example of EXAMPLES.filter((candidate) => candidate.bundle)) {
    const state = spaceOf(example);
    const checked = checkBundle(example.bundle, state, { today: TODAY });
    assert.equal(checked.ok, true, `${example.id}: ${JSON.stringify(checked.problems)}`);
    assert.deepEqual(checked.changes, [], `${example.id}: the model-facing example needs no normalizer fixes`);
    const store = openObjectStore({ storage: null, today: () => TODAY });
    store.replaceAll(state);
    const applied = applyBundle(store, checked);
    assert.equal(applied.ok, true, `${example.id}: ${applied.reason}`);
    assert.ok(applied.changeSetId, example.id);
  }
});

test("the refusal example passes checkBundle as a reply alone, in both surfaces, and changes nothing", () => {
  const refusal = exampleById("creatine-refuse");
  const state = spaceOf(refusal);
  for (const surface of SURFACES) {
    const printed = printAnswer(refusal, surface);
    const raw = surface === "json" ? printed : bundleFromMarkup(printed).bundle;
    const checked = checkBundle(raw, state, { today: TODAY, request: refusal.request });
    assert.equal(checked.ok, true, `${surface}: ${JSON.stringify(checked.problems)}`);
    assert.equal(checked.noop, true, surface);
    assert.equal(checked.reply, refusal.reply, surface);
    assert.deepEqual(checked.ops, [], surface);
  }
});

test("the examples cover every kind, input element, goal type, quota, avoid, follow, link, calc, source, embed, removal, overlay and refusal", () => {
  const bundles = EXAMPLES.filter((example) => example.bundle).map((example) => example.bundle);
  const tracks = bundles.flatMap((bundle) => bundle.tracks || []);
  const elements = bundles.flatMap((bundle) => (bundle.screens || []).flatMap((screen) => (screen.cards || []).flatMap((card) => card.body || [])));
  const fields = tracks.flatMap((track) => track.fields || []);
  const covered = {
    kinds: new Set(tracks.map((track) => track.kind)),
    elements: new Set(elements.map((el) => el.el)),
  };
  for (const kind of catalogue.KIND_KEYS) assert.ok(covered.kinds.has(kind), `kind ${kind}`);
  for (const el of ["quick", "form", "marks", "streak", "embed", "meter", "stat", "bars", "line", "heatmap", "table", "list"]) assert.ok(covered.elements.has(el), `element ${el}`);
  assert.ok(fields.some((f) => f.goalType === "max"), "a goal with goalType max");
  assert.ok(tracks.some((t) => t.times && t.per === "week"), "a week quota");
  assert.ok(tracks.some((t) => t.avoid === true), "an avoid habit");
  assert.ok(tracks.some((t) => t.kind === "follow" && t.follows === "ration"), "a follow track over Рацион");
  assert.ok(tracks.some((t) => t.kind === "catalog") && fields.some((f) => f.type === "link"), "a catalog and a link field");
  assert.ok(elements.some((el) => el.where), "a where filter");
  assert.ok(fields.some((f) => f.type === "calc"), "a calc field");
  assert.ok(elements.some((el) => el.of === "ration"), "a classic source chart");
  assert.ok(elements.some((el) => el.el === "embed"), "an embed");
  assert.ok(bundles.some((bundle) => bundle.remove?.length), "a removal");
  assert.ok(EXAMPLES.some((example) => example.after && example.bundle.tracks?.some((t) => !t.kind && !t.name)), "an overlay patch of an existing track");
  for (const type of ["number", "scale", "text", "choice", "yesno", "time", "calc", "link"]) assert.ok(fields.some((f) => f.type === type), `field type ${type}`);
});

// The corpus and the holdout are the exam: the examples may not teach their subjects.
// HOLDOUT_STEMS names, per holdout request, the words that identify its subject. A
// request added to holdout.json without an entry fails the first test below, so the
// decision is never forgotten.
const CORPUS_STEMS = ["вод", "вес", "шаг", "настроен", "бег", "пробеж", "кофе", "витамин", "магни", "антибиот", "сладк", "голодан", "растяж", "уборк", "жим", "сон", "давлен", "рецепт", "замер", "бюджет", "книг", "вишлист", "сыт", "rpe", "омег", "пылесос", "суп"];
const HOLDOUT_STEMS = {
  "h-core-meal-time-spread": [],
  "h-core-sport-by-kind": [],
  "h-cust-homemade": ["домашн", "приготовл"],
  "h-cust-session-place": [],
  "h-sugar-drinks": ["сахар", "напит", "ложк"],
  "h-fruit-veg-portions": ["фрукт", "овощ"],
  "h-plank-30": ["планк", "челлендж"],
  "h-weekly-dinners": ["ужин"],
  "h-swim-sets": ["бассейн", "плав", "заплыв", "дорожк"],
  "h-trip-categories": ["молочк", "мясо", "чек"],
  "h-gift-list": ["подар"],
  "h-spices-restock": ["специ", "докуп"],
  "h-fu-plank-rest-days": [],
  "h-fu-gift-occasion": ["повод"],
  "h-vague-sit-less": ["сидеть", "сидя"],
  "h-refuse-autofill-marks": [],
};
const HOLDOUT_FILE = path.join(here, "../scripts/primitives-lab/holdout.json");
const CORPUS_FILE = path.join(here, "../scripts/primitives-lab/corpus.json");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const requestsOf = (file) => readJson(file).map((item) => item.text || item.request);
// veg is the follow example that tests/kit-logic.test.mjs pins by id and keys. Its pattern, a
// yes/no on each meal, is not the holdout's counter of portions; only the word is shared.
const PINNED = { veg: ["овощ"] };

test("every request of the holdout has an entry in the ban list", () => {
  assert.deepEqual(readJson(HOLDOUT_FILE).map((item) => item.id).sort(), Object.keys(HOLDOUT_STEMS).sort());
});

const textOf = (example) => {
  const bundle = example.bundle || {};
  const tracks = (bundle.tracks || []).flatMap((t) => [t.key, t.name, ...(t.fields || []).flatMap((f) => [f.name, ...(f.options || [])]), ...(t.items || []).map((i) => i.name)]);
  const screens = (bundle.screens || []).flatMap((s) => [s.name, ...(s.cards || []).flatMap((c) => [c.title, c.caption, ...(c.body || []).flatMap((el) => [el.text, el.label])])]);
  return [example.request, example.reply, bundle.name, ...tracks, ...screens].filter(Boolean).join(" ").toLowerCase();
};

test("no example touches a subject of the corpus or of the holdout", () => {
  const banned = [...CORPUS_STEMS, ...Object.values(HOLDOUT_STEMS).flat()];
  const exempt = new Set(["весь", "всего"]);
  for (const example of EXAMPLES) {
    const words = textOf(example).split(/[^a-zа-яё0-9]+/i).filter(Boolean);
    for (const word of words) {
      if (exempt.has(word)) continue;
      const hit = banned.find((stem) => word.startsWith(stem) && !(PINNED[example.id] || []).includes(stem));
      assert.equal(hit, undefined, `${example.id}: «${word}» is a subject of the corpus or the holdout (${hit})`);
    }
  }
});

test("the ban sees a subject of the holdout: the checker is not blind", () => {
  const probe = { id: "probe", request: "Плаваю в бассейне", reply: "Собрал заплыв" };
  const hits = textOf(probe).split(/[^a-zа-яё0-9]+/i).filter((word) => Object.values(HOLDOUT_STEMS).flat().some((stem) => word.startsWith(stem)));
  assert.deepEqual(hits, ["плаваю", "бассейне", "заплыв"]);
});

// -- the manual ---------------------------------------------------------------------------

test("the manual states the rule of every fn, not only its name", () => {
  for (const surface of SURFACES) {
    const text = renderManual(emptyState(), { surface, request: "Хочу вести журнал", today: TODAY });
    for (const [name, doc] of Object.entries(catalogue.FNS)) assert.ok(text.includes(`  ${name}: ${doc}`), `${surface}: the line of fn ${name}`);
    assert.ok(text.includes("avg: среднее по дням с данными: мл, ккал, ₽, мин, км и г сначала суммируются за день, вес, шкала и поле без единицы сначала усредняются за день"), `${surface}: the per-day rule`);
    assert.ok(text.includes("Переставить карточки: у экрана order со списком ключей"), `${surface}: the patch line about order`);
  }
});

test("the manual names every catalogue word, in both surfaces", () => {
  const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  for (const surface of SURFACES) {
    const text = renderManual(emptyState(), { surface, request: "Хочу вести журнал", today: TODAY });
    const name = (word) => (surface === "html" ? kebab(word) : word);
    const mentions = (word, label) => assert.ok(text.includes(word), `${surface}: ${label} «${word}» is not in the manual`);
    for (const kind of catalogue.KIND_KEYS) mentions(`- ${kind} (${catalogue.KINDS[kind].name})`, "kind");
    for (const type of catalogue.FIELD_TYPE_KEYS) mentions(`  ${type}: `, "field type");
    for (const unit of catalogue.UNIT_KEYS) mentions(unit, "unit");
    for (const key of catalogue.ELEMENT_KEYS) {
      const element = catalogue.ELEMENTS[key];
      mentions(`${element.tag === "p" ? "p" : surface === "html" ? element.tag : key}: `, "element");
      for (const attr of Object.keys(element.attrs)) mentions(name(attr), `attribute of ${key}`);
    }
    const asTags = { tracks: "<c-track", screens: "<c-screen", remove: "<c-remove", fields: "<c-field", items: "<c-item", cards: "<c-card", body: "<c-card" };
    for (const attrs of [catalogue.BUNDLE_ATTRS, catalogue.TRACK_ATTRS, catalogue.FIELD_ATTRS, catalogue.ITEM_ATTRS, catalogue.SCREEN_ATTRS, catalogue.CARD_ATTRS]) {
      for (const attr of Object.keys(attrs)) mentions(surface === "html" && asTags[attr] ? asTags[attr] : name(attr), "declaration attribute");
    }
    for (const kind of Object.keys(catalogue.REMOVAL_KINDS)) mentions(kind, "removal");
    for (const range of catalogue.RANGES) mentions(range.token, "range");
    for (const fn of Object.keys(catalogue.FNS)) mentions(fn, "fn");
    for (const [source, info] of Object.entries(catalogue.SOURCES)) {
      mentions(source, "source");
      for (const value of info.values) mentions(value.key, `value of ${source}`);
    }
    for (const value of Object.keys(catalogue.VIRTUAL.marks.values)) mentions(value, "virtual value");
    for (const word of [...Object.keys(catalogue.EVERY.words), ...Object.keys(catalogue.AT.words), ...Object.keys(catalogue.UNMARKED), ...catalogue.STATES, ...Object.keys(catalogue.BY), ...catalogue.CALC_FUNCTIONS]) mentions(word, "vocabulary");
  }
});

test("the html surface round-trips every example through bundleToMarkup and bundleFromMarkup", () => {
  for (const example of EXAMPLES) {
    const answer = example.bundle ? { reply: example.reply, ...example.bundle } : { reply: example.reply };
    const back = bundleFromMarkup(bundleToMarkup(answer));
    assert.deepEqual(back.problems, [], example.id);
    assert.deepEqual(back.bundle, answer, example.id);
    if (example.bundle) assert.equal(checkBundle(back.bundle, spaceOf(example), { today: TODAY }).ok, true, `${example.id}: the markup form passes too`);
  }
});

test("both surfaces print the answer envelope the model must copy: reply first, then the bundle", () => {
  const ski = exampleById("ski");
  assert.match(printAnswer(ski, "json"), /^\{\n "reply": "Собрал «Лыжи»/);
  assert.match(printAnswer(ski, "html"), /^<c-bundle v="2" name="Лыжи">\n  <c-reply>Собрал «Лыжи»/);
  assert.equal(printAnswer(exampleById("creatine-refuse"), "json").includes("\"v\""), false, "a refusal has no bundle");
  assert.match(printAnswer(exampleById("creatine-refuse"), "html"), /^<c-reply>Дозу я не считаю/);
});

test("the examples in the manual follow the request, and a patch example rides along when the space has tracks", () => {
  assert.ok(requestTags("Без алкоголя по будням, отмечать срывы").has("avoid"));
  const habit = pickExamples("Каждый вечер читать, отмечать, что сделал, и видеть серию").map((example) => example.id);
  assert.ok(habit.includes("meditation") || habit.includes("flossing") || habit.includes("dry"), `habit request: ${habit}`);
  const goal = pickExamples("Считать порции, не больше двух в день, кнопка +1").map((example) => example.id);
  assert.ok(goal.includes("shakes"), `goal request: ${goal}`);
  assert.equal(pickExamples("что-нибудь").length, 3);
  assert.equal(pickExamples("что-нибудь").every((example) => !example.after), true, "no patch example for an empty space");
  const patched = pickExamples("Убери график", { patch: true });
  assert.equal(patched.length, 3);
  assert.equal(patched.filter((example) => example.after).length, 1);
  assert.ok(patched.some((example) => example.id === "meditation-remove"), "a removal request gets the removal patch");

  const empty = renderManual(emptyState(), { request: "Считать порции, не больше двух в день", today: TODAY });
  assert.doesNotMatch(empty, /В пространстве уже было/);
  const busy = renderManual(withApps("ski"), { request: "Добавь на главную километры", today: TODAY });
  assert.match(busy, /В пространстве уже было/);
  assert.match(busy, /Просьба: «Добавь на главную километры за неделю»/);
});

test("the manual carries the person's space and the request, and the surfaces differ in syntax only", () => {
  const state = withApps("ski");
  const json = renderManual(state, { surface: "json", request: "Убери график", today: TODAY });
  const html = renderManual(state, { surface: "html", request: "Убери график", today: TODAY });
  assert.match(json, /ПРОСЬБА ЧЕЛОВЕКА\n«Убери график»/);
  assert.match(html, /ПРОСЬБА ЧЕЛОВЕКА\n«Убери график»/);
  assert.ok(/"key":"ski"/.test(json), "the space is printed as JSON");
  assert.ok(/<c-track key="ski"/.test(html), "the space is printed as markup");
  assert.doesNotMatch(html, /\{"el":/, "no JSON elements in the markup surface");
  assert.doesNotMatch(json, /<c-meter/, "no markup elements in the JSON surface");
  assert.ok(/goalType/.test(json));
  assert.ok(/goal-type/.test(html));
});

test("the reference for the assistant has no person-specific parts", () => {
  const reference = renderReference("json");
  assert.doesNotMatch(reference, /ПРОСЬБА ЧЕЛОВЕКА|ПРОСТРАНСТВО ЧЕЛОВЕКА|Пример 1/);
  assert.match(reference, /ЭЛЕМЕНТЫ КАРТОЧКИ/);
  assert.ok(estimateTokens(reference) < MANUAL_BUDGET.cap);
});

// Each "wrong" line of the manual is a real mistake the validator names, and the "right" line is the node of a passing example.
test("every mistake of the manual fails the validator with its rule, and the fix passes", () => {
  assert.ok(MISTAKES.length >= 4);
  for (const mistake of MISTAKES) {
    const example = exampleById(mistake.base);
    const state = spaceOf(example);
    const bundle = clone(example.bundle);
    const parent = mistake.at.slice(0, -1).reduce((node, key) => node[key], bundle);
    parent[mistake.at.at(-1)] = clone(mistake.wrong);
    const checked = checkBundle(bundle, state, { today: TODAY });
    assert.equal(checked.ok, false, `${mistake.id}: the wrong form passes`);
    assert.ok(checked.problems.some((problem) => problem.rule === mistake.rule), `${mistake.id}: expected rule ${mistake.rule}, got ${JSON.stringify(checked.problems.map((p) => p.rule))}`);
    assert.equal(checkBundle(example.bundle, state, { today: TODAY }).ok, true, `${mistake.id}: the right form passes`);
  }
});

// -- the loop ---------------------------------------------------------------------------------

const SHAKES = exampleById("shakes");
const answerOf = (bundle, reply = SHAKES.reply) => JSON.stringify({ reply, ...bundle });

test("authorBundle: a good first answer is one attempt, with the checked result and the reply", async () => {
  const provider = createMockProvider(() => answerOf(SHAKES.bundle));
  const result = await authorBundle({ provider, state: emptyState(), request: SHAKES.request, today: TODAY });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
  assert.equal(result.reply, SHAKES.reply);
  assert.equal(result.checked.ok, true);
  assert.ok(result.checked.rows.length > 0, "the change rows are there");
  const sent = provider.requests[0];
  assert.equal(sent.messages[0].role, "system");
  assert.match(sent.messages[0].content, /ПРОСЬБА ЧЕЛОВЕКА/);
  assert.equal(sent.messages.at(-1).content, SHAKES.request);
  assert.deepEqual(sent.responseFormat, { type: "json_object" }, "JSON surface asks for a JSON object");
});

test("authorBundle: two mistakes are sent back as one repair message with the first failing layer only", async () => {
  const state = emptyState();
  const slips = clone(SHAKES.bundle);
  slips.screens[0].cards[0].body[0].of = "shake";
  slips.tracks[0].fields[1].unit = "литры";
  const second = checkBundle(slips, state, { today: TODAY });
  assert.equal(second.ok, false);
  const provider = createMockProvider((_request, index) => answerOf(index === 0 ? slips : SHAKES.bundle));
  const result = await authorBundle({ provider, state, request: SHAKES.request, today: TODAY });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  const repair = provider.requests[1].messages.at(-1);
  assert.equal(repair.role, "user");
  for (const problem of second.problems) assert.ok(repair.content.includes(problem.message), `the repair names: ${problem.message}`);
  assert.ok(repair.content.includes("«литры»"), "the first failing pass is named");
  assert.ok(!repair.content.includes("Трека «shake» нет"), "the problem of the next pass waits for its turn");
  assert.equal(provider.requests[1].messages.at(-2).role, "assistant", "the wrong answer stays in the conversation");
});

test("authorBundle: the repair message holds only the problems of the first failing layer", () => {
  const layerOne = [{ path: "screens.home.cards.shakes_today.body.0.of", rule: "of-unknown", message: "Трека «shake» нет." }];
  const message = repairMessage({ layer: 1, problems: layerOne, changes: ["Цель перенесена на поле."] });
  assert.match(message, /Трека «shake» нет\./);
  assert.match(message, /Цель перенесена на поле\./, "the normalizer's changes ride along");
  assert.equal(message.split("\n").filter((line) => /^\d+\./.test(line)).length, 1);
  const many = Array.from({ length: 9 }, (_, index) => ({ path: `p${index}`, rule: "x", message: `проблема ${index}` }));
  assert.equal(repairMessage({ layer: 1, problems: many }).split("\n").filter((line) => /^\d+\./.test(line)).length, 6, "at most six problems");
});

test("authorBundle: a refusal is an answer, not a failure, and needs no repair", async () => {
  const refusal = exampleById("creatine-refuse");
  const provider = createMockProvider(() => JSON.stringify({ reply: refusal.reply }));
  const result = await authorBundle({ provider, state: emptyState(), request: refusal.request, today: TODAY });
  assert.equal(result.ok, true);
  assert.equal(result.checked, null);
  assert.equal(result.reply, refusal.reply);
  assert.equal(result.attempts, 1);
});

test("authorBundle: the number of the request may stand in the words of the answer, one the request lacks is repaired", async () => {
  const titled = clone(SHAKES.bundle);
  titled.screens[0].cards[0].title = "Пить 8 порций";
  const provider = createMockProvider(() => answerOf(titled));
  const asked = await authorBundle({ provider, state: emptyState(), request: "считай протеиновые коктейли, хочу 8 порций", today: TODAY });
  assert.equal(asked.ok, true, JSON.stringify(asked.problems));
  assert.equal(asked.attempts, 1);

  const repaired = createMockProvider((_request, index) => answerOf(index === 0 ? titled : SHAKES.bundle));
  const result = await authorBundle({ provider: repaired, state: emptyState(), request: SHAKES.request, today: TODAY });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.match(repaired.requests[1].messages.at(-1).content, /число 8/);
});

test("authorBundle: the words of a refusal pass the number rule too", async () => {
  const provider = createMockProvider((_request, index) => JSON.stringify({ reply: index === 0 ? "Вы съели 3000 ккал, это много." : "Это много, но число назвать не могу." }));
  const result = await authorBundle({ provider, state: emptyState(), request: "много ли я ем", today: TODAY });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.checked, null);
  assert.match(provider.requests[1].messages.at(-1).content, /число 3000/);
});

test("authorBundle: after the last repair the failure is honest and carries the problems", async () => {
  const bad = clone(SHAKES.bundle);
  bad.screens[0].cards[0].body[0].of = "shake";
  const provider = createMockProvider(() => answerOf(bad));
  const result = await authorBundle({ provider, state: emptyState(), request: SHAKES.request, today: TODAY, maxRepairs: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 3);
  assert.equal(provider.requests.length, 3);
  assert.ok(result.problems.length > 0);
  assert.equal(result.checked?.ok, false);
});

test("authorBundle: text that is not JSON gets a parse repair, a provider failure is passed on", async () => {
  const provider = createMockProvider((_request, index) => (index === 0 ? "Конечно, сейчас соберу!" : answerOf(SHAKES.bundle)));
  const result = await authorBundle({ provider, state: emptyState(), request: SHAKES.request, today: TODAY });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.match(provider.requests[1].messages.at(-1).content, /JSON/);
  const down = createMockProvider(() => { throw new Error("x"); });
  const failed = await authorBundle({ provider: down, state: emptyState(), request: "x", today: TODAY });
  assert.equal(failed.ok, false);
  assert.ok(failed.reason);
});

test("authorBundle on the html surface parses markup and repairs through the same checks", async () => {
  const bad = bundleToMarkup({ reply: SHAKES.reply, ...SHAKES.bundle }).replace('of="shakes" value="portions"/>', 'of="shake" value="portions"/>');
  const good = bundleToMarkup({ reply: SHAKES.reply, ...SHAKES.bundle });
  const provider = createMockProvider((_request, index) => (index === 0 ? bad : good));
  const result = await authorBundle({ provider, state: emptyState(), request: SHAKES.request, surface: "html", today: TODAY });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(provider.requests[0].responseFormat, undefined, "markup is not a JSON object");
  assert.match(provider.requests[0].messages[0].content, /<c-bundle v="2"/);
  const refusal = createMockProvider(() => "<c-reply>Дозу я не считаю.</c-reply>");
  const refused = await authorBundle({ provider: refusal, state: emptyState(), request: "x", surface: "html", today: TODAY });
  assert.equal(refused.ok, true);
  assert.equal(refused.checked, null);
  assert.equal(refused.reply, "Дозу я не считаю.");
});

// -- the samples ------------------------------------------------------------------------------

test("a sample for every field type and every element, and each passes the validator", () => {
  assert.deepEqual(Object.keys(FIELD_SAMPLES).sort(), [...catalogue.FIELD_TYPE_KEYS].sort());
  assert.deepEqual(Object.keys(ELEMENT_SAMPLES).sort(), [...catalogue.ELEMENT_KEYS].sort());
  const state = withApps("ski", "shakes", "meditation", "rides", "flossing", "gymbag");
  const cards = Object.entries(ELEMENT_SAMPLES).map(([key, el]) => ({ key: `sample_${key}`, title: "Образец", body: [el] }));
  const onHome = checkBundle({ v: 2, name: "Образцы", screens: [{ key: "home", cards: cards.slice(0, 8) }, { key: "samples", name: "Образцы", cards: cards.slice(8) }] }, state, { today: TODAY });
  assert.equal(onHome.ok, true, JSON.stringify(onHome.problems));
  const S = FIELD_SAMPLES;
  const host = {
    v: 2,
    name: "Образцы полей",
    tracks: [
      { key: "sample_a", name: "Образец А", kind: "log", fields: [{ key: "rounds", name: "Кругов", type: "number" }, { key: "lap", name: "Длина круга", type: "number" }, S.calc, S.number, S.scale, S.text, S.choice, S.yesno] },
      { key: "sample_b", name: "Образец Б", kind: "log", fields: [S.date, S.time, S.link] },
    ],
  };
  const fields = checkBundle(host, state, { today: TODAY });
  assert.equal(fields.ok, true, JSON.stringify(fields.problems));
});

// The manual is read by a model that is graded on the corpus: no line of it may hand out an answer.
test("the reference text and its samples name no subject of the corpus", () => {
  const banned = [
    /\bвод[аыуе]\b|\bwater\b|\bml\b/, /\bвес(а|у|ом|е)?\b|\bweight\b|\bkg\b/, /настроени|\bmood\b/, /пробеж|\bбег(а|у|ом)?\b/, /кофе/, /витамин|магни|vitamin/, /антибиот/, /сладк/,
    /голодан/, /растяж/, /уборк|пылесос/, /заготовк/, /\bжим\b|bench|\bsets\b|\breps\b/, /\bсон\b|\bсна\b|\bsleep\b|выспал|\blay\b|\bwoke\b/, /давлен|пульс/, /рецепт(?! трека)/, /замер/, /бюджет/,
    /книг/, /вишлист/, /сытост|насколько сыт|голоден/, /\brpe\b/, /омег/,
    // the holdout
    /планк|челлендж/, /подар/, /специ[йяюи]/, /сахар|напитк|ложк/, /фрукт|овощ/, /ужин/, /бассейн|плава|заплыв|дорожк/, /молочк/, /сидеть|сидя/, /домашн|приготовл/,
  ];
  const skip = /^(unit:|Источники|Столбцы|Функции|Величины)/;
  for (const surface of SURFACES) {
    const lines = renderReference(surface).split("\n").filter((line) => !skip.test(line.trim()));
    for (const line of lines) {
      const hit = banned.find((pattern) => pattern.test(line.toLowerCase()));
      assert.equal(hit, undefined, `${surface}: «${line.slice(0, 120)}» hands out a corpus subject (${hit})`);
    }
  }
});

test("the manual explains the blocks of embed, the calc functions and the classic values", () => {
  const text = renderManual(emptyState(), { request: "x", today: TODAY });
  for (const value of catalogue.ELEMENTS.embed.attrs.what.values) assert.ok(EMBED_NOTES[value], `embed ${value} has a note`);
  assert.ok(text.includes("ration-today (приёмы пищи сегодня с отметками)"));
  for (const name of catalogue.CALC_FUNCTIONS) assert.ok(CALC_DOCS[name], `calc function ${name} has a line`);
  assert.ok(text.includes("spanHours(от, до): часы между двумя временами ЧЧ:ММ, через полночь тоже"));
  for (const source of Object.values(catalogue.SOURCES)) for (const value of source.values) assert.ok(text.includes(`${value.key} (`), `source value ${value.key} is described`);
  assert.ok(text.includes("kcal_planned (ккал по плану)"));
});

test("the space section gives the dates a model would count wrongly", () => {
  const text = renderManual(emptyState(), { request: "x", today: TODAY });
  assert.ok(text.includes("Сегодня 2026-10-24, суббота. Даты вперёд: +1 д. 2026-10-25, +2 д. 2026-10-26, +3 д. 2026-10-27, +6 д. 2026-10-30, +7 д. 2026-10-31, +13 д. 2026-11-06, +14 д. 2026-11-07, +29 д. 2026-11-22, +30 д. 2026-11-23."));
  assert.ok(!renderManual(emptyState(), { request: "x" }).includes("Даты вперёд"), "no dates without a today");
});

test("a space that has grown for a long time shrinks to keys and still fits the cap", () => {
  const apply = (state, bundle) => {
    const store = openObjectStore({ storage: null, today: () => TODAY });
    store.replaceAll(state);
    const checked = checkBundle(bundle, state, { today: TODAY });
    assert.equal(checked.ok, true, JSON.stringify(checked.problems));
    assert.equal(applyBundle(store, checked).ok, true);
    return store.state();
  };
  let state = emptyState();
  for (let n = 1; n <= 24; n += 1) {
    state = apply(state, {
      v: 2,
      name: `Счётчик ${n}`,
      tracks: [{ key: `count_${n}`, name: `Счётчик номер ${n}`, kind: "log", fields: [{ key: "times", name: "Раз", type: "number", unit: "раз", min: 1, max: 20, goal: 3, goalType: "max" }, { key: "note", name: "Заметка", type: "text" }] }],
      screens: [{ key: "home", cards: [{ key: `count_${n}_today`, title: `Счётчик ${n} сегодня`, body: [{ el: "meter", of: `count_${n}`, value: "times" }, { el: "quick", of: `count_${n}`, values: { times: 1 } }] }] }],
    });
  }
  for (const surface of SURFACES) {
    const parts = manualParts(state, { surface, request: "добавь ещё один", today: TODAY });
    const space = parts.find((part) => part.id === "space").text;
    assert.ok(space.length <= SPACE_CHARS + 400, `${surface}: the space section is ${space.length} characters`);
    for (let n = 1; n <= 24; n += 1) assert.ok(space.includes(`count_${n}_today`), `${surface}: the card key count_${n}_today survives`);
    assert.ok(estimateTokens(renderManual(state, { surface, request: "добавь ещё один", today: TODAY })) <= MANUAL_BUDGET.cap);
  }
});

// -- the budget -------------------------------------------------------------------------------

test("a typical prompt fits the target for every request of the corpus and the holdout, a grown space fits the cap, in both surfaces", () => {
  const requests = [...requestsOf(CORPUS_FILE), ...requestsOf(HOLDOUT_FILE)];
  assert.ok(requests.length >= 60, `${requests.length} requests`);
  const busy = withApps("shakes", "meditation", "ski", "rides");
  const sizes = {};
  for (const surface of SURFACES) {
    for (const [name, state] of Object.entries({ empty: emptyState(), demo: buildDemoState(TODAY) })) {
      const worst = Math.max(...requests.map((request) => estimateTokens(renderManual(state, { surface, request, today: TODAY }))));
      sizes[`${surface}/${name}`] = worst;
      assert.ok(worst <= MANUAL_BUDGET.target, `${surface}/${name}: ${worst} tokens is over the target ${MANUAL_BUDGET.target}`);
    }
    const tokens = estimateTokens(renderManual(busy, { surface, request: "Хочу считать порции, цель не больше двух", today: TODAY }));
    sizes[`${surface}/busy`] = tokens;
    assert.ok(tokens <= MANUAL_BUDGET.cap, `${surface}/busy: ${tokens} tokens is over the cap ${MANUAL_BUDGET.cap}`);
  }
  console.log("manual tokens, worst request of the corpus and the holdout (chars / 3.2):", JSON.stringify(sizes));
});

// -- the decision rows -------------------------------------------------------------------------

test("every decision row names a wish, a rule and pieces cut from checked answers; the literal pieces pass checkBundle on the demo space", () => {
  assert.ok(DECISIONS.length >= 18, `${DECISIONS.length} rows`);
  assert.equal(new Set(DECISIONS.map((row) => row.id)).size, DECISIONS.length);
  const required = ["week-count", "missed", "weekdays", "month", "frequency", "plan-fact", "course", "money-left", "pace", "week-avg", "ask-at-mark", "plan-per-item", "last-delta", "expiring", "edit-search", "one-record", "own-date", "catalog-or-list", "shopping", "streak", "honest"];
  assert.deepEqual(DECISIONS.map((row) => row.id).sort(), required.sort());
  for (const row of DECISIONS) {
    assert.match(row.wish, /[а-яё]/i, row.id);
    assert.match(row.say, /[а-яё]/i, row.id);
    for (const token of row.say.match(/@\w+/g) || []) assert.equal(catalogue.isRange(token), true, `${row.id}: ${token} is not in the range grammar`);
    for (const piece of row.show) {
      const { kind, node } = pieceNode(piece);
      assert.ok(node && typeof node === "object", `${row.id}: the piece is gone`);
      if (piece.base) {
        const example = exampleById(piece.base);
        assert.equal(checkBundle(example.bundle, spaceOf(example), { today: TODAY }).ok, true, `${row.id}: example ${piece.base} must pass`);
        if (kind === "attrs") for (const name of piece.attrs) assert.notEqual(node[name], undefined, `${row.id}: ${name} is not written in the example`);
      } else {
        const card = { key: "row_check", title: "Проверка", body: [node] };
        const checked = checkBundle({ v: 2, name: "Строка", screens: [{ key: "home", cards: [card] }] }, buildDemoState(TODAY), { today: TODAY });
        assert.equal(checked.ok, true, `${row.id}: ${JSON.stringify(checked.problems)}`);
        assert.deepEqual(checked.changes, [], row.id);
      }
    }
  }
});

test("the manual prints every decision row with its pieces, in the syntax of the surface", () => {
  for (const surface of SURFACES) {
    const wish = manualParts(emptyState(), { surface, request: "x", today: TODAY }).find((part) => part.id === "wish").text;
    for (const row of DECISIONS) {
      assert.ok(wish.includes(`«${row.wish}»: ${row.say}`), `${surface}: the row ${row.id}`);
      for (const piece of row.show) {
        const { kind, node } = pieceNode(piece);
        if (kind === "el") assert.ok(wish.includes(snippet("el", node, surface)), `${surface}: ${row.id} shows ${node.el}`);
        else for (const name of piece.attrs) assert.ok(wish.includes(surface === "html" ? `${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${node[name]}"` : `"${name}":${JSON.stringify(node[name])}`), `${surface}: ${row.id} shows ${name}`);
      }
    }
    if (surface === "html") assert.doesNotMatch(wish, /\{"el":/, "no JSON elements in the markup rows");
    else assert.doesNotMatch(wish, /<c-stat|<c-bars|<c-meter/, "no markup elements in the JSON rows");
  }
});

test("the examples carry every pattern the rows teach", () => {
  const bundles = EXAMPLES.filter((example) => example.bundle).map((example) => example.bundle);
  const tracks = bundles.flatMap((bundle) => bundle.tracks || []);
  const els = bundles.flatMap((bundle) => (bundle.screens || []).flatMap((screen) => (screen.cards || []).flatMap((card) => card.body || [])));
  const has = (test, label) => assert.ok(els.some(test), label);
  has((el) => el.el === "bars" && el.fn === "count" && !["day", "week", "month"].includes(el.by) && el.by, "bars by a choice field");
  has((el) => el.el === "stat" && el.rows === "items" && el.where?.state === "open", "remaining sum over open items");
  has((el) => el.pace === "left", "pace left");
  has((el) => el.el === "meter" && el.goal === "due" && el.range === "@all", "course meter");
  has((el) => el.fn === "last", "fn last");
  has((el) => el.fn === "delta", "fn delta");
  has((el) => el.edit === true && el.search === true, "edit and search");
  has((el) => Object.values(el.where || {}).some((value) => /^<=\+\d+d$/.test(value)), "where with an operator and a relative day");
  has((el) => el.range === "@thisWeek" && el.value === "done", "weekly count");
  has((el) => el.range === "@thisWeek" && el.value === "skipped", "weekly skips");
  has((el) => el.range === "@thisMonth", "this month");
  assert.ok(tracks.some((track) => track.unmarked === "missed"), "unmarked missed");
  assert.ok(tracks.some((track) => (track.items || []).some((item) => /^[a-z]{3}(,[a-z]{3})+$/.test(item.every || ""))), "a list of weekdays");
  assert.ok(tracks.some((track) => (track.items || []).some((item) => item.until)), "an item with until");
  assert.ok(tracks.some((track) => track.kind === "list" && (track.fields || []).some((field) => field.planned && field.unit === "₽")), "a list with a planned price");
  assert.ok(tracks.some((track) => (track.fields || []).some((field) => field.goalType === "max" && field.goalPer === "month")), "a monthly limit");
});

// The rows promise behaviour; the examples they point at must keep the promise on a real space.
const TOOLS = {
  open(id, { created = TODAY } = {}) {
    const store = openObjectStore({ storage: null, today: () => TODAY });
    const checked = checkBundle(exampleById(id).bundle, store.state(), { today: created });
    assert.equal(checked.ok, true, JSON.stringify(checked.problems));
    assert.equal(applyBundle(store, checked).ok, true);
    return store;
  },
  person(store, ops) {
    const result = store.apply(ops, { actor: "human" });
    assert.equal(result.ok, true, result.reason);
  },
  card: (id, key, at = 0) => exampleById(id).bundle.screens.flatMap((screen) => screen.cards).find((card) => card.key === key).body[at],
  read: (store, el) => resolveBinding(store.state(), el, { today: TODAY }),
};

test("a habit that counts a missed day: unmarked missed turns an unmarked due day into a skip, and without it the skip is not counted", () => {
  const run = (bundle) => {
    const store = openObjectStore({ storage: null, today: () => TODAY });
    const checked = checkBundle(bundle, store.state(), { today: "2026-10-19" });
    assert.equal(checked.ok, true, JSON.stringify(checked.problems));
    applyBundle(store, checked);
    const item = Object.values(store.state().objects).find((object) => object.type === "track_item").props.kit_key;
    TOOLS.person(store, markOps(store.state(), "plants", { item, state: "done", date: "2026-10-20", today: TODAY }));
    return ["done", "skipped"].map((value) => TOOLS.read(store, { el: "stat", of: "plants", value, range: "@thisWeek" }).value);
  };
  const example = exampleById("plants").bundle;
  assert.deepEqual(run(example), [1, 1], "Tuesday done, Friday unmarked and counted as missed");
  const lenient = clone(example);
  delete lenient.tracks[0].unmarked;
  assert.deepEqual(run(lenient), [1, 0], "the default policy leaves Friday uncounted");
});

test("frequency per option, remaining money, course progress and the monthly pace read as the rows say", () => {
  const walks = TOOLS.open("walks");
  for (const [place, mins] of [["парк", 30], ["парк", 40], ["двор", 20], ["набережная", 50]]) TOOLS.person(walks, formOps(walks.state(), "walks", { place, mins }, { today: TODAY }));
  const bars = TOOLS.read(walks, TOOLS.card("walks", "walks_places"));
  assert.deepEqual([bars.buckets, bars.series[0].values], [["парк", "набережная", "двор"], [2, 1, 1]]);
  assert.equal(TOOLS.read(walks, TOOLS.card("walks", "walks_month")).value, 140);

  const repair = TOOLS.open("repair");
  assert.equal(TOOLS.read(repair, TOOLS.card("repair", "repair_left")).value, 20600);
  TOOLS.person(repair, markOps(repair.state(), "repair", { item: "kraska", state: "done", today: TODAY }));
  assert.equal(TOOLS.read(repair, TOOLS.card("repair", "repair_left")).value, 17100, "a bought item leaves the remaining sum");

  const exam = TOOLS.open("exam");
  const course = TOOLS.read(exam, TOOLS.card("exam", "exam_today", 1));
  assert.deepEqual([course.value, course.goal], [0, 14], "fourteen evenings from today to the last day");
  TOOLS.person(exam, markOps(exam.state(), "exam", { item: "zanyatie", state: "done", today: TODAY }));
  assert.equal(TOOLS.read(exam, TOOLS.card("exam", "exam_today", 1)).value, 1);

  const taxi = TOOLS.open("taxi");
  TOOLS.person(taxi, formOps(taxi.state(), "taxi", { fare: 700 }, { today: TODAY }));
  const pace = TOOLS.read(taxi, TOOLS.card("taxi", "taxi_month", 0)).pace;
  assert.deepEqual([pace.left, pace.daysLeft, pace.perDay, pace.text.replace(/\s/g, " ")], [4300, 8, 537, "можно ещё 537 ₽ в день"]);
});

test("the latest value, the change over the period and the expiring rows read as the rows say", () => {
  const odo = TOOLS.open("odo");
  TOOLS.person(odo, formOps(odo.state(), "odo", { reading: 100000 }, { today: TODAY, date: "2026-10-05" }));
  TOOLS.person(odo, formOps(odo.state(), "odo", { reading: 100200 }, { today: TODAY }));
  assert.equal(TOOLS.read(odo, TOOLS.card("odo", "odo_last")).value, 100200);
  assert.equal(TOOLS.read(odo, TOOLS.card("odo", "odo_month")).value, 200);

  const docs = TOOLS.open("docs");
  TOOLS.person(docs, addItemOps(docs.state(), "docs", { name: "Загранпаспорт", plan: { expires: "2026-12-01" } }, { today: TODAY }));
  TOOLS.person(docs, addItemOps(docs.state(), "docs", { name: "Полис", plan: { expires: "2027-06-01" } }, { today: TODAY }));
  TOOLS.person(docs, itemOps(docs.state(), "ti_docs_prava", { plan: { expires: "2026-11-15" } }, { today: TODAY }));
  const soon = TOOLS.read(docs, TOOLS.card("docs", "docs_soon"));
  assert.deepEqual(soon.rows.map((row) => row.cells.map((cell) => cell.text)), [["Права", "15 ноя"], ["Загранпаспорт", "1 дек"]], "within sixty days, soonest first; the row of 2027 and the rows without a date stay out");
  assert.equal(TOOLS.read(docs, TOOLS.card("docs", "docs_all")).total, 5);
});

// -- the vocabulary ----------------------------------------------------------------------------

test("the manual prints the range grammar with its examples, the by values, the where operators and the values of every enum attribute", () => {
  for (const surface of SURFACES) {
    const text = renderManual(emptyState(), { surface, request: "x", today: TODAY });
    for (const range of catalogue.RANGES) {
      assert.ok(text.includes(range.token), `${surface}: ${range.token}`);
      for (const example of range.examples) assert.ok(text.includes(example), `${surface}: ${example}`);
      assert.ok(text.includes(range.doc.split(";")[0]), `${surface}: the meaning of ${range.token}`);
    }
    for (const word of Object.keys(catalogue.BY_WORDS)) assert.ok(text.includes(`${word} (${catalogue.BY_WORDS[word]})`), `${surface}: by ${word}`);
    for (const type of catalogue.BY_FIELD_TYPES) assert.ok(text.includes(type), `${surface}: by a ${type} field`);
    for (const op of Object.keys(catalogue.WHERE_OPS)) assert.ok(text.includes(op), `${surface}: operator ${op}`);
    for (const key of Object.keys(catalogue.WHERE_KEYS)) assert.ok(text.includes(key), `${surface}: where key ${key}`);
    for (const state of catalogue.WHERE_STATES) assert.ok(text.includes(state), `${surface}: where state ${state}`);
    for (const element of Object.values(catalogue.ELEMENTS)) {
      for (const [name, attr] of Object.entries(element.attrs)) {
        if (attr.type === "enum") for (const value of attr.values) assert.ok(text.includes(String(value)), `${surface}: ${name}=${value}`);
      }
    }
    assert.ok(text.includes("rows") && text.includes("pace") && text.includes("goal"), `${surface}: rows, pace, goal`);
  }
});

test("the wording about the streak states what the engine does, and the rules do not contradict the kit", () => {
  for (const surface of SURFACES) {
    const text = renderManual(emptyState(), { surface, request: "x", today: TODAY });
    assert.doesNotMatch(text, /срыв не обнуляет всё/, "the vague line of the catalogue is not printed");
    assert.ok(text.includes("при grace 0 срыв начинает её заново"), `${surface}: the element line`);
    assert.ok(text.includes("При grace 0 срыв начинает текущую серию заново, лучшая и доля за 30 дней остаются"), `${surface}: the decision row`);
    assert.doesNotMatch(text, /уведомлений, поиска/, "search exists now");
    assert.ok(text.includes("переставить можно order у экрана"), `${surface}: the rule about moving cards agrees with order`);
    assert.doesNotMatch(text, /убери карточку \(remove\) и объяви её заново/, "the old way of moving a card is gone");
    assert.ok(text.includes("Обещай в reply только то, что показывают карточки ответа"), `${surface}: the honesty rule`);
  }
});

// -- the defaults ---------------------------------------------------------------------------------

const D = (id) => defaultsFor(DEFAULT_CASES.find((c) => `${c.kind}, ${c.when}` === id).track);
const names = (list) => list.map((el) => el.el);

test("defaults on a fresh track: a log gets its input, its chart, the latest value with the change, and recent entries to edit", () => {
  const accumulating = D("log, число копится за день");
  assert.deepEqual([names(accumulating.home), names(accumulating.own)], [["meter", "form"], ["bars", "list"]]);
  assert.deepEqual(accumulating.own[0], { el: "bars", of: "demo", value: "n", fn: "sum", range: "@last7d" });
  assert.deepEqual(accumulating.own[1], { el: "list", of: "demo", columns: ["date", "n"], limit: 5, range: "@last30d", edit: true });

  const counter = D("log, один счётчик (порц., шт., раз)");
  assert.deepEqual(names(counter.home), ["meter", "quick", "form"]);
  assert.deepEqual(counter.home[1], { el: "quick", of: "demo", values: { n: 1 } });

  const measure = D("log, измерение без цели (температура, рост)");
  assert.deepEqual([names(measure.home), names(measure.own)], [["form"], ["line", "stat", "stat", "list"]]);
  assert.deepEqual(measure.own.slice(0, 3), [
    { el: "line", of: "demo", value: "n", fn: "avg", range: "@last30d" },
    { el: "stat", of: "demo", value: "n", fn: "last", range: "@all" },
    { el: "stat", of: "demo", value: "n", fn: "delta", range: "@last30d" },
  ]);
  assert.equal(measure.own[3].edit, true);
});

test("defaults on a fresh track: a habit gets marks, a streak and bars of done per day, a course also a progress meter, never a long heatmap", () => {
  const plain = D("habit, обычная");
  assert.deepEqual([names(plain.home), names(plain.own)], [["marks"], ["streak", "bars"]]);
  assert.deepEqual(plain.own[1], { el: "bars", of: "demo", value: "done", fn: "sum", range: "@last14d" });
  const course = D("habit, у пункта есть until (курс)");
  assert.deepEqual([names(course.home), names(course.own)], [["marks", "meter"], ["streak", "bars"]]);
  assert.deepEqual(course.home[1], { el: "meter", of: "demo", value: "done", goal: "due", range: "@all" });
  for (const shown of [plain, course]) assert.equal([...shown.home, ...shown.own].some((el) => el.el === "heatmap"), false);
});

test("defaults on a fresh track: a list, a catalog and a follow track", () => {
  const plain = D("list, обычный");
  assert.deepEqual([names(plain.home), names(plain.own)], [["stat"], ["marks"]]);
  assert.equal(plain.own[0].add, true);
  const priced = D("list, в поле ₽ planned: true");
  assert.deepEqual(names(priced.own), ["marks", "stat", "stat"]);
  assert.deepEqual(priced.own[1], { el: "stat", of: "demo", value: "n", fn: "sum", rows: "items", where: { state: "open" }, range: "@all" });

  const catalog = D("catalog, любой");
  assert.deepEqual([catalog.home, names(catalog.own)], [[], ["list"]]);
  assert.deepEqual([catalog.own[0].add, catalog.own[0].edit, catalog.own[0].search], [true, true, true]);

  const plainFollow = D("follow, есть поле-число");
  assert.deepEqual([names(plainFollow.home), names(plainFollow.own)], [["marks"], ["line", "table"]]);
  const choice = D("follow, есть поле choice");
  assert.deepEqual([names(choice.home), names(choice.own)], [["marks"], ["bars", "table"]]);
  assert.deepEqual(choice.own[0], { el: "bars", of: "demo", by: "feel", fn: "count", range: "@last30d" });
});

test("every default case passes checkBundle on its own, and the manual prints the table from the same function", () => {
  const defaults = manualParts(emptyState(), { request: "x" }).find((part) => part.id === "defaults").text;
  for (const { kind, when, track } of DEFAULT_CASES) {
    const checked = checkBundle({ v: 2, name: "Демо", tracks: [{ key: "demo", name: "Демо", ...track }] }, emptyState(), { today: TODAY });
    assert.equal(checked.ok, true, `${kind}, ${when}: ${JSON.stringify(checked.problems)}`);
    const shown = defaultsFor(track);
    assert.ok(defaults.includes(`- ${kind}, ${when}: на главную ${shown.home.length ? shown.home.map((el) => el.el).join(", ") : "ничего"}`), `${kind}, ${when}: the table line`);
  }
  assert.equal(DEFAULT_CASES.length, 10);
  assert.match(defaults, /- habit, у пункта есть until \(курс\): на главную marks, meter \(goal due\)/);
  assert.match(defaults, /Если карточка есть только на главной, экран трека с историей приложение добавит всё равно/);
});

test("a track the bundle names only on home still gets its own screen with history; a track with a screen of its own gets nothing added", () => {
  const spec = readSpec(emptyState());
  const track = { key: "t1", name: "Трек", kind: "follow", follows: "ration", fields: [{ key: "lvl", name: "Уровень", type: "scale" }] };
  const onHome = { v: 2, name: "Т", tracks: [track], screens: [{ key: "home", cards: [{ key: "t1_form", title: "Уровень", body: [{ el: "marks", of: "t1" }] }] }] };
  const expanded = expandDefaults(spec, onHome, { today: TODAY });
  assert.deepEqual(expanded.screens.map((screen) => [screen.key, screen.cards.map((card) => card.key)]), [["home", ["t1_form"]], ["t1", ["t1_trend", "t1_last"]]]);
  assert.equal(expanded.screens[1].name, "Трек", "the screen is named after the track");
  const checked = checkBundle(onHome, emptyState(), { today: TODAY });
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
  assert.ok(Object.values(checked.spec.cards).some((card) => card.key === "t1_last" && card.screen === "t1"), "the history card is in the spec");

  const withScreen = { ...onHome, screens: [{ key: "t1", name: "Трек", cards: [{ key: "t1_all", title: "Все", body: [{ el: "table", of: "t1", columns: ["date", "slot"], range: "@last30d" }] }] }] };
  assert.deepEqual(expandDefaults(spec, withScreen, { today: TODAY }).screens.map((screen) => [screen.key, screen.cards.map((card) => card.key)]), [["t1", ["t1_all"]]], "nothing is added to a track that has its place");
});

test("defaults never push a valid answer over the limits of screens and cards", () => {
  const spec = readSpec(emptyState());
  const tracks = [1, 2, 3, 4].map((n) => ({ key: `c${n}`, name: `Счёт ${n}`, kind: "log", fields: [{ key: "n", name: "Раз", type: "number", unit: "раз", min: 1, max: 20 }] }));
  const bundle = { v: 2, name: "Счета", tracks, screens: [{ key: "home", cards: tracks.map((t) => ({ key: `${t.key}_add`, title: t.name, body: [{ el: "form", of: t.key }] })) }] };
  const expanded = expandDefaults(spec, bundle, { today: TODAY });
  assert.ok(expanded.screens.length <= catalogue.LIMITS.screens, `${expanded.screens.length} screens`);
  assert.deepEqual(expanded.screens.map((screen) => screen.key), ["home", "c1", "c2", "c3"], "the fourth track keeps its home card and goes without a screen of its own");
  const checked = checkBundle(bundle, emptyState(), { today: TODAY });
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
});
