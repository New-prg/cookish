// Charts of the kit: bars, line, spark and heatmap. Marks follow the method:
// thin bars with a 4 px rounded data end on a straight baseline, 2 px lines,
// a 2 px surface gap between fills, recessive hairline grid, a few direct labels,
// text in text tokens only, a tooltip per mark and a table twin of every chart.
import { VizElement, h, s, textWidth } from "./el.js";
import {
  axisLabel, dateLabel, fmtAxis, fmtValue, hasValues, isDateKey, niceTicks, normalizeSeries,
  shiftDate, weekStart, MONTHS, WEEKDAYS,
} from "./util.js";

const PLOT_TOP = 18;
const PLOT_H = 168;
const AXIS_H = 24;
export const CHART_HEIGHT = PLOT_TOP + PLOT_H + AXIS_H;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const slotClass = (i) => `s${clamp(i, 0, 6)}`;

// A bar with a rounded data end and a straight baseline.
export function barPath(x, w, yBase, yEnd, radius = 4) {
  const rr = Math.min(radius, w / 2, Math.abs(yBase - yEnd));
  if (rr < 0.5) return `M${x} ${yBase}V${yEnd}H${x + w}V${yBase}Z`;
  const k = yEnd < yBase ? 1 : -1;
  return `M${x} ${yBase}V${yEnd + k * rr}Q${x} ${yEnd} ${x + rr} ${yEnd}H${x + w - rr}Q${x + w} ${yEnd} ${x + w} ${yEnd + k * rr}V${yBase}Z`;
}

// -- tooltip and pointer ---------------------------------------------------------
// One tooltip per chart. `at(event)` finds the nearest mark, `read(i)` describes it,
// `mark(i)` and `unmark()` lift it. Mouse hover, a tap and the arrow keys all work.
function interact(el, plot, { at, read, mark, unmark, steps }) {
  const tip = h("div", { class: "viz-tip", role: "status", hidden: "" });
  plot.append(tip);
  plot.tabIndex = 0;
  let active = -1;

  const hide = () => {
    if (active < 0) return;
    active = -1;
    tip.hidden = true;
    unmark();
  };
  const show = (i) => {
    if (i == null || i < 0) { hide(); return; }
    active = i;
    const info = read(i);
    tip.replaceChildren(
      h("div", { class: "viz-tip-title", text: info.title }),
      ...info.rows.map((row) => h("div", { class: "viz-tip-row" },
        row.color == null ? null : h("span", { class: `viz-key ${row.line ? "is-line" : ""} ${slotClass(row.color)}` }),
        h("span", { class: "viz-tip-value", text: row.value }),
        row.name ? h("span", { class: "viz-tip-name", text: row.name }) : null,
      )),
    );
    tip.hidden = false;
    mark(i);
    const width = tip.offsetWidth;
    tip.style.left = `${clamp(info.x - width / 2, 0, Math.max(0, plot.clientWidth - width))}px`;
    tip.style.top = `${info.top ?? 2}px`;
  };
  const point = (event) => {
    const box = plot.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  plot.addEventListener("pointermove", (event) => { if (event.pointerType !== "touch") show(at(point(event))); });
  plot.addEventListener("pointerdown", (event) => show(at(point(event))));
  plot.addEventListener("pointerleave", (event) => { if (event.pointerType !== "touch") hide(); });
  plot.addEventListener("blur", hide);
  plot.addEventListener("focus", () => { if (plot.matches(":focus-visible")) show(steps(-1, 0)); });
  plot.addEventListener("keydown", (event) => {
    const dir = { ArrowRight: 1, ArrowLeft: -1, Home: -2, End: 2 }[event.key];
    if (event.key === "Escape") { hide(); return; }
    if (!dir) return;
    event.preventDefault();
    show(steps(active, dir));
  });
  const outside = (event) => { if (!plot.contains(event.target)) hide(); };
  document.addEventListener("pointerdown", outside);
  el._offs.push(() => document.removeEventListener("pointerdown", outside));
  return { show, hide };
}

// -- shared chart element -----------------------------------------------------------
class ChartElement extends VizElement {
  constructor() {
    super();
    this._offs = [];
    this._showTable = false;
  }

  cleanup() {
    for (const off of this._offs.splice(0)) off();
    this._toggle = null;
  }

  series(data) {
    return normalizeSeries(data, {
      by: this.getAttribute("by") || "day",
      unit: this.getAttribute("unit") ?? "",
      goal: this.hasAttribute("goal") ? Number(this.getAttribute("goal")) : null,
      fn: this.getAttribute("fn") || "sum",
    });
  }

  isEmpty(data) { return !hasValues(this.series(data)); }

  // The shared frame: title row, legend, plot, table twin. Returns the pieces.
  frame(S, { height, legend = "square", table }) {
    const root = h("div", { class: "viz-chart" });
    const plot = h("div", { class: "viz-plot", role: "img", style: `height:${height}px` });
    plot.setAttribute("aria-label", this.summary(S));
    const tableWrap = h("div", { class: "viz-table-wrap", hidden: "", tabindex: "0", role: "region", "aria-label": `Таблица: ${this.nameText() || "данные"}` }, table);
    const toggle = h("button", { type: "button", class: "viz-toggle", "aria-pressed": String(this._showTable), "aria-label": "Показать таблицей" },
      h("span", { class: "viz-toggle-pill", text: this._showTable ? "График" : "Таблица" }));
    const apply = () => {
      plot.hidden = this._showTable;
      tableWrap.hidden = !this._showTable;
      toggle.setAttribute("aria-pressed", String(this._showTable));
      toggle.firstChild.textContent = this._showTable ? "График" : "Таблица";
      toggle.setAttribute("aria-label", this._showTable ? "Показать графиком" : "Показать таблицей");
    };
    toggle.addEventListener("click", () => { this._showTable = !this._showTable; apply(); });
    this._toggle = toggle;

    const card = this.closest("c-card");
    const slot = card && !this.getTitle() && card.getTitle() && card.querySelectorAll("c-bars, c-line, c-heatmap").length <= 1 ? card.toolsSlot?.() : null;
    const head = h("div", { class: "viz-head" }, this.titleNode(), slot ? null : toggle);
    if (slot) slot.replaceChildren(toggle);
    const legendNode = S.series.length > 1
      ? h("div", { class: "viz-legend", role: "list" }, S.series.map((ser) => h("span", { class: "viz-legend-item", role: "listitem" }, h("span", { class: `viz-key ${legend === "line" ? "is-line" : ""} ${slotClass(ser.color)}` }), h("span", { text: ser.label }))))
      : null;
    root.append(head.childNodes.length ? head : "", legendNode ?? "", plot, tableWrap);
    this.replaceChildren(root);
    apply();
    return { root, plot };
  }

  summary(S) {
    const name = this.nameText() || S.label || "График";
    const real = S.series.flatMap((ser) => ser.values).filter((v) => v != null);
    if (!real.length) return `${name}: нет данных`;
    return `${name}: от ${fmtValue(Math.min(...real), S.unit)} до ${fmtValue(Math.max(...real), S.unit)}, значений ${real.length}`;
  }

  cellText(S, v) { return v == null ? "—" : fmtValue(v, S.unit); }

  tableOf(S, firstLabel = "Период") {
    const caption = this.nameText() || S.label || "Данные";
    return h("table", { class: "viz-table" },
      h("caption", { class: "viz-sr", text: caption }),
      h("thead", null, h("tr", null, h("th", { scope: "col", text: firstLabel }), S.series.map((ser) => h("th", { scope: "col", class: "num", text: S.series.length > 1 ? ser.label : (S.label || ser.label || "Значение") })))),
      h("tbody", null, S.buckets.map((b, i) => h("tr", null, h("th", { scope: "row", text: axisLabel(b, S.by, "long") }), S.series.map((ser) => h("td", { class: "num", text: this.cellText(S, ser.values[i]) }))))),
    );
  }

  // Labels of the x axis that fit without touching.
  xLabels(S, left, slot, W, y) {
    const n = S.buckets.length;
    const style = S.by === "day" && n <= 7 ? "weekday" : "short";
    const texts = S.buckets.map((b) => axisLabel(b, S.by, style));
    const widest = Math.max(...texts.map((t) => textWidth(t)));
    const step = Math.max(1, Math.ceil((widest + 10) / slot));
    const nodes = [];
    for (let i = n - 1; i >= 0; i -= step) {
      const cx = left + slot * (i + 0.5);
      const w = textWidth(texts[i]);
      const x = clamp(cx, w / 2, W - w / 2);
      nodes.push(s("text", { class: "viz-xlabel", x, y, "text-anchor": "middle", text: texts[i] }));
    }
    return nodes;
  }

  // The goal line and its label. The label goes to the left or to the right end, whichever is free
  // of the value labels already placed; with neither free the line stands alone (the caption names it).
  goalLine(S, y, left, W, right, placed = []) {
    if (S.goal == null) return null;
    const yy = y(S.goal);
    const label = `Цель ${fmtValue(S.goal, S.unit)}`;
    const w = textWidth(label);
    const free = (x0) => !placed.some((p) => p.x0 < x0 + w + 4 && x0 - 4 < p.x1 && Math.abs(p.y - (yy - 5)) < 22);
    const spot = [left + 4, W - right - 4 - w].find(free);
    return s("g", { class: "viz-goal" },
      s("line", { x1: left, x2: W - right, y1: yy, y2: yy }),
      spot == null ? null : s("text", { class: "viz-goal-label", x: spot, y: yy - 5, text: label }),
    );
  }
}

// -- bars --------------------------------------------------------------------------
export class BarsElement extends ChartElement {
  draw(data, width) {
    const S = this.series(data);
    const stacked = S.series.length > 1 && this.getAttribute("stack") !== "grouped";
    const grouped = S.series.length > 1 && !stacked;
    const { plot } = this.frame(S, { height: CHART_HEIGHT, table: this.tableOf(S) });
    if (!width) return;
    const W = plot.clientWidth || width;
    const n = S.buckets.length;
    const all = S.series.flatMap((ser) => ser.values.filter((v) => v != null));
    const lo = stacked ? 0 : Math.min(0, ...all);
    const topOf = (i) => (stacked ? S.series.reduce((a, ser) => a + Math.max(0, ser.values[i] || 0), 0) : Math.max(...S.series.map((ser) => ser.values[i] ?? -Infinity)));
    const hi = Math.max(...S.buckets.map((_, i) => topOf(i)).filter(Number.isFinite), S.goal || 0, 0.000001);
    const { ticks, min, max } = niceTicks(lo, hi, 4);
    const y = (v) => PLOT_TOP + PLOT_H * (1 - (v - min) / (max - min));
    const left = Math.ceil(Math.max(...ticks.map((t) => textWidth(fmtAxis(t))))) + 10;
    const right = 6;
    const slot = (W - left - right) / n;
    const base = y(Math.max(0, min));

    const svg = s("svg", { viewBox: `0 0 ${W} ${CHART_HEIGHT}`, width: W, height: CHART_HEIGHT, "aria-hidden": "true" });
    const grid = s("g", { class: "viz-grid" });
    for (const t of ticks) {
      grid.append(s("line", { x1: left, x2: W - right, y1: y(t), y2: y(t) }));
      grid.append(s("text", { class: "viz-ylabel", x: left - 6, y: y(t) + 4, "text-anchor": "end", text: fmtAxis(t) }));
    }
    svg.append(grid, s("g", { class: "viz-axis" }, s("line", { x1: left, x2: W - right, y1: base, y2: base })));

    const cols = [];
    const labelled = [];
    let placed = [];
    S.buckets.forEach((b, i) => {
      const cx = left + slot * (i + 0.5);
      const g = s("g", { class: "viz-col" });
      if (stacked) {
        const bw = clamp(slot * 0.62, 3, 24);
        let acc = 0;
        const parts = S.series.map((ser, j) => ({ ser, j, v: Math.max(0, ser.values[i] || 0) })).filter((p) => p.v > 0);
        parts.forEach((p, k) => {
          const y0 = y(acc);
          acc += p.v;
          const y1 = y(acc);
          const lower = k > 0 && y0 - y1 > 4 ? 1 : 0;
          const upper = k < parts.length - 1 && y0 - y1 > 4 ? 1 : 0;
          g.append(s("path", { class: `viz-mark ${slotClass(p.ser.color)}`, d: barPath(cx - bw / 2, bw, y0 - lower, y1 + upper, k === parts.length - 1 ? 4 : 0) }));
        });
      } else {
        const k = S.series.length;
        const bw = grouped ? clamp((slot * 0.72 - (k - 1) * 2) / k, 2, 24) : clamp(slot * 0.62, 3, 24);
        const groupW = k * bw + (k - 1) * 2;
        S.series.forEach((ser, j) => {
          const v = ser.values[i];
          if (v == null) return;
          const x = cx - groupW / 2 + j * (bw + 2);
          g.append(s("path", { class: `viz-mark ${slotClass(ser.color)}`, d: barPath(x, bw, y(0), y(v)) }));
        });
        if (k === 1 && ser1(S).values[i] != null) labelled.push(i);
      }
      cols.push(g);
      svg.append(g);
    });

    if (S.series.length === 1) {
      const values = S.series[0].values;
      const real = labelled.filter((i) => values[i] != null);
      const last = real[real.length - 1];
      const peak = real.reduce((best, i) => (best == null || values[i] > values[best] ? i : best), null);
      const picks = [...new Set([peak, last].filter((i) => i != null))];
      let lastEdge = -Infinity;
      placed = [];
      for (const i of picks.sort((a, b) => a - b)) {
        const text = fmtValue(values[i], "");
        const w = textWidth(text, "600 12px system-ui, sans-serif");
        const cx = clamp(left + slot * (i + 0.5), left + w / 2, W - w / 2);
        if (cx - w / 2 < lastEdge + 6) continue;
        lastEdge = cx + w / 2;
        const top = values[i] >= 0 ? y(values[i]) - 6 : y(values[i]) + 14;
        placed.push({ x0: cx - w / 2, x1: cx + w / 2, y: top });
        svg.append(s("text", { class: "viz-value-label", x: cx, y: top, "text-anchor": "middle", text }));
      }
    }
    const goal = this.goalLine(S, y, left, W, right, placed);
    if (goal) svg.append(goal);
    svg.append(...this.xLabels(S, left, slot, W, PLOT_TOP + PLOT_H + 17));
    plot.prepend(svg);

    interact(this, plot, {
      at: ({ x }) => clamp(Math.floor((x - left) / slot), 0, n - 1),
      read: (i) => {
        const rows = S.series.filter((ser) => ser.values[i] != null).map((ser) => ({ color: ser.color, value: this.cellText(S, ser.values[i]), name: ser.label }));
        if (stacked && rows.length > 1) rows.push({ color: null, value: fmtValue(S.series.reduce((a, ser) => a + (ser.values[i] || 0), 0), S.unit), name: "всего" });
        if (!rows.length) rows.push({ color: null, value: "нет данных", name: "" });
        return { title: axisLabel(S.buckets[i], S.by, "long"), rows, x: left + slot * (i + 0.5) };
      },
      mark: (i) => { cols.forEach((g, k) => g.classList.toggle("is-hover", k === i)); },
      unmark: () => { cols.forEach((g) => g.classList.remove("is-hover")); },
      steps: (from, dir) => (dir === -2 ? 0 : dir === 2 ? n - 1 : from < 0 ? n - 1 : clamp(from + dir, 0, n - 1)),
    });
  }
}
const ser1 = (S) => S.series[0];

// -- line --------------------------------------------------------------------------
export class LineElement extends ChartElement {
  draw(data, width) {
    const S = this.series(data);
    const area = this.hasAttribute("area") && S.series.length === 1;
    const { plot } = this.frame(S, { height: CHART_HEIGHT, legend: "line", table: this.tableOf(S) });
    if (!width) return;
    const W = plot.clientWidth || width;
    const n = S.buckets.length;
    const all = S.series.flatMap((ser) => ser.values.filter((v) => v != null));
    const zero = ["sum", "count"].includes(S.fn);
    let lo = Math.min(...all, S.goal ?? Infinity);
    let hi = Math.max(...all, S.goal ?? -Infinity);
    if (zero) lo = Math.min(0, lo);
    else {
      const pad = (hi - lo) * 0.18 || Math.abs(hi) * 0.02 || 1;
      const positive = lo >= 0;
      lo -= pad;
      hi += pad;
      if (positive && lo < 0) lo = 0; // a measure that cannot be negative gets no negative axis
    }
    const { ticks, min, max } = niceTicks(lo, hi, 4);
    const y = (v) => PLOT_TOP + PLOT_H * (1 - (v - min) / (max - min));
    const left = Math.ceil(Math.max(...ticks.map((t) => textWidth(fmtAxis(t))))) + 10;
    const names = S.series.length > 1 && S.series.length <= 4;
    const right = names ? Math.min(78, Math.ceil(Math.max(...S.series.map((ser) => textWidth(ser.label)))) + 14) : 10;
    const slot = (W - left - right) / n;
    const x = (i) => left + slot * (i + 0.5);

    const svg = s("svg", { viewBox: `0 0 ${W} ${CHART_HEIGHT}`, width: W, height: CHART_HEIGHT, "aria-hidden": "true" });
    const grid = s("g", { class: "viz-grid" });
    for (const t of ticks) {
      grid.append(s("line", { x1: left, x2: W - right + 4, y1: y(t), y2: y(t) }));
      grid.append(s("text", { class: "viz-ylabel", x: left - 6, y: y(t) + 4, "text-anchor": "end", text: fmtAxis(t) }));
    }
    svg.append(grid, s("g", { class: "viz-axis" }, s("line", { x1: left, x2: W - right + 4, y1: PLOT_TOP + PLOT_H, y2: PLOT_TOP + PLOT_H })));
    const goal = this.goalLine(S, y, left, W, right - 4);
    if (goal) svg.append(goal);

    const ends = [];
    S.series.forEach((ser) => {
      const real = ser.values.map((v, i) => (v == null ? null : [x(i), y(v), i])).filter(Boolean);
      if (!real.length) return;
      const path = real.map(([px, py], k) => `${k ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join("");
      if (area && real.length > 1) {
        const bottom = PLOT_TOP + PLOT_H;
        svg.append(s("path", { class: `viz-area ${slotClass(ser.color)}`, d: `${path}L${real[real.length - 1][0].toFixed(1)} ${bottom}L${real[0][0].toFixed(1)} ${bottom}Z` }));
      }
      svg.append(s("path", { class: `viz-line ${slotClass(ser.color)}`, d: path }));
      const dots = real.length <= 16 ? real : [real[real.length - 1]];
      for (const [px, py] of dots) svg.append(s("circle", { class: `viz-dot ${slotClass(ser.color)}`, cx: px, cy: py, r: 4 }));
      ends.push({ ser, px: real[real.length - 1][0], py: real[real.length - 1][1], v: ser.values[real[real.length - 1][2]] });
    });
    if (S.series.length === 1 && ends[0]) {
      const text = fmtValue(ends[0].v, "");
      const w = textWidth(text, "600 12px system-ui, sans-serif");
      svg.append(s("text", { class: "viz-value-label", x: clamp(ends[0].px, w / 2, W - w / 2), y: ends[0].py - 11, "text-anchor": "middle", text }));
    } else if (names) {
      const sorted = [...ends].sort((a, b) => a.py - b.py);
      if (sorted.every((e, k) => k === 0 || e.py - sorted[k - 1].py >= 14)) {
        for (const e of sorted) svg.append(s("text", { class: "viz-end-label", x: e.px + 9, y: e.py + 4, text: e.ser.label }));
      }
    }
    svg.append(...this.xLabels(S, left, slot, W, PLOT_TOP + PLOT_H + 17));

    const hover = s("g", { class: "viz-hover", visibility: "hidden" }, s("line", { class: "viz-crosshair", y1: PLOT_TOP, y2: PLOT_TOP + PLOT_H }));
    svg.append(hover);
    plot.prepend(svg);

    const valid = S.buckets.map((_, i) => i).filter((i) => S.series.some((ser) => ser.values[i] != null));
    const nearest = (px) => valid.reduce((best, i) => (best < 0 || Math.abs(x(i) - px) < Math.abs(x(best) - px) ? i : best), -1);
    interact(this, plot, {
      at: ({ x: px }) => nearest(px),
      read: (i) => ({
        title: axisLabel(S.buckets[i], S.by, "long"),
        rows: S.series.filter((ser) => ser.values[i] != null).map((ser) => ({ color: ser.color, line: true, value: this.cellText(S, ser.values[i]), name: ser.label })),
        x: x(i),
      }),
      mark: (i) => {
        hover.setAttribute("visibility", "visible");
        const line = hover.querySelector("line");
        line.setAttribute("x1", x(i));
        line.setAttribute("x2", x(i));
        hover.querySelectorAll("circle").forEach((c) => c.remove());
        for (const ser of S.series) if (ser.values[i] != null) hover.append(s("circle", { class: `viz-dot ${slotClass(ser.color)}`, cx: x(i), cy: y(ser.values[i]), r: 5 }));
      },
      unmark: () => hover.setAttribute("visibility", "hidden"),
      steps: (from, dir) => {
        if (dir === -2) return valid[0];
        if (dir === 2) return valid[valid.length - 1];
        if (from < 0) return valid[valid.length - 1];
        const at = valid.indexOf(from);
        return valid[clamp(at + dir, 0, valid.length - 1)];
      },
    });
  }
}

// -- spark ------------------------------------------------------------------------
export class SparkElement extends ChartElement {
  draw(data, width) {
    const S = this.series(data);
    const values = S.series[0].values;
    const real = values.map((v, i) => (v == null ? null : [i, v])).filter(Boolean);
    const root = h("div", { class: "viz-spark" });
    this.replaceChildren(root);
    root.setAttribute("role", "img");
    root.setAttribute("aria-label", `${this.nameText() || "Динамика"}: от ${fmtValue(Math.min(...real.map((p) => p[1])), S.unit)} до ${fmtValue(Math.max(...real.map((p) => p[1])), S.unit)}`);
    if (!width) return;
    const W = root.clientWidth || width;
    const H = 32;
    const lo = Math.min(...real.map((p) => p[1]));
    const hi = Math.max(...real.map((p) => p[1]));
    const pad = 6;
    const x = (i) => pad + (W - pad * 2) * (values.length > 1 ? i / (values.length - 1) : 0.5);
    const y = (v) => (hi === lo ? H / 2 : pad + (H - pad * 2) * (1 - (v - lo) / (hi - lo)));
    const pts = real.map(([i, v]) => [x(i), y(v)]);
    const d = (list) => list.map(([px, py], k) => `${k ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join("");
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, "aria-hidden": "true" });
    svg.append(s("path", { class: "viz-line is-quiet", d: d(pts) }));
    if (pts.length > 2) svg.append(s("path", { class: "viz-line s0", d: d(pts.slice(-Math.max(2, Math.ceil(pts.length * 0.25)))) }));
    const end = pts[pts.length - 1];
    svg.append(s("circle", { class: "viz-dot s0", cx: end[0], cy: end[1], r: 4 }));
    root.append(svg);
  }
}

// -- heatmap ----------------------------------------------------------------------
export class HeatmapElement extends ChartElement {
  draw(data, width) {
    const S = this.series(data);
    const values = S.series[0].values;
    const days = S.buckets.filter((b) => isDateKey(b));
    const byDay = new Map(S.buckets.map((b, i) => [b, values[i]]));
    const first = days[0];
    const last = days[days.length - 1];
    const startWeek = weekStart(first);
    const weeks = [];
    for (let d = startWeek; d <= last; d = shiftDate(d, 7)) weeks.push(d);
    const real = values.filter((v) => v != null && v > 0);
    const max = real.length ? Math.max(...real) : 0;
    const level = (v) => (v == null || v <= 0 || !max ? 0 : clamp(Math.ceil((v / max) * 5), 1, 5));
    const table = h("table", { class: "viz-table" },
      h("caption", { class: "viz-sr", text: this.nameText() || "Календарь" }),
      h("thead", null, h("tr", null, h("th", { scope: "col", text: "День" }), h("th", { scope: "col", class: "num", text: S.label || "Значение" }))),
      h("tbody", null, [...days].reverse().filter((d) => byDay.get(d) != null && byDay.get(d) > 0).map((d) => h("tr", null, h("th", { scope: "row", text: dateLabel(d, "day", "long") }), h("td", { class: "num", text: fmtValue(byDay.get(d), S.unit) })))));
    const labelW = 22;
    const gap = 2;
    const cell = clamp(Math.floor(((width || 300) - labelW) / weeks.length) - gap, 8, 22);
    const topH = 16;
    const height = topH + 7 * (cell + gap);
    const { plot, root } = this.frame(S, { height, table });
    const scale = h("div", { class: "viz-scale" },
      h("span", { text: "меньше" }),
      [0, 1, 2, 3, 4, 5].map((l) => h("span", { class: `viz-swatch l${l}` })),
      h("span", { text: max ? `больше, до ${fmtValue(max, S.unit)}` : "больше" }));
    root.insertBefore(scale, root.querySelector(".viz-table-wrap"));
    if (!width) return;
    const W = plot.clientWidth || width;
    const svg = s("svg", { viewBox: `0 0 ${W} ${height}`, width: W, height, "aria-hidden": "true" });
    [0, 2, 4].forEach((r) => svg.append(s("text", { class: "viz-ylabel", x: 0, y: topH + r * (cell + gap) + cell * 0.72, text: WEEKDAYS[r] })));
    let lastMonth = -9;
    weeks.forEach((w, c) => {
      const month = Number(w.slice(5, 7)) - 1;
      const x = labelW + c * (cell + gap);
      if (c - lastMonth >= 3 && (c === 0 || w.slice(0, 7) !== weeks[c - 1].slice(0, 7))) {
        svg.append(s("text", { class: "viz-xlabel", x, y: 11, text: MONTHS[month] }));
        lastMonth = c;
      }
      for (let r = 0; r < 7; r += 1) {
        const date = shiftDate(w, r);
        if (date < first || date > last) continue;
        svg.append(s("rect", { class: `viz-cell l${level(byDay.get(date))}`, "data-date": date, x, y: topH + r * (cell + gap), width: cell, height: cell, rx: 3 }));
      }
    });
    const hoverRect = s("rect", { class: "viz-cell-ring", width: cell + 2, height: cell + 2, rx: 4, visibility: "hidden" });
    svg.append(hoverRect);
    plot.prepend(svg);

    const cells = [];
    weeks.forEach((w, c) => { for (let r = 0; r < 7; r += 1) { const date = shiftDate(w, r); if (date >= first && date <= last) cells.push({ date, c, r }); } });
    const find = (c, r) => cells.findIndex((it) => it.c === c && it.r === r);
    interact(this, plot, {
      at: ({ x, y }) => {
        const c = Math.floor((x - labelW) / (cell + gap));
        const r = Math.floor((y - topH) / (cell + gap));
        return find(c, r);
      },
      read: (i) => {
        const v = byDay.get(cells[i].date);
        return {
          title: dateLabel(cells[i].date, "day", "long"),
          rows: [{ color: null, value: v == null || v <= 0 ? "нет записей" : fmtValue(v, S.unit), name: v == null || v <= 0 ? "" : S.label }],
          x: labelW + cells[i].c * (cell + gap) + cell / 2,
          top: Math.max(0, topH + cells[i].r * (cell + gap) + cell + 6),
        };
      },
      mark: (i) => {
        hoverRect.setAttribute("visibility", "visible");
        hoverRect.setAttribute("x", labelW + cells[i].c * (cell + gap) - 1);
        hoverRect.setAttribute("y", topH + cells[i].r * (cell + gap) - 1);
      },
      unmark: () => hoverRect.setAttribute("visibility", "hidden"),
      steps: (from, dir) => {
        if (dir === -2) return 0;
        if (dir === 2) return cells.length - 1;
        if (from < 0) return cells.length - 1;
        return clamp(from + dir, 0, cells.length - 1);
      },
    });
  }
}
