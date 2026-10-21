// Built-in relations and types of the Cookish object space. Everything the
// app knows is an object of a type; a type lists its relations. Relations are
// global, so «Дата» or «Продукт» mean the same thing on every type.
//
// A fact type (`fact: true`) is what the person did: marks, purchases, tracker
// entries. Only a person or a connector writes facts, never the assistant, and
// facts stay out of the change journal, like История питания and Учёт today.

export const FORMATS = Object.freeze([
  "text", "number", "date", "time", "datetime", "select", "multiselect",
  "checkbox", "object", "objects", "url", "formula", "json",
]);

export const DIMENSIONS = Object.freeze(["energy", "mass", "volume", "count", "money", "duration", "pressure", "glucose", "ratio"]);

const opt = (id, name, color) => ({ id, name, ...(color ? { color } : {}) });
const rel = (key, name, format, extra = {}) => Object.freeze({ key, name, format, system: true, ...extra });

const MEAL_STATES = [opt("unmarked", "не отмечено", "grey"), opt("eaten", "съедено", "green"), opt("changed", "изменено", "amber"), opt("skipped", "не съедено", "red")];
const SESSION_STATES = [opt("unmarked", "не отмечено", "grey"), opt("done", "выполнено", "green"), opt("changed", "изменено", "amber"), opt("skipped", "пропущено", "red")];
const UNITS = [opt("г", "г"), opt("мл", "мл"), opt("кг", "кг"), opt("л", "л"), opt("шт.", "шт."), opt("уп.", "уп.")];
const SPORT_KINDS = [opt("strength", "Силовая"), opt("run", "Бег"), opt("swim", "Плавание"), opt("bike", "Велосипед"), opt("walk", "Ходьба"), opt("yoga", "Йога"), opt("other", "Другое")];
const INTENSITIES = [opt("low", "низкая"), opt("medium", "средняя"), opt("high", "высокая")];

const NUTRIENT = (key, name, dimension, unit, formula) => rel(key, name, formula ? "formula" : "number", { dimension, unit, ...(formula ? { formula } : { min: 0 }) });

export const BUILTIN_RELATIONS = Object.freeze([
  rel("name", "Название", "text"),
  rel("description", "Описание", "text"),
  rel("note", "Заметка", "text"),
  rel("date", "Дата", "date"),
  rel("time", "Время", "time"),
  rel("at", "Когда", "datetime"),
  rel("tags", "Метки", "multiselect", { options: [] }),

  // Продукт
  rel("category", "Категория", "select", { options: [opt("Овощи", "Овощи"), opt("Фрукты", "Фрукты"), opt("Крупы", "Крупы"), opt("Мясо", "Мясо"), opt("Рыба", "Рыба"), opt("Молочное", "Молочное"), opt("Хлеб", "Хлеб"), opt("Напитки", "Напитки"), opt("Другое", "Другое")], open: true }),
  rel("unit", "Единица", "select", { options: UNITS }),
  NUTRIENT("kcal100", "Ккал на 100", "energy", "ккал"),
  NUTRIENT("protein100", "Белки на 100", "mass", "г"),
  NUTRIENT("fat100", "Жиры на 100", "mass", "г"),
  NUTRIENT("carbs100", "Углеводы на 100", "mass", "г"),
  NUTRIENT("fiber100", "Клетчатка на 100", "mass", "г"),
  rel("barcode", "Штрихкод", "text"),
  rel("brand", "Бренд", "text"),
  rel("nutritionSource", "Источник КБЖУ", "select", { options: [opt("person", "Вы"), opt("off", "Open Food Facts"), opt("reference", "Справочник"), opt("estimate", "Оценка ИИ")] }),
  rel("packSize", "Упаковка", "number", { min: 0 }),
  rel("pieceWeight", "Вес штуки, г", "number", { min: 0, dimension: "mass", unit: "г" }),
  rel("confirmed", "Проверен", "checkbox"),
  rel("lastPrice", "Последняя цена", "formula", { dimension: "money", unit: "₽", formula: "last(backlinks('purchase', 'product'), 'price')" }),

  // План: неделя, день, приём пищи, порция, тренировка
  rel("area", "Раздел", "select", { options: [opt("ration", "Рацион"), opt("sport", "Спорт")] }),
  rel("effectiveFrom", "Действует с", "date"),
  rel("anchor", "Опорная дата", "date", { hidden: true }),
  rel("weekdayBinding", "По дням недели", "checkbox"),
  rel("days", "Дни", "objects", { types: ["day_plan"] }),
  rel("cycleIndex", "День цикла", "number", { hidden: true, min: 0 }),
  rel("meals", "Приёмы пищи", "objects", { types: ["meal"] }),
  rel("sessions", "Тренировки", "objects", { types: ["session"] }),
  rel("slot", "Слот", "text", { hidden: true }),
  rel("items", "Позиции", "objects", { types: ["portion", "request_item"] }),
  rel("product", "Продукт", "object", { types: ["product"] }),
  rel("amount", "Количество", "number", { min: 0 }),
  rel("base", "В граммах", "formula", { hidden: true, formula: "if(unit == 'шт.', if(product.pieceWeight > 0, amount * product.pieceWeight, null), if(unit == 'кг' || unit == 'л', amount * 1000, amount))" }),
  NUTRIENT("kcal", "Ккал", "energy", "ккал", "kcalOf(this)"),
  NUTRIENT("protein", "Белки", "mass", "г", "nutrientOf(this, 'protein')"),
  NUTRIENT("fat", "Жиры", "mass", "г", "nutrientOf(this, 'fat')"),
  NUTRIENT("carbs", "Углеводы", "mass", "г", "nutrientOf(this, 'carbs')"),
  rel("kind", "Вид", "select", { options: SPORT_KINDS }),
  rel("duration", "Длительность, мин", "number", { min: 1, max: 1440, dimension: "duration", unit: "мин" }),
  rel("intensity", "Интенсивность", "select", { options: INTENSITIES }),
  rel("kcalBurned", "Расход, ккал", "formula", { dimension: "energy", unit: "ккал", formula: "burnedOf(this)" }),

  // Факты: отметки, расхождения, активность
  rel("meal", "Приём пищи", "object", { types: ["meal"] }),
  rel("mealState", "Состояние", "select", { options: MEAL_STATES }),
  rel("transferredMinutes", "Перенос, мин", "number"),
  rel("discrepancyKind", "Что изменилось", "select", { options: [opt("added", "добавлено"), opt("excluded", "не съедено"), opt("replaced", "замена"), opt("amount", "другое количество")] }),
  rel("replacedBy", "Чем заменили", "object", { types: ["product"] }),
  rel("session", "Тренировка", "object", { types: ["session"] }),
  rel("sessionState", "Состояние", "select", { options: SESSION_STATES }),
  rel("actualDuration", "Фактически, мин", "number", { min: 1, max: 1440, dimension: "duration", unit: "мин" }),
  rel("actualIntensity", "Фактическая интенсивность", "select", { options: INTENSITIES }),

  // Покупки
  rel("status", "Статус", "select", { options: [opt("open", "открыт", "blue"), opt("done", "закрыт", "green")] }),
  rel("request", "Запрос", "object", { types: ["request"] }),
  rel("quantity", "Количество", "number", { min: 0 }),
  rel("item", "Позиция", "object", { types: ["request_item"] }),
  rel("price", "Сумма", "number", { min: 0, dimension: "money", unit: "₽" }),
  rel("bought", "Куплено", "formula", { formula: "sum(backlinks('purchase', 'item'), 'quantity')" }),
  rel("isBought", "Куплено всё", "formula", { formula: "bought >= quantity && quantity > 0" }),
  rel("total", "Потрачено", "formula", { dimension: "money", unit: "₽", formula: "sum(backlinks('purchase', 'request'), 'price')" }),
  rel("progress", "Куплено позиций", "formula", { formula: "count(items, 'isBought') + ' из ' + count(items)" }),

  // Профиль
  rel("ageGroup", "Возраст", "select", { options: [opt("child", "Ребёнок"), opt("teen", "Подросток"), opt("adult", "Взрослый"), opt("senior", "Пожилой")] }),
  rel("heightCm", "Рост, см", "number", { min: 50, max: 250 }),
  rel("weightKg", "Вес, кг", "number", { min: 20, max: 400, dimension: "mass", unit: "кг" }),
  rel("goal", "Цель", "select", { options: [opt("lose", "снизить вес"), opt("keep", "держать вес"), opt("gain", "набрать вес")] }),
  rel("mealsPerDay", "Приёмов в день", "number", { min: 1, max: 10 }),
  rel("budget", "Бюджет на неделю", "number", { min: 0, dimension: "money", unit: "₽" }),
  rel("targetCalories", "Цель, ккал", "number", { min: 1200, max: 6000, dimension: "energy", unit: "ккал", guarded: true }),
  rel("targetProtein", "Цель по белку, г", "number", { min: 0, max: 400, dimension: "mass", unit: "г", guarded: true }),
  rel("targetFat", "Цель по жирам, г", "number", { min: 0, max: 400, dimension: "mass", unit: "г", guarded: true }),
  rel("targetCarbs", "Цель по углеводам, г", "number", { min: 0, max: 1000, dimension: "mass", unit: "г", guarded: true }),
  rel("excluded", "Исключённые продукты", "objects", { types: ["product"] }),
  rel("preferences", "Предпочтения", "text"),

  // Системные: наборы и панели
  rel("query", "Запрос набора", "json", { hidden: true }),
  rel("view", "Вид", "json", { hidden: true }),
  rel("widgets", "Виджеты", "json", { hidden: true }),
  rel("goalValue", "Цель", "number", { min: 0 }),
]);

const type = (key, name, plural, icon, relations, extra = {}) => Object.freeze({ key, name, plural, icon, relations, layout: "basic", system: true, ...extra });

export const BUILTIN_TYPES = Object.freeze([
  type("product", "Продукт", "Продукты", "🥕", ["category", "unit", "kcal100", "protein100", "fat100", "carbs100", "fiber100", "packSize", "pieceWeight", "brand", "barcode", "nutritionSource", "confirmed", "lastPrice"], { area: "food" }),
  type("week_plan", "Неделя плана", "Недели плана", "🗓", ["area", "effectiveFrom", "weekdayBinding", "days", "anchor"], { area: "plan", hidden: true }),
  type("day_plan", "День плана", "Дни плана", "📅", ["area", "date", "cycleIndex", "meals", "sessions", "kcal", "protein", "fat", "carbs"], { area: "plan", hidden: true }),
  type("meal", "Приём пищи", "Приёмы пищи", "🍽", ["time", "items", "kcal", "protein", "fat", "carbs", "slot"], { area: "food" }),
  type("portion", "Порция", "Порции", "🥄", ["product", "amount", "unit", "packSize", "kcal", "protein", "fat", "carbs", "base"], { area: "food", hidden: true }),
  type("session", "Тренировка", "Тренировки", "🏃", ["kind", "time", "duration", "intensity", "note", "kcalBurned", "slot"], { area: "sport" }),
  type("meal_mark", "Отметка приёма", "Отметки приёмов", "✅", ["date", "meal", "slot", "mealState", "transferredMinutes"], { area: "food", fact: true, hidden: true }),
  type("discrepancy", "Расхождение", "Расхождения", "↔", ["date", "slot", "discrepancyKind", "product", "replacedBy", "amount", "unit"], { area: "food", fact: true, hidden: true }),
  type("session_mark", "Отметка тренировки", "Отметки тренировок", "✅", ["date", "session", "slot", "sessionState", "actualDuration", "actualIntensity"], { area: "sport", fact: true, hidden: true }),
  type("activity", "Активность", "Активности", "⚡", ["date", "kind", "time", "duration", "intensity", "note", "kcalBurned"], { area: "sport", fact: true, layout: "entry" }),
  type("request", "Запрос", "Запросы", "🛒", ["status", "items", "progress", "total", "date"], { area: "shopping" }),
  type("request_item", "Позиция запроса", "Позиции запросов", "▫", ["request", "product", "quantity", "unit", "note", "bought", "isBought"], { area: "shopping", hidden: true }),
  type("purchase", "Покупка", "Покупки", "🧾", ["date", "request", "item", "product", "quantity", "price"], { area: "shopping", fact: true, layout: "entry" }),
  type("profile", "Профиль", "Профиль", "👤", ["ageGroup", "heightCm", "weightKg", "goal", "mealsPerDay", "budget", "targetCalories", "targetProtein", "targetFat", "targetCarbs", "excluded", "preferences"], { area: "system", singleton: true }),
  type("set", "Набор", "Наборы", "🗂", ["description", "query", "view"], { area: "system", layout: "set" }),
  type("dashboard", "Панель", "Панели", "🏠", ["description", "widgets"], { area: "system", layout: "dashboard" }),
  type("note", "Заметка", "Заметки", "📝", ["description", "tags"], { area: "custom", layout: "note" }),
]);

export function builtinSchema() {
  return {
    relations: Object.fromEntries(BUILTIN_RELATIONS.map((r) => [r.key, r])),
    types: Object.fromEntries(BUILTIN_TYPES.map((t) => [t.key, t])),
  };
}

// MET values from the current Спорт domain, kept here so formulas need no import.
export const SPORT_MET = Object.freeze({
  strength: { low: 3.5, medium: 5, high: 6 },
  run: { low: 7, medium: 9.8, high: 11.5 },
  swim: { low: 6, medium: 8.3, high: 10 },
  bike: { low: 4, medium: 6.8, high: 10 },
  walk: { low: 2.8, medium: 3.5, high: 5 },
  yoga: { low: 2.5, medium: 3, high: 4 },
  other: { low: 3, medium: 4.5, high: 6 },
});
