// A space written by hand to the storage mapping of design/synthesis.md §2: a
// water log with a goal, a week of entries, a `home` card holding a meter and a
// quick element, and a `water` screen with a bars card. The selftest feeds it to
// the scripts in place of a model's bundle, so the render, audit, screenshot and
// interaction path is proven without the kit's own pipeline.
import { shiftDate } from "../../../mobile-shell/objects/viz/util.js";
import { TODAY } from "./common.mjs";

export const WATER_ML = [1500, 2200, 1800, 2000, 900, 2400, 600];

export function waterOps({ caption = "Столбики по дням", weekAttrs = {} } = {}) {
  const ops = [
    { op: "defineRelation", relation: { key: "tr_water__ml", name: "Выпито", format: "number", unit: "мл", min: 1, max: 5000, kit: { track: "water", field: "ml", goal: 2000, goalType: "min", goalPer: "day" } } },
    { op: "defineType", type: { key: "tr_water", name: "Вода", plural: "Вода", icon: "💧", layout: "entry", fact: true, relations: ["date", "tr_water__ml"], kit: { track: "water", kind: "log", app: "voda" } } },
  ];
  WATER_ML.forEach((ml, i) => {
    const date = shiftDate(TODAY, i - 6);
    ops.push({ op: "create", type: "tr_water", id: `lab_w_${date}`, name: "Вода", props: { date, tr_water__ml: ml } });
  });
  ops.push(
    { op: "create", type: "kit_screen", id: "sc_home", name: "Главная", props: { kit_key: "home", kit_order: 0, kit_app: "voda" } },
    { op: "create", type: "kit_screen", id: "sc_water", name: "Вода", props: { kit_key: "water", kit_order: 1, kit_icon: "💧", kit_app: "voda" } },
    { op: "create", type: "kit_card", id: "cd_water_today", name: "Вода сегодня", props: { kit_key: "water_today", kit_screen: "sc_home", kit_size: "full", kit_order: 0, kit_app: "voda", kit_body: [
      { el: "meter", of: "water", value: "ml", fn: "sum", range: "@today" },
      { el: "quick", of: "water", values: "ml=250", label: "+250 мл" },
    ] } },
    { op: "create", type: "kit_card", id: "cd_water_week", name: "Вода за неделю", props: { description: caption, kit_key: "water_week", kit_screen: "sc_water", kit_size: "full", kit_order: 0, kit_app: "voda", kit_body: [
      { el: "bars", of: "water", value: "ml", fn: "sum", range: "@last7d", by: "day", ...weekAttrs },
    ] } },
  );
  return ops;
}
