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
import { fmtNum, fmtValue, isOn } from "./util.js";
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

// data.pace.text: what is left per remaining day of the goal's period.
const paceLine = (pace) => (pace?.text ? h("p", { class: "viz-pace", text: pace.text }) : null);

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
    const left = h("div", { class: "viz-stat-main" }, line, this.delta(d, unit), paceLine(d.pace));
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
    // goal="due" names where the goal comes from; the number is in the data.
    const attrGoal = Number(this.getAttribute("goal"));
    const goal = this.hasAttribute("goal") && Number.isFinite(attrGoal) ? attrGoal : Number(d.goal) || 0;
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
    this.replaceChildren(h("div", { class: "viz-meter" }, this.titleNode(), line, track, legend, this.foot(share, goal, value, unit, limit), paceLine(d.pace)));
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
// data: { mode?, columns: [{ key, label, numeric }], rows: [{ id, href?, icon?, title, sub?, state?, stateLabel?, search?, cells: [{ text, numeric }] }], total?, limit?, query?, remember? }
// Attributes: edit="yes" makes a row with an id a button that reports kit-edit { id, track, title };
// search="yes" puts a text filter above the rows (data.limit then caps what is shown after the filter).
// Rows of items (rows="items", or data.mode "items") show their state as a badge: a mark and a word.
// data.query and data.remember keep the filter across redraws.
const ITEM_STATES = { open: ["open", "открыто"], done: ["check", "сделано"], changed: ["check", "изменено"], skipped: ["skip", "пропущено"], pending: ["open", "ждёт"] };
const searchable = (text) => String(text ?? "").toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
const rowWords = (row) => [row.title, row.sub, ...(row.cells || []).map((c) => c.text), row.search].filter(Boolean).join(" ");
const rowName = (row) => [...new Set([row.title, ...(row.cells || []).map((c) => c.text)])].filter(Boolean).join(", ").slice(0, 90);

function stateBadge(row) {
  const [icon, word] = ITEM_STATES[row.state] || ["open", row.state];
  return h("span", { class: `viz-badge is-${row.state}` }, glyph(icon, 14), h("span", { text: (row.stateLabel || word).toLocaleLowerCase("ru-RU") }));
}

class RowsElement extends VizElement {
  isEmpty(data) { return !data?.rows?.length; }

  flag(name) { return isOn(this.getAttribute(name)); }

  draw(d) {
    const content = h("div", { class: "viz-rows-content" });
    const paint = () => this.fillRows(content, d);
    this._query ??= d.query ?? "";
    this.replaceChildren(h("div", { class: "viz-rows" }, this.titleNode(), this.flag("search") ? this.searchBox(d, paint) : null, content));
    paint();
  }

  searchBox(d, paint) {
    const input = h("input", { type: "search", class: "kit-input viz-search", autocomplete: "off", placeholder: "Поиск", "aria-label": `Поиск: ${this.nameText() || "по строкам"}` });
    input.value = this._query;
    input.addEventListener("input", () => {
      this._query = input.value;
      d.remember?.(input.value);
      paint();
    });
    return input;
  }

  // The rows that pass the filter, cut to the limit; "more" counts the rest.
  fillRows(content, d) {
    const query = searchable(this._query).trim();
    const hits = query ? d.rows.filter((row) => searchable(rowWords(row)).includes(query)) : d.rows;
    const shown = d.limit ? hits.slice(0, d.limit) : hits;
    const count = query ? hits.length : Math.max(d.total ?? 0, hits.length);
    if (!shown.length) {
      content.replaceChildren(emptyBox(`Ничего не найдено по запросу «${this._query.trim()}»`));
      return;
    }
    content.replaceChildren(...this.body(d, shown, count - shown.length).filter(Boolean));
  }

  edit(row) {
    this.dispatchEvent(new CustomEvent("kit-edit", { bubbles: true, detail: { id: row.id, track: this.getAttribute("of"), title: row.title } }));
  }

  editable(row) { return this.flag("edit") && row.id != null; }
}

class TableElement extends RowsElement {
  body(d, rows, more) {
    // Rows that all carry the same name (tracker entries) get no name column; a filter does not change that.
    const named = d.rows.length < 2 || new Set(d.rows.map((r) => r.title)).size > 1 || d.rows.some((r) => r.href);
    const columns = d.columns || [];
    const status = (this.getAttribute("rows") === "items" || d.mode === "items") && rows.some((r) => r.state) && !columns.some((c) => c.key === "state");
    const first = (row, content) => (this.editable(row)
      ? h("button", { type: "button", class: "viz-edit", "aria-label": `Изменить: ${rowName(row)}`, onclick: () => this.edit(row) }, h("span", { class: "viz-edit-text", text: content }), glyph("edit", 14))
      : content);
    const wrap = h("div", { class: "viz-table-wrap", tabindex: "0", role: "region", "aria-label": this.nameText() || "Таблица" },
      h("table", { class: "viz-table" },
        h("caption", { class: "viz-sr", text: this.nameText() || "Таблица" }),
        h("thead", null, h("tr", null, named ? h("th", { scope: "col", text: "Название" }) : null, columns.map((c) => h("th", { scope: "col", class: c.numeric ? "num" : "", text: c.label })), status ? h("th", { scope: "col", text: "Статус" }) : null)),
        h("tbody", null, rows.map((row) => h("tr", null,
          named ? h("th", { scope: "row" }, row.href ? h("a", { class: "viz-link", href: row.href, text: row.title }) : first(row, row.title)) : null,
          (row.cells || []).map((cell, i) => (i === 0 && !named ? h("th", { scope: "row" }, first(row, cell.text)) : h("td", { class: cell.numeric ? "num" : "", text: cell.text }))),
          status ? h("td", null, row.state ? stateBadge(row) : null) : null)))));
    return [wrap, more > 0 ? h("p", { class: "viz-more", text: `Показано ${rows.length} из ${rows.length + more}` }) : null];
  }
}

class ListElement extends RowsElement {
  body(d, rows, more) {
    const items = this.getAttribute("rows") === "items" || d.mode === "items";
    const lines = rows.map((row) => {
      const sub = row.sub ?? (row.cells || []).map((c) => c.text).filter(Boolean).join(" · ");
      const editing = this.editable(row);
      const body = [
        h("span", { class: "viz-row-icon", "aria-hidden": "true", text: row.icon || "" }),
        h("span", { class: "viz-row-main" }, h("span", { class: "viz-row-title", text: row.title }), sub ? h("span", { class: "viz-row-sub", text: sub }) : null),
        items && row.state ? stateBadge(row) : null,
        editing ? glyph("edit", 16) : null,
      ];
      if (editing) return h("button", { type: "button", class: "viz-row is-edit", "aria-label": `Изменить: ${rowName(row)}`, onclick: () => this.edit(row) }, body);
      return row.href ? h("a", { class: "viz-row", href: row.href }, body) : h("div", { class: "viz-row" }, body);
    });
    return [h("div", { class: "viz-list" }, lines), more > 0 ? h("p", { class: "viz-more", text: `и ещё ${more}` }) : null];
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
