// Home widgets: a table from widget kind to how it renders. Set widgets show
// a saved set as a list, one number, or bars by day.
import { aggregate, runQuery, runSeries } from "../core/query.js";
import { objectsOfType, valueOf } from "../core/values.js";
import { hrefFor, iconOf, nameOf } from "./runtime.js";
import { empty, h, num, progressBar } from "./dom.js";
import "../viz/kit.js";
import { rangeCaption } from "../viz/util.js";
import { shownValue } from "./editors.js";
import { rationDayBody, sportDayBody } from "./day.js";
import { defaultView } from "./setview.js";

export const WIDGET_KINDS = {
  "ration-today": { name: "Сегодня в Рационе", href: (w, c) => `#/ration/${c.today}`, render: (state, w, c) => rationDayBody(state, c.today, c, { compact: true }) },
  "sport-today": { name: "Спорт сегодня", href: (w, c) => `#/sport/${c.today}`, render: (state, w, c) => sportDayBody(state, c.today, c, { compact: true }) },
  requests: { name: "Покупки", href: () => "#/type/request", render: requestsWidget },
  set: { name: "Из набора", href: (w) => `#/set/${encodeURIComponent(w.setId)}`, render: setWidget },
};

export const AGG_NAMES = { count: "Количество", sum: "Сумма", avg: "Среднее", min: "Минимум", max: "Максимум" };
const AGG_SUFFIX = { count: "", sum: "", avg: "в среднем", min: "минимум", max: "максимум" };
import { DISPLAY_NAMES } from "../core/changes.js";
export { DISPLAY_NAMES };

function requestsWidget(state, w, c) {
  const open = objectsOfType(state, "request").filter((r) => r.props?.status !== "done");
  if (!open.length) return empty("Открытых запросов нет");
  return h("div", { class: "list" }, open.slice(0, 4).map((r) => {
    const items = (r.props?.items || []).filter((id) => state.objects[id] && !state.objects[id].archivedAt);
    const bought = items.filter((id) => valueOf(state, id, "isBought", c)).length;
    const spent = valueOf(state, r, "total", c) || 0;
    return h("a", { class: "row row-stack", href: hrefFor(r) },
      h("span", { class: "row-line" }, h("span", { class: "row-title", text: nameOf(r) }), h("span", { class: "row-count", text: `${bought} из ${items.length}` })),
      progressBar(bought, items.length),
      spent ? h("span", { class: "row-sub", text: `Потрачено ${num(spent)} ₽` }) : null,
    );
  }));
}

function setWidget(state, w, c) {
  const set = state.objects[w.setId];
  if (!set || set.archivedAt) return empty("Набор удалён");
  try {
    return (DISPLAYS[w.display] || DISPLAYS.list)(state, w, set, c);
  } catch (error) {
    return empty(`Не считается: ${error.message}`);
  }
}

const unitOf = (state, relKey) => (relKey ? state.relations[relKey]?.unit || "" : "");

// The three displays of a set widget are the chart kit: c-list, c-stat or c-meter
// (a goal makes it a meter), c-bars. They keep the class names the tests read:
// .metric-value and .metric-of inside the number, the headline of the bars.
const DISPLAYS = {
  list(state, w, set, c) {
    const rows = runQuery(state, set.props?.query || {}, c).rows;
    if (!rows.length) return empty("Пока пусто");
    const keys = set.props?.view?.relations || defaultView(state, set.props?.query?.source?.type).relations;
    const list = h("c-list");
    list.data = {
      total: rows.length,
      rows: rows.slice(0, 5).map((obj) => ({ id: obj.id, href: hrefFor(obj), icon: iconOf(state, obj), title: nameOf(obj), sub: keys.map((k) => shownValue(state, obj, k, c)).filter(Boolean).join(" · ") })),
    };
    return list;
  },
  number(state, w, set, c) {
    const agg = w.aggregate?.fn ? w.aggregate : { fn: "count" };
    const rows = runQuery(state, set.props?.query || {}, c).rows;
    const value = aggregate(state, rows, agg, c);
    const unit = agg.fn === "count" ? "" : unitOf(state, agg.rel);
    const goal = Number(w.goal) > 0 ? Number(w.goal) : null;
    const el = h(goal ? "c-meter" : "c-stat");
    el.data = { value, goal, unit, note: AGG_SUFFIX[agg.fn] };
    return el;
  },
  bars(state, w, set, c) {
    const range = w.series?.range || "@last7d";
    const fn = w.series?.fn || "sum";
    const series = runSeries(state, set.props?.query || {}, { dateRel: w.series?.dateRel || "date", valueRel: w.series?.valueRel, fn, range }, c);
    const unit = fn === "count" ? "" : unitOf(state, w.series?.valueRel);
    const values = series.map((p) => p.value).filter((v) => v != null);
    const total = !values.length ? null : fn === "sum" || fn === "count" ? values.reduce((a, b) => a + b, 0) : values.reduce((a, b) => a + b, 0) / values.length;
    const headline = h("c-stat", { class: "is-small" });
    headline.data = { value: total, unit, note: fn === "sum" || fn === "count" ? rangeCaption(range) : "в среднем за день" };
    const bars = h("c-bars");
    bars.data = {
      by: "day", unit, fn, goal: Number(w.goal) > 0 ? Number(w.goal) : null, label: AGG_NAMES[fn],
      buckets: series.map((p) => p.date),
      series: [{ key: "value", label: AGG_NAMES[fn], color: 0, values: series.map((p) => p.value) }],
    };
    return h("div", { class: "bars-wrap" }, headline, bars);
  },
};
