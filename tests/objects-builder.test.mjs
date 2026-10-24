import assert from "node:assert/strict";
import { test } from "node:test";
import { openObjectStore } from "../mobile-shell/objects/core/store.js";
import { buildProposal, spaceOutline } from "../mobile-shell/objects/core/builder.js";
import { applyBundle, checkBundle } from "../mobile-shell/objects/kit/pipeline.js";
import { readSpec } from "../mobile-shell/objects/kit/spec.js";
import { createMockProvider } from "../mobile-shell/services/assistant/ai-provider.js";

const TODAY = "2026-10-19";
const open = () => {
  let n = 0;
  const store = openObjectStore({ storage: null, today: () => TODAY, idFactory: (p) => `${p}_${++n}` });
  store.create("dashboard", { id: "home", name: "Главная", props: { widgets: [] } });
  store.replaceAll({ ...store.state(), meta: { ...store.state().meta, home: "home" } });
  return store;
};

const TEA = {
  v: 2,
  name: "Чай",
  tracks: [{
    key: "tea", name: "Чай", kind: "log", icon: "🍵",
    fields: [{ key: "cups", name: "Чашек", type: "number", unit: "шт.", min: 1, max: 10, goal: 4, goalType: "max", goalPer: "day" }],
  }],
  screens: [{
    key: "home",
    cards: [{ key: "tea_today", title: "Чай сегодня", body: [{ el: "meter", of: "tea", value: "cups" }, { el: "quick", of: "tea", values: { cups: 1 }, label: "+1 чашка" }] }],
  }],
};
const answer = (bundle, reply = "Собрал «Чай»: шкала чашек до предела и кнопка «+1 чашка» на главной.") => JSON.stringify({ reply, ...bundle });

test("a request becomes a checked proposal with change rows that the person applies as one change set and takes back", async () => {
  const store = open();
  const provider = createMockProvider(() => answer(TEA));
  const result = await buildProposal({ provider, state: store.state(), request: "считай чашки чая, не больше четырёх", today: TODAY });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.attempts, 1);
  assert.equal(result.proposal.reply, "Собрал «Чай»: шкала чашек до предела и кнопка «+1 чашка» на главной.");
  assert.equal(result.proposal.summary, "Чай");
  const { checked } = result.proposal;
  assert.deepEqual(checked.rows, [
    ["Трек", "Чай", "поле «Чашек, шт.», лимит 4 в день"],
    ["Новый экран", "🍵 Чай", ""],
    ["Новая карточка", "Чай сегодня", "экран «Главная»: шкала цели, кнопка записи"],
    ["Новая карточка", "Чашек по дням", "экран «Чай»: столбцы"],
    ["Новая карточка", "Последние записи", "экран «Чай»: список"],
  ]);
  assert.equal(store.state().types.tr_tea, undefined, "nothing is written before the person applies");
  assert.equal(readSpec(store.state()).cards.tea_today, undefined);

  const applied = applyBundle(store, checked);
  assert.equal(applied.ok, true, applied.reason);
  const state = store.state();
  assert.equal(state.types.tr_tea.fact, true);
  assert.equal(readSpec(state).cards.tea_today.screen, "home");
  const entry = { name: "Чашка", props: { date: TODAY, tr_tea__cups: 1 } };
  assert.match(store.create("tr_tea", entry, { actor: "ai" }).reason, /записывает только человек/);

  const undone = store.revert(applied.changeSetId);
  assert.equal(undone.ok, true, "the whole proposal is one undo step while there is no entry");
  assert.equal(store.state().types.tr_tea, undefined);
  assert.equal(readSpec(store.state()).cards.tea_today, undefined);
});

test("a proposal that made a track cannot be undone once the track holds an entry, and removing the track keeps the entries", async () => {
  const store = open();
  const provider = createMockProvider(() => answer(TEA));
  const { proposal } = await buildProposal({ provider, state: store.state(), request: "считай чашки чая", today: TODAY });
  const applied = applyBundle(store, proposal.checked);
  assert.equal(applied.ok, true, applied.reason);
  assert.equal(store.create("tr_tea", { name: "Чашка", props: { date: TODAY, tr_tea__cups: 1 } }).ok, true);
  const before = store.state();

  const refused = store.revert(applied.changeSetId);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "в треке «Чай» уже есть записи, откатить нельзя; уберите трек через remove, записи сохранятся");
  assert.equal(store.state(), before, "a refused undo writes nothing");

  const removal = checkBundle({ v: 2, name: "Убрать чай", remove: [{ track: "tea" }] }, store.state(), { today: TODAY });
  assert.equal(removal.ok, true, JSON.stringify(removal.problems));
  assert.equal(applyBundle(store, removal).ok, true);
  assert.equal(Object.values(store.state().objects).filter((o) => o.type === "tr_tea" && !o.archivedAt).length, 1, "the entry stays");
});

test("a broken answer is sent back with the problems of its first failing layer and repaired", async () => {
  const store = open();
  const wrong = structuredClone(TEA);
  wrong.screens[0].cards[0].body[0].of = "tea_cups";
  const provider = createMockProvider((_request, index) => answer(index === 0 ? wrong : TEA));
  const result = await buildProposal({ provider, state: store.state(), request: "чай", today: TODAY });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  const repair = provider.requests[1].messages.at(-1).content;
  assert.match(repair, /Трека «tea_cups» нет/);
  assert.match(repair, /Ключи треков и классических разделов: .*tea/);
});

test("unsafe proposals are refused by code, not by the prompt", async () => {
  const store = open();
  const energy = { v: 2, name: "Лимит", tracks: [{ key: "food", name: "Еда", kind: "log", fields: [{ key: "kcal", name: "Энергия", type: "number", unit: "ккал", goal: 600, goalType: "max" }] }] };
  const dose = { v: 2, name: "Доза", tracks: [{ key: "pills", name: "Таблетки", kind: "log", fields: [{ key: "mg", name: "Миллиграммы", type: "number", unit: "мг" }, { key: "total", name: "Всего", type: "calc", calc: "mg * 2", unit: "мг" }] }] };
  const facts = { ...TEA, entries: [{ track: "tea", cups: 3 }] };
  for (const [bundle, why] of [[energy, /ниже 1200 ккал/], [dose, /считается по дозам лекарств/], [facts, /Записи пакетом не добавляются/]]) {
    const provider = createMockProvider(() => answer(bundle, "x"));
    const result = await buildProposal({ provider, state: store.state(), request: "x", today: TODAY, maxRepairs: 0 });
    assert.equal(result.ok, false);
    assert.match(result.problems.map((p) => p.message).join("; "), why);
  }
});

test("words without a bundle are an answer, not a proposal", async () => {
  const store = open();
  const provider = createMockProvider(() => JSON.stringify({ reply: "Дозу подбирает врач. Могу собрать ежедневную отметку приёма." }));
  const result = await buildProposal({ provider, state: store.state(), request: "сколько таблеток пить", today: TODAY });
  assert.equal(result.ok, true);
  assert.equal(result.proposal.checked, null);
  assert.match(result.proposal.reply, /подбирает врач/);
});

test("the model sees the structure of the space, never the text of objects", async () => {
  const store = open();
  store.create("note", { name: "Секрет: диагноз гипертония", props: { description: "вес 80 кг" } });
  const outline = JSON.stringify(spaceOutline(store.state()));
  assert.doesNotMatch(outline, /гипертония|80 кг/);

  const applied = applyBundle(store, (await buildProposal({ provider: createMockProvider(() => answer(TEA)), state: store.state(), request: "чай", today: TODAY })).proposal.checked);
  assert.equal(applied.ok, true);
  const provider = createMockProvider(() => JSON.stringify({ reply: "Хорошо." }));
  await buildProposal({ provider, state: store.state(), request: "убери кнопку", today: TODAY });
  const system = provider.requests[0].messages[0].content;
  assert.doesNotMatch(system, /гипертония|80 кг/);
  assert.match(system, /"key":"tea"/, "the keys of the space are in the manual");
  assert.match(system, /tea_today/, "and the keys of its cards");
  assert.match(JSON.stringify(spaceOutline(store.state()).kit), /tea_today/, "the assistant reads the same keys");
});
