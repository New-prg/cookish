// DOM helpers. Object data comes from other people later, so text always goes
// through text nodes and attributes, never through innerHTML.

const PROPS = new Set(["value", "checked", "disabled", "selected", "indeterminate"]);

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (PROPS.has(key)) el[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  append(el, children);
  return el;
}

// Replaces the children of an element; children nest and skip null like h().
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

const SVG = "http://www.w3.org/2000/svg";
const ICONS = {
  home: "M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z",
  library: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  plus: "M12 5v14M5 12h14",
  search: "M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20",
  back: "M15 5 8 12l7 7",
  next: "M9 5l7 7-7 7",
  close: "M6 6l12 12M18 6 6 18",
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
  check: "M5 12.5 10 17l9-10",
  assistant: "M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 10h8",
};

export function icon(name, size = 24) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "icon");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

// Dates are calendar keys (ГГГГ-ММ-ДД); format them in UTC so the key never
// shifts by the device time zone.
const DAY_LONG = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const DAY_SHORT = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("ru-RU", { weekday: "short", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
const asDate = (key) => new Date(`${key}T00:00:00Z`);

export const dayLong = (key) => DAY_LONG.format(asDate(key));
export const dayShort = (key) => DAY_SHORT.format(asDate(key));
export const weekdayShort = (key) => WEEKDAY.format(asDate(key));
export const monthLabel = (key) => MONTH.format(asDate(key)).replace(/\s*г\.$/, "");
export const shiftDate = (key, n) => new Date(asDate(key).getTime() + n * 86400000).toISOString().slice(0, 10);

export function relativeDay(key, today) {
  if (key === today) return "Сегодня";
  if (key === shiftDate(today, -1)) return "Вчера";
  if (key === shiftDate(today, 1)) return "Завтра";
  const label = dayLong(key);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export const num = (value) => Math.round(Number(value) || 0).toLocaleString("ru-RU");

export function localNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function pageHeader({ title, back = false, actions = [] }) {
  return h("header", { class: "topbar" },
    back ? h("button", { class: "icon-btn", "aria-label": "Назад", onclick: () => history.back() }, icon("back")) : null,
    h("h1", { class: "topbar-title", text: title }),
    h("div", { class: "topbar-actions" }, actions),
  );
}

export function progressBar(value, max) {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const bar = h("div", { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(Math.round(max || 0)), "aria-valuenow": String(Math.round(value || 0)) }, h("div", { class: "bar-fill" }));
  bar.firstChild.style.width = `${share * 100}%`;
  return bar;
}

export function empty(text) {
  return h("p", { class: "empty", text });
}

// A bottom sheet. `build(close)` returns its content.
export function openSheet(title, build) {
  const host = document.getElementById("sheets");
  const previous = document.activeElement;
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  };
  const onKey = (event) => { if (event.key === "Escape") close(); };
  const sheet = h("section", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "sheet-head" },
      h("h2", { text: title }),
      h("button", { class: "icon-btn", "aria-label": "Закрыть", onclick: close }, icon("close")),
    ),
    h("div", { class: "sheet-body" }, build(close)),
  );
  const backdrop = h("div", { class: "sheet-backdrop", onclick: (event) => { if (event.target === backdrop) close(); } }, sheet);
  host.append(backdrop);
  document.getElementById("toasts").replaceChildren();
  document.addEventListener("keydown", onKey);
  sheet.querySelector("input, select, textarea")?.focus({ preventScroll: true });
  return close;
}

let toastTimer = null;
export function toast(message, { undo = null, error = false } = {}) {
  const host = document.getElementById("toasts");
  clearTimeout(toastTimer);
  const node = h("div", { class: `toast${error ? " toast-error" : ""}`, role: error ? "alert" : "status" },
    h("span", { class: "toast-text", text: message }),
    undo ? h("button", { class: "toast-action", onclick: () => { node.remove(); undo(); } }, "Отменить") : null,
  );
  host.replaceChildren(node);
  toastTimer = setTimeout(() => node.remove(), undo ? 7000 : 4000);
}

// Every write of the page, from a button or a kit screen. A batch that touches the
// plan comes back with a change set whose revert undoes all of it, facts included;
// a batch of facts alone is not journaled, so its undo is built here from the state
// before. The result is store.apply's; a refusal is shown as an error toast.
export function applyUndoable(store, ops, { summary = "", quiet = false } = {}) {
  const list = Array.isArray(ops) ? ops : [ops];
  const before = store.state();
  const result = store.apply(list, { actor: "human", summary });
  if (!result.ok) {
    toast(result.reason, { error: true });
    return result;
  }
  const touched = new Set([...result.ids, ...list.filter((op) => op.op !== "create" && op.id).map((op) => op.id)]);
  const undo = result.changeSetId ? [{ op: "revert", changeSetId: result.changeSetId }] : factUndoOps(before, store.state(), touched);
  if (!quiet && undo.length) {
    toast(summary || "Сохранено", {
      undo: () => {
        const back = store.apply(undo, { actor: "human", summary: `Отмена: ${summary}` });
        toast(back.ok ? "Отменено" : back.reason, { error: !back.ok });
      },
    });
  }
  return result;
}

function factUndoOps(before, after, ids) {
  const ops = [];
  for (const id of ids) {
    const was = before.objects[id];
    const now = after.objects[id];
    if (!now || !after.types[now.type]?.fact) continue;
    if (!was) { ops.push({ op: "archive", id }); continue; }
    if (now.archivedAt && !was.archivedAt) ops.push({ op: "restore", id });
    const keys = new Set([...Object.keys(was.props || {}), ...Object.keys(now.props || {})]);
    ops.push({ op: "update", id, name: was.name, props: Object.fromEntries([...keys].map((k) => [k, was.props?.[k] ?? null])) });
    if (was.archivedAt && !now.archivedAt) ops.push({ op: "archive", id });
  }
  return ops;
}

export function field(label, control, hint) {
  return h("label", { class: "field" }, h("span", { class: "field-label", text: label }), control, hint ? h("span", { class: "field-hint", text: hint }) : null);
}

export function segmented(options, current, onPick, { label = "", allowClear = false } = {}) {
  return h("div", { class: "seg", role: "group", "aria-label": label },
    options.map((o) => h("button", {
      class: `seg-btn${o.id === current ? " is-on" : ""}${o.color ? ` tone-${o.color}` : ""}`,
      "aria-pressed": String(o.id === current),
      onclick: () => onPick(o.id === current && allowClear ? null : o.id),
    }, o.name)),
  );
}
