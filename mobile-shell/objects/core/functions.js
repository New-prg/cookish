// Food and sport functions for formulas. They hold the rules that the
// current Рацион and Спорт compute in code: КБЖУ of a portion from its
// product, totals of a meal and a day, energy of a session by MET.
import { registerFunctions, isRef } from "./formula.js";
import { SPORT_MET } from "./schema.js";
import { objectOf, round2 } from "./values.js";

const PER100 = { kcal: "kcal100", protein: "protein100", fat: "fat100", carbs: "carbs100", fiber: "fiber100" };

function nutrient(scope, target, field) {
  const obj = objectOf(scope.state, target);
  if (!obj || !PER100[field]) return null;
  if (obj.type === "portion") {
    const base = scope.field(obj, "base");
    const product = scope.field(obj, "product");
    const per100 = product ? scope.field(product, PER100[field]) : null;
    if (base == null || per100 == null || per100 === "") return null;
    return (Number(per100) * Number(base)) / 100;
  }
  const children = obj.type === "meal" ? scope.field(obj, "items") : obj.type === "day_plan" ? scope.field(obj, "meals") : null;
  if (!Array.isArray(children)) return null;
  const values = children.map((child) => nutrient(scope, child, field)).filter((v) => v != null);
  return round2(values.reduce((a, b) => a + b, 0));
}

export function burned(scope, target) {
  const obj = objectOf(scope.state, target);
  if (!obj) return null;
  const weight = Number(scope.profile ? scope.field(scope.profile, "weightKg") : null);
  if (!(weight > 0)) return null;
  const kind = scope.field(obj, "kind");
  const intensity = scope.field(obj, "intensity");
  const met = SPORT_MET[kind]?.[intensity] ?? SPORT_MET.other.medium;
  const minutes = Number(scope.field(obj, "duration")) || 0;
  return Math.round(met * weight * (minutes / 60));
}

registerFunctions({
  nutrientOf: (scope, target, field) => nutrient(scope, isRef(target) ? target : scope.self, String(field)),
  kcalOf: (scope, target) => nutrient(scope, isRef(target) ? target : scope.self, "kcal"),
  burnedOf: (scope, target) => burned(scope, isRef(target) ? target : scope.self),
  met: (_scope, kind, intensity) => SPORT_MET[kind]?.[intensity] ?? SPORT_MET.other.medium,
});
