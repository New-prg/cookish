import assert from "node:assert/strict";
import test from "node:test";

import { applyRationCommand, readRationDay, RATION_SCHEMA_VERSION } from "../mobile-shell/ration-domain.js";
import { JOURNAL_LIMIT, diffPlan, revertChangeSet } from "../mobile-shell/plan-journal.js";
import { memoryStorage, openLocalData, todayDateKey } from "../mobile-shell/local-data.js";

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

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
        effectiveFrom: addDays(today, -10),
        createdAt: "2026-01-01T00:00:00.000Z",
        cycle: {
          anchor: addDays(today, -10),
          weekdayBinding: false,
          days: [{ id: "cycle_1", meals: [{ id: "meal_1", name: "Завтрак", time: "08:00", items: [{ id: "item_1", productId: "product_oats", name: "Овсянка", portionSize: 80 }] }] }],
        },
      }],
      specialDays: {},
      history: {},
    },
  };
}

function openData(blob = planBlob()) {
  const storage = memoryStorage(blob);
  const data = openLocalData(storage);
  data.load();
  return { data, storage };
}

test("journal: every plan command writes its own change set", () => {
  const { data } = openData();
  const added = data.addRationMeal(tomorrow);
  assert.ok(added.changeSetId);
  data.updateRationMeal(tomorrow, added.mealId, { name: "Полдник" });
  data.setRationProfile({ targetCalories: 2000 });
  const repeated = data.repeatRationDays(tomorrow, 7);
  assert.ok(repeated.changeSetId);

  const { journal } = data.snapshot();
  assert.equal(journal.length, 4);
  const [add, rename, profile, repeat] = journal;
  assert.equal(add.actor, "human");
  assert.equal(add.page, "ration");
  assert.match(add.summary, /Добавлен приём пищи/);
  assert.deepEqual(Object.keys(add.after), [`ration:special:local|${tomorrow}`]);
  assert.equal(add.before[`ration:special:local|${tomorrow}`], null);
  assert.equal(add.after[`ration:special:local|${tomorrow}`].meals.length, 2);
  assert.match(rename.summary, /Изменён приём пищи/);
  assert.deepEqual(Object.keys(profile.after), ["ration:profile"]);
  assert.equal(profile.after["ration:profile"].targetCalories, 2000);
  assert.match(repeat.summary, /Неделя повторяется/);
  assert.ok(Object.keys(repeat.after).some((key) => key.startsWith("ration:version:")));
  assert.ok(add.id && add.createdAt);
});

test("journal: a revert brings the plan back and is journaled itself", () => {
  const { data } = openData();
  const before = readRationDay(data.snapshot(), tomorrow);
  const added = data.addRationMeal(tomorrow);
  assert.equal(readRationDay(data.snapshot(), tomorrow).meals.length, 2);

  const reverted = data.revertChangeSet(added.changeSetId);
  assert.equal(reverted.ok, true);
  const after = data.snapshot();
  assert.deepEqual(readRationDay(after, tomorrow), before);
  assert.deepEqual(after.ration.specialDays, {});
  assert.equal(after.journal.length, 2);
  assert.equal(after.journal[1].revertOf, added.changeSetId);
  assert.match(after.journal[1].summary, /^Откат: /);
});

test("journal: a revert after another change of the same day reports a conflict", () => {
  const { data } = openData();
  const first = data.addRationMeal(tomorrow);
  data.addRationMeal(tomorrow);
  const stateBefore = data.snapshot();

  const reverted = data.revertChangeSet(first.changeSetId);
  assert.equal(reverted.ok, false);
  assert.equal(reverted.conflict, true);
  assert.deepEqual(reverted.dates, [tomorrow]);
  assert.match(reverted.reason, /Поверх этого изменения/);
  assert.equal(data.snapshot(), stateBefore, "nothing is written on conflict");
});

test("journal: a change of another day does not block a revert", () => {
  const { data } = openData();
  const first = data.addRationMeal(tomorrow);
  data.addRationMeal(addDays(today, 2));
  assert.equal(data.revertChangeSet(first.changeSetId).ok, true);
  assert.deepEqual(Object.keys(data.snapshot().ration.specialDays), [`local|${addDays(today, 2)}`]);
});

test("journal: a revert of a revert restores the change", () => {
  const { data } = openData();
  data.setRationProfile({ targetCalories: 1800 });
  const changed = data.setRationProfile({ targetCalories: 2200 });
  const revert = data.revertChangeSet(changed.changeSetId);
  assert.equal(data.snapshot().ration.profile.targetCalories, 1800);
  assert.equal(data.revertChangeSet(revert.changeSetId).ok, true);
  assert.equal(data.snapshot().ration.profile.targetCalories, 2200);
  assert.equal(data.snapshot().journal.length, 4);
});

test("journal: a repeat is reverted with its version and the dropped special days", () => {
  const { data } = openData();
  data.addRationMeal(tomorrow);
  const special = structuredClone(data.snapshot().ration.specialDays);
  const repeated = data.repeatRationDays(tomorrow, 1);
  assert.equal(data.snapshot().ration.versions.length, 2);
  assert.deepEqual(data.snapshot().ration.specialDays, {});

  assert.equal(data.revertChangeSet(repeated.changeSetId).ok, true);
  const { ration } = data.snapshot();
  assert.equal(ration.versions.length, 1);
  assert.deepEqual(Object.keys(ration.specialDays), Object.keys(special));
  assert.deepEqual(ration.specialDays[`local|${tomorrow}`].meals, special[`local|${tomorrow}`].meals);
});

test("journal: История питания never enters the journal", () => {
  const { data } = openData();
  assert.equal(data.markRationMeal(today, "meal_1", "eaten").ok, true);
  assert.equal(data.recordRationDiscrepancy(today, "meal_1", { kind: "excluded", productId: "product_oats", name: "Овсянка" }).ok, true);
  assert.equal(data.transferRationMeals(today, "meal_1", 15).ok, true);
  assert.equal(data.markRationMeal(addDays(today, -1), "meal_1", "skipped").ok, true);
  assert.deepEqual(data.snapshot().journal, []);
});

test("journal: a batch of changes writes one set; a failed batch writes nothing", () => {
  const { data } = openData();
  const result = data.changePlan({ actor: "ai", page: "ration", summary: "Два дня без завтрака" }, (draft, context) => {
    for (const date of [tomorrow, addDays(today, 2)]) {
      const step = applyRationCommand(draft, { type: "setSpecialDay", date, meals: [] }, context);
      if (!step.ok) return step;
    }
    return { ok: true };
  });
  assert.equal(result.ok, true);
  const [set] = data.snapshot().journal;
  assert.equal(data.snapshot().journal.length, 1);
  assert.equal(set.actor, "ai");
  assert.equal(set.summary, "Два дня без завтрака");
  assert.equal(Object.keys(set.after).length, 2);

  const failed = data.changePlan({ actor: "ai" }, (draft, context) => {
    applyRationCommand(draft, { type: "setSpecialDay", date: addDays(today, 3), meals: [] }, context);
    return { ok: false, reason: "gate" };
  });
  assert.equal(failed.ok, false);
  assert.equal(data.snapshot().journal.length, 1);
  assert.equal(data.snapshot().ration.specialDays[`local|${addDays(today, 3)}`], undefined);
});

test("journal: the assistant cannot write История through a batch", () => {
  const { data } = openData();
  const result = data.changePlan({ actor: "ai" }, (draft, context) =>
    applyRationCommand(draft, { type: "markMeal", date: today, mealId: "meal_1", state: "eaten" }, context)
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /ИИ не может записывать Историю питания/);
});

test("journal: keeps only the newest sets", () => {
  const { data } = openData();
  for (let index = 0; index < JOURNAL_LIMIT + 5; index += 1) {
    data.setRationProfile({ targetCalories: 1500 + index });
  }
  const { journal } = data.snapshot();
  assert.equal(journal.length, JOURNAL_LIMIT);
  assert.equal(journal.at(-1).after["ration:profile"].targetCalories, 1500 + JOURNAL_LIMIT + 4);
  assert.equal(journal[0].after["ration:profile"].targetCalories, 1505);
});

test("journal: old data migrates to an empty journal and broken entries are dropped", () => {
  const { data, storage } = openData();
  const state = data.snapshot();
  assert.equal(state.schemaVersion, RATION_SCHEMA_VERSION);
  assert.ok(RATION_SCHEMA_VERSION >= 13);
  assert.deepEqual(state.journal, []);
  assert.equal(storage.backups()["v12"].schemaVersion, 12, "the v12 blob is kept once");

  const blob = { ...planBlob(), journal: [null, { id: "x" }, { id: "change_1", createdAt: "2026-01-01T00:00:00.000Z", actor: "robot", page: "?", summary: "Старое", before: { "ration:profile": null }, after: { "ration:profile": { targetCalories: 1 } } }] };
  const reopened = openData(blob).data.snapshot();
  assert.equal(reopened.journal.length, 1);
  assert.equal(reopened.journal[0].actor, "human");
  assert.equal(reopened.journal[0].page, "ration");
});

test("journal: edit stamps alone are not a change", () => {
  const { data } = openData();
  data.setRationProfile({ targetCalories: 2000 });
  const unchanged = data.setRationProfile({ targetCalories: 2000 });
  assert.equal(unchanged.changeSetId, undefined);
  assert.equal(data.snapshot().journal.length, 1);

  const before = data.snapshot();
  const after = structuredClone(before);
  after.ration.profile.updatedAt = "2030-01-01T00:00:00.000Z";
  assert.equal(diffPlan(before, after), null);
});

test("journal: a revert on a plain state works without local data", () => {
  const state = structuredClone(openData().data.snapshot());
  state.ration.specialDays[`local|${tomorrow}`] = { date: tomorrow, owner: "local", meals: [] };
  state.journal = [{
    id: "change_a",
    createdAt: "2026-01-01T00:00:00.000Z",
    actor: "ai",
    page: "ration",
    summary: "Пустой день",
    before: { [`ration:special:local|${tomorrow}`]: null },
    after: { [`ration:special:local|${tomorrow}`]: { date: tomorrow, owner: "local", meals: [] } },
  }];
  const result = revertChangeSet(state, "change_a", { now: "2026-01-02T00:00:00.000Z", actor: "ai" });
  assert.equal(result.ok, true);
  assert.deepEqual(state.ration.specialDays, {});
  assert.equal(state.journal.at(-1).actor, "ai");
});
