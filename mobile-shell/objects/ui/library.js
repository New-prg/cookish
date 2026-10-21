// The library of types and sets, the new type form, the ＋ menu and search.
import { objectsOfType } from "../core/values.js";
import { act, freeKey, go, hrefFor, iconOf, local, nameOf, newObjectProps, rerender, store, typeOf } from "./runtime.js";
import { fill, empty, field, h, icon, openSheet, pageHeader, toast } from "./dom.js";
import { FORMAT_NAMES, pickRelation } from "./editors.js";
import { defaultView } from "./setview.js";
import { builderSheet } from "./builder.js";

const isLibraryType = (t) => !t.hidden && !["set", "dashboard"].includes(t.layout);
const libraryTypes = (state) => Object.values(state.types).filter(isLibraryType)
  .sort((a, b) => Number(Boolean(b.system)) - Number(Boolean(a.system)) || a.name.localeCompare(b.name, "ru"));

export function libraryScreen() {
  const state = store.state();
  const sets = objectsOfType(state, "set").slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b), "ru"));
  return [
    h("header", { class: "page-head" }, h("h1", { class: "page-title", text: "Библиотека" })),
    h("section", { class: "block" },
      h("h2", { class: "section-title", text: "Типы" }),
      h("div", { class: "card list" }, libraryTypes(state).map((t) => h("a", { class: "row", href: `#/type/${encodeURIComponent(t.key)}` },
        h("span", { class: "row-icon", text: t.icon || "▫" }),
        h("span", { class: "row-main" }, h("span", { class: "row-title", text: t.plural || t.name }), h("span", { class: "row-sub", text: t.system ? (t.fact ? "записи" : "встроенный") : t.fact ? "ваш тип, записи" : "ваш тип" })),
        h("span", { class: "row-count", text: String(objectsOfType(state, t.key).length) }),
      ))),
      h("a", { class: "btn btn-quiet btn-block", href: "#/new-type" }, "+ Новый тип"),
    ),
    h("section", { class: "block" },
      h("h2", { class: "section-title", text: "Наборы" }),
      sets.length
        ? h("div", { class: "card list" }, sets.map((s) => h("a", { class: "row", href: hrefFor(s) },
          h("span", { class: "row-icon", text: state.types[s.props?.query?.source?.type]?.icon || "🗂" }),
          h("span", { class: "row-main" }, h("span", { class: "row-title", text: nameOf(s) }), h("span", { class: "row-sub", text: setSourceLabel(state, s) })),
        )))
        : empty("Наборов пока нет. Откройте тип, настройте фильтры и сохраните как набор."),
    ),
  ];
}

function setSourceLabel(state, set) {
  const source = set.props?.query?.source || {};
  if (source.type) return state.types[source.type]?.plural || source.type;
  if (source.builtin === "plan") return source.args?.area === "sport" ? "План тренировок" : "Рацион";
  return "Выбранные объекты";
}

// The new type form keeps its draft in screen state so a sheet opened on top
// of it does not lose what was typed.
export function newTypeScreen() {
  const state = store.state();
  const draft = local("new-type", () => ({ name: "", icon: "", fact: true, relations: ["at"], pending: [] }));
  const relDef = (key) => draft.pending.find((d) => d.key === key) || state.relations[key];
  const name = h("input", { class: "input", type: "text", maxlength: "60", value: draft.name, placeholder: "Например, Вода", oninput: (e) => { draft.name = e.target.value; } });
  const emoji = h("input", { class: "input input-emoji", type: "text", maxlength: "8", value: draft.icon, placeholder: "💧", "aria-label": "Иконка", oninput: (e) => { draft.icon = e.target.value; } });
  const save = () => {
    const title = draft.name.trim();
    if (!title) { toast("Назовите тип", { error: true }); name.focus(); return; }
    const used = new Set(draft.relations);
    const key = freeKey(new Set(Object.keys(state.types)), "t", title);
    const ops = [
      ...draft.pending.filter((d) => used.has(d.key)).map((relation) => ({ op: "defineRelation", relation })),
      { op: "defineType", type: { key, name: title, plural: title, icon: draft.icon.trim() || "▫", fact: draft.fact, layout: draft.fact ? "entry" : "basic", relations: draft.relations } },
    ];
    const result = act(ops, { summary: `Тип «${title}»` });
    if (!result.ok) return;
    Object.assign(draft, { name: "", icon: "", fact: true, relations: ["at"], pending: [] });
    location.replace(`#/type/${encodeURIComponent(key)}`);
  };
  return [
    pageHeader({ title: "Новый тип", back: true }),
    h("div", { class: "form card" },
      h("div", { class: "row-fields" }, field("Иконка", emoji), field("Название", name)),
      h("button", { class: "toggle-row", role: "switch", "aria-checked": String(draft.fact), onclick: () => { draft.fact = !draft.fact; rerender(); } },
        h("span", { class: "row-main" }, h("span", { class: "row-title", text: "Это записи о том, что я сделал" }), h("span", { class: "row-sub", text: "Выпил воду, прошёл шаги, принял таблетку. Записи пишете только вы." })),
        h("span", { class: `switch${draft.fact ? " is-on" : ""}` }, h("span", { class: "switch-knob" })),
      ),
    ),
    h("section", { class: "block" },
      h("h2", { class: "section-title", text: "Связи" }),
      h("div", { class: "card list" },
        draft.relations.length ? draft.relations.map((k) => {
          const rel = relDef(k);
          return h("div", { class: "row" },
            h("span", { class: "row-main" }, h("span", { class: "row-title", text: rel.name }), h("span", { class: "row-sub", text: `${FORMAT_NAMES[rel.format] || rel.format}${rel.unit ? `, ${rel.unit}` : ""}${draft.pending.includes(rel) ? " · новая" : ""}` })),
            h("button", { class: "icon-btn", "aria-label": `Убрать «${rel.name}»`, onclick: () => { draft.relations = draft.relations.filter((x) => x !== k); rerender(); } }, icon("close", 20)),
          );
        }) : empty("Связей нет: у объектов будет только название"),
        h("button", { class: "btn btn-quiet btn-block", onclick: () => pickRelation({
          exclude: draft.relations,
          onPick: (key, def) => { if (def) draft.pending.push(def); draft.relations = [...draft.relations, key]; rerender(); },
        }) }, "+ Связь"),
      ),
    ),
    h("button", { class: "btn btn-primary btn-block", onclick: save }, "Создать тип"),
  ];
}

// The ＋ menu.
export const CREATE_ACTIONS = [
  { id: "object", title: "Объект", sub: "Продукт, запрос, запись трекера", run: (close) => { close(); pickTypeSheet(); } },
  { id: "type", title: "Новый тип", sub: "Свой вид объектов со своими связями", run: (close) => { close(); go("#/new-type"); } },
  { id: "set", title: "Новый набор", sub: "Объекты типа с фильтром и видом", run: (close) => { close(); newSetSheet(); } },
  { id: "builder", title: "Собрать с ИИ", sub: "Опишите словами, что отслеживать", run: (close) => { close(); builderSheet(); } },
];

export function createSheet() {
  openSheet("Создать", (close) => h("div", { class: "pick-list" }, CREATE_ACTIONS.map((a) => h("button", {
    class: "row row-btn", disabled: !a.run, "data-create": a.id, onclick: () => a.run?.(close),
  }, h("span", { class: "row-main" }, h("span", { class: "row-title", text: a.title }), h("span", { class: "row-sub", text: a.sub }))))));
}

function pickTypeSheet() {
  openSheet("Объект какого типа", (close) => {
    const state = store.state();
    return h("div", { class: "pick-list" }, libraryTypes(state).filter((t) => !t.singleton).map((t) => h("button", { class: "row row-btn", onclick: () => {
      close();
      const result = act({ op: "create", type: t.key, name: t.fact ? t.name : "", props: newObjectProps(state, t.key) }, { summary: `Новый объект «${t.name}»` });
      if (result.ok) go(hrefFor(store.state().objects[result.ids[0]]));
    } }, h("span", { class: "row-icon", text: t.icon || "▫" }), h("span", { class: "row-title", text: t.name }))));
  });
}

function newSetSheet() {
  openSheet("Новый набор", (close) => {
    const state = store.state();
    const types = libraryTypes(state);
    const name = h("input", { class: "input", type: "text", maxlength: "200", placeholder: "Например, Вода за неделю" });
    const source = h("select", { class: "input" }, types.map((t) => h("option", { value: t.key }, `${t.icon || ""} ${t.plural || t.name}`)));
    return h("div", { class: "form" }, field("Название", name), field("Из объектов типа", source), h("button", { class: "btn btn-primary", onclick: () => {
      const type = state.types[source.value];
      const title = name.value.trim() || type.plural || type.name;
      const result = act({ op: "create", type: "set", name: title, props: { query: { source: { type: type.key } }, view: defaultView(state, type.key) } }, { summary: `Набор «${title}»` });
      if (result.ok) { close(); go(`#/set/${encodeURIComponent(result.ids[0])}`); }
    } }, "Создать"));
  });
}

export function searchScreen() {
  const view = local("search", () => ({ q: "" }));
  const input = h("input", { class: "input input-search", type: "search", placeholder: "Название объекта", "aria-label": "Поиск", value: view.q });
  const results = h("div", { class: "card list" });
  const refresh = () => {
    const state = store.state();
    const q = view.q.trim().toLocaleLowerCase("ru-RU");
    if (!q) { fill(results, empty("Ищет по названию среди всех объектов")); return; }
    const found = Object.values(state.objects)
      .filter((o) => !o.archivedAt && nameOf(o).toLocaleLowerCase("ru-RU").includes(q))
      .sort((a, b) => Number(Boolean(state.types[a.type]?.hidden)) - Number(Boolean(state.types[b.type]?.hidden)) || nameOf(a).localeCompare(nameOf(b), "ru"))
      .slice(0, 60);
    fill(results, ...(found.length ? found.map((o) => h("a", { class: "row", href: hrefFor(o) },
      h("span", { class: "row-icon", text: iconOf(state, o) }),
      h("span", { class: "row-main" }, h("span", { class: "row-title", text: nameOf(o) }), h("span", { class: "row-sub", text: typeOf(state, o).name })),
    )) : [empty("Ничего не нашлось")]));
  };
  input.addEventListener("input", () => { view.q = input.value; refresh(); });
  refresh();
  queueMicrotask(() => { if (!view.q) input.focus({ preventScroll: true }); });
  return [h("header", { class: "page-head" }, h("h1", { class: "page-title", text: "Поиск" })), input, results];
}
