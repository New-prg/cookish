// One-way import of the current app's data into the object space. Products,
// the Рацион and the План тренировок with their versions (week plans) and
// Особые дни, История питания and Учёт тренировок as facts, Запросы with
// their Покупки, and the Профиль. The legacy key is only read.
import { checkValue, emptyObjectState, localDateKey } from "./store.js";
import { cycleDayName, planDay, shiftDate } from "./domain.js";

export const LEGACY_KEY = "cookish.android.data.v1";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EPOCH = new Date(0).toISOString();
const MEAL_STATES = new Set(["unmarked", "eaten", "changed", "skipped"]);
const SESSION_STATES = new Set(["unmarked", "done", "changed", "skipped"]);
const DISCREPANCY_KINDS = new Set(["added", "excluded", "replaced", "amount"]);
const SPORT_KINDS = { strength: "Силовая", run: "Бег", swim: "Плавание", bike: "Велосипед", walk: "Ходьба", yoga: "Йога", other: "Другое" };
const INTENSITIES = new Set(["low", "medium", "high"]);
const AGE_GROUPS = { "Ребёнок": "child", child: "child", "Подросток": "teen", teen: "teen", teenager: "teen", "Взрослый": "adult", adult: "adult", "Пожилой": "senior", senior: "senior", elderly: "senior" };
const GOALS = { "Снижение веса": "lose", lose: "lose", "Поддержание веса": "keep", keep: "keep", "Набор массы": "gain", gain: "gain" };
const NUTRITION_SOURCES = { "Вы": "person", "Введено пользователем": "person", "Open Food Facts": "off", "Справочник": "reference", "Встроенный справочник": "reference", "Оценка ИИ": "estimate", "Ассистент": "estimate" };

const ownerKey = (value) => String(value || "local").trim().toLowerCase() || "local";
const finite = (value) => (value === "" || value == null || !Number.isFinite(Number(value)) ? undefined : Number(value));
const stamp = (value) => (Number.isFinite(Date.parse(value || "")) ? value : EPOCH);
const dayOf = (value, fallback) => (Number.isFinite(Date.parse(value || "")) ? localDateKey(new Date(Date.parse(value))) : fallback);
const list = (value) => (Array.isArray(value) ? value : []);
const entries = (value) => (value && typeof value === "object" ? Object.entries(value) : []);

// Units of the closed «Единица» list. A portion keeps the legacy arithmetic
// (pieces, ×1000 for кг and л, everything else as is), so an unknown unit of
// a portion becomes «г»; an unknown unit of a Запрос counts things, «шт.».
function normalizeUnit(raw, fallback = "г") {
  const unit = String(raw || "").trim().toLowerCase();
  if (unit.includes("шт")) return "шт.";
  if (unit.includes("кг")) return "кг";
  if (unit === "л" || unit.includes("литр")) return "л";
  if (unit.includes("мл")) return "мл";
  if (unit.startsWith("уп")) return "уп.";
  if (unit === "г" || unit.startsWith("гр")) return "г";
  return fallback;
}

// rationMeasure of the legacy Рацион, on the raw product unit.
function rationMeasure(product) {
  const unit = String(product?.unit || "г").toLowerCase();
  if (unit.includes("шт")) return { unit: "шт.", portion: 1, pack: 1 };
  if (unit === "л" || unit.includes("мл")) return { unit: "мл", portion: 250, pack: 1000 };
  return { unit: "г", portion: 100, pack: 1000 };
}

function clampMinutes(value, fallback) {
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes) || minutes <= 0) return fallback;
  return Math.min(minutes, 24 * 60);
}

// normalizeSession of the legacy Спорт.
function sessionProps(session) {
  return {
    kind: SPORT_KINDS[session?.type] ? session.type : "other",
    time: /^\d{2}:\d{2}$/.test(session?.time || "") ? session.time : "18:00",
    duration: clampMinutes(session?.durationMin, 45),
    intensity: INTENSITIES.has(session?.intensity) ? session.intensity : "medium",
    note: session?.note ? String(session.note).slice(0, 300) : undefined,
  };
}

function space(now) {
  const objects = {};
  let counter = 0;
  const claim = (type, wanted) => {
    let id = wanted ? String(wanted) : `${type}_lg${++counter}`;
    while (objects[id]) id = `${wanted || type}_lg${++counter}`;
    objects[id] = null;
    return id;
  };
  const put = (type, name, props, { id = claim(type), createdAt = now, updatedAt = createdAt, archivedAt } = {}) => {
    const clean = Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined && value !== null && value !== ""));
    objects[id] = { id, type, name: String(name || "").slice(0, 200), props: clean, createdAt, updatedAt, createdBy: "import", updatedBy: "import", ...(archivedAt ? { archivedAt } : {}) };
    return id;
  };
  return { objects, claim, put };
}

export function legacyToObjects(legacy, { today = localDateKey(), now = new Date().toISOString() } = {}) {
  const source = legacy && typeof legacy === "object" ? legacy : {};
  const owner = ownerKey(source.user?.email);
  const { objects, claim, put } = space(now);

  // The legacy readers prefer a live product with the id and fall back to a
  // deleted one.
  const products = new Map();
  for (const product of list(source.products)) {
    if (!product?.id) continue;
    const seen = products.get(product.id);
    if (!seen || (seen.deletedAt && !product.deletedAt)) products.set(product.id, product);
  }
  for (const product of products.values()) {
    const nutrition = product.nutrition && typeof product.nutrition === "object" ? product.nutrition : null;
    const label = nutrition ? NUTRITION_SOURCES[String(nutrition.source || "").trim()] || NUTRITION_SOURCES[String(product.catalogSource || "").trim()] || "person" : undefined;
    put("product", product.name, {
      category: product.category ? String(product.category).slice(0, 60) : undefined,
      unit: normalizeUnit(product.unit),
      kcal100: finite(nutrition?.calories),
      protein100: finite(nutrition?.protein),
      fat100: finite(nutrition?.fat),
      carbs100: finite(nutrition?.carbs),
      fiber100: finite(nutrition?.fiber),
      barcode: product.barcode || undefined,
      brand: product.brand || undefined,
      description: product.ingredients || undefined,
      nutritionSource: label,
      confirmed: product.confirmed === true || (product.confirmed !== false && Boolean(product.barcode)),
    }, { id: claim("product", product.id), createdAt: stamp(product.createdAt || product.updatedAt), updatedAt: stamp(product.updatedAt), archivedAt: product.deletedAt || undefined });
  }
  const known = (productId) => (productId && products.has(productId) ? productId : undefined);
  const productName = (productId) => products.get(productId)?.name;

  const putMeal = (meal, index) => {
    const items = list(meal?.items).map((item) => {
      const product = products.get(item?.productId);
      const measure = rationMeasure(product);
      return put("portion", product?.name || item?.name || "Продукт", {
        product: known(item?.productId),
        amount: Number(item?.portionSize) || measure.portion,
        unit: normalizeUnit(item?.measureUnit || measure.unit),
        packSize: Number(item?.packageSize) || measure.pack,
      });
    });
    return put("meal", meal?.name || `Приём пищи ${index + 1}`, { time: meal?.time, items, slot: meal?.id ? String(meal.id) : undefined });
  };
  const putSession = (session) => {
    const props = sessionProps(session);
    return put("session", SPORT_KINDS[props.kind], { ...props, slot: session?.id ? String(session.id) : undefined });
  };
  const AREA = {
    ration: { plan: source.ration, list: "meals", putItem: putMeal, title: "Рацион" },
    sport: { plan: source.sport, list: "sessions", putItem: putSession, title: "Тренировки" },
  };
  const putDay = (area, items, name, props) => {
    const ids = list(items).map((item, index) => AREA[area].putItem(item, index));
    return put("day_plan", name, { area, ...props, [AREA[area].list]: ids });
  };
  // Keys of Особые дни, История and Учёт are `${owner}|${date}`; only the
  // current owner's entries are read, as the legacy readers do.
  const ownDates = (map) => entries(map).flatMap(([key, value]) => {
    const date = key.startsWith(`${owner}|`) ? key.slice(owner.length + 1) : "";
    return DATE.test(date) ? [[date, value]] : [];
  });

  for (const [area, { plan, list: field, title }] of Object.entries(AREA)) {
    for (const version of list(plan?.versions)) {
      if (!version || (version.owner || "local") !== owner || !DATE.test(version.effectiveFrom || "")) continue;
      const cycle = version.cycle && typeof version.cycle === "object" ? version.cycle : {};
      const days = list(cycle.days);
      const anchor = DATE.test(cycle.anchor || "") ? cycle.anchor : undefined;
      const binding = Boolean(cycle.weekdayBinding);
      const dayIds = days.map((day, index) => putDay(area, day?.[field], cycleDayName(binding && days.length === 7, anchor, index), { cycleIndex: index }));
      // createdAt and the id break ties between versions of one date, as in
      // the legacy activePlanVersion.
      put("week_plan", `${title} с ${version.effectiveFrom}`, { area, effectiveFrom: version.effectiveFrom, anchor, weekdayBinding: binding, days: dayIds }, {
        id: claim("week_plan", version.id), createdAt: stamp(version.createdAt), updatedAt: stamp(version.updatedAt || version.createdAt),
      });
    }
    for (const [date, day] of ownDates(plan?.specialDays)) putDay(area, day?.[field], `Особый день ${date}`, { date });
  }

  // Facts point at the meal or session the date showed, found by slot.
  const view = { ...emptyObjectState(), objects: { ...objects } };
  const itemsBySlot = (area, date) => new Map(planDay(view, area, date).items.map((id) => [view.objects[id].props.slot || id, view.objects[id]]));

  for (const [date, entry] of ownDates(source.ration?.history)) {
    const meals = itemsBySlot("ration", date);
    for (const [slot, record] of entries(entry?.meals)) {
      const meal = meals.get(slot);
      put("meal_mark", meal?.name || "Приём пищи", {
        date, slot, meal: meal?.id,
        mealState: MEAL_STATES.has(record?.state) ? record.state : "unmarked",
        transferredMinutes: finite(record?.transferredMinutes) || undefined,
      });
      for (const discrepancy of list(record?.discrepancies)) {
        const kind = discrepancy?.kind;
        if (!DISCREPANCY_KINDS.has(kind)) continue;
        const measure = rationMeasure(products.get(discrepancy.productId));
        const added = kind === "added";
        const replacement = kind === "replaced" ? productName(discrepancy.replacedProductId) || discrepancy.replacedName : "";
        put("discrepancy", [productName(discrepancy.productId) || discrepancy.name || "Продукт", replacement].filter(Boolean).join(" → "), {
          date, slot, discrepancyKind: kind,
          product: known(discrepancy.productId),
          replacedBy: kind === "replaced" ? known(discrepancy.replacedProductId) : undefined,
          amount: added ? Number(discrepancy.amount) || measure.portion : discrepancy.amount != null ? Number(discrepancy.amount) || 0 : undefined,
          unit: added ? normalizeUnit(discrepancy.measureUnit || measure.unit) : discrepancy.measureUnit ? normalizeUnit(discrepancy.measureUnit) : undefined,
        });
      }
    }
  }

  for (const [date, entry] of ownDates(source.sport?.log)) {
    const sessions = itemsBySlot("sport", date);
    for (const [slot, record] of entries(entry?.sessions)) {
      const session = sessions.get(slot);
      put("session_mark", session?.name || "Тренировка", {
        date, slot, session: session?.id,
        sessionState: SESSION_STATES.has(record?.state) ? record.state : "unmarked",
        actualDuration: record?.actualDurationMin != null ? clampMinutes(record.actualDurationMin, undefined) : undefined,
        actualIntensity: INTENSITIES.has(record?.actualIntensity) ? record.actualIntensity : undefined,
      });
    }
    for (const session of list(entry?.unplanned)) {
      const props = sessionProps(session);
      put("activity", props.note ? props.note.slice(0, 200) : SPORT_KINDS[props.kind], { date, ...props });
    }
  }

  for (const request of list(source.requests)) {
    if (!request?.id) continue;
    const lines = new Map(list(request.items).filter((item) => item?.productId).map((item) => [item.productId, item]));
    // Requests of the oldest builds kept the purchases on the request itself.
    const responses = list(request.responses).length ? list(request.responses) : request.purchases ? [{ items: request.purchases, createdAt: request.completedAt || request.updatedAt }] : [];
    const active = responses.filter((response) => response && !response.deletedAt);
    const bought = (productId) => active.reduce((total, response) => total + list(response.items).filter((line) => line?.productId === productId).reduce((sum, line) => sum + (Number(line.quantity) || 0), 0), 0);
    const items = [...lines.values()];
    const done = items.length > 0 && items.every((item) => bought(item.productId) >= Number(item.quantity));
    const date = dayOf(request.createdAt, today);
    const requestId = claim("request", request.id);
    const itemIds = new Map(items.map((item) => [item.productId, put("request_item", productName(item.productId) || item.name || "Продукт", {
      request: requestId,
      product: known(item.productId),
      quantity: finite(item.quantity) ?? 1,
      unit: normalizeUnit(item.unit, "шт."),
      note: item.note || (item.plannedAmount ? [item.plannedAmount, item.measureUnit, "по плану"].filter(Boolean).join(" ") : undefined),
    }, { archivedAt: request.deletedAt || undefined })]));
    put("request", `Запрос от ${date}`, { status: done ? "done" : "open", date, items: [...itemIds.values()] }, {
      id: requestId, createdAt: stamp(request.createdAt), updatedAt: stamp(request.updatedAt || request.createdAt), archivedAt: request.deletedAt || undefined,
    });
    for (const response of active) {
      for (const line of list(response.items)) {
        if (!line?.productId || (!Number(line.quantity) && !Number(line.price))) continue;
        const purchased = line.purchasedProductId || line.productId;
        put("purchase", productName(purchased) || productName(line.productId) || "Покупка", {
          date: dayOf(response.updatedAt || response.createdAt, date),
          request: requestId,
          item: itemIds.get(line.productId),
          product: known(purchased) || known(line.productId),
          quantity: Number(line.quantity) || 0,
          price: Number(line.price) || 0,
        }, { archivedAt: request.deletedAt || undefined });
      }
    }
  }

  const profile = source.ration?.profile && typeof source.ration.profile === "object" ? source.ration.profile : {};
  const terms = list(profile.excludedProducts).map((term) => String(term).trim().toLocaleLowerCase("ru-RU")).filter(Boolean);
  const live = [...products.values()].filter((product) => !product.deletedAt);
  const matches = (term) => live.filter((product) => String(product.name || "").toLocaleLowerCase("ru-RU").includes(term));
  const unmatched = terms.filter((term) => !matches(term).length);
  const preferences = [
    profile.preferences,
    profile.schedule ? `Режим дня: ${profile.schedule}` : "",
    unmatched.length ? `Не ест: ${unmatched.join(", ")}` : "",
  ].filter(Boolean).join("\n");
  put("profile", "Профиль", {
    ageGroup: AGE_GROUPS[profile.ageGroup],
    heightCm: finite(profile.heightCm),
    weightKg: finite(profile.weightKg),
    goal: GOALS[profile.goal],
    mealsPerDay: finite(profile.mealsPerDay),
    budget: finite(profile.budget),
    targetCalories: finite(profile.targetCalories),
    targetProtein: finite(profile.targetProtein),
    targetFat: finite(profile.targetFat),
    targetCarbs: finite(profile.targetCarbs),
    excluded: [...new Set(terms.flatMap((term) => matches(term).map((product) => product.id)))],
    preferences: preferences || undefined,
  }, { id: claim("profile", "profile"), updatedAt: stamp(profile.updatedAt) });

  const home = putHome(put, claim, finite(profile.budget));
  const state = { ...emptyObjectState(), objects, meta: { ...emptyObjectState().meta, home } };
  state.meta.importIssues = sanitize(state);
  return state;
}

// Sets and the home dashboard, so a fresh space has something to show.
function putHome(put, claim, budget) {
  const set = (id, name, query, view) => put("set", name, { query, view }, { id: claim("set", id) });
  const products = set("set_products", "Продукты",
    { source: { type: "product" }, sorts: [{ rel: "name", dir: "asc" }] },
    { layout: "table", relations: ["category", "kcal100", "protein100", "fat100", "carbs100", "lastPrice"] });
  set("set_requests", "Запросы",
    { source: { type: "request" }, sorts: [{ rel: "date", dir: "desc" }], group: { rel: "status" } },
    { layout: "kanban", relations: ["date", "progress", "total"], groupRel: "status" });
  const sessions = set("set_sessions", "Тренировки сегодня",
    { source: { builtin: "plan", args: { area: "sport", date: "@today" } } },
    { layout: "list", relations: ["time", "kind", "duration", "intensity", "kcalBurned"] });
  const purchases = set("set_purchases", "Покупки за неделю",
    { source: { type: "purchase" }, filters: [{ rel: "date", op: "within", value: "@last7d" }], sorts: [{ rel: "date", dir: "desc" }], aggregates: [{ rel: "price", fn: "sum" }] },
    { layout: "table", relations: ["date", "product", "quantity", "price"], dateRel: "date" });
  const widgets = [
    { id: "w_ration", kind: "ration-today", title: "Рацион сегодня" },
    { id: "w_sport", kind: "sport-today", title: "Спорт сегодня" },
    { id: "w_requests", kind: "requests", title: "Запросы" },
    { id: "w_sessions", kind: "set", title: "Тренировки сегодня", setId: sessions, display: "list" },
    { id: "w_spent", kind: "set", title: "Потрачено за неделю", setId: purchases, display: "number", aggregate: { rel: "price", fn: "sum" }, ...(budget ? { goal: budget } : {}) },
    { id: "w_spent_days", kind: "set", title: "Траты по дням", setId: purchases, display: "bars", series: { dateRel: "date", valueRel: "price", fn: "sum", range: "@last7d" } },
    { id: "w_products", kind: "set", title: "Продуктов", setId: products, display: "number", aggregate: { fn: "count" } },
  ];
  return put("dashboard", "Главная", { widgets }, { id: claim("dashboard", "dashboard_home") });
}

// Values the store would refuse (out of range, a dead link, a time that is
// not ЧЧ:ММ) are dropped, so a later edit of the object is not blocked by
// data it did not touch. The dropped values are listed for the person.
function sanitize(state) {
  const issues = [];
  for (const obj of Object.values(state.objects)) {
    for (const [key, value] of Object.entries(obj.props)) {
      const rel = state.relations[key];
      const problem = rel ? checkValue(state, rel, value) : "нет такой связи";
      if (!problem) continue;
      delete obj.props[key];
      issues.push(`${obj.name || obj.type}: «${rel?.name || key}» ${JSON.stringify(value)} не перенесено, ${problem}`);
    }
  }
  return issues.slice(0, 50);
}

export function importLegacy(store, storage) {
  let raw = null;
  try { raw = storage?.getItem(LEGACY_KEY) ?? null; } catch { raw = null; }
  if (!raw) return { ok: false, reason: "Данных текущего приложения нет" };
  let legacy;
  try { legacy = JSON.parse(raw); } catch { return { ok: false, reason: "Данные текущего приложения не читаются" }; }
  const now = new Date().toISOString();
  const state = legacyToObjects(legacy, { today: store.today(), now });
  state.meta = { ...state.meta, importedAt: now, source: LEGACY_KEY };
  const saved = store.replaceAll(state);
  if (!saved.ok) return saved;
  const counts = {};
  for (const obj of Object.values(state.objects)) counts[obj.type] = (counts[obj.type] || 0) + 1;
  return { ok: true, counts, issues: state.meta.importIssues };
}

// A legacy state for the demo: the products and the week of
// scripts/ai-lab/fixture.mjs (copied: scripts/ is not part of the app),
// moved so the plan covers `today`, with Особые дни, История питания with
// every kind of discrepancy, a План and Учёт тренировок, two Запросы with
// purchases and a filled Профиль.
const FOODS = {
  oats: ["Овсяные хлопья", 366, 12, 6, 60, 10], milk: ["Молоко 2,5%", 52, 2.8, 2.5, 4.7, 0], banana: ["Банан", 96, 1.5, 0.5, 21, 2.6],
  eggs: ["Яйца куриные", 157, 12.7, 11.5, 0.7, 0], cottage: ["Творог 5%", 121, 17.2, 5, 1.8, 0], chicken: ["Куриная грудка", 113, 23.6, 1.9, 0.4, 0],
  beef: ["Говядина", 187, 18.9, 12.4, 0, 0], pork: ["Свинина", 259, 16, 21.6, 0, 0], salmon: ["Лосось", 153, 20, 8.1, 0, 0],
  buckwheat: ["Гречка", 313, 12.6, 3.3, 62, 11], rice: ["Рис", 344, 6.7, 0.7, 78.9, 0.4], pasta: ["Макароны", 344, 10.4, 1.1, 69.7, 3.7],
  lentils: ["Чечевица", 295, 24, 1.5, 46.3, 11.5], tofu: ["Тофу", 76, 8, 4.8, 1.9, 0.3], chickpea: ["Нут", 309, 20.1, 4.3, 46.2, 9.9],
  salad: ["Овощной салат", 30, 1.2, 0.2, 5.5, 2], oil: ["Оливковое масло", 898, 0, 99.8, 0, 0], bread: ["Хлеб цельнозерновой", 247, 13, 3.4, 41, 7],
  apple: ["Яблоко", 47, 0.4, 0.4, 9.8, 2.4], nuts: ["Грецкий орех", 654, 15.2, 65.2, 7, 6.7], yogurt: ["Йогурт греческий", 66, 5, 2, 4, 0],
  cheese: ["Сыр", 356, 24, 29.5, 0.3, 0],
};
const CATEGORIES = {
  "Крупы": ["oats", "buckwheat", "rice", "pasta", "lentils", "chickpea"], "Молочное": ["milk", "cottage", "yogurt", "cheese", "kefir"],
  "Мясо": ["chicken", "beef", "pork"], "Рыба": ["salmon"], "Овощи": ["salad"], "Фрукты": ["banana", "apple"], "Хлеб": ["bread"],
};
const categoryOf = (key) => Object.keys(CATEGORIES).find((name) => CATEGORIES[name].includes(key)) || "Другое";
const BREAKFAST = [["oats", 80], ["milk", 250], ["banana", 120]];
const SNACK = [["cottage", 200], ["apple", 150], ["nuts", 20]];
const WEEK = [
  ["mon", [["chicken", 200], ["buckwheat", 100], ["salad", 200], ["oil", 10]], [["salmon", 180], ["rice", 80], ["salad", 150]]],
  ["tue", [["beef", 180], ["pasta", 100], ["salad", 200], ["oil", 10]], [["eggs", 150], ["bread", 80], ["cheese", 30]]],
  ["wed", [["chicken", 200], ["rice", 100], ["salad", 200], ["oil", 10]], [["lentils", 90], ["salad", 200], ["oil", 10]]],
  ["thu", [["pork", 150], ["buckwheat", 100], ["salad", 200]], [["chicken", 200], ["pasta", 80], ["salad", 150]]],
  ["fri", [["beef", 180], ["rice", 100], ["salad", 200], ["oil", 10]], [["chicken", 180], ["buckwheat", 80], ["salad", 150]]],
  ["sat", [["salmon", 180], ["buckwheat", 100], ["salad", 200]], [["pork", 150], ["bread", 80], ["salad", 150]]],
  ["sun", [["chicken", 200], ["pasta", 100], ["salad", 200], ["oil", 10]], [["cottage", 200], ["yogurt", 150], ["bread", 60]]],
];

export function demoLegacyState(today = localDateKey()) {
  const at = (date, time = "09:00") => `${date}T${time}:00.000Z`;
  const shift = (days) => shiftDate(today, days);
  const weekday = (date) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const anchor = shiftDate(shift(-14), -weekday(shift(-14)));
  const product = (key, [name, calories, protein, fat, carbs, fiber], extra = {}) => ({
    id: `product_${key}`, name, unit: "г", category: categoryOf(key), brand: "", barcode: "", confirmed: false,
    nutrition: { calories, protein, fat, carbs, fiber }, updatedAt: at(shift(-40)), updatedBy: "local", ...extra,
  });
  const products = [
    ...Object.entries(FOODS).map(([key, values]) => product(key, values)),
    product("egg_piece", ["Яйцо", 157, 12.7, 11.5, 0.7, 0], { unit: "шт." }),
    { ...product("spice", ["Специи", 0, 0, 0, 0, 0]), nutrition: null },
    product("kefir", ["Кефир 1%", 40, 3, 1, 4, 0], { unit: "мл", deletedAt: at(shift(-8)) }),
    product("chocolate", ["Шоколад горький", 540, 6.2, 35.4, 48.2, 7.4], { barcode: "4600000000017", nutrition: { calories: 540, protein: 6.2, fat: 35.4, carbs: 48.2, fiber: 7.4, source: "Open Food Facts" } }),
  ];
  const nameOf = (key) => products.find((value) => value.id === `product_${key}`).name;
  const item = (id, key, amount, unit = "г") => ({ id, productId: `product_${key}`, name: nameOf(key), portionSize: amount, packageSize: 1000, measureUnit: unit });
  const meal = (slot, day, name, time, items) => ({ id: `m_${slot}_${day}`, name, time, items: items.map(([key, grams], index) => item(`item_${slot}_${day}_${index}`, key, grams)) });
  const cycleDay = ([day, lunch, dinner]) => ({
    id: `cycle_day_${day}`,
    meals: [meal("breakfast", day, "Завтрак", "08:00", BREAKFAST), meal("lunch", day, "Обед", "13:00", lunch), meal("snack", day, "Перекус", "16:30", SNACK), meal("dinner", day, "Ужин", "19:30", dinner)],
  });
  const week = WEEK.map(cycleDay);
  const version = (id, effectiveFrom, createdAt, cycle) => ({ id, owner: "local", effectiveFrom, createdAt, updatedAt: createdAt, updatedBy: "local", cycle });

  const special = {};
  const setSpecial = (date, meals) => { special[`local|${date}`] = { date, owner: "local", meals, updatedAt: at(shift(-1)), updatedBy: "local" }; };
  const cycleMeals = (date) => structuredClone(week[weekday(date)].meals);
  const lighter = cycleMeals(shift(-3));
  lighter[0].items[0].portionSize = 60;
  lighter[1].items.pop();
  setSpecial(shift(-3), lighter);
  const kefirDay = cycleMeals(shift(-10));
  kefirDay[0].items[1] = item("item_kefir", "kefir", 500, "мл");
  setSpecial(shift(-10), kefirDay);
  const brunchDay = cycleMeals(shift(2));
  const spice = item("item_brunch_spice", "spice", 5);
  delete spice.packageSize;
  setSpecial(shift(2), [
    { id: "m_brunch", name: "Бранч", time: "11:00", items: [item("item_brunch_egg", "egg_piece", 2, "шт."), item("item_brunch_cheese", "cheese", 0.05, "кг"), spice, item("item_brunch_bread", "bread", 80), { id: "item_brunch_empty", productId: "", name: "" }] },
    brunchDay[3],
  ]);

  const ration = {
    versions: [
      version("ration_version_demo_1", anchor, at(anchor, "08:00"), { anchor, weekdayBinding: true, days: week }),
      version("ration_version_demo_2", shift(6), at(shift(-1), "10:00"), { anchor: shift(6), weekdayBinding: false, days: [week[0], week[2], week[4]] }),
      // Same start date, released earlier: the version above wins the tie.
      version("ration_version_demo_9", shift(6), at(shift(-2), "10:00"), { anchor: shift(6), weekdayBinding: false, days: [{ id: "cycle_day_light", meals: [week[0].meals[0]] }] }),
    ],
    specialDays: special,
    history: {},
    profile: {
      ageGroup: "Взрослый", heightCm: 180, weightKg: 80, goal: "Поддержание веса", mealsPerDay: 4, schedule: "работа 9–18", budget: 7000,
      preferences: "без острого", excludedProducts: ["тофу", "кинза"], targetCalories: 2400, targetProtein: 140, targetFat: 80, targetCarbs: 280,
      updatedAt: at(shift(-20)), updatedBy: "local",
    },
  };
  const mealsOn = (date) => special[`local|${date}`]?.meals || (date >= anchor ? week[weekday(date)].meals : []);
  for (let index = 0; index < 14; index += 1) {
    const date = shift(index - 13);
    const [breakfast, lunch, snack, dinner] = mealsOn(date);
    const first = lunch.items[0].productId;
    const discrepancies = [
      [{ kind: "amount", productId: first, name: "", amount: 150 }],
      [{ kind: "excluded", productId: lunch.items[2]?.productId || first, name: "" }],
      [{ kind: "replaced", productId: first, name: "", replacedProductId: "product_tofu" }],
      [{ kind: "added", productId: "product_yogurt", name: nameOf("yogurt"), amount: 150, measureUnit: "г" }],
      [{ kind: "added", name: "Конфета", amount: 30 }, { kind: "replaced", productId: first, name: "", replacedName: "Индейка" }],
    ][index % 5];
    // A second «другое количество» for the same product: the first one counts.
    if (index === 5) discrepancies.push({ kind: "amount", productId: first, name: "", amount: 400 });
    const meals = {
      [breakfast.id]: { state: index % 5 === 4 ? "skipped" : "eaten", discrepancies: [], transferredMinutes: 0 },
      [lunch.id]: { state: "changed", discrepancies, transferredMinutes: 0 },
    };
    if (index % 3 === 0) meals[snack.id] = { state: "skipped", discrepancies: [], transferredMinutes: 0 };
    if (index % 3 === 1) meals[snack.id] = { state: "unmarked", discrepancies: [], transferredMinutes: 30 };
    if (index % 2 === 0) meals[dinner.id] = { state: "eaten", discrepancies: [{ kind: "added", productId: "product_egg_piece", name: "", amount: 1, measureUnit: "шт." }], transferredMinutes: 0 };
    if (index === 7) meals.m_ghost = { state: "eaten", discrepancies: [], transferredMinutes: 0 };
    ration.history[`local|${date}`] = { date, owner: "local", versionId: "ration_version_demo_1", meals };
  }

  const session = (id, type, time, durationMin, intensity, note = "") => ({ id, type, time, durationMin, intensity, note, exercises: [] });
  const sportStart = shift(-14);
  const sportAnchor = shift(-15);
  const sportCycle = [
    { id: "sport_day_a", sessions: [session("s_run", "run", "07:00", 40, "medium")] },
    { id: "sport_day_b", sessions: [] },
    { id: "sport_day_c", sessions: [session("s_strength", "strength", "18:00", 60, "high"), session("s_yoga", "yoga", "21:00", 30, "low")] },
  ];
  const sportWeek = Array.from({ length: 7 }, (_, index) => ({
    id: `sport_week_${index}`,
    sessions: { 0: [session("s_w_strength", "strength", "19:00", 60, "medium")], 2: [session("s_w_run", "run", "07:30", 30, "high")], 4: [session("s_w_bike", "bike", "10:00", 90, "low")], 6: [session("s_w_yoga", "yoga", "09:00", 30, "low")] }[index] || [],
  }));
  const sportSpecial = {
    [`local|${shift(1)}`]: { date: shift(1), owner: "local", sessions: [session("s_swim", "swim", "08:00", 45, "high", "Бассейн")], updatedAt: at(shift(-1)), updatedBy: "local" },
    [`local|${shift(-5)}`]: { date: shift(-5), owner: "local", sessions: [], updatedAt: at(shift(-6)), updatedBy: "local" },
  };
  const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
  const sessionsOn = (date) => sportSpecial[`local|${date}`]?.sessions || sportCycle[daysBetween(sportAnchor, date) % 3].sessions;
  const log = {};
  for (let index = 0; index < 14; index += 1) {
    const date = shift(index - 13);
    const records = Object.fromEntries(sessionsOn(date).map((value, position) => [value.id, [
      { state: "done" },
      { state: "done", actualDurationMin: 50, actualIntensity: "high" },
      { state: "changed", actualDurationMin: 30, actualIntensity: "low" },
      { state: "skipped" },
      { state: "unmarked" },
    ][(index + position) % 5]]));
    const unplanned = [];
    if (index % 4 === 0) unplanned.push(session(`u_walk_${index}`, "walk", "12:30", 30, "medium", "Прогулка"));
    if (index === 9) unplanned.push(session("u_bike", "bike", "17:00", 45, "high"));
    log[`local|${date}`] = { date, owner: "local", versionId: "sport_version_demo_1", sessions: records, unplanned };
  }
  const sport = {
    versions: [
      version("sport_version_demo_1", sportStart, at(sportStart, "08:00"), { anchor: sportAnchor, weekdayBinding: false, days: sportCycle }),
      version("sport_version_demo_2", shift(4), at(shift(-1), "11:00"), { anchor: shift(4), weekdayBinding: true, days: sportWeek }),
    ],
    specialDays: sportSpecial,
    log,
  };

  const line = (key, quantity, price) => ({ productId: `product_${key}`, purchasedProductId: `product_${key}`, quantity, price, completionMode: price ? "filled" : "closed" });
  const response = (requestId, id, date, items, deletedAt = "") => ({ id, requestId, items, createdAt: at(date, "18:00"), createdBy: "local", updatedAt: at(date, "18:00"), updatedBy: "local", deletedAt });
  const request = (id, date, items, responses, extra = {}) => ({
    id, createdAt: at(date, "10:00"), createdBy: "local", updatedAt: at(date, "10:00"), updatedBy: "local", status: "open", completedAt: "", deletedAt: "",
    items, responses, history: [], ...extra,
  });
  const fromPlan = (key, quantity, plannedAmount) => ({ productId: `product_${key}`, quantity, unit: "уп.", plannedAmount, packageSize: 1000, measureUnit: "г", note: "" });
  const requests = [
    request("request_demo_1", shift(-2), [fromPlan("oats", 1, 240), fromPlan("milk", 2, 1250), fromPlan("chicken", 1, 600), fromPlan("salad", 2, 1300), fromPlan("oil", 1, 30)],
      [response("request_demo_1", "response_request_demo_1", shift(-1), [line("oats", 1, 120), line("milk", 1, 90), line("chicken", 1, 420)])]),
    request("request_demo_2", shift(-6), [{ productId: "product_apple", quantity: 2, unit: "шт.", note: "зелёные" }, { productId: "product_bread", quantity: 1, unit: "шт.", note: "" }],
      [response("request_demo_2", "response_old", shift(-6), [line("apple", 5, 999)], at(shift(-6), "19:00")), response("request_demo_2", "response_request_demo_2", shift(-5), [line("apple", 2, 150), line("bread", 1, 75)])],
      { status: "done", completedAt: at(shift(-5), "18:00") }),
    request("request_demo_3", shift(-4), [{ productId: "product_nuts", quantity: 1, unit: "уп.", note: "" }],
      [response("request_demo_3", "response_request_demo_3", shift(-4), [line("nuts", 1, 300)], at(shift(-4), "20:00"))],
      { deletedAt: at(shift(-4), "20:00") }),
  ];

  return { schemaVersion: 14, products, requests, ration, sport, journal: [], user: null, onboardingCompleted: true };
}
