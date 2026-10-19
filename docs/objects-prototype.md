# Cookish на объектах: прототип

Ветка `refactor/object-model-prototype`. Прототип переносит Cookish на объектную модель в духе Anytype, но со специализацией под питание, спорт и покупки. Старое приложение (`mobile-shell/index.html`) не меняется. Новое живёт рядом: `mobile-shell/objects.html` и папка `mobile-shell/objects/`. У них общий origin в WebView, поэтому прототип может прочитать данные текущего приложения из `localStorage` и перенести их к себе, ничего не меняя в старых данных.

## Модель

Всё, что знает приложение, хранится как **объект** (`{ id, type, name, props, blocks?, createdAt, updatedAt, createdBy, updatedBy, archivedAt? }`).

- **Тип** задаёт название, иконку, макет и список рекомендуемых связей. Встроенные типы перечислены в `core/schema.js` (`BUILTIN_TYPES`). Человек и Ассистент могут заводить свои типы (`defineType`).
- **Связь** (relation) это глобальное свойство с форматом: `text, number, date, time, datetime, select, multiselect, checkbox, object, objects, url, formula, json`. У числа есть `min`, `max`, `unit`, `dimension`. У ссылок есть `types`. У формулы есть `formula`. Связь с `guarded: true` меняет только человек (цели КБЖУ).
- **Факт**: тип с `fact: true`. Это отметки приёмов и тренировок, расхождения, активность, покупки, записи трекеров. Факты пишет только человек или коннектор (`actor: "human" | "connector"`). Ассистент (`actor: "ai"`) не пишет факты никогда. Факты не журналируются, как сейчас История питания и Учёт.
- **Набор** (`set`) это объект с `props.query` и `props.view`. **Панель** (`dashboard`) это объект с `props.widgets`.

## Ядро (готово)

- `core/schema.js`: встроенные связи и типы, таблица MET.
- `core/formula.js`: разбор и вычисление формул без eval, лимиты (`LIMITS`), таблица функций (`registerFunctions`). `Ref` оборачивает ссылку на объект внутри формулы.
- `core/values.js`: `valueOf(state, objOrId, rel, ctx)` возвращает значение связи, формулы считаются по требованию и кэшируются на снимок. `displayValue` даёт строку для показа. `backlinks`, `objectsOfType`, `profileOf`, `formulaError`.
- `core/functions.js`: формульные функции домена `kcalOf`, `nutrientOf`, `burnedOf`, `met`.
- `core/query.js`: `runQuery(state, { source, filters, sorts, group, aggregates, limit }, ctx)` и `runSeries(...)` для графиков. Источник это `{ type }`, `{ ids }` или `{ builtin, args }` из `registerSource`. Токены дат: `@today`, `@yesterday`, `@tomorrow`, `@+Nd`, `@-Nd`, `@lastNd`, `@nextNd`, `@thisWeek`, `@thisMonth`.
- `core/store.js`: `openObjectStore({ storage, key, clock, today, idFactory })`. Запись только через `apply(ops, { actor, summary })`, операции `create, update, archive, restore, defineType, defineRelation, revert`. Пачка атомарна. Проверки: связи и форматы, ссылки на существующие объекты нужных типов, факты, охраняемые связи, одиночки (`singleton`), правила домена (`registerRule`). Журнал (`state.journal`, до 200 наборов) и откат `revert(changeSetId)`. `replaceAll(state)` для разового импорта. `subscribe(fn)`.
- Тесты: `tests/objects-core.test.mjs`.

`ctx` для чтения всегда `{ today: "ГГГГ-ММ-ДД" }`, его даёт `store.today()`.

## Как моделируется Рацион и Спорт

- **Неделя плана** (`week_plan`): `area` (`ration` или `sport`), `effectiveFrom`, `anchor`, `weekdayBinding`, `days` (упорядоченные `day_plan`). Это бывшая Версия с её Циклом. В интерфейсе слово «Цикл» не показываем.
- **День плана** (`day_plan`): `area`, `meals` или `sessions`. У дня цикла есть `cycleIndex`, у Особого дня есть `date`.
- **Приём пищи** (`meal`): `time`, `items` (порции), `slot`. **Порция** (`portion`): `product`, `amount`, `unit`, `packSize`. КБЖУ считается формулами.
- **Тренировка** (`session`): `kind`, `time`, `duration`, `intensity`, `note`, `slot`.
- **Слот** (`slot`) это устойчивый ключ приёма или тренировки. Копия дня цикла в Особый день получает новые id объектов, но тот же `slot`. Отметки ссылаются на дату и слот, поэтому переживают копирование, как сейчас `history.meals[mealId]`.
- **Отметка приёма** (`meal_mark`, факт): `date`, `slot`, `meal`, `mealState`, `transferredMinutes`. **Расхождение** (`discrepancy`, факт): `date`, `slot`, `discrepancyKind`, `product`, `replacedBy`, `amount`, `unit`. **Отметка тренировки** (`session_mark`), **Активность** (`activity`).
- Покупки: **Запрос** (`request`) со `status` и `items`, **Позиция запроса** (`request_item`), **Покупка** (`purchase`, факт) ссылается на позицию и запрос. Куплено и потрачено считают формулы по обратным ссылкам.

## Домен (`core/domain.js`, делает агент домена)

Экспортирует ровно это, интерфейс опирается на эти имена.

```js
planDay(state, area, date) // → { dayId, source: "special"|"cycle"|"empty", weekId, items: [id] } items по времени
markFor(state, area, date, slot) // → объект meal_mark или session_mark или null
dayActual(state, date, ctx) // → { planned: {kcal, protein, fat, carbs}, eaten: {...}, meals: [{ mealId, slot, state, planned, actual, discrepancies: [id] }] }
sportDay(state, date, ctx) // → { planned, actual, sessions: [{ sessionId, slot, state, planned, actual }], activities: [id] }
markMealOps(state, date, mealId, mealState) // → ops
discrepancyOps(state, date, mealId, { kind, product, replacedBy, amount, unit }) // → ops
markSessionOps(state, date, sessionId, sessionState, { actualDuration, actualIntensity } = {}) // → ops
editableDayOps(state, area, date) // → { ops, dayId, idMap } Особый день из дня цикла, idMap: старый id → новый
newWeekOps(state, area, { fromDate, days }) // → ops новая неделя плана с даты, только будущее
requestFromPlanOps(state, { dates, name }) // → ops Запрос с округлением до упаковок
markBoughtOps(state, itemId, { quantity, price, date }) // → ops
```

Источник для наборов: `registerSource("plan", (state, { area, date }, ctx) => ids)`, где `date` может быть токеном `@today`.

Правила (`registerRule`): прошлое плана неизменно, дневная проверка КБЖУ для `actor: "ai"` с порогами из `mobile-shell/core/proposals.js` и `core/safety.js`.

## Перенос (`core/migrate.js`, делает агент домена)

```js
legacyToObjects(legacyState, { today }) // → состояние объектного пространства
importLegacy(store, storage) // читает cookish.android.data.v1 и вызывает store.replaceAll
demoLegacyState(today) // старое состояние для примера, на основе scripts/ai-lab/fixture.mjs
```

Проверка: `tests/objects-domain.test.mjs` сверяет расчёты старых функций (`readRationDay`, `readRationDayNutrition`, `readRationDayActual`, `readSportDayEnergy`, `plannedRationRequestItems`, суммы Запросов) с объектной моделью после переноса, по дням.

## Интерфейс (`objects.html`, `objects/ui/`, делает агент интерфейса)

Anytype для питания, спорта и покупок: главная панель с виджетами, библиотека типов и наборов, вид набора (список, таблица, канбан, календарь, галерея, чек-лист), страница объекта со связями, создание своих типов и связей, день Рациона и день Спорта, Запрос с отметкой покупки, отмена через журнал.
