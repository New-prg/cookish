// The chart kit: custom elements in the light DOM with Russian labels and ru-RU
// numbers. Import this module once; it injects its styles and defines the tags.
//
//   <c-dashboard v="1"> <c-grid cols="2"> <c-card title="Вода">
//     <c-bars set="set_water" value="drunk" fn="sum" range="@last7d" goal="2000"></c-bars>
//
// Every chart takes data from a `data` property set by code, or from its attributes
// through the data source the app registers with setDataSource (data.js).
import { VizElement, emptyBox, glyph, h } from "./el.js";
import { BarsElement, HeatmapElement, LineElement, SparkElement } from "./charts.js";
import { injectStyles } from "./styles.js";
import { fmtNum, fmtValue } from "./util.js";
import { getDataSource, onDataSource, setDataSource } from "./source.js";

export { setDataSource, getDataSource, onDataSource };

// -- containers ------------------------------------------------------------------
class DashboardElement extends HTMLElement {}
class GridElement extends HTMLElement {}

class CardElement extends VizElement {
  connectedCallback() {
    this.hoistTitle();
    this.paintHead();
  }

  disconnectedCallback() {}

  refresh() { this.paintHead(); }

  toolsSlot() { return this.querySelector(":scope > .viz-card-head > .viz-card-tools"); }

  paintHead() {
    this.hoistTitle();
    const old = this.querySelector(":scope > .viz-card-head");
    const tools = old?.querySelector(":scope > .viz-card-tools");
    old?.remove();
    const title = this.getTitle();
    const caption = this.getAttribute("caption");
    if (title) this.setAttribute("role", "group");
    else this.removeAttribute("role");
    if (title) this.setAttribute("aria-label", title);
    if (!title && !caption) return;
    this.prepend(h("div", { class: "viz-card-head" },
      h("div", { class: "viz-card-text" },
        title ? h("div", { class: "viz-card-title", role: "heading", "aria-level": "3", text: title }) : null,
        caption ? h("div", { class: "viz-card-caption", text: caption }) : null),
      tools || h("div", { class: "viz-card-tools" })));
  }
}

// -- stat --------------------------------------------------------------------------
// data: { value, unit?, note?, previous?, periodLabel?, good?, spark?: [numbers] } or a number
class StatElement extends VizElement {
  isEmpty(data) { return (typeof data === "number" ? data : data?.value) == null; }

  draw(raw) {
    const d = typeof raw === "number" ? { value: raw } : raw;
    const unit = this.getAttribute("unit") ?? d.unit ?? "";
    const line = h("p", { class: "viz-stat-line" },
      h("span", { class: "metric-value", text: fmtNum(d.value) }),
      h("span", { class: "metric-of", text: [unit, d.note].filter(Boolean).join(" ") }));
    const left = h("div", { class: "viz-stat-main" }, line, this.delta(d, unit));
    const spark = Array.isArray(d.spark) && d.spark.filter((v) => v != null).length >= 3 ? h("c-spark", { class: "viz-stat-spark", "data-title": `${this.getTitle() || "Динамика"}` }) : null;
    this.replaceChildren(h("div", { class: "viz-stat" }, this.titleNode(), h("div", { class: "viz-stat-row" }, left, spark)));
    if (spark) spark.data = d.spark;
  }

  delta(d, unit) {
    if (d.previous == null || d.value == null) return null;
    const diff = d.value - d.previous;
    const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
    const pct = d.previous ? Math.abs(diff / d.previous) * 100 : null;
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
    const text = pct != null ? `${sign}${fmtNum(pct, pct < 10 ? 1 : 0)} %` : `${sign}${fmtValue(Math.abs(diff), unit)}`;
    const good = this.getAttribute("good") || d.good || "up";
    const tone = dir === "flat" || good === "none" ? "flat" : dir === good ? "good" : "bad";
    return h("p", { class: `viz-delta is-${tone}` }, glyph(dir), h("b", { text }), h("span", { text: `к ${d.periodLabel || "прошлому периоду"}` }));
  }
}

// -- meter -------------------------------------------------------------------------
// data: { value, goal, unit?, note?, goalType?, segments?: [{ label, value, color }] }
class MeterElement extends VizElement {
  isEmpty(data) { return data?.value == null && !(data?.segments?.length); }

  draw(d) {
    const unit = this.getAttribute("unit") ?? d.unit ?? "";
    const goal = this.hasAttribute("goal") ? Number(this.getAttribute("goal")) : Number(d.goal) || 0;
    const limit = (this.getAttribute("goal-type") || d.goalType) === "max";
    const value = d.value ?? (d.segments || []).reduce((a, seg) => a + seg.value, 0);
    const share = goal > 0 ? value / goal : 0;
    const tone = limit ? (share > 1 ? "critical" : share > 0.9 ? "warning" : "ok") : "ok";
    const label = this.nameText() || "Прогресс";
    const line = h("p", { class: "viz-meter-line" },
      h("span", { class: "metric-value", text: fmtNum(value) }),
      h("span", { class: "metric-of", text: [goal > 0 ? `из ${fmtNum(goal)}` : "", unit, d.note].filter(Boolean).join(" ") }));
    const fills = (d.segments?.length ? d.segments : [{ label, value, color: 0 }]).map((seg, i, all) => {
      const fill = h("span", { class: `viz-fill s${Math.min(seg.color ?? 0, 6)} ${i === all.length - 1 ? "is-last" : ""} ${all.length === 1 && tone !== "ok" ? `is-${tone}` : ""}` });
      fill.style.width = `${Math.min(100, goal > 0 ? (seg.value / goal) * 100 : 0)}%`;
      return fill;
    });
    const track = h("div", { class: "viz-track", role: "progressbar", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": String(Math.round(goal)), "aria-valuenow": String(Math.round(value)) }, fills);
    const legend = d.segments?.length > 1
      ? h("div", { class: "viz-legend", role: "list" }, d.segments.map((seg) => h("span", { class: "viz-legend-item", role: "listitem" }, h("span", { class: `viz-key s${Math.min(seg.color ?? 0, 6)}` }), h("span", { text: `${seg.label} ${fmtNum(seg.value)}` }))))
      : null;
    this.replaceChildren(h("div", { class: "viz-meter" }, this.titleNode(), line, track, legend, this.foot(share, goal, value, unit, limit)));
  }

  foot(share, goal, value, unit, limit) {
    if (!(goal > 0)) return null;
    const pct = h("span", { class: "viz-pct", text: `${fmtNum(share * 100, 0)} %` });
    let status;
    if (limit && share > 1) status = h("span", { class: "viz-status is-critical" }, glyph("over"), h("span", { text: `превышено на ${fmtValue(value - goal, unit)}` }));
    else if (limit && share > 0.9) status = h("span", { class: "viz-status is-warning" }, glyph("warn"), h("span", { text: "близко к лимиту" }));
    else if (!limit && share >= 1) status = h("span", { class: "viz-status is-good" }, glyph("check"), h("span", { text: "цель достигнута" }));
    else status = h("span", { class: "viz-status" }, h("span", { text: `осталось ${fmtValue(goal - value, unit)}` }));
    return h("div", { class: "viz-meter-foot" }, pct, status);
  }
}

// -- table and list -----------------------------------------------------------------
// data: { columns: [{ key, label, numeric }], rows: [{ id, href?, icon?, title, sub?, cells: [{ text, numeric }] }], total? }
class TableElement extends VizElement {
  isEmpty(data) { return !data?.rows?.length; }

  draw(d) {
    // Rows that all carry the same name (tracker entries) get no name column.
    const named = d.rows.length < 2 || new Set(d.rows.map((r) => r.title)).size > 1 || d.rows.some((r) => r.href);
    const wrap = h("div", { class: "viz-table-wrap", tabindex: "0", role: "region", "aria-label": this.nameText() || "Таблица" },
      h("table", { class: "viz-table" },
        h("caption", { class: "viz-sr", text: this.nameText() || "Таблица" }),
        h("thead", null, h("tr", null, named ? h("th", { scope: "col", text: "Название" }) : null, (d.columns || []).map((c) => h("th", { scope: "col", class: c.numeric ? "num" : "", text: c.label })))),
        h("tbody", null, d.rows.map((row) => h("tr", null,
          named ? h("th", { scope: "row" }, row.href ? h("a", { class: "viz-link", href: row.href, text: row.title }) : h("span", { text: row.title })) : null,
          (row.cells || []).map((cell, i) => (i === 0 && !named ? h("th", { scope: "row", class: "", text: cell.text }) : h("td", { class: cell.numeric ? "num" : "", text: cell.text }))))))));
    const more = d.total > d.rows.length ? h("p", { class: "viz-more", text: `Показано ${d.rows.length} из ${d.total}` }) : null;
    this.replaceChildren(h("div", { class: "viz-rows" }, this.titleNode(), wrap, more));
  }
}

class ListElement extends VizElement {
  isEmpty(data) { return !data?.rows?.length; }

  draw(d) {
    const rows = d.rows.map((row) => {
      const sub = row.sub ?? (row.cells || []).map((c) => c.text).filter(Boolean).join(" · ");
      const body = [
        h("span", { class: "viz-row-icon", "aria-hidden": "true", text: row.icon || "" }),
        h("span", { class: "viz-row-main" }, h("span", { class: "viz-row-title", text: row.title }), sub ? h("span", { class: "viz-row-sub", text: sub }) : null),
      ];
      return row.href ? h("a", { class: "viz-row", href: row.href }, body) : h("div", { class: "viz-row" }, body);
    });
    const more = d.total > d.rows.length ? h("p", { class: "viz-more", text: `и ещё ${d.total - d.rows.length}` }) : null;
    this.replaceChildren(h("div", { class: "viz-rows" }, this.titleNode(), h("div", { class: "viz-list" }, rows), more));
  }
}

// -- empty -------------------------------------------------------------------------
class EmptyElement extends VizElement {
  connectedCallback() {
    this._text ??= this.textContent.trim();
    this.paint();
  }

  refresh() { this.paint(); }

  paint() {
    this.vizState = { empty: false, error: null, painted: true };
    this.replaceChildren(emptyBox(this._text || "Пока нет данных"));
  }
}

export const ELEMENTS = {
  "c-dashboard": DashboardElement,
  "c-grid": GridElement,
  "c-card": CardElement,
  "c-stat": StatElement,
  "c-meter": MeterElement,
  "c-bars": BarsElement,
  "c-line": LineElement,
  "c-spark": SparkElement,
  "c-heatmap": HeatmapElement,
  "c-table": TableElement,
  "c-list": ListElement,
  "c-empty": EmptyElement,
};

export function defineViz() {
  injectStyles();
  for (const [tag, constructor] of Object.entries(ELEMENTS)) if (!customElements.get(tag)) customElements.define(tag, constructor);
}

// Redraws the bound elements, for when the data behind the source changed.
export function refreshViz(root = document) {
  for (const el of root.querySelectorAll(Object.keys(ELEMENTS).join(","))) el.refresh?.();
}

if (typeof customElements !== "undefined") defineViz();
