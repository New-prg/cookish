// The home: the dashboard object and its widgets, with an edit mode to add,
// remove and reorder them.
import { act, ctx, dateRelationOf, isNumeric, local, nameOf, rerender, store } from "./runtime.js";
import { fill, dayLong, empty, field, h, icon, openSheet, segmented, toast } from "./dom.js";
import { AGG_NAMES, DISPLAY_NAMES, WIDGET_KINDS } from "./widgets.js";
import { defaultView, PERIODS } from "./setview.js";
import { homeOf, objectsOfType } from "../core/values.js";

export function homeScreen() {
  const state = store.state();
  const c = ctx();
  const dash = homeOf(state);
  const mode = local("home", () => ({ editing: false }));
  const widgets = dash?.props?.widgets || [];
  const save = (next, summary) => act({ op: "update", id: dash.id, props: { widgets: next } }, { summary });
  const move = (i, step) => {
    const next = widgets.slice();
    [next[i], next[i + step]] = [next[i + step], next[i]];
    save(next, "Порядок виджетов");
  };
  const date = dayLong(c.today);
  return [
    h("header", { class: "page-head" },
      h("div", {}, h("h1", { class: "page-title", text: "Сегодня" }), h("p", { class: "page-sub", text: date })),
      dash ? h("button", { class: `btn btn-quiet btn-small${mode.editing ? " is-on" : ""}`, onclick: () => { mode.editing = !mode.editing; rerender(); } }, mode.editing ? "Готово" : "Изменить") : null,
    ),
    widgets.length ? null : empty("На главной пока нет виджетов"),
    widgets.map((w, i) => {
      const kind = WIDGET_KINDS[w.kind];
      const title = w.title || kind?.name || "Виджет";
      return h("section", { class: `widget card${mode.editing ? " is-editing" : ""}`, "data-widget": w.kind },
        h("header", { class: "widget-head" },
          kind && !mode.editing ? h("a", { class: "widget-title", href: kind.href(w, c) }, h("span", { text: title }), icon("next", 18)) : h("h2", { class: "widget-title", text: title }),
          mode.editing ? h("div", { class: "widget-tools" },
            h("button", { class: "icon-btn", "aria-label": `Выше: ${title}`, disabled: i === 0, onclick: () => move(i, -1) }, icon("up", 20)),
            h("button", { class: "icon-btn", "aria-label": `Ниже: ${title}`, disabled: i === widgets.length - 1, onclick: () => move(i, 1) }, icon("down", 20)),
            h("button", { class: "icon-btn", "aria-label": `Убрать: ${title}`, onclick: () => save(widgets.filter((x) => x.id !== w.id), `Убран виджет «${title}»`) }, icon("close", 20)),
          ) : null,
        ),
        mode.editing ? null : h("div", { class: "widget-body" }, kind ? kind.render(state, w, c) : empty("Неизвестный виджет")),
      );
    }),
    mode.editing && dash ? h("button", { class: "btn btn-primary btn-block", onclick: () => widgetSheet(dash) }, "+ Виджет") : null,
  ];
}

// Adding a widget. A set widget may start from a type: the sheet then saves a
// set of that type, with a period filter, in the same batch as the widget.
function widgetSheet(dash) {
  openSheet("Новый виджет", (close) => {
    const state = store.state();
    const sets = objectsOfType(state, "set");
    const types = Object.values(state.types).filter((t) => !t.hidden && !["set", "dashboard"].includes(t.layout));
    const sources = [
      ...sets.map((s) => ({ id: `set:${s.id}`, name: `🗂 ${nameOf(s)}` })),
      ...types.map((t) => ({ id: `type:${t.key}`, name: `${t.icon || ""} ${t.plural || t.name}` })),
    ];
    const d = { kind: "set", source: sources.find((s) => s.id.startsWith("type:") && !state.types[s.id.slice(5)]?.system)?.id || sources[0]?.id, display: "number", fn: "sum", rel: null, period: "@today", goal: "", title: "" };
    const body = h("div", { class: "form" });
    const sourceType = () => (d.source?.startsWith("type:") ? d.source.slice(5) : state.objects[d.source?.slice(4)]?.props?.query?.source?.type || null);
    const build = () => {
      const typeKey = sourceType();
      const numeric = (state.types[typeKey]?.relations || []).filter((k) => isNumeric(state, k));
      if (!numeric.includes(d.rel)) d.rel = numeric[0] || null;
      if (!d.rel && d.fn !== "count") d.fn = "count";
      const dateRel = dateRelationOf(state, typeKey);
      const kindPick = segmented(Object.entries(WIDGET_KINDS).map(([id, k]) => ({ id, name: k.name })), d.kind, (id) => { d.kind = id; build(); }, { label: "Что показать" });
      const sourceSelect = h("select", { class: "input", "aria-label": "Источник" }, sources.map((s) => h("option", { value: s.id, selected: s.id === d.source }, s.name)));
      sourceSelect.addEventListener("change", () => { d.source = sourceSelect.value; build(); });
      const relSelect = h("select", { class: "input", "aria-label": "Связь" }, numeric.map((k) => h("option", { value: k, selected: k === d.rel }, state.relations[k].name)));
      relSelect.addEventListener("change", () => { d.rel = relSelect.value; });
      const goal = h("input", { class: "input", type: "text", inputmode: "decimal", value: d.goal, placeholder: "Например, 2000", oninput: (e) => { d.goal = e.target.value; } });
      const title = h("input", { class: "input", type: "text", maxlength: "60", value: d.title, placeholder: "Как назвать виджет", oninput: (e) => { d.title = e.target.value; } });
      fill(body,
        h("div", { class: "field" }, h("span", { class: "field-label", text: "Что показать" }), kindPick),
        d.kind !== "set" ? null : [
          field("Источник", sourceSelect),
          h("div", { class: "field" }, h("span", { class: "field-label", text: "Как показать" }), segmented(Object.entries(DISPLAY_NAMES).map(([id, name]) => ({ id, name })), d.display, (id) => { d.display = id; build(); }, { label: "Как показать" })),
          d.display === "list" ? null : h("div", { class: "field" }, h("span", { class: "field-label", text: "Считать" }), segmented(Object.entries(AGG_NAMES).filter(([id]) => id === "count" || numeric.length).map(([id, name]) => ({ id, name })), d.fn, (id) => { d.fn = id; build(); }, { label: "Считать" })),
          d.display !== "list" && d.fn !== "count" ? field("По связи", relSelect) : null,
          d.source?.startsWith("type:") && dateRel && d.display !== "bars" ? h("div", { class: "field" }, h("span", { class: "field-label", text: "За период" }), segmented([{ id: "@today", name: "сегодня" }, { id: "@last7d", name: "7 дней" }, { id: "all", name: "всё время" }], d.period, (id) => { d.period = id; build(); }, { label: "За период" })) : null,
          d.display === "bars" && !dateRel ? h("p", { class: "field-hint", text: "У этого типа нет даты, столбцам не по чему строиться" }) : null,
          d.display === "list" ? null : field("Цель", goal, "Необязательно: покажет «X из цели»"),
          field("Название", title),
        ],
        h("button", { class: "btn btn-primary", onclick: () => { if (addWidget(dash, d, sourceType(), dateRel)) close(); } }, "Добавить"),
      );
    };
    build();
    return body;
  });
}

function addWidget(dash, d, typeKey, dateRel) {
  const state = store.state();
  const widgets = dash.props?.widgets || [];
  const id = store.newId("widget");
  if (d.kind !== "set") {
    return act({ op: "update", id: dash.id, props: { widgets: [...widgets, { id, kind: d.kind, title: d.title.trim() || WIDGET_KINDS[d.kind].name }] } }, { summary: `Виджет «${WIDGET_KINDS[d.kind].name}»` }).ok;
  }
  if (!d.source) { toast("Выберите источник", { error: true }); return false; }
  if (d.display === "bars" && !dateRel) { toast("Для столбцов нужна дата у объектов", { error: true }); return false; }
  const ops = [];
  let setId = d.source.slice(4);
  let setName = nameOf(state.objects[setId]);
  if (d.source.startsWith("type:")) {
    const type = state.types[typeKey];
    const period = d.display !== "bars" && dateRel && d.period !== "all" ? d.period : null;
    setId = store.newId("set");
    setName = `${type.plural || type.name}${period ? `, ${PERIODS.find((p) => p.value === period)?.name}` : ""}`;
    ops.push({ op: "create", type: "set", id: setId, name: setName, props: {
      query: { source: { type: typeKey }, ...(period ? { filters: [{ rel: dateRel, op: "within", value: period }] } : {}) },
      view: defaultView(state, typeKey),
    } });
  }
  const goal = Number(String(d.goal).replace(",", "."));
  const aggregate = d.fn === "count" ? { fn: "count" } : { rel: d.rel, fn: d.fn };
  const widget = {
    id, kind: "set", title: d.title.trim() || setName, setId, display: d.display,
    ...(d.display === "number" ? { aggregate } : {}),
    ...(d.display === "bars" ? { series: { dateRel, ...(d.fn === "count" ? {} : { valueRel: d.rel }), fn: d.fn, range: "@last7d" } } : {}),
    ...(d.display !== "list" && goal > 0 ? { goal } : {}),
  };
  ops.push({ op: "update", id: dash.id, props: { widgets: [...widgets, widget] } });
  return act(ops, { summary: `Виджет «${widget.title}»` }).ok;
}
