import assert from "node:assert/strict";
import { test } from "node:test";
import { openObjectStore } from "../mobile-shell/objects/core/store.js";
import { demoLegacyState, legacyToObjects } from "../mobile-shell/objects/core/migrate.js";
import { dayActual, markFor, planDay, shiftDate } from "../mobile-shell/objects/core/domain.js";
import { OBJECT_TOOLS, applyProposal, createObjectAssistant, discardProposal, newThread, pendingProposals, recheckProposals, revertProposal } from "../mobile-shell/objects/core/assistant.js";
import { disorderSigns, isMinor, protectiveReasons, raisesDeficit } from "../mobile-shell/objects/core/assistant-safety.js";
import { rationDayView } from "../mobile-shell/objects/core/assistant-plan.js";
import { spaceOutline } from "../mobile-shell/objects/core/builder.js";
import { createMockProvider } from "../mobile-shell/services/assistant/ai-provider.js";
import { disorderSigns as legacyDisorderSigns, isMinor as legacyIsMinor, raisesDeficit as legacyRaisesDeficit } from "../mobile-shell/core/safety.js";

const TODAY = "2026-10-19";
const TOMORROW = shiftDate(TODAY, 1);
const CTX = { today: TODAY };

const open = (mutate) => {
  const legacy = demoLegacyState(TODAY);
  mutate?.(legacy);
  const store = openObjectStore({ storage: null, today: () => TODAY });
  assert.equal(store.replaceAll(legacyToObjects(legacy, { today: TODAY })).ok, true);
  return store;
};

let sequence = 0;
const call = (name, args) => ({ id: `call_${sequence += 1}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const tools = (...calls) => ({ role: "assistant", content: "", tool_calls: calls });
const say = (content) => ({ role: "assistant", content });
const script = (steps, options) => createMockProvider((request, index) => {
  const step = steps[index] ?? say("Готово.");
  return typeof step === "function" ? step(request) : step;
}, options);

const catalog = { search: async () => ({ products: [] }), productByBarcode: async () => ({ product: null }) };

async function ask(store, steps, text = "Помоги с планом", { thread = newThread(), usage } = {}) {
  const provider = script(steps, usage ? { usage } : undefined);
  const assistant = createObjectAssistant({ provider, getState: () => store.state(), catalog, today: () => TODAY });
  const events = [];
  const result = await assistant.run(thread, text, { onEvent: (event) => events.push(event) });
  const results = thread.messages.filter((message) => message.role === "tool").map((message) => JSON.parse(message.content));
  return { thread, provider, result, events, results };
}

// The meals of a date as the model writes them, every portion times `factor`.
const mealsOf = (state, date, factor = 1, edit = (meals) => meals) => edit(rationDayView(state, date, CTX).meals.map((meal) => ({
  name: meal.name,
  time: meal.time,
  items: meal.items.map((item) => ({ product: item.id, amount: Math.round(item.amount * factor) })),
})));

const kcalOf = (state, date) => dayActual(state, date, CTX).planned.kcal;

test("reads see pending proposals, and the real space stays untouched until the person applies", async () => {
  const store = open();
  const state = store.state();
  const fish = mealsOf(state, TODAY, 1, (meals) => meals.map((meal) => (meal.name === "Ужин" ? { ...meal, items: [{ product: "product_salmon", amount: 220 }, { product: "product_rice", amount: 80 }, { product: "product_salad", amount: 150 }] } : meal)));
  const { thread, results, events } = await ask(store, [
    tools(call("propose_day", { area: "ration", date: TODAY, meals: fish })),
    tools(call("get_plan", { area: "ration", from: TODAY, to: TODAY })),
    say("Заменила ужин на лосось. Нажмите «Применить»."),
  ], "замени ужин сегодня на что-то с рыбой");
  assert.equal(results[0].ok, true, JSON.stringify(results[0]));
  assert.equal(results[0].summary, "Особый день · 19 окт.");
  assert.match(results[0].note, /только после его подтверждения/);
  const dinner = results[1].days[0].meals.find((meal) => meal.name === "Ужин");
  assert.equal(dinner.items[0].amount, 220, "get_plan shows the pending day");
  assert.equal(results[1].days[0].source, "Особый день");
  assert.equal(planDay(store.state(), "ration", TODAY).source, "cycle", "nothing is written before apply");
  assert.deepEqual(events.map((event) => event.type), ["user", "progress", "proposal", "progress", "assistant"]);
  assert.equal(thread.proposals.length, 1);
  const [proposal] = thread.proposals;
  assert.equal(proposal.status, "pending");
  const change = proposal.preview.days[0].changes;
  assert.equal(change.length, 1);
  assert.match(change[0].label, /Ужин/);
  assert.match(change[0].was, /Лосось 180 г/);
  assert.match(change[0].now, /Лосось 220 г/);
  assert.ok(proposal.preview.days[0].after.kcal > proposal.preview.days[0].before.kcal);
});

test("a day under the gate is refused with the reason, and the model's second try passes", async () => {
  const store = open();
  const state = store.state();
  const thin = mealsOf(state, TODAY, 1, (meals) => meals.filter((meal) => meal.name !== "Перекус" && meal.name !== "Ужин"));
  const ok = mealsOf(state, TODAY, 1.05);
  const { thread, results, provider } = await ask(store, [
    tools(call("propose_day", { area: "ration", date: TODAY, meals: thin })),
    tools(call("propose_day", { area: "ration", date: TODAY, meals: ok })),
    say("Готово."),
  ]);
  assert.equal(results[0].ok, false);
  assert.match(results[0].problems.join("; "), /отличается от цели 2400 больше чем на 15%/);
  assert.equal(results[1].ok, true, JSON.stringify(results[1]));
  assert.equal(thread.proposals.length, 1, "the refused try left no card");
  assert.match(provider.requests[1].messages.at(-1).content, /отличается от цели/, "the model got the problems back");
  const review = await ask(store, [tools(call("get_plan", { area: "ration", from: TODAY, to: TODAY })), say("ок")], "что в плане?", { thread });
  const day = review.results.at(-1).days[0];
  assert.equal(day.totals.kcal > 2265.7, true, "the second try is the working state; the refused one is not");
});

test("apply is one undoable change and keeps today's marks; a revert takes it back", async () => {
  const store = open();
  const breakfast = planDay(store.state(), "ration", TODAY).items[0];
  const slot = store.state().objects[breakfast].props.slot;
  assert.equal(store.create("meal_mark", { name: "Завтрак", props: { date: TODAY, slot, meal: breakfast, mealState: "eaten" } }).ok, true);
  const { thread, results } = await ask(store, [tools(call("propose_day", { area: "ration", date: TODAY, meals: mealsOf(store.state(), TODAY, 1.1) })), say("ок")]);
  const id = results[0].proposalId;
  const applied = applyProposal(store, thread, id);
  assert.equal(applied.ok, true, applied.reason);
  assert.equal(thread.proposals[0].status, "applied");
  const plan = planDay(store.state(), "ration", TODAY);
  assert.equal(plan.source, "special");
  assert.equal(store.state().journal.at(-1).actor, "ai");
  assert.equal(markFor(store.state(), "ration", TODAY, slot).props.mealState, "eaten", "the breakfast mark finds its meal by slot");
  assert.equal(applyProposal(store, thread, id).ok, false, "twice is not possible");
  const eaten = dayActual(store.state(), TODAY, CTX).meals[0];
  assert.equal(eaten.state, "eaten");

  const back = revertProposal(store, thread, id);
  assert.equal(back.ok, true, back.reason);
  assert.equal(thread.proposals[0].status, "reverted");
  assert.equal(planDay(store.state(), "ration", TODAY).source, "cycle");
});

test("an existing Особый день is replaced by the new one, not stacked", async () => {
  const store = open();
  const date = shiftDate(TODAY, 2);
  const old = planDay(store.state(), "ration", date);
  assert.equal(old.source, "special", "the demo has an Особый день two days ahead");
  const { thread, results } = await ask(store, [tools(call("propose_day", { area: "ration", date, meals: mealsOf(store.state(), TOMORROW) })), say("ок")]);
  assert.equal(results[0].ok, true, JSON.stringify(results[0]));
  assert.equal(applyProposal(store, thread, results[0].proposalId).ok, true);
  const next = planDay(store.state(), "ration", date);
  assert.equal(next.source, "special");
  assert.notEqual(next.dayId, old.dayId);
  assert.ok(store.state().objects[old.dayId].archivedAt, "the old day is archived");
  const live = Object.values(store.state().objects).filter((o) => o.type === "day_plan" && o.props.date === date && !o.archivedAt);
  assert.equal(live.length, 1);
  assert.equal(revertProposal(store, thread, results[0].proposalId).ok, true);
  assert.equal(planDay(store.state(), "ration", date).dayId, old.dayId, "the undo brings the old day back");
});

test("ai cannot propose facts, plan internals, the profile or guarded targets", async () => {
  const store = open();
  const meal = planDay(store.state(), "ration", TODAY).items[0];
  const profile = Object.values(store.state().objects).find((obj) => obj.type === "profile");
  const { results, thread } = await ask(store, [
    tools(
      call("propose_objects", { summary: "отметка", ops: [{ op: "create", type: "meal_mark", name: "x", props: { date: TODAY, slot: "s", meal, mealState: "eaten" } }] }),
      call("propose_objects", { summary: "покупка", ops: [{ op: "create", type: "purchase", name: "x", props: { date: TODAY } }] }),
      call("propose_objects", { summary: "цели", ops: [{ op: "update", id: profile.id, props: { targetCalories: 1500 } }] }),
      call("propose_objects", { summary: "цель в заметке", ops: [{ op: "create", type: "note", name: "x", props: { targetCalories: 1500 } }] }),
      call("propose_objects", { summary: "приём", ops: [{ op: "update", id: meal, props: { time: "07:00" } }] }),
      call("propose_day", { area: "ration", date: shiftDate(TODAY, -1), meals: mealsOf(store.state(), TODAY) }),
    ),
    say("Не могу."),
  ]);
  assert.match(results[0].problems.join(" "), /записывает только человек/);
  assert.match(results[1].problems.join(" "), /записывает только человек/);
  assert.match(results[2].problems.join(" "), /через propose_objects не меняется/);
  assert.match(results[3].problems.join(" "), /меняет только человек/);
  assert.match(results[4].problems.join(" "), /через propose_objects не меняется/);
  assert.match(results[5].error, /Прошедшие дни менять нельзя/);
  assert.equal(thread.proposals.length, 0);
});

test("protective mode refuses a deficit by code and says why; more food is welcome", async () => {
  const store = open();
  const state = store.state();
  const words = "Хочу есть ещё меньше, вообще ничего не есть";
  const cut = await ask(store, [tools(call("propose_day", { area: "ration", date: TOMORROW, meals: mealsOf(state, TOMORROW, 0.9) })), say("Давайте не будем.")], words);
  assert.equal(cut.thread.proposals.length, 0);
  assert.match(cut.results[0].error, /Снижать калории или добавлять нагрузку сейчас нельзя: слова человека/);
  assert.match(cut.results[0].hint, /специалисту по расстройствам/);
  assert.match(cut.provider.requests[0].messages[0].content, /ВНИМАНИЕ: слова человека[\s\S]*расстройствам пищевого поведения/);
  const more = await ask(store, [tools(call("propose_day", { area: "ration", date: TOMORROW, meals: mealsOf(state, TOMORROW, 1.08) })), say("ок")], words);
  assert.equal(more.thread.proposals.length, 1, "more food is always welcome");
  const run = await ask(store, [tools(call("propose_day", { area: "sport", date: TOMORROW, sessions: [{ kind: "run", time: "07:00", duration: 60, intensity: "high" }] })), say("ок")], words);
  assert.match(run.results[0].error, /Снижать калории или добавлять нагрузку/, "workouts count in the balance");

  const teen = open();
  const profile = Object.values(teen.state().objects).find((obj) => obj.type === "profile");
  assert.equal(teen.update(profile.id, { props: { ageGroup: "teen" } }).ok, true);
  const minor = await ask(teen, [tools(call("propose_day", { area: "ration", date: TOMORROW, meals: mealsOf(teen.state(), TOMORROW, 0.9) })), say("ок")], "Хочу похудеть к лету");
  assert.match(minor.results[0].error, /несовершеннолетний в профиле/);
  assert.match(minor.provider.requests[0].messages[0].content, /рассчитано на совершеннолетнего/);
  const calm = await ask(store, [tools(call("propose_day", { area: "ration", date: TOMORROW, meals: mealsOf(state, TOMORROW, 0.9) })), say("ок")], "Сделай завтра без мяса");
  assert.equal(calm.thread.proposals.length, 1, "without a sign a lighter day is the person's choice");
  assert.equal(calm.provider.requests[0].messages[0].content.includes("ВНИМАНИЕ"), false, "no warning without a sign");
});

test("propose_space takes a bundle: one proposal with change rows; applying and undoing it restores the space", async () => {
  const store = open();
  const tea = {
    v: 2,
    name: "Чай",
    tracks: [{ key: "tea", name: "Чай", kind: "log", icon: "🍵", fields: [{ key: "cups", name: "Чашек", type: "number", unit: "шт.", min: 1, max: 10, goal: 4, goalType: "max", goalPer: "day" }] }],
    screens: [{ key: "home", cards: [{ key: "tea_today", title: "Чай сегодня", body: [{ el: "meter", of: "tea", value: "cups" }, { el: "quick", of: "tea", values: { cups: 1 }, label: "+1 чашка" }] }] }],
  };
  const lowEnergy = { v: 2, name: "Лимит", tracks: [{ key: "food", name: "Еда", kind: "log", fields: [{ key: "kcal", name: "Энергия", type: "number", unit: "ккал", goal: 600, goalType: "max" }] }] };
  const { thread, results } = await ask(store, [
    tools(call("propose_space", { summary: "Чай: шкала и кнопка", bundle: tea })),
    tools(call("propose_space", { summary: "Низкая цель", bundle: lowEnergy })),
    tools(call("propose_space", { summary: "Старый формат", ops: [{ op: "defineType", key: "water", name: "Вода" }] })),
    say("Собрала."),
  ], "сделай учёт чая");
  assert.equal(results[0].ok, true, JSON.stringify(results[0]));
  assert.deepEqual(results[0].preview.rows.map((row) => row[0]), ["Трек", "Новый экран", "Новая карточка", "Новая карточка", "Новая карточка"], "the card on home stays, the track's own screen with its history comes with it");
  assert.equal(results[1].ok, false, "a calorie goal under 1200 is refused");
  assert.match(results[1].problems.join(" "), /ниже 1200 ккал/);
  assert.equal(results[2].ok, false, "the op language is gone: a bundle is required");
  assert.match(results[2].error, /bundle/);
  assert.equal(store.state().types.tr_tea, undefined);
  const applied = applyProposal(store, thread, results[0].proposalId);
  assert.equal(applied.ok, true, applied.reason);
  assert.equal(store.state().types.tr_tea.fact, true);
  assert.deepEqual(spaceOutline(store.state()).kit.screens.find((screen) => screen.key === "home").cards.map((card) => card.key), ["tea_today"]);
  assert.equal(revertProposal(store, thread, results[0].proposalId).ok, true);
  assert.equal(store.state().types.tr_tea, undefined);
});

test("propose_space lets a title repeat the person's own numbers and still refuses invented ones", async () => {
  const store = open();
  const bundle = (title) => ({
    v: 2,
    name: "Чай",
    tracks: [{ key: "tea", name: "Чай", kind: "log", fields: [{ key: "cups", name: "Чашек", type: "number", unit: "шт.", min: 1, max: 10 }] }],
    screens: [{ key: "home", cards: [{ key: "tea_today", title, body: [{ el: "quick", of: "tea", values: { cups: 1 }, label: "+1 чашка" }] }] }],
  });
  const { results } = await ask(store, [
    tools(call("propose_space", { summary: "Чай", bundle: bundle("Не больше 3 чашек в день") })),
    tools(call("propose_space", { summary: "Чай", bundle: bundle("Вы выпили 7 чашек") })),
    say("Готово."),
  ], "веду чай, хочу не больше 3 чашек в день");
  assert.equal(results[0].ok, true, JSON.stringify(results[0]));
  assert.equal(results[1].ok, false);
  assert.match(results[1].problems.join(" "), /число 7/);
});

test("the tracks, screens and cards of the kit go through propose_space only", async () => {
  const store = open();
  const { results } = await ask(store, [
    tools(call("propose_objects", { summary: "Экран", ops: [{ op: "create", type: "kit_screen", name: "Мой" }] })),
    say("Не вышло."),
  ], "добавь экран");
  assert.match(results[0].problems.join(" "), /propose_space/);
});

test("a new product from the reference rides in the same proposal; the card's numbers come from code", async () => {
  const store = open();
  const fish = mealsOf(store.state(), TODAY, 1, (meals) => meals.map((meal) => (meal.name === "Ужин" ? { ...meal, items: [{ product: "Треска", amount: 250 }, { product: "product_rice", amount: 100 }, { product: "product_salad", amount: 150 }] } : meal)));
  const { thread, results } = await ask(store, [
    tools(call("find_reference", { query: "треска" })),
    tools(call("propose_day", { area: "ration", date: TODAY, meals: fish })),
    tools(call("propose_day", { area: "ration", date: TODAY, meals: fish, new_products: [{ name: "Треска", source: "reference", source_ref: "cod", calories: 1 }] })),
    say("ок"),
  ], "ужин с треской");
  assert.equal(results[0].candidates[0].id, "cod");
  assert.equal(results[1].ok, false, "an unknown product is refused with the way to add it");
  assert.match(results[1].problems.join(" "), /new_products/);
  assert.equal(results[2].ok, true, JSON.stringify(results[2]));
  const [proposal] = thread.proposals;
  const created = proposal.ops.find((op) => op.op === "create" && op.type === "product");
  assert.equal(created.props.kcal100, 82, "the model's calories=1 is ignored, the card says 82");
  assert.equal(created.props.nutritionSource, "reference");
  assert.equal(created.props.confirmed, false);
  assert.match(proposal.preview.rows[0][0], /Новый продукт/);
  assert.equal(applyProposal(store, thread, proposal.id).ok, true);
  assert.equal(Object.values(store.state().objects).filter((obj) => obj.type === "product" && obj.name === "Треска").length, 1);
});

test("a proposal that builds on another waits for it; apply all goes in order", async () => {
  const store = open();
  const { thread, results } = await ask(store, [
    tools(call("propose_objects", { summary: "Новый продукт", ops: [{ op: "create", type: "product", id: "product_skyr", name: "Скир", props: { unit: "г", kcal100: 63, protein100: 11, fat100: 0.2, carbs100: 4 } }] })),
    tools(call("propose_day", { area: "ration", date: TODAY, meals: mealsOf(store.state(), TODAY, 1, (meals) => meals.map((meal) => (meal.name === "Перекус" ? { ...meal, items: [{ product: "Скир", amount: 300 }, { product: "product_apple", amount: 150 }, { product: "product_nuts", amount: 20 }] } : meal))) })),
    say("ок"),
  ]);
  assert.equal(results[0].ok, true, JSON.stringify(results[0]));
  assert.equal(results[1].ok, true, JSON.stringify(results[1]));
  const [first, second] = thread.proposals;
  assert.deepEqual(second.dependsOn, [first.id]);
  const early = applyProposal(store, thread, second.id);
  assert.match(early.reason, /Сначала примените «Новый продукт»/);
  assert.equal(second.status, "pending", "waiting is not a conflict");
  for (const proposal of pendingProposals(thread)) assert.equal(applyProposal(store, thread, proposal.id).ok, true);
  assert.deepEqual(thread.proposals.map((p) => p.status), ["applied", "applied"]);
});

test("pending proposals are rechecked: a changed space turns them into conflicts and back", async () => {
  const store = open();
  const { thread } = await ask(store, [tools(call("propose_day", { area: "ration", date: TODAY, meals: mealsOf(store.state(), TODAY, 1.05) })), say("ок")]);
  const profile = Object.values(store.state().objects).find((obj) => obj.type === "profile");
  assert.equal(store.update(profile.id, { props: { targetCalories: 3600 } }).ok, true);
  recheckProposals(store.state(), thread, TODAY);
  assert.equal(thread.proposals[0].status, "conflict");
  assert.match(thread.proposals[0].reason, /отличается от цели 3600/);
  assert.equal(applyProposal(store, thread, thread.proposals[0].id).ok, false);
  assert.equal(store.update(profile.id, { props: { targetCalories: 2400 } }).ok, true);
  recheckProposals(store.state(), thread, TODAY);
  assert.equal(thread.proposals[0].status, "pending", "it fits again");
  assert.equal(discardProposal(thread, thread.proposals[0].id).ok, true);
  assert.equal(thread.proposals[0].status, "discarded");
  assert.equal(recheckProposals(store.state(), thread, TODAY)[0].status, "discarded");
});

test("a new week starts tomorrow at the earliest, is gated day by day and replaces nothing in force", async () => {
  const store = open();
  const state = store.state();
  const weekOf = (from, factor) => Object.fromEntries(Array.from({ length: 7 }, (_, index) => {
    const key = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"][(new Date(`${shiftDate(from, index)}T00:00:00Z`).getUTCDay() + 6) % 7];
    return [key, mealsOf(state, shiftDate(from, index), factor)];
  }));
  const from = shiftDate(TODAY, 7);
  const { thread, results } = await ask(store, [
    tools(call("propose_week", { area: "ration", effective_from: TODAY, week: weekOf(TODAY, 1) })),
    tools(call("propose_week", { area: "ration", effective_from: from, week: weekOf(from, 0.5) })),
    tools(call("propose_week", { area: "ration", effective_from: from, week: weekOf(from, 1.04) })),
    tools(call("propose_week", { area: "sport", effective_from: from, week: { пн: [{ kind: "run", time: "07:00", duration: 30, intensity: "medium" }], вт: [], ср: [], чт: [], пт: [], сб: [], вс: [] } })),
    say("ок"),
  ]);
  assert.match(results[0].error, /только завтра или позже/);
  assert.equal(results[1].ok, false);
  assert.match(results[1].problems.join(" "), /ниже безопасного минимума|отличается от цели/);
  assert.equal(results[2].ok, true, JSON.stringify(results[2]));
  assert.equal(results[2].preview.days.length, 7);
  assert.equal(results[3].ok, true, JSON.stringify(results[3]));
  const week = thread.proposals[0];
  assert.equal(applyProposal(store, thread, week.id).ok, true);
  assert.equal(store.state().objects[Object.values(store.state().objects).find((o) => o.type === "week_plan" && o.props.effectiveFrom === from && o.props.area === "ration").id].props.days.length, 7);
  assert.equal(revertProposal(store, thread, week.id).ok, true);
});

test("propose_revert undoes a change from the journal; a missing or repeated one is refused", async () => {
  const store = open();
  const note = store.create("note", { name: "Список", props: {} }, { actor: "human", summary: "Заметка «Список»" });
  assert.equal(note.ok, true);
  const { thread, results } = await ask(store, [
    tools(call("get_change_sets", { limit: 3 })),
    tools(call("propose_revert", { id: note.changeSetId }), call("propose_revert", { id: "nope" })),
    say("ок"),
  ]);
  assert.equal(results[0].changeSets[0].id, note.changeSetId);
  assert.equal(results[1].ok, true, JSON.stringify(results[1]));
  assert.equal(results[2].ok, false);
  assert.equal(applyProposal(store, thread, results[1].proposalId).ok, true);
  assert.equal(store.state().objects[note.ids[0]], undefined);
  const again = await ask(store, [tools(call("propose_revert", { id: note.changeSetId })), say("ок")]);
  assert.equal(again.results[0].ok, false);
});

test("read tools: find_objects with filters, get_object, get_history and get_profile", async () => {
  const store = open();
  const { results } = await ask(store, [
    tools(
      call("find_objects", { type: "product", filters: [{ rel: "protein100", op: "gte", value: 15 }], sorts: [{ rel: "protein100", dir: "desc" }], limit: 3, relations: ["protein100", "kcal100", "unit"] }),
      call("find_objects", { type: "nope" }),
      call("find_objects", { type: "product", filters: [{ rel: "nope", op: "eq", value: 1 }] }),
      call("get_object", { id: "product_chicken" }),
      call("get_history", { area: "ration", from: shiftDate(TODAY, -3), to: TODAY }),
      call("get_history", { area: "sport", from: TODAY, to: TODAY }),
      call("get_profile", {}),
      call("get_plan", { area: "sport", from: TODAY, to: shiftDate(TODAY, 20) }),
      call("get_space", {}),
    ),
    say("ок"),
  ]);
  const [found, noType, noRel, object, history, future, profile, sport, space] = results;
  assert.equal(found.objects.length, 3);
  assert.ok(found.objects[0].protein100 >= found.objects[1].protein100);
  assert.equal(found.total >= 3, true);
  assert.match(noType.error, /Нет типа/);
  assert.match(noRel.error, /Нет связи/);
  assert.equal(object.name, "Куриная грудка");
  assert.equal(object.props.unit, "г");
  assert.ok(object.backlinks["Порция"] > 0, "portions of the plan link to the product");
  assert.equal(history.days.length, 3, "only past days");
  assert.ok(history.days.every((day) => day.date < TODAY));
  assert.match(future.error, /только у прошедших/);
  assert.equal(profile.profile.targetCalories, 2400);
  assert.deepEqual(profile.profile.excluded, ["Тофу"]);
  assert.equal(sport.days.length, 14, "a plan range is capped at 14 days");
  assert.ok(space.space.types.some((type) => type.key === "product"));
});

test("a long conversation is compacted: a note replaces the beginning and the feed keeps everything", async () => {
  const store = open();
  const first = await ask(store, [tools(call("get_plan", { area: "ration", from: TODAY, to: shiftDate(TODAY, 6) })), say("Вот план.")], "покажи неделю", { usage: () => ({ prompt_tokens: 95_000 }) });
  assert.equal(first.thread.promptTokens, 95_000);
  assert.ok(first.thread.promptChars > 0);
  const thread = first.thread;
  const second = await ask(store, [
    (request) => { assert.equal(request.tools, undefined, "the note is written without tools"); return say("Человек смотрел план недели. Предпочтений нет."); },
    say("Слушаю."),
  ], "ещё вопрос", { thread, usage: () => ({ prompt_tokens: 20_000 }) });
  assert.ok(second.events.some((event) => event.type === "compacted"), "compaction ran");
  assert.match(thread.messages[0].content, /Начало разговора сжато/);
  assert.match(thread.messages[0].content, /Человек смотрел план недели/);
  assert.match(thread.messages[0].content, /покажи неделю/, "earlier words of the person stay word for word");
  assert.equal(thread.messages.at(-1).content, "Слушаю.");
  assert.equal(thread.log.filter((entry) => entry.type === "user").length, 2, "the feed keeps every message");
  assert.equal(thread.promptTokens, 20_000);
});

test("tools are stable and every tool has a Russian description", () => {
  const names = OBJECT_TOOLS.map((tool) => tool.function.name);
  assert.deepEqual(names, ["get_space", "find_objects", "get_object", "get_plan", "get_history", "get_profile", "get_change_sets", "find_reference", "search_food", "propose_day", "propose_week", "propose_objects", "propose_space", "propose_revert"]);
  for (const tool of OBJECT_TOOLS) assert.match(tool.function.description, /[а-яё]/i, tool.function.name);
});

// ——— Parity with mobile-shell/core/safety.js ———

const AGE_GROUPS = ["Ребёнок", "Подросток", "Взрослый", "Пожилой"];
const ID_OF_GROUP = { "Ребёнок": "child", "Подросток": "teen", "Взрослый": "adult", "Пожилой": "senior" };

test("parity: isMinor agrees with the legacy safety for every age group", () => {
  for (const group of AGE_GROUPS) {
    const legacy = demoLegacyState(TODAY);
    legacy.ration.profile.ageGroup = group;
    const state = legacyToObjects(legacy, { today: TODAY });
    assert.equal(isMinor(state), legacyIsMinor(legacy.ration.profile), group);
    assert.equal(state.objects && Object.values(state.objects).find((o) => o.type === "profile").props.ageGroup, ID_OF_GROUP[group]);
  }
});

test("parity: the words of an eating disorder match the legacy patterns", () => {
  const legacy = demoLegacyState(TODAY);
  legacy.ration.history = {};
  const state = legacyToObjects(legacy, { today: TODAY });
  const phrases = [
    "Хочу есть ещё меньше", "я вообще ничего не ем", "не ем уже 3 дня", "хочу поголодать", "вызываю рвоту после еды", "пью слабительное",
    "хочу сбросить 5 кг за неделю", "ненавижу своё тело", "Сделай завтра без мяса", "замени ужин на рыбу", "хочу набрать массу", "поем ещё немного",
  ];
  for (const phrase of phrases) {
    assert.deepEqual(disorderSigns(state, [phrase], TODAY), legacyDisorderSigns(legacy, [phrase], TODAY), phrase);
  }
  assert.deepEqual(disorderSigns(state, phrases.slice(0, 3), TODAY), ["слова человека"]);
});

test("parity: frequent «не съедено» in the marks of two weeks trigger like in the legacy Учёт", () => {
  const history = (skippedOf) => (legacy) => {
    legacy.ration.history = {};
    const base = legacy.ration.versions[0].cycle.days;
    for (let back = 1; back <= 4; back += 1) {
      const date = shiftDate(TODAY, -back);
      const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
      const [breakfast, lunch] = base[weekday].meals;
      legacy.ration.history[`local|${date}`] = { date, owner: "local", meals: { [breakfast.id]: { state: skippedOf(back, 0) ? "skipped" : "eaten" }, [lunch.id]: { state: skippedOf(back, 1) ? "skipped" : "eaten" } } };
    }
  };
  for (const [name, rule] of [["none", () => false], ["most", (back, index) => back !== 1 || index === 1], ["exactly 40%", (back, index) => (back * 2 + index) % 5 < 2]]) {
    const legacy = demoLegacyState(TODAY);
    history(rule)(legacy);
    const state = legacyToObjects(legacy, { today: TODAY });
    assert.deepEqual(disorderSigns(state, [], TODAY), legacyDisorderSigns(legacy, [], TODAY), name);
  }
  const legacy = demoLegacyState(TODAY);
  history(() => true)(legacy);
  assert.deepEqual(legacyDisorderSigns(legacy, [], TODAY), ["частые «не съедено» в Учёте"]);
  assert.deepEqual(disorderSigns(legacyToObjects(legacy, { today: TODAY }), [], TODAY), ["частые «не съедено» в Учёте"]);
});

test("parity: raisesDeficit agrees with the legacy safety on food and workout changes", () => {
  const dates = [TOMORROW];
  const day = (legacy) => {
    const weekday = (new Date(`${TOMORROW}T00:00:00Z`).getUTCDay() + 6) % 7;
    return structuredClone(legacy.ration.versions[0].cycle.days[weekday].meals);
  };
  const scaleFood = (factor) => (legacy) => {
    const meals = day(legacy);
    meals.forEach((meal) => meal.items.forEach((item) => { item.portionSize = Math.round(item.portionSize * factor); }));
    legacy.ration.specialDays[`local|${TOMORROW}`] = { date: TOMORROW, owner: "local", meals };
  };
  const session = (id, minutes, intensity) => ({ id, type: "run", time: "07:00", durationMin: minutes, intensity, note: "", exercises: [] });
  const sport = (sessions) => (legacy) => { legacy.sport.specialDays[`local|${TOMORROW}`] = { date: TOMORROW, owner: "local", sessions }; };
  const cases = [
    ["no change", () => {}],
    ["much less food", scaleFood(0.7)],
    ["slightly less food", scaleFood(0.99)],
    ["more food", scaleFood(1.3)],
    ["a workout added", sport([session("s_new", 60, "high")])],
    ["a workout removed", sport([])],
    ["a short workout", sport([session("s_short", 5, "low")])],
  ];
  const seen = new Set();
  for (const [name, change] of cases) {
    const before = demoLegacyState(TODAY);
    const after = demoLegacyState(TODAY);
    change(after);
    const expected = legacyRaisesDeficit(before, after, dates);
    assert.equal(raisesDeficit(legacyToObjects(before, { today: TODAY }), legacyToObjects(after, { today: TODAY }), dates), expected, name);
    seen.add(expected);
  }
  assert.deepEqual([...seen].sort(), [false, true], "the cases cover both answers");
});

test("protectiveReasons joins a minor and the words, nothing else", () => {
  const state = legacyToObjects(demoLegacyState(TODAY), { today: TODAY });
  assert.deepEqual(protectiveReasons(state, ["сделай завтра без мяса"], TODAY), []);
  assert.deepEqual(protectiveReasons(state, ["хочу голодать"], TODAY), ["слова человека"]);
});
