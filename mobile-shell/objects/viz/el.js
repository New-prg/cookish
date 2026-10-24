// Base of the kit's custom elements and the small DOM helpers they share.
// Elements live in the light DOM (no shadow roots), so the tokens reach them and
// the audit can walk them. Text always goes through text nodes, never innerHTML.
import { getDataSource, onDataSource } from "./source.js";
import { isEmptyData } from "./util.js";

export const SVG_NS = "http://www.w3.org/2000/svg";

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  put(el, children);
  return el;
}

export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "text") el.textContent = value;
    else el.setAttribute(key, String(value));
  }
  put(el, children);
  return el;
}

function put(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

let measureCtx = null;
export function textWidth(text, font = "12px system-ui, sans-serif") {
  const value = String(text);
  try {
    measureCtx ??= document.createElement("canvas").getContext("2d");
    measureCtx.font = font;
    return measureCtx.measureText(value).width;
  } catch {
    return value.length * 6.6;
  }
}

const ICON_PATHS = {
  empty: "M4 19V9m5 10V5m5 14v-7m5 7v-4",
  warn: "M12 4 3 20h18L12 4zm0 6v5m0 3v.01",
  check: "M5 12.5 10 17l9-10",
  up: "M12 19V6m-6 6 6-6 6 6",
  down: "M12 5v13m-6-6 6 6 6-6",
  flat: "M5 12h14",
  over: "M12 4 3 20h18L12 4zm0 6v5m0 3v.01",
  edit: "M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4",
  open: "M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z",
  skip: "M7 7l10 10M17 7 7 17",
  prev: "M15 5 8 12l7 7",
  next: "M9 5l7 7-7 7",
};

export function glyph(name, size = 16) {
  return s("svg", { viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": "true", class: "viz-glyph", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" }, s("path", { d: ICON_PATHS[name] }));
}

export function emptyBox(text, { error = false } = {}) {
  return h("div", { class: `viz-empty${error ? " is-error" : ""}`, role: error ? "alert" : "status" }, glyph(error ? "warn" : "empty", 20), h("span", { class: "viz-empty-text", text }));
}

export const ATTRS = ["title", "data-title", "caption", "set", "of", "where", "value", "fn", "range", "by", "category", "goal", "date", "unit", "stack", "area", "compare", "spark", "good", "goal-type", "columns", "limit", "sort", "order", "cols", "edit", "search", "rows"];

export class VizElement extends HTMLElement {
  static get observedAttributes() { return ATTRS; }

  constructor() {
    super();
    this._data = undefined;
    this._resolved = undefined;
    this._width = 0;
    this._token = 0;
    this._queued = false;
    this.vizState = { empty: false, error: null, painted: false };
  }

  // Data handed over by code: SeriesData, points, rows or numbers (see util.js).
  get data() { return this._data; }
  set data(value) {
    this._data = value;
    if (this.isConnected) this.refresh();
  }

  // The browser shows a native tooltip for a title attribute; the title lives in data-title instead.
  hoistTitle() {
    if (!this.hasAttribute("title")) return;
    this.setAttribute("data-title", this.getAttribute("title"));
    this.removeAttribute("title");
  }

  getTitle() { return this.getAttribute("data-title") || ""; }

  connectedCallback() {
    this.hoistTitle();
    this._ro = new ResizeObserver(() => {
      const width = Math.round(this.clientWidth);
      if (width && width !== this._width && this._resolved !== undefined) this.paint();
    });
    this._ro.observe(this);
    this._off = onDataSource(() => this.refresh());
    this.refresh();
  }

  disconnectedCallback() {
    this._ro?.disconnect();
    this._off?.();
    this.cleanup();
  }

  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    if (name === "title") this.hoistTitle();
    if (this._queued) return;
    this._queued = true;
    queueMicrotask(() => { this._queued = false; if (this.isConnected) this.refresh(); });
  }

  spec() {
    const attrs = Object.fromEntries(this.getAttributeNames().filter((name) => name !== "data-title").map((name) => [name, this.getAttribute(name)]));
    return { tag: this.localName, ...attrs, ...(this.getTitle() ? { title: this.getTitle() } : {}) };
  }

  resolve() {
    if (this._data !== undefined) return this._data;
    if (!this.hasAttribute("set") && !this.hasAttribute("of")) return null;
    const source = getDataSource();
    return source ? source(this.spec()) : null;
  }

  refresh() {
    const mine = ++this._token;
    let out;
    try { out = this.resolve(); } catch (error) { this.fail(error); return; }
    if (out && typeof out.then === "function") {
      out.then((d) => { if (mine === this._token) this.accept(d); }, (e) => { if (mine === this._token) this.fail(e); });
      return;
    }
    this.accept(out);
  }

  accept(data) {
    this._resolved = data;
    this.paint();
  }

  fail(error) {
    this.cleanup();
    this.vizState = { empty: false, error, painted: true };
    this.setAttribute("data-error", String(error?.message || error));
    this.replaceChildren(emptyBox(`Не удалось показать: ${error?.message || error}`, { error: true }));
  }

  isEmpty(data) { return isEmptyData(this.localName, data); }

  paint() {
    if (this._resolved === undefined) return;
    try {
      this.removeAttribute("data-error");
      this.cleanup();
      this._width = Math.round(this.clientWidth);
      const empty = this.isEmpty(this._resolved);
      this.vizState = { empty, error: null, painted: true };
      this.toggleAttribute("data-empty", empty);
      if (empty) this.replaceChildren(...[this.titleNode(), emptyBox(this.emptyText || "Пока нет данных за этот период")].filter(Boolean));
      else this.draw(this._resolved, this._width);
    } catch (error) {
      this.fail(error);
    }
  }

  titleNode() {
    const title = this.getTitle();
    return title ? h("div", { class: "viz-title", text: title }) : null;
  }

  // The name a screen reader hears: own title or the card's.
  nameText() {
    return this.getTitle() || this.closest("c-card")?.getTitle?.() || "";
  }

  cleanup() {}
  draw() {}
}
