// Home widgets: a table from widget kind to how it renders. Set widgets show
// a saved set as a list, one number, or bars by day.
import { aggregate, runQuery, runSeries } from "../core/query.js";
import { objectsOfType, valueOf } from "../core/values.js";
import { hrefFor, iconOf, nameOf } from "./runtime.js";
import { empty, h, num, progressBar, weekdayShort } from "./dom.js";
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
export const DISPLAY_NAMES ={ list: "Список", number: "Число", bars: "Столбцы за 7 дней" };

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

const DISPLAYS = {
  list(state, w, set, c) {
    const rows = runQuery(state, set.props?.query || {}, c).rows;
    if (!rows.length) return empty("Пока пусто");
    const keys = set.props?.view?.relations || defaultView(state, set.props?.query?.source?.type).relations;
    return h("div", { class: "list" }, rows.slice(0, 5).map((obj) => h("a", { class: "row", href: hrefFor(obj) },
      h("span", { class: "row-icon", text: iconOf(state, obj) }),
      h("span", { class: "row-main" }, h("span", { class: "row-title", text: nameOf(obj) }), h("span", { class: "row-sub", text: keys.map((k) => shownValue(state, obj, k, c)).filter(Boolean).join(" · ") })),
    )), rows.length > 5 ? h("span", { class: "row-sub more", text: `и ещё ${rows.length - 5}` }) : null);
  },
  number(state, w, set, c) {
    const agg = w.aggregate?.fn ? w.aggregate : { fn: "count" };
    const rows = runQuery(state, set.props?.query || {}, c).rows;
    const value = aggregate(state, rows, agg, c);
    const unit = agg.fn === "count" ? "" : unitOf(state, agg.rel);
    const goal = Number(w.goal) > 0 ? Number(w.goal) : null;
    return h("div", { class: "metric" },
      h("p", { class: "metric-line" },
        h("span", { class: "metric-value", text: value == null ? "—" : num(value) }),
        h("span", { class: "metric-of", text: [goal ? `из ${num(goal)}` : "", unit, AGG_SUFFIX[agg.fn]].filter(Boolean).join(" ") }),
      ),
      goal ? progressBar(value || 0, goal) : null,
    );
  },
  bars(state, w, set, c) {
    const series = runSeries(state, set.props?.query || {}, { dateRel: w.series?.dateRel || "date", valueRel: w.series?.valueRel, fn: w.series?.fn || "sum", range: w.series?.range || "@last7d" }, c);
    const max = Math.max(Number(w.goal) || 0, ...series.map((p) => p.value || 0));
    const fn = w.series?.fn || "sum";
    const unit = fn === "count" ? "" : unitOf(state, w.series?.valueRel);
    const values = series.map((p) => p.value).filter((v) => v != null);
    const total = !values.length ? null : fn === "sum" || fn === "count" ? values.reduce((a, b) => a + b, 0) : values.reduce((a, b) => a + b, 0) / values.length;
    return h("div", { class: "bars-wrap" },
      h("p", { class: "metric-line" }, h("span", { class: "metric-value metric-small", text: total == null ? "—" : num(total) }), h("span", { class: "metric-of", text: [unit, fn === "sum" || fn === "count" ? "за 7 дней" : "в среднем за день"].filter(Boolean).join(" ") })),
      h("div", { class: "bars", role: "img", "aria-label": series.map((p) => `${weekdayShort(p.date)} ${p.value == null ? "нет" : num(p.value)}`).join(", ") },
        series.map((p) => {
          const bar = h("span", { class: `bars-bar${p.value == null ? " is-empty" : ""}` });
          bar.style.height = `${max > 0 && p.value ? Math.max(4, (p.value / max) * 100) : 4}%`;
          return h("span", { class: `bars-col${p.date === c.today ? " is-today" : ""}` }, h("span", { class: "bars-track" }, bar), h("span", { class: "bars-label", text: weekdayShort(p.date) }));
        }),
      ),
    );
  },
};
