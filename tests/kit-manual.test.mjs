import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { authorBundle, repairMessage } from "../mobile-shell/objects/kit/author.js";
import * as catalogue from "../mobile-shell/objects/kit/catalogue.js";
import { EXAMPLES, exampleById } from "../mobile-shell/objects/kit/examples/index.js";
import { CALC_DOCS, ELEMENT_SAMPLES, EMBED_NOTES, FIELD_SAMPLES, MANUAL_BUDGET, MISTAKES, SPACE_CHARS, estimateTokens, manualParts, pickExamples, priorState, printAnswer, renderManual, renderReference, requestTags } from "../mobile-shell/objects/kit/manual.js";
import { bundleFromMarkup, bundleToMarkup } from "../mobile-shell/objects/kit/markup.js";
import { applyBundle, checkBundle } from "../mobile-shell/objects/kit/pipeline.js";
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

// The corpus is the exam: the examples may not teach its subjects.
test("no example touches a subject of the corpus", () => {
  const banned = ["вод", "вес", "шаг", "настроен", "бег", "пробеж", "кофе", "витамин", "магни", "антибиот", "сладк", "голодан", "растяж", "уборк", "жим", "сон", "давлен", "рецепт", "замер", "бюджет", "книг", "вишлист", "сыт", "rpe", "омег", "пылесос", "суп"];
  const exempt = new Set(["весь", "всего"]);
  for (const example of EXAMPLES) {
    const text = [example.request, example.reply, example.bundle?.name, ...(example.bundle?.tracks || []).flatMap((t) => [t.key, t.name, ...(t.fields || []).map((f) => f.name), ...(t.items || []).map((i) => i.name)])].filter(Boolean).join(" ").toLowerCase();
    const words = text.split(/[^a-zа-яё0-9]+/i).filter(Boolean);
    for (const word of words) {
      if (exempt.has(word)) continue;
      const hit = banned.find((stem) => word.startsWith(stem));
      assert.equal(hit, undefined, `${example.id}: «${word}» is a subject of the corpus (${hit})`);
    }
  }
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

test("the manual fits the budget on the empty, the demo and a busy space, in both surfaces", () => {
  const spaces = {
    empty: emptyState(),
    demo: buildDemoState(TODAY),
    busy: withApps("shakes", "meditation", "swim", "rides"),
  };
  const sizes = {};
  for (const surface of SURFACES) {
    for (const [name, state] of Object.entries(spaces)) {
      const tokens = estimateTokens(renderManual(state, { surface, request: "Хочу считать воду, цель два литра, кнопки +250 и +500", today: TODAY }));
      sizes[`${surface}/${name}`] = tokens;
      assert.ok(tokens <= MANUAL_BUDGET.cap, `${surface}/${name}: ${tokens} tokens is over the cap ${MANUAL_BUDGET.cap}`);
    }
  }
  console.log("manual tokens (chars / 3.2):", JSON.stringify(sizes));
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
  const swim = exampleById("swim");
  assert.match(printAnswer(swim, "json"), /^\{\n "reply": "Собрал «Бассейн»/);
  assert.match(printAnswer(swim, "html"), /^<c-bundle v="2" name="Бассейн">\n  <c-reply>Собрал «Бассейн»/);
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
  const busy = renderManual(withApps("swim"), { request: "Добавь на главную километры", today: TODAY });
  assert.match(busy, /В пространстве уже было/);
  assert.match(busy, /Просьба: «Добавь на главную километры за неделю»/);
});

test("the manual carries the person's space and the request, and the surfaces differ in syntax only", () => {
  const state = withApps("swim");
  const json = renderManual(state, { surface: "json", request: "Убери график", today: TODAY });
  const html = renderManual(state, { surface: "html", request: "Убери график", today: TODAY });
  assert.match(json, /ПРОСЬБА ЧЕЛОВЕКА\n«Убери график»/);
  assert.match(html, /ПРОСЬБА ЧЕЛОВЕКА\n«Убери график»/);
  assert.ok(/"key":"swim"/.test(json), "the space is printed as JSON");
  assert.ok(/<c-track key="swim"/.test(html), "the space is printed as markup");
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

test("the manual says what the app adds by itself, from expandDefaults", () => {
  const defaults = manualParts(emptyState(), { request: "x" }).find((part) => part.id === "defaults").text;
  for (const kind of catalogue.KIND_KEYS) assert.match(defaults, new RegExp(`- ${kind}: `));
  assert.match(defaults, /- habit: .*marks/);
  assert.match(defaults, /- log: .*form/);
});

// Each "wrong" line of the manual is a real mistake the validator names, and the "right" line is the node of a passing example.
test("every mistake of the manual fails the validator with its rule, and the fix passes", () => {
  assert.ok(MISTAKES.length >= 6);
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
  const state = withApps("swim", "shakes", "meditation", "rides", "flossing", "gymbag");
  const cards = Object.entries(ELEMENT_SAMPLES).map(([key, el]) => ({ key: `sample_${key}`, title: "Образец", body: [el] }));
  const onHome = checkBundle({ v: 2, name: "Образцы", screens: [{ key: "home", cards: cards.slice(0, 8) }, { key: "samples", name: "Образцы", cards: cards.slice(8) }] }, state, { today: TODAY });
  assert.equal(onHome.ok, true, JSON.stringify(onHome.problems));
  const S = FIELD_SAMPLES;
  const host = {
    v: 2,
    name: "Образцы полей",
    tracks: [
      { key: "sample_a", name: "Образец А", kind: "log", fields: [{ key: "laps", name: "Длин", type: "number" }, { key: "pool", name: "Бассейн", type: "number" }, S.calc, S.number, S.scale, S.text, S.choice, S.yesno] },
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
