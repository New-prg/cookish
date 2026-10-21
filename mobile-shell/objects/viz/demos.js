// The components of the gallery as plain data: the same list drives the gallery
// page and the single-file gallery. Each demo is { id, group, title, tag, attrs, data?, text? }:
// `attrs` bind the element to the demo space, `data` hands it data by code.
export const GROUPS = { numbers: "Числа и цели", charts: "Графики", rows: "Таблица и список", empty: "Пустые состояния" };

export const DEMOS = [
  { id: "stat-bound", group: "numbers", title: "Число с динамикой", tag: "c-stat", attrs: { set: "set_water", value: "drunk", fn: "sum", range: "@last7d", compare: "yes", spark: "yes" } },
  { id: "stat-bad", group: "numbers", title: "Рост не к добру", tag: "c-stat", attrs: { good: "down" }, data: { value: 1840, unit: "ккал", previous: 1620, periodLabel: "прошлой неделе", spark: [1500, 1620, 1580, 1700, 1650, 1790, 1840] } },
  { id: "meter-bound", group: "numbers", title: "Цель по воде", tag: "c-meter", attrs: { set: "set_water", value: "drunk", fn: "sum", range: "@today", goal: "2000" } },
  { id: "meter-near", group: "numbers", title: "Почти предел", tag: "c-meter", attrs: { "goal-type": "max" }, data: { value: 2250, goal: 2400, unit: "ккал" } },
  { id: "meter-over", group: "numbers", title: "Выше лимита", tag: "c-meter", attrs: { "goal-type": "max" }, data: { value: 2650, goal: 2400, unit: "ккал" } },
  { id: "meter-done", group: "numbers", title: "Цель достигнута", tag: "c-meter", attrs: {}, data: { value: 2100, goal: 2000, unit: "мл" } },
  { id: "meter-segments", group: "numbers", title: "Калории по макросам", tag: "c-meter", attrs: {}, data: { value: 2050, goal: 2400, unit: "ккал", segments: [{ label: "Белки", value: 520, color: 0 }, { label: "Жиры", value: 640, color: 1 }, { label: "Углеводы", value: 890, color: 2 }] } },

  { id: "bars-single", group: "charts", title: "Вода за 7 дней, с целью", tag: "c-bars", attrs: { set: "set_water", value: "drunk", fn: "sum", range: "@last7d", goal: "2000" } },
  { id: "bars-30", group: "charts", title: "Вода за 30 дней", tag: "c-bars", attrs: { set: "set_water", value: "drunk", fn: "sum", range: "@last30d" } },
  { id: "bars-stacked", group: "charts", title: "Минуты по видам, неделя за неделей", tag: "c-bars", attrs: { set: "set_activity", value: "duration", fn: "sum", range: "@last8w", by: "week", category: "kind", stack: "stacked" } },
  {
    id: "bars-grouped", group: "charts", title: "Сравнение двух недель", tag: "c-bars", attrs: { stack: "grouped", unit: "мин" },
    data: { by: "day", buckets: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"], series: [{ key: "a", label: "Эта неделя", color: 0, values: [30, 45, 20, 60, 40] }, { key: "b", label: "Прошлая", color: 1, values: [25, 35, 50, 30, 55] }] },
  },
  { id: "bars-month", group: "charts", title: "Траты по месяцам", tag: "c-bars", attrs: { set: "set_spend", value: "price", fn: "sum", range: "@last6m", by: "month" } },
  { id: "line-area", group: "charts", title: "Вес за 30 дней", tag: "c-line", attrs: { set: "set_weight", value: "weightKg", fn: "avg", range: "@last30d", area: "yes" } },
  { id: "line-multi", group: "charts", title: "Минуты по видам", tag: "c-line", attrs: { set: "set_activity", value: "duration", fn: "sum", range: "@last12w", by: "week", category: "kind" } },
  { id: "spark", group: "charts", title: "Динамика воды", tag: "c-spark", attrs: { set: "set_water", value: "drunk", fn: "sum", range: "@last14d" } },
  { id: "heatmap", group: "charts", title: "Календарь тренировок", tag: "c-heatmap", attrs: { set: "set_activity", value: "duration", fn: "sum", range: "@last12w" } },

  { id: "table", group: "rows", title: "Последние тренировки", tag: "c-table", attrs: { set: "set_activity", columns: "date,kind,duration", limit: "5" } },
  { id: "list", group: "rows", title: "Открытые запросы", tag: "c-list", attrs: { set: "set_open_requests", columns: "date,progress" } },

  { id: "empty", group: "empty", title: "Пустое состояние", tag: "c-empty", attrs: {}, text: "Пока нет записей: добавьте первую, и здесь появится график." },
  { id: "empty-bars", group: "empty", title: "Столбцы без данных", tag: "c-bars", attrs: {}, data: [] },
  { id: "empty-stat", group: "empty", title: "Число без данных", tag: "c-stat", attrs: {}, data: { value: null } },
  { id: "empty-heatmap", group: "empty", title: "Календарь без данных", tag: "c-heatmap", attrs: {}, data: { by: "day", buckets: ["2026-10-01", "2026-10-02"], series: [{ key: "v", label: "x", color: 0, values: [null, null] }] } },
];
