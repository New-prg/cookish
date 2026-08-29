export const RATION_SCHEMA_VERSION = 12;

export const RATION_MEAL_STATES = ["unmarked", "eaten", "changed", "skipped"];
export const RATION_DISCREPANCY_KINDS = ["added", "excluded", "replaced", "amount"];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const DAY_MS = 86400000;
const MEAL_STATES = new Set(RATION_MEAL_STATES);
const DISCREPANCY_KINDS = new Set(RATION_DISCREPANCY_KINDS);

export function emptyRation() {
  return { versions: [], specialDays: {}, history: {}, profile: defaultRationProfile() };
}

export function defaultRationProfile() {
  return {
    ageGroup: "",
    heightCm: null,
    weightKg: null,
    goal: "",
    mealsPerDay: null,
    schedule: "",
    budget: null,
    preferences: "",
    excludedProducts: [],
    targetCalories: null,
    targetProtein: null,
    targetFat: null,
    targetCarbs: null,
    updatedAt: "",
    updatedBy: "",
  };
}

export function validateRationProfile(profile) {
  const source = profile && typeof profile === "object" ? profile : {};
  const missing = [];
  const violations = [];
  if (!String(source.ageGroup || "").trim()) missing.push("ageGroup");
  if (!String(source.goal || "").trim()) missing.push("goal");
  if (!isFilledNumber(source.heightCm)) missing.push("heightCm");
  if (!isFilledNumber(source.weightKg)) missing.push("weightKg");
  if (!isFilledNumber(source.mealsPerDay)) missing.push("mealsPerDay");
  if (!isFilledNumber(source.targetCalories)) missing.push("targetCalories");
  const height = Number(source.heightCm);
  if (Number.isFinite(height) && (height <= 0 || height > 300)) violations.push("heightCm");
  const weight = Number(source.weightKg);
  if (Number.isFinite(weight) && (weight <= 0 || weight > 1000)) violations.push("weightKg");
  const meals = Number(source.mealsPerDay);
  if (Number.isFinite(meals) && (meals < 1 || meals > 12)) violations.push("mealsPerDay");
  const calories = Number(source.targetCalories);
  if (Number.isFinite(calories) && calories < 0) violations.push("targetCalories");
  ["targetProtein", "targetFat", "targetCarbs"].forEach((key) => {
    const value = Number(source[key]);
    if (Number.isFinite(value) && value < 0) violations.push(key);
  });
  const protein = Number(source.targetProtein);
  const fat = Number(source.targetFat);
  const carbs = Number(source.targetCarbs);
  if ([protein, fat, carbs, calories].every(Number.isFinite) && calories > 0) {
    const macroCalories = protein * 4 + fat * 9 + carbs * 4;
    if (Math.abs(macroCalories - calories) / calories > 0.15) violations.push("macroMismatch");
  }
  return { ok: missing.length === 0 && violations.length === 0, missing, violations };
}

export function migrateRationState(source) {
  const state = source && typeof source === "object" ? source : {};
  const result = { ...state };
  const owner = rationOwner(state);
  const legacyDays = normalizeLegacyRationDays(state.rationDays, owner);
  const legacyTemplates = Array.isArray(state.rationTemplates)
    ? state.rationTemplates.filter((template) => template && typeof template === "object")
    : [];
  delete result.rationDays;
  const ration = state.ration && typeof state.ration === "object" ? state.ration : null;
  const hasContent = Boolean(
    ration && (
      (Array.isArray(ration.versions) && ration.versions.length)
      || (ration.specialDays && Object.keys(ration.specialDays).length)
      || (ration.history && Object.keys(ration.history).length)
    )
  );
  result.ration = hasContent ? normalizeRation(ration) : buildRationFromLegacy(legacyDays, legacyTemplates, owner);
  result.schemaVersion = RATION_SCHEMA_VERSION;
  return result;
}

export function normalizeLegacyRationDays(source, fallbackOwner = "local") {
  const result = {};
  const values = source && typeof source === "object" ? Object.values(source) : [];
  values.forEach((day) => {
    if (!day?.date || !DATE_PATTERN.test(day.date)) return;
    const owner = ownerKey(day.owner || fallbackOwner);
    const meals = (day.meals || []).filter((meal) => {
      const legacyNames = ["Завтрак", "Обед", "Ужин"];
      const legacyTimes = ["08:00", "13:00", "19:00"];
      const legacyIndex = Number(String(meal.id || "").match(new RegExp(`^meal_${day.date}_(\\d+)$`))?.[1]) - 1;
      return !(
        legacyIndex >= 0
        && meal.name === legacyNames[legacyIndex]
        && meal.time === legacyTimes[legacyIndex]
        && !(meal.items || []).length
      );
    });
    result[`${owner}|${day.date}`] = { ...day, meals, owner };
  });
  return result;
}

export function readRationDay(state, dateKey) {
  if (!DATE_PATTERN.test(String(dateKey || ""))) return null;
  const owner = rationOwner(state);
  const special = state.ration?.specialDays?.[`${owner}|${dateKey}`];
  if (special) {
    return {
      date: dateKey,
      owner,
      source: "special",
      meals: special.meals || [],
      updatedAt: special.updatedAt || "",
      updatedBy: special.updatedBy || "",
    };
  }
  const version = activeRationVersion(state.ration, owner, dateKey);
  if (!version) return null;
  const cycleDay = cycleDayFor(version.cycle, dateKey);
  if (!cycleDay) return null;
  return {
    date: dateKey,
    owner,
    source: "cycle",
    versionId: version.id,
    meals: cycleDay.meals || [],
    updatedAt: version.updatedAt || version.createdAt || "",
    updatedBy: version.updatedBy || "",
  };
}

export function readRationRange(state, fromKey, toKey) {
  const days = [];
  if (!DATE_PATTERN.test(String(fromKey || "")) || !DATE_PATTERN.test(String(toKey || ""))) return days;
  let cursor = fromKey;
  for (let guard = 0; cursor <= toKey && guard < 400; guard += 1) {
    const day = readRationDay(state, cursor);
    if (day) days.push(day);
    cursor = formatRationDate(new Date(validDate(cursor).getTime() + DAY_MS));
  }
  return days;
}
export function readRationHistoryDay(state, dateKey) {
  if (!DATE_PATTERN.test(String(dateKey || ""))) return null;
  const owner = rationOwner(state);
  const entry = state.ration?.history?.[`${owner}|${dateKey}`];
  if (!entry) return null;
  return {
    date: dateKey,
    owner,
    versionId: entry.versionId || "",
    meals: entry.meals || {},
  };
}

const NUTRITION_FIELDS = ["calories", "protein", "fat", "carbs", "fiber"];

export function readRationDayNutrition(state, dateKey) {
  const day = readRationDay(state, dateKey);
  const result = {
    date: dateKey,
    source: day?.source || "empty",
    totals: { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 },
    perMeal: [],
    missing: [],
  };
  if (!day) return result;
  const products = state.products || [];
  day.meals.forEach((meal) => {
    const mealTotals = { mealId: meal.id, name: meal.name || "", calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 };
    (meal.items || []).forEach((item) => {
      const product = products.find((value) => value.id === item.productId && !value.deletedAt)
        || products.find((value) => value.id === item.productId);
      const measure = rationMeasure(product);
      const portionSize = Number(item.portionSize) || measure.defaultPortion;
      const unit = String(item.measureUnit || measure.unit || "г");
      const portion = portionToBase(portionSize, unit);
      if (portion.kind === "piece") {
        result.missing.push({ mealId: meal.id, itemId: item.id, reason: "piece_weight_unknown" });
        return;
      }
      if (!product?.nutrition) {
        result.missing.push({ mealId: meal.id, itemId: item.id, reason: "no_nutrition" });
        return;
      }
      const factor = portion.base / 100;
      NUTRITION_FIELDS.forEach((field) => {
        const raw = product.nutrition[field];
        if (raw == null || raw === "") {
          result.missing.push({ mealId: meal.id, itemId: item.id, field, reason: "nutrient_unknown" });
          return;
        }
        const value = Number(raw);
        if (!Number.isFinite(value)) {
          result.missing.push({ mealId: meal.id, itemId: item.id, field, reason: "nutrient_unknown" });
          return;
        }
        mealTotals[field] += value * factor;
      });
    });
    NUTRITION_FIELDS.forEach((field) => {
      mealTotals[field] = round2(mealTotals[field]);
      result.totals[field] += mealTotals[field];
    });
    result.perMeal.push(mealTotals);
  });
  NUTRITION_FIELDS.forEach((field) => {
    result.totals[field] = round2(result.totals[field]);
  });
  return result;
}

function portionToBase(amount, unit) {
  const value = String(unit || "").toLowerCase();
  if (value.includes("шт")) return { kind: "piece" };
  if (value.includes("кг") || value === "л" || value.includes("литр")) return { kind: "volume", base: Number(amount) * 1000 };
  return { kind: "volume", base: Number(amount) };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

export function activeRationVersion(ration, owner, dateKey) {
  const versions = (ration?.versions || []).filter((version) =>
    (version.owner || "local") === ownerKey(owner) && DATE_PATTERN.test(version.effectiveFrom || "")
  );
  if (!versions.length) return null;
  const sorted = versions.slice().sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom) || String(a.id).localeCompare(String(b.id))
  );
  if (String(dateKey) < sorted[0].effectiveFrom) return null;
  let active = sorted[0];
  for (const version of sorted) {
    if (version.effectiveFrom <= dateKey) active = version;
    else break;
  }
  return active;
}

export function cycleDayFor(cycle, dateKey) {
  const days = cycle?.days || [];
  if (!days.length) return null;
  const anchor = validDate(cycle.anchor);
  const target = validDate(dateKey);
  if (!anchor || !target) return null;
  const index = cycle.weekdayBinding && days.length === 7
    ? (target.getDay() - anchor.getDay() + 7) % 7
    : ((Math.round((target - anchor) / DAY_MS) % days.length) + days.length) % days.length;
  return days[index] || null;
}

export function executeRationCommand(state, command, context = {}) {
  const next = structuredClone(state && typeof state === "object" ? state : {});
  if (!next.ration || typeof next.ration !== "object") next.ration = emptyRation();
  const ctx = {
    now: context.now || new Date().toISOString(),
    actor: context.actor || rationOwner(next),
  };
  const payload = runRationCommand(next, command, ctx);
  if (payload.ok === false) return payload;
  return { ...payload, state: next };
}

export function plannedRationRequestItems(state, dates, selectedItemIds) {
  const portions = new Map();
  const selected = selectedItemIds instanceof Set ? selectedItemIds : new Set(selectedItemIds || []);
  (dates || []).forEach((dateKey) => (readRationDay(state, dateKey)?.meals || []).forEach((meal) =>
    (meal.items || []).forEach((item) => {
      if (!item.productId || !selected.has(item.id)) return;
      const product = (state.products || []).find((value) => value.id === item.productId);
      const measure = rationMeasure(product);
      const portionSize = Number(item.portionSize) || measure.defaultPortion;
      const packageSize = Number(item.packageSize) || measure.defaultPackage;
      const current = portions.get(item.productId) || {
        productId: item.productId,
        plannedAmount: 0,
        packageSize,
        measureUnit: item.measureUnit || measure.unit,
      };
      current.plannedAmount += portionSize;
      current.packageSize = packageSize;
      portions.set(item.productId, current);
    })
  ));
  return [...portions.values()].map((item) => ({
    ...item,
    quantity: Math.max(1, Math.ceil(item.plannedAmount / item.packageSize)),
    unit: "уп.",
  }));
}

export function resolveOrCreateProduct(source, draft, changedAt, actor) {
  const name = String(draft.name || draft.query || "").trim();
  const existingById = draft.productId
    ? (source.products || []).find((product) => product.id === draft.productId && !product.deletedAt)
    : null;
  if (existingById) return existingById;
  const key = normalizeProductName(name);
  if (key) {
    const existing = (source.products || []).find((product) =>
      !product.deletedAt && normalizeProductName(product.name) === key
    );
    if (existing) return existing;
  }
  if (!name) return null;
  const catalog = draft.hint && typeof draft.hint === "object" ? draft.hint : null;
  const category = catalog?.category || "";
  const product = {
    id: createId("product"),
    name,
    category,
    unit: catalog?.unit || draft.unit || "шт.",
    brand: catalog?.brand || "",
    kind: catalog?.kind || (catalog?.barcode ? "sku" : "generic"),
    genericKey: catalog?.genericKey || genericKeyFromParts(category, name),
    confirmed: false,
    updatedAt: changedAt,
    updatedBy: actor,
    nutrition: catalog?.nutrition ? structuredClone(catalog.nutrition) : null,
    barcode: catalog?.barcode || "",
    ingredients: catalog?.ingredients || "",
    catalogSource: catalog?.catalogSource || (catalog ? "Встроенный справочник" : ""),
    nutritionSource: catalog?.catalogSource || (catalog ? "Справочник" : ""),
  };
  source.products = source.products || [];
  source.products.push(product);
  return product;
}

export function cloneMealsWithNewIds(meals) {
  return (meals || []).map((meal, mealIndex) => ({
    id: createId("meal"),
    name: meal.name || `Приём пищи ${mealIndex + 1}`,
    time: defaultRationMealTime(meal, mealIndex),
    items: (meal.items || []).map((item) => ({
      id: createId("ration_item"),
      productId: item.productId || "",
      name: item.name || "",
      portionSize: Number(item.portionSize) || 0,
      packageSize: Number(item.packageSize) || 0,
      measureUnit: item.measureUnit || "",
    })),
  }));
}

export function rationMeasure(product) {
  const unit = String(product?.unit || "г").toLowerCase();
  if (unit.includes("шт")) return { unit: "шт.", defaultPortion: 1, defaultPackage: 1 };
  if (unit === "л" || unit.includes("мл")) return { unit: "мл", defaultPortion: 250, defaultPackage: 1000 };
  return { unit: "г", defaultPortion: 100, defaultPackage: 1000 };
}

export function rationOwner(source) {
  return ownerKey(source?.user?.email || "local");
}

export function rationDayKey(dateKey, source) {
  return `${rationOwner(source)}|${dateKey}`;
}

export function todayDateKey() {
  return formatRationDate(new Date());
}

export function parseRationDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function formatRationDate(value) {
  const date = value instanceof Date ? value : parseRationDate(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeProductName(name) {
  return String(name || "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
}

export function genericKeyFromParts(category, name, fallback = "") {
  if (category) return normalizeGenericKey(category);
  const first = String(name || "").trim().split(/\s+/)[0] || fallback;
  return normalizeGenericKey(first);
}

function normalizeGenericKey(value) {
  return normalizeProductName(value).replace(/[^a-zа-яё0-9]+/gi, "_").replace(/^_|_$/g, "");
}

function runRationCommand(next, command, ctx) {
  const type = String(command?.type || "");
  const ration = next.ration;
  const owner = rationOwner(next);
  switch (type) {
    case "addMeal": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      const day = ensureSpecialDay(ration, owner, date, ctx);
      const meal = {
        id: createId("meal"),
        name: `Приём пищи ${day.meals.length + 1}`,
        time: defaultRationMealTime(null, day.meals.length),
        items: [],
      };
      day.meals.push(meal);
      touchSpecialDay(day, ctx);
      return { ok: true, mealId: meal.id };
    }
    case "updateMeal": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      if (!projectionHasMeal(next, date, command.mealId)) return fail("Приём пищи не найден.");
      const day = ensureSpecialDay(ration, owner, date, ctx);
      const meal = day.meals.find((item) => item.id === command.mealId);
      if (!meal) return fail("Приём пищи не найден.");
      if (command.fields?.name != null) meal.name = String(command.fields.name).trim() || "Приём пищи";
      if (command.fields?.time != null) meal.time = TIME_PATTERN.test(command.fields.time) ? command.fields.time : "12:00";
      touchSpecialDay(day, ctx);
      return { ok: true, mealId: meal.id };
    }
    case "removeMeal": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      if (!projectionHasMeal(next, date, command.mealId)) return fail("Приём пищи не найден.");
      const day = ensureSpecialDay(ration, owner, date, ctx);
      const before = day.meals.length;
      day.meals = day.meals.filter((item) => item.id !== command.mealId);
      if (day.meals.length === before) return fail("Приём пищи не найден.");
      touchSpecialDay(day, ctx);
      return { ok: true };
    }
    case "addItem": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      if (!projectionHasMeal(next, date, command.mealId)) return fail("Приём пищи не найден.");
      const day = ensureSpecialDay(ration, owner, date, ctx);
      const meal = day.meals.find((item) => item.id === command.mealId);
      const item = { id: createId("ration_item"), productId: "", name: "" };
      meal.items = meal.items || [];
      meal.items.push(item);
      touchSpecialDay(day, ctx);
      return { ok: true, itemId: item.id, mealId: meal.id };
    }
    case "saveItem": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      if (!projectionHasItem(next, date, command.itemId)) return fail("Позиция рациона не найдена.");
      const day = ensureSpecialDay(ration, owner, date, ctx);
      const item = day.meals.flatMap((meal) => meal.items || []).find((entry) => entry.id === command.itemId);
      if (!item) return fail("Позиция рациона не найдена.");
      const product = resolveOrCreateProduct(next, { name: command.name, hint: command.hint }, ctx.now, ctx.actor);
      item.productId = product.id;
      item.name = product.name;
      let nextItemId = "";
      if (command.addNext) {
        const meal = day.meals.find((entry) => (entry.items || []).some((value) => value.id === command.itemId));
        const nextItem = { id: createId("ration_item"), productId: "", name: "" };
        meal.items = meal.items || [];
        meal.items.push(nextItem);
        nextItemId = nextItem.id;
      }
      touchSpecialDay(day, ctx);
      return { ok: true, itemId: item.id, nextItemId, mealId: command.mealId };
    }
    case "removeItem": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      if (!projectionHasItem(next, date, command.itemId)) return fail("Позиция рациона не найдена.");
      const day = ensureSpecialDay(ration, owner, date, ctx);
      let removed = false;
      day.meals.forEach((meal) => {
        const before = (meal.items || []).length;
        meal.items = (meal.items || []).filter((item) => item.id !== command.itemId);
        if (meal.items.length !== before) removed = true;
      });
      if (!removed) return fail("Позиция рациона не найдена.");
      touchSpecialDay(day, ctx);
      return { ok: true, mealId: command.mealId };
    }
    case "setPortion": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      if (!projectionHasItem(next, date, command.itemId)) return fail("Позиция рациона не найдена.");
      const day = ensureSpecialDay(ration, owner, date, ctx);
      const item = day.meals.flatMap((meal) => meal.items || []).find((entry) => entry.id === command.itemId);
      if (!item) return fail("Позиция рациона не найдена.");
      item.portionSize = Number(command.portionSize) || 1;
      item.packageSize = Number(command.packageSize) || 1;
      item.measureUnit = command.measureUnit || item.measureUnit || "г";
      touchSpecialDay(day, ctx);
      return { ok: true, itemId: item.id };
    }
    case "replaceDays": {
      const dates = [...new Set((command.dates || []).map(commandDate).filter(Boolean))];
      if (!dates.length) return fail("Выберите дни для шаблона.");
      dates.forEach((dateKey) => {
        const day = ensureSpecialDay(ration, owner, dateKey, ctx, { materialize: false });
        day.meals = cloneMealsWithNewIds(command.meals);
        touchSpecialDay(day, ctx);
      });
      return { ok: true, dates };
    }
    case "createCycle":
    case "releaseVersion": {
      return releaseVersion(ration, owner, command, ctx);
    }
    case "setSpecialDay": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      const day = ensureSpecialDay(ration, owner, date, ctx, { materialize: false });
      day.meals = command.meals ? structuredClone(command.meals) : [];
      touchSpecialDay(day, ctx);
      return { ok: true, date };
    }
    case "removeSpecialDay": {
      const date = commandDate(command.date);
      if (!date) return fail("Некорректная дата.");
      const key = `${owner}|${date}`;
      if (!ration.specialDays[key]) return fail("Особый день не найден.");
      delete ration.specialDays[key];
      return { ok: true, date };
    }
    case "markMeal": {
      return markMeal(next, ration, owner, command, ctx);
    }
    case "recordDiscrepancy": {
      return recordDiscrepancy(next, ration, owner, command, ctx);
    }
    case "transferMeals": {
      return transferMeals(next, ration, owner, command, ctx);
    }
    case "setRationProfile": {
      const current = normalizeProfile(ration.profile);
      const fields = command.fields && typeof command.fields === "object" ? command.fields : {};
      const next = normalizeProfile({ ...current, ...fields, updatedAt: ctx.now, updatedBy: ctx.actor });
      ration.profile = next;
      return { ok: true, profile: structuredClone(next), validation: validateRationProfile(next) };
    }
    case "deleteSelection": {
      return deleteSelection(next, ration, owner, command, ctx);
    }
    default:
      return fail(`Неизвестная команда рациона: ${type || "(пусто)"}`);
  }
}

function historyWritable(ctx, date) {
  const today = DATE_PATTERN.test(ctx.today || "") ? ctx.today : String(ctx.now || "").slice(0, 10);
  if (date > today) return fail("Нельзя менять Историю питания будущего дня.");
  if (ctx.actor === "ai") return fail("ИИ не может записывать Историю питания.");
  return null;
}

function ensureHistoryEntry(ration, owner, dateKey, ctx) {
  const key = `${owner}|${dateKey}`;
  if (!ration.history[key]) {
    const version = activeRationVersion(ration, owner, dateKey);
    ration.history[key] = { date: dateKey, owner, versionId: version?.id || "", meals: {} };
  }
  return ration.history[key];
}

function mealHistory(entry, mealId) {
  if (!entry.meals[mealId]) {
    entry.meals[mealId] = { state: "unmarked", discrepancies: [], transferredMinutes: 0 };
  }
  return entry.meals[mealId];
}

function markMeal(next, ration, owner, command, ctx) {
  const date = commandDate(command.date);
  if (!date) return fail("Некорректная дата.");
  const state = String(command.state || "");
  if (!MEAL_STATES.has(state)) return fail("Неизвестное состояние приёма пищи.");
  const blocked = historyWritable(ctx, date);
  if (blocked) return blocked;
  if (!projectionHasMeal(next, date, command.mealId)) return fail("Приём пищи не найден.");
  const entry = ensureHistoryEntry(ration, owner, date, ctx);
  const meal = mealHistory(entry, command.mealId);
  meal.state = state;
  const version = activeRationVersion(ration, owner, date);
  if (version) meal.versionId = version.id;
  return { ok: true, date, mealId: command.mealId, state };
}

function recordDiscrepancy(next, ration, owner, command, ctx) {
  const date = commandDate(command.date);
  if (!date) return fail("Некорректная дата.");
  const kind = String(command.discrepancy?.kind || "");
  if (!DISCREPANCY_KINDS.has(kind)) return fail("Неизвестный вид расхождения.");
  const productId = String(command.discrepancy?.productId || "");
  const name = String(command.discrepancy?.name || "");
  if (kind !== "amount" && !productId && !name) return fail("Расхождение должно указывать Продукт.");
  if (kind === "replaced" && !String(command.discrepancy?.replacedProductId || command.discrepancy?.replacedName || "")) {
    return fail("Замена должна указывать Продукт, которым заменили.");
  }
  const blocked = historyWritable(ctx, date);
  if (blocked) return blocked;
  if (!projectionHasMeal(next, date, command.mealId)) return fail("Приём пищи не найден.");
  const entry = ensureHistoryEntry(ration, owner, date, ctx);
  const meal = mealHistory(entry, command.mealId);
  const version = activeRationVersion(ration, owner, date);
  if (version) meal.versionId = version.id;
  const discrepancy = { kind };
  if (productId) discrepancy.productId = productId;
  if (name) discrepancy.name = name;
  if (kind === "replaced" && String(command.discrepancy.replacedProductId || "")) {
    discrepancy.replacedProductId = String(command.discrepancy.replacedProductId);
  }
  if (kind === "replaced" && String(command.discrepancy.replacedName || "")) {
    discrepancy.replacedName = String(command.discrepancy.replacedName);
  }
  if (command.discrepancy.amount != null) discrepancy.amount = Number(command.discrepancy.amount) || 0;
  if (command.discrepancy.measureUnit) discrepancy.measureUnit = String(command.discrepancy.measureUnit);
  meal.discrepancies.push(discrepancy);
  if (meal.state === "unmarked") meal.state = "changed";
  return { ok: true, date, mealId: command.mealId, discrepancy };
}

function transferMeals(next, ration, owner, command, ctx) {
  const date = commandDate(command.date);
  if (!date) return fail("Некорректная дата.");
  const minutes = Number(command.minutes);
  if (!Number.isFinite(minutes) || minutes === 0) return fail("Перенос требует ненулевого сдвига в минутах.");
  const blocked = historyWritable(ctx, date);
  if (blocked) return blocked;
  const day = readRationDay(next, date);
  if (!day?.meals?.length) return fail("В этот день нет приёмов пищи.");
  const chosen = day.meals.find((meal) => meal.id === command.mealId);
  if (!chosen) return fail("Приём пищи не найден.");
  const sorted = day.meals.slice().sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
  const chosenIndex = sorted.findIndex((meal) => meal.id === chosen.id);
  const entry = ensureHistoryEntry(ration, owner, date, ctx);
  const shifted = [];
  for (let index = chosenIndex; index < sorted.length; index += 1) {
    const meal = sorted[index];
    const history = entry.meals[meal.id];
    const marked = history && history.state !== "unmarked";
    if (index > chosenIndex && marked) continue;
    const newMinutes = timeMinutes(meal.time) + minutes;
    if (newMinutes < 0 || newMinutes >= 1440) {
      if (!command.confirmMidnight) {
        return fail("Перенос сдвигает приём пищи через полночь и требует явного подтверждения.");
      }
    }
    const record = mealHistory(entry, meal.id);
    record.transferredMinutes = (Number(record.transferredMinutes) || 0) + minutes;
    const version = activeRationVersion(ration, owner, date);
    if (version) record.versionId = version.id;
    shifted.push(meal.id);
  }
  if (!shifted.length) return fail("Нет приёмов пищи для переноса.");
  return { ok: true, date, shifted };
}

function timeMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function releaseVersion(ration, owner, command, ctx) {
  const days = Array.isArray(command.days) ? command.days : [];
  if (!days.length) return fail("Цикл должен содержать хотя бы один день.");
  const anchor = commandDate(command.anchor);
  if (!anchor) return fail("Некорректная опорная дата.");
  const effectiveFrom = commandDate(command.effectiveFrom) || anchor;
  const weekdayBinding = Boolean(command.weekdayBinding);
  const version = {
    id: createId("ration_version"),
    owner,
    effectiveFrom,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    updatedBy: ctx.actor,
    cycle: {
      anchor,
      weekdayBinding,
      days: days.map((day, index) => {
        const sourceDay = day && typeof day === "object" ? day : {};
        return {
          id: sourceDay.id || `cycle_day_${effectiveFrom}_${index}`,
          meals: structuredClone(sourceDay.meals || []),
        };
      }),
    },
  };
  ration.versions.push(version);
  return { ok: true, versionId: version.id, effectiveFrom };
}

function deleteSelection(next, ration, owner, command, ctx) {
  const mealIds = new Set((command.mealIds || []).map(String));
  const itemIds = new Set((command.itemIds || []).map(String));
  const dates = new Set((command.dates || []).filter((value) => DATE_PATTERN.test(String(value || ""))));
  if (!mealIds.size && !itemIds.size && !dates.size) return fail("Ничего не выбрано.");
  const datesToEdit = new Set(dates);
  const foundMealIds = new Set();
  const foundItemIds = new Set();
  Object.values(ration.specialDays).forEach((day) => {
    (day.meals || []).forEach((meal) => {
      if (mealIds.has(meal.id)) {
        foundMealIds.add(meal.id);
        datesToEdit.add(day.date);
      }
      (meal.items || []).forEach((item) => {
        if (itemIds.has(item.id)) {
          foundItemIds.add(item.id);
          datesToEdit.add(day.date);
        }
      });
    });
  });
  let changed = false;
  datesToEdit.forEach((dateKey) => {
    const day = ensureSpecialDay(ration, owner, dateKey, ctx);
    let dayChanged = false;
    if (mealIds.size) {
      const before = day.meals.length;
      day.meals = day.meals.filter((meal) => !mealIds.has(meal.id));
      dayChanged = day.meals.length !== before;
    } else if (itemIds.size) {
      day.meals.forEach((meal) => {
        const before = (meal.items || []).length;
        meal.items = (meal.items || []).filter((item) => !itemIds.has(item.id));
        if (meal.items.length !== before) dayChanged = true;
      });
    } else if (dates.has(dateKey) && day.meals.length) {
      day.meals = [];
      dayChanged = true;
    }
    if (dayChanged) {
      touchSpecialDay(day, ctx);
      changed = true;
    }
  });
  const leftoverMealIds = [...mealIds].filter((id) => !foundMealIds.has(id));
  const leftoverItemIds = [...itemIds].filter((id) => !foundItemIds.has(id));
  if (leftoverMealIds.length || leftoverItemIds.length) {
    const leftoverMeals = new Set(leftoverMealIds);
    const leftoverItems = new Set(leftoverItemIds);
    (ration.versions || []).forEach((version) => {
      let versionChanged = false;
      (version.cycle?.days || []).forEach((cycleDay) => {
        if (leftoverMeals.size) {
          const before = cycleDay.meals.length;
          cycleDay.meals = cycleDay.meals.filter((meal) => !leftoverMeals.has(meal.id));
          if (cycleDay.meals.length !== before) versionChanged = true;
        } else {
          (cycleDay.meals || []).forEach((meal) => {
            const before = (meal.items || []).length;
            meal.items = (meal.items || []).filter((item) => !leftoverItems.has(item.id));
            if (meal.items.length !== before) versionChanged = true;
          });
        }
      });
      if (versionChanged) {
        version.updatedAt = ctx.now;
        version.updatedBy = ctx.actor;
        changed = true;
      }
    });
  }
  if (!changed) return fail("В сохранённом рационе нечего удалять.");
  return { ok: true };
}

function ensureSpecialDay(ration, owner, dateKey, ctx, { materialize = true } = {}) {
  const key = `${owner}|${dateKey}`;
  if (!ration.specialDays[key]) {
    const day = { date: dateKey, owner, meals: [], updatedAt: "", updatedBy: "" };
    if (materialize) {
      const version = activeRationVersion(ration, owner, dateKey);
      const cycleDay = version ? cycleDayFor(version.cycle, dateKey) : null;
      if (cycleDay) day.meals = structuredClone(cycleDay.meals || []);
    }
    ration.specialDays[key] = day;
  }
  return ration.specialDays[key];
}

function touchSpecialDay(day, ctx) {
  day.updatedAt = ctx.now;
  day.updatedBy = ctx.actor;
}

function projectionHasMeal(state, dateKey, mealId) {
  return Boolean(readRationDay(state, dateKey)?.meals?.some((meal) => meal.id === mealId));
}

function projectionHasItem(state, dateKey, itemId) {
  return Boolean(readRationDay(state, dateKey)?.meals?.some((meal) =>
    (meal.items || []).some((item) => item.id === itemId)
  ));
}

function commandDate(value) {
  return DATE_PATTERN.test(String(value || "")) ? String(value) : "";
}

function defaultRationMealTime(meal, index = 0) {
  return TIME_PATTERN.test(meal?.time || "")
    ? meal.time
    : ["08:00", "13:00", "19:00"][index] || `${String(Math.min(22, 8 + index * 3)).padStart(2, "0")}:00`;
}

function buildRationFromLegacy(days, templates, owner) {
  const ration = emptyRation();
  const byOwner = new Map();
  Object.values(days).forEach((day) => {
    const list = byOwner.get(day.owner) || [];
    list.push(day);
    byOwner.set(day.owner, list);
  });
  byOwner.forEach((list, dayOwner) => {
    const sorted = list.slice().sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted.reduce((acc, day) =>
      timestampOf(day.updatedAt) >= timestampOf(acc?.updatedAt) ? day : acc
    , sorted[0]);
    ration.versions.push({
      id: `ration_version_${dayOwner}_${sorted[0].date}`,
      owner: dayOwner,
      effectiveFrom: sorted[0].date,
      createdAt: latest.updatedAt || "",
      updatedAt: latest.updatedAt || "",
      updatedBy: latest.updatedBy || "local",
      cycle: {
        anchor: sorted[0].date,
        weekdayBinding: isConsecutiveWeek(sorted),
        days: sorted.map((day) => ({ id: `cycle_day_${day.date}`, meals: structuredClone(day.meals || []) })),
      },
    });
    sorted.forEach((day) => {
      ration.specialDays[`${dayOwner}|${day.date}`] = structuredClone(day);
    });
  });
  ration.profile = normalizeProfile(ration.profile);
  if (!byOwner.size) {
    const template = templates
      .filter((item) => ownerKey(item.owner) === owner)
      .sort((a, b) => timestampOf(b.updatedAt) - timestampOf(a.updatedAt) || timestampOf(b.createdAt) - timestampOf(a.createdAt))[0];
    if (template?.meals?.length) {
      const when = String(template.updatedAt || template.createdAt || "").slice(0, 10);
      ration.versions.push({
        id: `ration_version_${owner}_template_${template.id}`,
        owner,
        effectiveFrom: DATE_PATTERN.test(when) ? when : "",
        createdAt: template.updatedAt || template.createdAt || "",
        updatedAt: template.updatedAt || template.createdAt || "",
        updatedBy: template.updatedBy || "local",
        cycle: {
          anchor: DATE_PATTERN.test(when) ? when : "",
          weekdayBinding: false,
          days: [{ id: `cycle_day_template_${template.id}`, meals: cloneMealsWithNewIds(template.meals) }],
        },
      });
    }
  }
  return ration;
}

function isConsecutiveWeek(sorted) {
  if (sorted.length !== 7) return false;
  return sorted.every((day, index) =>
    index === 0 || Math.round((validDate(day.date) - validDate(sorted[index - 1].date)) / DAY_MS) === 1
  );
}

function normalizeRation(ration) {
  return {
    versions: (Array.isArray(ration.versions) ? ration.versions : []).map((version, index) => normalizeVersion(version, index)),
    specialDays: normalizeSpecialDays(ration.specialDays),
    history: ration.history && typeof ration.history === "object" ? structuredClone(ration.history) : {},
    profile: normalizeProfile(ration.profile),
  };
}

function normalizeProfile(profile) {
  const source = profile && typeof profile === "object" ? profile : {};
  return {
    ageGroup: String(source.ageGroup || ""),
    heightCm: finiteOrNull(source.heightCm),
    weightKg: finiteOrNull(source.weightKg),
    goal: String(source.goal || ""),
    mealsPerDay: finiteOrNull(source.mealsPerDay),
    schedule: String(source.schedule || ""),
    budget: finiteOrNull(source.budget),
    preferences: String(source.preferences || ""),
    excludedProducts: Array.isArray(source.excludedProducts) ? source.excludedProducts.map((value) => String(value)) : [],
    targetCalories: finiteOrNull(source.targetCalories),
    targetProtein: finiteOrNull(source.targetProtein),
    targetFat: finiteOrNull(source.targetFat),
    targetCarbs: finiteOrNull(source.targetCarbs),
    updatedAt: String(source.updatedAt || ""),
    updatedBy: String(source.updatedBy || ""),
  };
}

function finiteOrNull(value) {
  if (value === "" || value == null) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function isFilledNumber(value) {
  return finiteOrNull(value) != null;
}

function normalizeVersion(version, index) {
  const source = version && typeof version === "object" ? version : {};
  const cycle = source.cycle && typeof source.cycle === "object" ? source.cycle : {};
  return {
    ...source,
    id: source.id || `ration_version_${index}`,
    owner: ownerKey(source.owner),
    effectiveFrom: DATE_PATTERN.test(source.effectiveFrom || "") ? source.effectiveFrom : "",
    cycle: {
      anchor: DATE_PATTERN.test(cycle.anchor || "") ? cycle.anchor : "",
      weekdayBinding: Boolean(cycle.weekdayBinding),
      days: (Array.isArray(cycle.days) ? cycle.days : []).map((day, dayIndex) => {
        const sourceDay = day && typeof day === "object" ? day : {};
        return {
          id: sourceDay.id || `cycle_day_${dayIndex}`,
          meals: Array.isArray(sourceDay.meals) ? sourceDay.meals : [],
        };
      }),
    },
  };
}

function normalizeSpecialDays(source) {
  const result = {};
  const values = source && typeof source === "object" ? Object.values(source) : [];
  values.forEach((day) => {
    if (!day?.date || !DATE_PATTERN.test(day.date)) return;
    const owner = ownerKey(day.owner);
    result[`${owner}|${day.date}`] = { ...day, meals: day.meals || [], owner };
  });
  return result;
}

function validDate(value) {
  const date = value instanceof Date ? value : parseRationDate(value);
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function ownerKey(value) {
  return String(value || "local").trim().toLowerCase() || "local";
}

function timestampOf(value) {
  const result = Date.parse(value || "");
  return Number.isFinite(result) ? result : 0;
}

function fail(reason) {
  return { ok: false, reason };
}
