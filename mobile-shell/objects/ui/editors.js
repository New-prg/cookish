// Editing a relation value by its format, picking objects, and defining new
// relations. One table of editors serves every type, built-in or person-made.
import { displayValue, formulaError, objectsOfType, valueOf } from "../core/values.js";
import { act, ctx, freeKey, hrefFor, iconOf, isVisibleRelation, nameOf, store } from "./runtime.js";
import { fill, dayShort, field, h, icon, openSheet, segmented, toast } from "./dom.js";

export const FORMAT_NAMES = {
  text: "Текст", number: "Число", date: "Дата", time: "Время", datetime: "Дата и время",
  select: "Один вариант", multiselect: "Несколько вариантов", checkbox: "Да или нет",
  object: "Ссылка на объект", objects: "Ссылки на объекты", url: "Ссылка на сайт", formula: "Формула",
};

const setProp = (obj, rel, value) => act({ op: "update", id: obj.id, props: { [rel.key]: value } }, { summary: `${nameOf(obj)}: ${rel.name.toLowerCase()}` });

function commitInput(input, obj, rel, parse) {
  input.addEventListener("change", () => {
    const parsed = parse(input.value.trim());
    if (parsed === undefined) { toast(`«${rel.name}»: не похоже на ${FORMAT_NAMES[rel.format].toLowerCase()}`, { error: true }); return; }
    if (parsed === (obj.props?.[rel.key] ?? null)) return;
    setProp(obj, rel, parsed);
  });
  input.addEventListener("keydown", (event) => { if (event.key === "Enter" && input.tagName === "INPUT") input.blur(); });
  return input;
}

export const parseNumber = (text) => {
  if (text === "") return null;
  const value = Number(text.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
};

// Stored datetimes are local "ГГГГ-ММ-ДДTЧЧ:ММ"; imported ones may carry a
// zone, so show them in local time.
function localDatetime(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const label = (rel) => rel.name;

const MOMENT = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// A value as a short line for lists, cards and table cells.
export function shownValue(state, obj, key, c) {
  if (key === "name") return nameOf(obj);
  const rel = state.relations[key];
  const value = valueOf(state, obj, key, c);
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return "";
  if (rel?.format === "date") return dayShort(value);
  if (rel?.format === "datetime") { const d = new Date(value); return Number.isFinite(d.getTime()) ? MOMENT.format(d) : String(value); }
  if (typeof value === "boolean") return value ? `✓ ${rel?.name || key}` : "";
  return displayValue(state, obj, key, c);
}

const EDITORS = {
  text: (state, obj, rel) => {
    const long = ["note", "description", "preferences"].includes(rel.key);
    const input = long
      ? h("textarea", { class: "input", rows: "3", "aria-label": label(rel), value: obj.props?.[rel.key] ?? "" })
      : h("input", { class: "input", type: "text", "aria-label": label(rel), value: obj.props?.[rel.key] ?? "" });
    return commitInput(input, obj, rel, (v) => v || null);
  },
  url: (state, obj, rel) => commitInput(h("input", { class: "input", type: "url", inputmode: "url", "aria-label": label(rel), placeholder: "https://", value: obj.props?.[rel.key] ?? "" }), obj, rel, (v) => v || null),
  number: (state, obj, rel) => h("div", { class: "with-unit" },
    commitInput(h("input", { class: "input", type: "text", inputmode: "decimal", "aria-label": label(rel), value: obj.props?.[rel.key] ?? "" }), obj, rel, parseNumber),
    rel.unit ? h("span", { class: "unit", text: rel.unit }) : null,
  ),
  date: (state, obj, rel) => commitInput(h("input", { class: "input", type: "date", "aria-label": label(rel), value: obj.props?.[rel.key] ?? "" }), obj, rel, (v) => v || null),
  time: (state, obj, rel) => commitInput(h("input", { class: "input", type: "time", "aria-label": label(rel), value: obj.props?.[rel.key] ?? "" }), obj, rel, (v) => v || null),
  datetime: (state, obj, rel) => commitInput(h("input", { class: "input", type: "datetime-local", "aria-label": label(rel), value: localDatetime(obj.props?.[rel.key]) }), obj, rel, (v) => v || null),
  select: (state, obj, rel) => segmented(rel.options || [], obj.props?.[rel.key] ?? null, (id) => setProp(obj, rel, id), { label: label(rel), allowClear: true }),
  multiselect: (state, obj, rel) => {
    const current = obj.props?.[rel.key] || [];
    return h("div", { class: "chips", role: "group", "aria-label": label(rel) },
      (rel.options || []).map((o) => h("button", {
        class: `chip${current.includes(o.id) ? " is-on" : ""}`, "aria-pressed": String(current.includes(o.id)),
        onclick: () => setProp(obj, rel, current.includes(o.id) ? current.filter((v) => v !== o.id) : [...current, o.id]),
      }, o.name)),
      rel.options?.length ? null : h("span", { class: "muted", text: "Вариантов пока нет" }),
    );
  },
  checkbox: (state, obj, rel) => {
    const on = Boolean(obj.props?.[rel.key]);
    return h("button", { class: `switch${on ? " is-on" : ""}`, role: "switch", "aria-checked": String(on), "aria-label": label(rel), onclick: () => setProp(obj, rel, !on) }, h("span", { class: "switch-knob" }));
  },
  object: (state, obj, rel) => {
    const target = state.objects[obj.props?.[rel.key]];
    const pick = () => pickObject({ title: rel.name, types: rel.types, onPick: (id) => setProp(obj, rel, id) });
    return h("div", { class: "chips" },
      target ? linkChip(state, target, () => setProp(obj, rel, null)) : null,
      h("button", { class: "chip chip-add", onclick: pick }, target ? "Заменить" : "Выбрать"),
    );
  },
  objects: (state, obj, rel) => {
    const ids = obj.props?.[rel.key] || [];
    return h("div", { class: "chips" },
      ids.map((id) => state.objects[id]).filter(Boolean).map((target) => linkChip(state, target, () => setProp(obj, rel, ids.filter((x) => x !== target.id)))),
      h("button", { class: "chip chip-add", onclick: () => pickObject({ title: rel.name, types: rel.types, exclude: ids, onPick: (id) => setProp(obj, rel, [...ids, id]) }) }, "+ Добавить"),
    );
  },
  formula: (state, obj, rel) => {
    const shown = displayValue(state, obj, rel.key, ctx());
    const error = formulaError(state, obj.id, rel.key, ctx());
    return h("div", { class: "formula" },
      h("span", { class: shown ? "formula-value" : "muted", text: shown || "—" }),
      error ? h("span", { class: "formula-error", text: `Формула не считается: ${error}` }) : null,
    );
  },
};

export function relationEditor(state, obj, rel) {
  return (EDITORS[rel.format] || EDITORS.formula)(state, obj, rel);
}

function linkChip(state, target, onRemove) {
  return h("span", { class: "link-chip" },
    h("a", { class: "link-chip-main", href: hrefFor(target) }, h("span", { class: "link-chip-icon", text: iconOf(state, target) }), h("span", { class: "link-chip-name", text: nameOf(target) })),
    onRemove ? h("button", { class: "link-chip-x", "aria-label": `Убрать «${nameOf(target)}»`, onclick: onRemove }, icon("close", 18)) : null,
  );
}

// Choosing an object of the given types, with search and, for a single
// plain type, creating one from the search text.
export function pickObject({ title = "Выбрать", types = [], exclude = [], onPick }) {
  openSheet(title, (close) => {
    const state = store.state();
    const pool = (types?.length ? types.flatMap((t) => objectsOfType(state, t)) : Object.values(state.objects).filter((o) => !o.archivedAt && !state.types[o.type]?.hidden))
      .filter((o) => !exclude.includes(o.id))
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b), "ru"));
    const creatable = types?.length === 1 && !state.types[types[0]]?.fact && state.types[types[0]]?.layout !== "dashboard";
    const input = h("input", { class: "input", type: "search", placeholder: "Найти", "aria-label": "Найти" });
    const list = h("div", { class: "pick-list" });
    const choose = (id) => { close(); onPick(id); };
    const refresh = () => {
      const q = input.value.trim().toLocaleLowerCase("ru-RU");
      const found = pool.filter((o) => !q || nameOf(o).toLocaleLowerCase("ru-RU").includes(q)).slice(0, 60);
      fill(list,
        ...found.map((o) => h("button", { class: "row row-btn", onclick: () => choose(o.id) },
          h("span", { class: "row-icon", text: iconOf(state, o) }),
          h("span", { class: "row-main" }, h("span", { class: "row-title", text: nameOf(o) }), h("span", { class: "row-sub", text: state.types[o.type]?.name || "" })),
        )),
        creatable && q && !found.some((o) => nameOf(o).toLocaleLowerCase("ru-RU") === q)
          ? h("button", { class: "row row-btn row-create", onclick: () => {
            const result = act({ op: "create", type: types[0], name: input.value.trim() }, { summary: `${state.types[types[0]].name} «${input.value.trim()}»` });
            if (result.ok) choose(result.ids[0]);
          } }, `+ Создать «${input.value.trim()}»`)
          : null,
        !found.length && !(creatable && q) ? h("p", { class: "empty", text: "Ничего не нашлось" }) : null,
      );
    };
    input.addEventListener("input", refresh);
    refresh();
    return [input, list];
  });
}

// A form for a new relation. Calls back with a relation definition that
// carries its key, so the caller can define it in the same batch as a type.
function relationForm({ onDone, submitLabel = "Добавить связь" }) {
  const state = store.state();
  const name = h("input", { class: "input", type: "text", maxlength: "60", placeholder: "Например, Выпито" });
  const format = h("select", { class: "input" }, Object.entries(FORMAT_NAMES).map(([id, title]) => h("option", { value: id }, title)));
  const unit = h("input", { class: "input", type: "text", maxlength: "12", placeholder: "мл, шаги, ₽" });
  const options = h("input", { class: "input", type: "text", placeholder: "через запятую: утро, день, вечер" });
  const linkType = h("select", { class: "input" }, Object.values(state.types).filter((t) => !t.hidden && t.layout !== "dashboard").map((t) => h("option", { value: t.key }, `${t.icon || ""} ${t.name}`)));
  const formula = h("input", { class: "input", type: "text", placeholder: "Например, amount * 2" });
  const unitField = field("Единица", unit);
  const optionsField = field("Варианты", options);
  const linkField = field("На объекты типа", linkType);
  const formulaField = field("Формула", formula);
  const sync = () => {
    unitField.hidden = !["number", "formula"].includes(format.value);
    optionsField.hidden = !["select", "multiselect"].includes(format.value);
    linkField.hidden = !["object", "objects"].includes(format.value);
    formulaField.hidden = format.value !== "formula";
  };
  format.addEventListener("change", sync);
  sync();
  const submit = () => {
    const title = name.value.trim();
    if (!title) { toast("Назовите связь", { error: true }); name.focus(); return; }
    const taken = new Set(Object.keys(store.state().relations));
    const def = { key: freeKey(taken, "r", title), name: title, format: format.value };
    if (unit.value.trim() && !unitField.hidden) def.unit = unit.value.trim();
    if (!optionsField.hidden) {
      const names = [...new Set(options.value.split(",").map((s) => s.trim()).filter(Boolean))];
      def.options = names.map((n) => ({ id: n.slice(0, 60), name: n }));
    }
    if (!linkField.hidden) def.types = [linkType.value];
    if (!formulaField.hidden) def.formula = formula.value.trim();
    onDone(def);
  };
  return h("div", { class: "form" },
    field("Название", name), field("Формат", format), unitField, optionsField, linkField, formulaField,
    h("button", { class: "btn btn-primary", onclick: submit }, submitLabel),
  );
}

// Picking relations for a type or an object: existing ones by search, or a
// new one made inline.
export function pickRelation({ exclude = [], onPick }) {
  openSheet("Добавить связь", (close) => {
    const state = store.state();
    const pool = Object.values(state.relations).filter((r) => isVisibleRelation(r) && r.key !== "name" && !exclude.includes(r.key)).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    const input = h("input", { class: "input", type: "search", placeholder: "Найти связь", "aria-label": "Найти связь" });
    const list = h("div", { class: "pick-list" });
    const refresh = () => {
      const q = input.value.trim().toLocaleLowerCase("ru-RU");
      fill(list, ...pool.filter((r) => !q || r.name.toLocaleLowerCase("ru-RU").includes(q)).slice(0, 40).map((r) => h("button", { class: "row row-btn", onclick: () => { close(); onPick(r.key, null); } },
        h("span", { class: "row-main" }, h("span", { class: "row-title", text: r.name }), h("span", { class: "row-sub", text: `${FORMAT_NAMES[r.format] || r.format}${r.unit ? `, ${r.unit}` : ""}` })),
      )));
    };
    input.addEventListener("input", refresh);
    refresh();
    return [
      h("details", { class: "new-rel" }, h("summary", { class: "btn btn-quiet" }, "+ Новая связь"), relationForm({ onDone: (def) => { close(); onPick(def.key, def); } })),
      input, list,
    ];
  });
}
