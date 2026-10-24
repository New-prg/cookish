// The input elements of the kit, in the style of the chart kit (viz/el.js): light
// DOM, Russian text, colors from the tokens only. Import this module once; it
// injects the styles and defines the tags.
//
//   <c-quick of="water" values="ml=250">   one button that records a preset
//   <c-form of="sleep" fields="lay,woke">  a field per type and a submit
//   <c-marks of="vitamins">                today's occurrences, a button per state
//   <c-add of="recipes">                   a name and the fields of a row, under a list with add
//   <c-streak of="vitamins">               current, best and the last 30 days
//   <c-embed what="ration-today">          a classic widget
//
// An input never touches the store. It draws the `data` that kit/bind.js
// resolved for it and answers a tap with a `kit-action` event, whose detail is
// a closed record the screen turns into ops (kit/actions.js):
//
//   { do: "quick",   track, values, date, summary }
//   { do: "form",    track, values, date, summary }
//   { do: "mark",    track, item | slot, state, values?, date, summary }
//   { do: "unmark",  track, item | slot, date, summary }
//   { do: "addItem", track, name, every?, plan?, summary }
//
// The data each element takes is what kit/bind.js resolveBinding returns for it:
//
//   c-quick   { track, name, values, label, fields, date }
//   c-form    { track, name, kind, date, maxDate, fields: [field + default], lastEntry }
//   c-marks   { track, name, kind, date, canMark, states: [{ id, label }], add, addEvery, empty,
//               rows: [{ key, itemId, slot, name, at, time, state, via, markId, planned, values, ask }],
//               progress: { done, of } }
//   c-add     { track, name, kind, date, fields }
//   c-streak  { current, best, last30: { ok, of }, unit }
//   c-embed   { what, state, ctx }  (built by kit/screen.js, not by bind.js)
//
// A field is { key, name, type, unit, min, max, options: [{ id, name }], labels, required, hint }.
// The caller of a c-marks may add { compact: true } to drop the row names (a control
// that stands under a meal already has the meal's name above it).
import { VizElement, glyph, h } from "../viz/el.js";
import { injectStyles } from "../viz/styles.js";
import { fmtNum, fmtValue, plural } from "../viz/util.js";

const STATE_NAMES = { done: "сделано", changed: "изменено", skipped: "пропущено" };
const AT_WORDS = { morning: "утром", noon: "днём", evening: "вечером", night: "на ночь" };

// The classic widgets the app lets a screen embed: what → (state, ctx) → Node.
const embeds = new Map();
export function registerEmbeds(renderers) {
  for (const [what, render] of Object.entries(renderers)) embeds.set(what, render);
}

let serial = 0;
const uid = (prefix) => `${prefix}-${++serial}`;

class InputElement extends VizElement {
  // The data is handed over by code and never changes under the element, and a
  // redraw would drop what the person has typed: no resize or source redraw.
  connectedCallback() {
    this.hoistTitle();
    this.refresh();
  }

  disconnectedCallback() { this.cleanup(); }

  isEmpty(data) { return data == null; }

  act(detail) {
    this.dispatchEvent(new CustomEvent("kit-action", { bubbles: true, detail }));
  }
}

// -- controls -------------------------------------------------------------------------
const optionsOf = (field) => (field.options || []).map((o) => (typeof o === "string" ? { id: o, name: o } : o));

function button(text, { quiet = false, primary = false, pressed = null, onclick, type = "button", label = null } = {}) {
  return h("button", {
    type, class: `kit-btn${quiet ? " is-quiet" : ""}${primary ? " is-primary" : ""}`,
    "aria-pressed": pressed == null ? null : String(pressed), "aria-label": label, onclick,
  }, text);
}

// Buttons that pick one value. A second tap on the picked one clears it when the
// field is optional. `caption` is the line under a scale that names the pick.
function picker(items, { value, clearable, onPick, group, caption }) {
  let current = value;
  const buttons = [];
  const paint = () => {
    for (const [i, b] of buttons.entries()) b.setAttribute("aria-pressed", String(items[i].id === current));
    if (caption) caption.textContent = items.find((item) => item.id === current)?.caption || "";
  };
  const wrap = h("div", { class: "kit-picker", role: "group", "aria-labelledby": group });
  for (const item of items) {
    const b = button(item.text ?? item.name, {
      label: item.label,
      pressed: item.id === current,
      onclick: () => { current = item.id === current && clearable ? null : item.id; paint(); onPick?.(current); },
    });
    buttons.push(b);
    wrap.append(b);
  }
  paint();
  return { node: wrap, get: () => current };
}

// → { node, read() → { value, error? } } or null for a field a person cannot enter.
function fieldControl(field, initial, labelId, today) {
  const name = field.name || field.key;
  const unit = field.unit ? h("span", { class: "kit-unit", text: field.unit }) : null;
  switch (field.type) {
    case "calc": return null;
    case "number": {
      const input = h("input", { class: "kit-input", type: "text", inputmode: "decimal", autocomplete: "off", "aria-labelledby": labelId });
      input.value = initial == null ? "" : String(initial).replace(".", ",");
      return {
        node: h("div", { class: "kit-with-unit" }, input, unit),
        read() {
          const text = input.value.trim().replace(/\s/g, "").replace(",", ".");
          if (!text) return { value: undefined };
          if (!/^-?\d+(\.\d+)?$/.test(text)) return { error: `${name}: нужно число` };
          const value = Number(text);
          if (field.min != null && value < field.min) return { error: `${name}: не меньше ${fmtNum(field.min)}` };
          if (field.max != null && value > field.max) return { error: `${name}: не больше ${fmtNum(field.max)}` };
          return { value };
        },
      };
    }
    case "scale": {
      const min = Number(field.min ?? 1);
      const max = Number(field.max ?? 5);
      // Past eleven steps buttons stop being a scale: type the number.
      if (max - min + 1 > 11) return fieldControl({ ...field, type: "number" }, initial, labelId, today);
      const steps = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => {
        const n = min + i;
        const caption = field.labels?.[i] || "";
        return { id: n, text: String(n), caption: caption ? `${n} — ${caption}` : "", label: caption ? `${n}, ${caption}` : String(n) };
      });
      const caption = h("span", { class: "kit-caption", "aria-live": "polite" });
      const pick = picker(steps, { value: initial == null ? null : Number(initial), clearable: !field.required, group: labelId, caption });
      return { node: h("div", { class: "kit-stack" }, pick.node, caption), read: () => ({ value: pick.get() ?? undefined }) };
    }
    case "choice":
    case "link": {
      const options = optionsOf(field);
      if (!options.length) return { node: h("p", { class: "kit-hint", text: "Вариантов пока нет" }), read: () => ({ value: undefined }) };
      if (options.length > 8) {
        const select = h("select", { class: "kit-input", "aria-labelledby": labelId }, h("option", { value: "" }, "Не выбрано"), options.map((o) => h("option", { value: o.id }, o.name)));
        select.value = options.some((o) => o.id === initial) ? initial : "";
        return { node: select, read: () => ({ value: select.value || undefined }) };
      }
      const pick = picker(options.map((o) => ({ id: o.id, text: o.name })), { value: initial, clearable: !field.required, group: labelId });
      return { node: pick.node, read: () => ({ value: pick.get() ?? undefined }) };
    }
    case "yesno": {
      const pick = picker([{ id: true, text: "Да" }, { id: false, text: "Нет" }], { value: initial == null ? null : Boolean(initial), clearable: !field.required, group: labelId });
      return { node: pick.node, read: () => ({ value: pick.get() ?? undefined }) };
    }
    case "time":
    case "date": {
      const input = h("input", { class: "kit-input", type: field.type, "aria-labelledby": labelId, max: field.type === "date" ? today : null });
      input.value = initial || "";
      return { node: input, read: () => ({ value: input.value || undefined }) };
    }
    default: {
      const input = h("input", { class: "kit-input", type: "text", maxlength: "200", autocomplete: "off", "aria-labelledby": labelId });
      input.value = initial == null ? "" : String(initial);
      return { node: input, read: () => ({ value: input.value.trim() || undefined }) };
    }
  }
}

// A set of fields with one read(): { node, read() → { values } | { error } }.
function fieldSet(fields, initial, today) {
  const parts = [];
  const nodes = fields.map((field) => {
    const labelId = uid("kit-label");
    const control = fieldControl(field, initial?.[field.key] ?? field.default ?? field.value, labelId, today);
    if (!control) return null;
    parts.push({ field, control });
    return h("div", { class: "kit-field" },
      h("span", { class: "kit-label", id: labelId, text: field.name || field.key }),
      control.node,
      field.hint ? h("span", { class: "kit-hint", text: field.hint }) : null);
  });
  return {
    node: h("div", { class: "kit-fields" }, nodes),
    read() {
      const values = {};
      for (const { field, control } of parts) {
        const out = control.read();
        if (out.error) return { error: out.error };
        if (out.value === undefined) {
          if (field.required) return { error: `${field.name || field.key}: заполните поле` };
          continue;
        }
        values[field.key] = out.value;
      }
      return { values };
    },
  };
}

const errorLine = () => h("p", { class: "kit-error", role: "alert", hidden: true });
function showError(line, message) {
  line.textContent = message || "";
  line.hidden = !message;
}

// -- c-quick ----------------------------------------------------------------------------
function quickLabel(values, units = {}) {
  return Object.entries(values || {}).map(([key, raw]) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return String(raw);
    return `${n < 0 ? "−" : "+"}${fmtValue(Math.abs(n), units[key] || "")}`;
  }).join(" · ");
}

class QuickElement extends InputElement {
  draw(d) {
    const label = this.getAttribute("label") || d.label || quickLabel(d.values, d.units);
    const summary = `${d.name ? `${d.name}: ` : ""}${label}`;
    this.replaceChildren(button(label, {
      primary: true,
      onclick: () => this.act({ do: "quick", track: d.track, values: d.values, date: d.date, summary }),
    }));
  }
}

// -- c-form -----------------------------------------------------------------------------
class FormElement extends InputElement {
  draw(d) {
    const fields = d.fields || [];
    const today = d.maxDate || d.date;
    const set = fieldSet(fields, null, today);
    const error = errorLine();
    const dateId = uid("kit-label");
    const date = h("input", { class: "kit-input", type: "date", max: today, "aria-labelledby": dateId });
    date.value = d.date || today;
    const dateField = h("div", { class: "kit-field", hidden: true }, h("span", { class: "kit-label", id: dateId, text: "Дата записи" }), date);
    const other = button("Другой день", { quiet: true, onclick: () => {
      dateField.hidden = !dateField.hidden;
      other.setAttribute("aria-expanded", String(!dateField.hidden));
    } });
    other.setAttribute("aria-expanded", "false");
    const form = h("form", { class: "kit-form", novalidate: true, "aria-label": this.nameText() || d.name || "Запись" },
      set.node,
      h("div", { class: "kit-more" }, other, dateField),
      error,
      button("Записать", { primary: true, type: "submit" }));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const out = set.read();
      if (out.error) { showError(error, out.error); return; }
      if (!Object.keys(out.values).length) { showError(error, "Заполните хотя бы одно поле"); return; }
      showError(error, "");
      this.act({ do: "form", track: d.track, values: out.values, date: date.value || d.date, summary: `${d.name || "Запись"}: записано` });
    });
    this.replaceChildren(form);
  }
}

// -- c-marks ----------------------------------------------------------------------------
class MarksElement extends InputElement {
  get emptyText() { return this._resolved?.empty || "Сегодня отмечать нечего"; }

  isEmpty(d) { return d == null || (!d.rows?.length && !d.add); }

  cleanup() { this._ask = null; }

  draw(d) {
    const rows = d.rows || [];
    const readOnly = d.canMark === false;
    const done = d.progress && d.progress.of > 0 ? h("p", { class: "kit-hint", text: `Отмечено ${d.progress.done} из ${d.progress.of}` }) : null;
    // replaceChildren turns a null into the text «null»
    this.replaceChildren(...[
      rows.length ? h("ul", { class: "kit-marks" }, rows.map((row) => this.row(d, row, readOnly))) : h("p", { class: "kit-hint", text: this.emptyText }),
      d.compact ? null : done,
      d.add && !readOnly ? this.adder(d) : null,
    ].filter(Boolean));
  }

  label(d, state) { return d.states?.find((s) => s.id === state)?.label || STATE_NAMES[state] || state; }

  row(d, row, readOnly) {
    const target = row.itemId ? { item: row.itemId } : { slot: row.slot };
    const marked = Boolean(row.markId);
    const states = d.states?.length ? d.states.map((s) => s.id) : ["done"];
    const asks = (state) => row.ask?.[state] || [];
    const inline = (d.inline ?? d.kind === "follow") && asks(states[0]).length > 0;
    const who = row.name || d.name;
    const send = (state, values) => this.act({ do: "mark", track: d.track, ...target, state, ...(values && Object.keys(values).length ? { values } : {}), date: d.date, summary: `${who}: ${this.label(d, state)}` });
    const initial = { ...row.planned, ...row.values };
    // Under a meal the row is the meal, which is named above: the head names the track.
    const head = h("div", { class: "kit-mark-head" },
      h("span", { class: "kit-mark-name", text: d.compact ? d.name : row.name }),
      !d.compact && (row.time || row.at) ? h("span", { class: "kit-mark-sub", text: row.time || AT_WORDS[row.at] || "" }) : null);
    const unmark = marked && !readOnly
      ? button("Снять отметку", { quiet: true, label: `Снять отметку: ${who}`, onclick: () => this.act({ do: "unmark", track: d.track, ...target, date: d.date, summary: `${who}: отметка снята` }) })
      : null;
    const li = h("li", { class: "kit-mark", "data-state": marked ? row.state : "none", "data-row": row.key, role: "group", "aria-label": who });
    if (readOnly) {
      li.append(head);
      if (marked) li.append(h("p", { class: "kit-hint", text: this.label(d, row.state) }));
      return li;
    }
    if (inline) {
      const state = states[0];
      const set = fieldSet(asks(state), initial, d.maxDate || d.date);
      const error = errorLine();
      const form = h("form", { class: "kit-form", novalidate: true },
        set.node, error,
        h("div", { class: "kit-buttons" },
          button(marked ? "Обновить" : "Записать", { primary: true, type: "submit", label: `${marked ? "Обновить" : "Записать"}: ${who}` }),
          unmark));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const out = set.read();
        if (out.error) { showError(error, out.error); return; }
        if (!Object.keys(out.values).length) { showError(error, "Заполните поле"); return; }
        send(state, out.values);
      });
      li.append(head, form);
      return li;
    }
    const asking = this._ask && this._ask.row === row.key ? this._ask.state : null;
    const buttons = h("div", { class: "kit-buttons" }, states.map((state) => button(
      [marked && row.state === state ? glyph("check", 16) : null, this.label(d, state)],
      {
        pressed: marked && row.state === state,
        onclick: () => {
          if (!asks(state).length) { this._ask = null; send(state); return; }
          this._ask = { row: row.key, state };
          this.draw(d);
        },
      },
    )), unmark);
    li.append(head, buttons);
    if (asking) li.append(this.asker(d, row, asking, initial, send));
    return li;
  }

  // The fields a state asks for, under the row, with a button that marks.
  asker(d, row, state, initial, send) {
    const set = fieldSet(row.ask[state], initial, d.maxDate || d.date);
    const error = errorLine();
    const form = h("form", { class: "kit-form kit-ask", novalidate: true, "aria-label": `${row.name || d.name}: ${this.label(d, state)}` },
      set.node, error,
      h("div", { class: "kit-buttons" },
        button(this.label(d, state), { primary: true, type: "submit", label: `Отметить: ${this.label(d, state)}` }),
        button("Отмена", { quiet: true, onclick: () => { this._ask = null; this.draw(d); } })));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const out = set.read();
      if (out.error) { showError(error, out.error); return; }
      this._ask = null;
      send(state, out.values);
    });
    return form;
  }

  adder(d) {
    if (!this._adding) {
      return h("div", { class: "kit-add" }, button("Добавить", { quiet: true, label: `Добавить в «${d.name || "список"}»`, onclick: () => { this._adding = true; this.draw(d); this.querySelector(".kit-add input")?.focus(); } }));
    }
    const input = h("input", { class: "kit-input", type: "text", maxlength: "60", autocomplete: "off", "aria-label": "Название нового пункта", placeholder: "Название" });
    const error = errorLine();
    const form = h("form", { class: "kit-form kit-add", novalidate: true }, input, error,
      h("div", { class: "kit-buttons" },
        button("Добавить", { primary: true, type: "submit" }),
        button("Отмена", { quiet: true, onclick: () => { this._adding = false; this.draw(d); } })));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) { showError(error, "Напишите название"); return; }
      this._adding = false;
      this.act({ do: "addItem", track: d.track, name, every: d.addEvery, summary: `${d.name || "Список"}: добавлено «${name}»` });
    });
    return form;
  }
}

// -- c-add ------------------------------------------------------------------------------
class AddElement extends InputElement {
  draw(d) {
    if (!this._adding) {
      this.replaceChildren(h("div", { class: "kit-add" }, button("Добавить", {
        quiet: true, label: `Добавить в «${d.name}»`,
        onclick: () => { this._adding = true; this.draw(d); this.querySelector(".kit-add input")?.focus(); },
      })));
      return;
    }
    const input = h("input", { class: "kit-input", type: "text", maxlength: "60", autocomplete: "off", "aria-label": "Название", placeholder: "Название" });
    const set = fieldSet(d.fields || [], null, d.date);
    const error = errorLine();
    const form = h("form", { class: "kit-form kit-add", novalidate: true, "aria-label": `Добавить в «${d.name}»` }, input, set.node, error,
      h("div", { class: "kit-buttons" },
        button("Добавить", { primary: true, type: "submit" }),
        button("Отмена", { quiet: true, onclick: () => { this._adding = false; this.draw(d); } })));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) { showError(error, "Напишите название"); return; }
      const out = set.read();
      if (out.error) { showError(error, out.error); return; }
      this._adding = false;
      this.act({ do: "addItem", track: d.track, name, plan: out.values, summary: `${d.name}: добавлено «${name}»` });
    });
    this.replaceChildren(form);
  }
}

// -- c-streak ---------------------------------------------------------------------------
// No zero and no red: a slip lowers one number while the best and the last 30
// days stay, and a streak that has not started yet says when it will.
class StreakElement extends InputElement {
  isEmpty(d) { return d == null || (!d.current && !d.best && !d.last30?.of); }

  get emptyText() { return "Серия начнётся с первой отметки"; }

  draw(d) {
    const weeks = d.unit === "нед.";
    const unit = (n) => (weeks ? plural(n, "неделя", "недели", "недель") : plural(n, "день", "дня", "дней"));
    const days = (n) => `${fmtNum(n, 0)} ${unit(n)}`;
    const last = d.last30 || { ok: 0, of: 0 };
    const cell = (value, caption, extra = "") => h("div", { class: `kit-streak-cell${extra}` },
      h("span", { class: "kit-streak-value", text: value }),
      h("span", { class: "kit-streak-caption", text: caption }));
    const summary = `${d.current > 0 ? `Серия ${days(d.current)}` : "Новая серия впереди"}, лучшая ${days(d.best || 0)}, за 30 дней ${last.ok} из ${last.of}`;
    this.replaceChildren(h("div", { class: "kit-streak", role: "group", "aria-label": summary },
      d.current > 0 ? cell(fmtNum(d.current, 0), `${unit(d.current)} подряд`, " is-main") : cell("—", "новая серия впереди", " is-main"),
      cell(fmtNum(d.best || 0, 0), "лучшая серия"),
      cell(`${last.ok} из ${last.of}`, weeks ? "недель в серии" : "дней за месяц")));
  }
}

// -- c-embed ----------------------------------------------------------------------------
class EmbedElement extends InputElement {
  draw(d) {
    const render = embeds.get(d.what);
    if (!render) throw new Error(`нет встроенного блока «${d.what}»`);
    this.replaceChildren(h("div", { class: "kit-embed" }, render(d.state, d.ctx)));
  }
}

export const INPUT_ELEMENTS = {
  "c-quick": QuickElement,
  "c-form": FormElement,
  "c-marks": MarksElement,
  "c-add": AddElement,
  "c-streak": StreakElement,
  "c-embed": EmbedElement,
};

export function defineInputs() {
  injectStyles();
  for (const [tag, constructor] of Object.entries(INPUT_ELEMENTS)) if (!customElements.get(tag)) customElements.define(tag, constructor);
}

if (typeof customElements !== "undefined") defineInputs();
