// A set: a query over objects shown in one of several layouts. Opening a type
// shows a draft set of its objects; «Сохранить как набор» keeps it.
import { aggregate, runQuery } from "../core/query.js";
import { act, ctx, go, hrefFor, iconOf, isNumeric, isVisibleRelation, local, nameOf, newObjectProps, rerender, store, typeOf } from "./runtime.js";
import { fill, dayShort, empty, field, h, icon, monthLabel, num, openSheet, pageHeader, segmented, shiftDate, toast } from "./dom.js";
import { parseNumber, pickObject, shownValue } from "./editors.js";
import { catalogAction } from "./product.js";

const LAYOUTS = {
  list: { name: "Список", render: listRows },
  table: { name: "Таблица", render: tableLayout },
  kanban: { name: "Канбан", render: kanbanLayout, whole: true },
  calendar: { name: "Календарь", render: calendarLayout, whole: true },
  gallery: { name: "Галерея", render: galleryLayout },
  checklist: { name: "Чек-лист", render: checklistLayout },
};

export const PERIODS = [
  { value: "@today", name: "сегодня" }, { value: "@yesterday", name: "вчера" }, { value: "@last7d", name: "7 дней" },
  { value: "@thisWeek", name: "эта неделя" }, { value: "@thisMonth", name: "этот месяц" }, { value: "@last30d", name: "30 дней" },
  { value: "@next7d", name: "ближайшие 7 дней" },
];

const OPS = {
  eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤", contains: "содержит", within: "за", empty: "пусто", notEmpty: "заполнено",
};
const OPS_BY_FORMAT = {
  text: ["contains", "eq", "empty", "notEmpty"], url: ["contains", "empty", "notEmpty"],
  number: ["gte", "lte", "eq", "empty", "notEmpty"], formula: ["gte", "lte", "eq", "notEmpty"],
  date: ["within", "eq", "empty", "notEmpty"], datetime: ["within", "empty", "notEmpty"], time: ["gte", "lte", "eq"],
  select: ["eq", "neq", "empty", "notEmpty"], multiselect: ["contains", "empty"], checkbox: ["eq"],
  object: ["eq", "empty", "notEmpty"], objects: ["contains", "empty", "notEmpty"],
};
const GROUPABLE = ["select", "multiselect", "checkbox", "object", "date", "datetime"];

export function defaultView(state, typeKey) {
  const relations = (state.types[typeKey]?.relations || []).filter((k) => isVisibleRelation(state.relations[k]) && state.relations[k].format !== "objects").slice(0, 3);
  return { layout: "list", relations };
}

// One shape for a saved set and a type draft: what to show and how to change it.
function setModel(state, kind, arg) {
  if (kind === "type") {
    const type = state.types[arg];
    if (!type) return null;
    const draft = local(`type:${arg}`, () => ({ query: { source: { type: arg } }, view: defaultView(state, arg) }));
    return {
      key: `type:${arg}`, title: type.plural || type.name, icon: type.icon, typeKey: arg, saved: null, query: draft.query, view: draft.view,
      update(patch) { Object.assign(draft, patch); rerender(); },
    };
  }
  const set = state.objects[arg];
  if (!set || set.type !== "set") return null;
  const query = set.props?.query || { source: {} };
  return {
    key: `set:${arg}`, title: nameOf(set), icon: query.source?.type ? state.types[query.source.type]?.icon : "🗂", typeKey: query.source?.type || null, saved: set,
    query, view: set.props?.view || defaultView(state, query.source?.type),
    update(patch) { act({ op: "update", id: set.id, props: patch }, { quiet: true, summary: `Набор «${nameOf(set)}»` }); },
  };
}

function viewRelations(state, model, rows) {
  const keys = model.view.relations?.length ? model.view.relations : model.typeKey ? defaultView(state, model.typeKey).relations : [];
  if (keys.length || model.typeKey) return keys.filter((k) => state.relations[k]);
  const first = rows[0] && typeOf(state, rows[0]);
  return (first?.relations || []).filter((k) => isVisibleRelation(state.relations[k]) && state.relations[k].format !== "objects").slice(0, 3);
}

const relationsOfModel = (state, model) => {
  if (model.typeKey) return (state.types[model.typeKey]?.relations || []).filter((k) => isVisibleRelation(state.relations[k]));
  return Object.values(state.relations).filter(isVisibleRelation).map((r) => r.key);
};

const subtitle = (state, obj, keys, c) => keys.map((k) => shownValue(state, obj, k, c)).filter(Boolean).join(" · ");

export function setScreen(kind, arg) {
  const state = store.state();
  const model = setModel(state, kind, arg);
  if (!model) return [pageHeader({ title: "Набор", back: true }), empty("Такого набора нет")];
  const c = ctx();
  let result;
  try {
    result = runQuery(state, model.query, c);
  } catch (error) {
    return [pageHeader({ title: model.title, back: true }), empty(`Набор не открывается: ${error.message}`)];
  }
  const layout = LAYOUTS[model.view.layout] ? model.view.layout : "list";
  const keys = viewRelations(state, model, result.rows);
  const m = { ...model, keys, c };
  const type = model.typeKey ? state.types[model.typeKey] : null;
  const canCreate = type && !type.hidden && !["set", "dashboard"].includes(type.layout) && !type.singleton;

  const title = model.saved
    ? h("input", { class: "title-input", type: "text", value: model.title, "aria-label": "Название набора", onchange: (e) => act({ op: "update", id: model.saved.id, name: e.target.value.trim() }, { summary: `Набор «${e.target.value.trim()}»` }) })
    : h("h2", { class: "hero-title", text: model.title });

  const content = LAYOUTS[layout].whole || !result.groups
    ? LAYOUTS[layout].render(state, result.rows, m)
    : result.groups.map((g) => h("section", { class: "group" },
      h("h3", { class: "group-title" }, h("span", { text: groupLabel(state, model.query.group, g) }), h("span", { class: "muted", text: String(g.rows.length) })),
      LAYOUTS[layout].render(state, g.rows, m),
    ));

  return [
    pageHeader({ title: model.saved ? "Набор" : "Тип", back: true, actions: model.typeKey === "product" ? [catalogAction()] : [] }),
    h("section", { class: "hero hero-set" },
      h("span", { class: "hero-icon", "aria-hidden": "true", text: model.icon || "🗂" }),
      title,
      h("span", { class: "muted", text: countLabel(result.rows.length) }),
    ),
    h("div", { class: "tabs", role: "tablist", "aria-label": "Вид" }, Object.entries(LAYOUTS).map(([id, l]) => h("button", {
      class: `tab${id === layout ? " is-on" : ""}`, role: "tab", "aria-selected": String(id === layout),
      onclick: () => model.update({ view: { ...model.view, layout: id } }),
    }, l.name))),
    toolbar(state, m),
    h("div", { class: `set-body layout-${layout}` }, result.rows.length || LAYOUTS[layout].whole ? content : empty(model.query.filters?.length ? "Под фильтр ничего не подходит" : "Пока пусто")),
    totalsRow(state, result.rows, m),
    h("div", { class: "actions" },
      canCreate ? h("button", { class: "btn btn-primary", onclick: () => createIn(state, model) }, "+ Новый") : null,
      model.saved ? null : h("button", { class: "btn btn-quiet", onclick: () => saveAsSet(state, model) }, "Сохранить как набор"),
    ),
    model.saved ? h("button", { class: "btn btn-danger btn-block", onclick: () => { if (act({ op: "archive", id: model.saved.id }, { summary: `Набор «${model.title}» в архиве` }).ok) history.back(); } }, "Удалить набор") : null,
  ];
}

const countLabel = (n) => {
  const tail = n % 10 === 1 && n % 100 !== 11 ? "объект" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "объекта" : "объектов";
  return `${n} ${tail}`;
};

function createIn(state, model) {
  const type = state.types[model.typeKey];
  const result = act({ op: "create", type: type.key, name: type.fact ? type.name : "", props: newObjectProps(state, type.key, model.query.filters) }, { summary: `Новый объект «${type.name}»` });
  if (result.ok) go(hrefFor(store.state().objects[result.ids[0]]));
}

function saveAsSet(state, model) {
  openSheet("Сохранить как набор", (close) => {
    const name = h("input", { class: "input", type: "text", maxlength: "200", value: model.title });
    return h("div", { class: "form" }, field("Название", name), h("button", { class: "btn btn-primary", onclick: () => {
      const result = act({ op: "create", type: "set", name: name.value.trim() || model.title, props: { query: model.query, view: model.view } }, { summary: `Набор «${name.value.trim() || model.title}»` });
      if (result.ok) { close(); go(`#/set/${encodeURIComponent(result.ids[0])}`); }
    } }, "Сохранить"));
  });
}

function toolbar(state, m) {
  const q = m.query;
  const setQuery = (patch) => m.update({ query: { ...q, ...patch } });
  const removable = (text, onRemove) => h("span", { class: "fchip" }, h("span", { class: "fchip-text", text }), h("button", { class: "fchip-x", "aria-label": `Убрать: ${text}`, onclick: onRemove }, icon("close", 18)));
  return h("div", { class: "toolbar" },
    (q.filters || []).map((f, i) => removable(filterLabel(state, f), () => setQuery({ filters: q.filters.filter((_, j) => j !== i) }))),
    (q.sorts || []).map((s, i) => removable(`${s.dir === "desc" ? "↓" : "↑"} ${relName(state, s.rel)}`, () => setQuery({ sorts: q.sorts.filter((_, j) => j !== i) }))),
    q.group?.rel ? removable(`Группа: ${relName(state, q.group.rel)}`, () => setQuery({ group: null })) : null,
    h("button", { class: "chip chip-add", onclick: () => filterSheet(state, m, setQuery) }, "+ Фильтр"),
    h("button", { class: "chip chip-add", onclick: () => sortSheet(state, m, setQuery) }, "+ Сортировка"),
    q.group?.rel ? null : h("button", { class: "chip chip-add", onclick: () => groupSheet(state, m, setQuery) }, "+ Группа"),
    h("button", { class: "chip chip-add", onclick: () => fieldsSheet(state, m) }, "Поля"),
  );
}

const relName = (state, key) => (key === "name" ? "Название" : state.relations[key]?.name || key);

function valueLabel(state, rel, value) {
  if (typeof value === "string" && value.startsWith("@")) return PERIODS.find((p) => p.value === value)?.name || value;
  if (rel?.format === "select" || rel?.format === "multiselect") return rel.options?.find((o) => o.id === value)?.name || String(value);
  if (rel?.format === "object" || rel?.format === "objects") return nameOf(state.objects[value]);
  if (rel?.format === "checkbox") return value ? "да" : "нет";
  if (rel?.format === "date") return dayShort(value);
  return String(value);
}

function filterLabel(state, f) {
  const rel = state.relations[f.rel];
  const name = relName(state, f.rel);
  if (f.op === "empty" || f.op === "notEmpty") return `${name}: ${OPS[f.op]}`;
  if (f.op === "within") return `${name}: ${valueLabel(state, rel, f.value)}`;
  return `${name} ${OPS[f.op]} ${valueLabel(state, rel, f.value)}`;
}

function relationSelect(state, keys, current, onChange) {
  const select = h("select", { class: "input", "aria-label": "Связь" }, keys.map((k) => h("option", { value: k, selected: k === current }, relName(state, k))));
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function filterSheet(state, m, setQuery) {
  const keys = ["name", ...relationsOfModel(state, m)];
  openSheet("Фильтр", (close) => {
    const draft = { rel: keys[0], op: null, value: null };
    const body = h("div", { class: "form" });
    const build = () => {
      const rel = state.relations[draft.rel];
      const format = draft.rel === "name" ? "text" : rel.format;
      const ops = OPS_BY_FORMAT[format] || ["eq"];
      if (!ops.includes(draft.op)) { draft.op = ops[0]; draft.value = format === "checkbox" ? true : format === "date" || format === "datetime" ? "@today" : null; }
      fill(body,
        field("Связь", relationSelect(state, keys, draft.rel, (k) => { draft.rel = k; draft.op = null; build(); })),
        h("div", { class: "field" }, h("span", { class: "field-label", text: "Условие" }), segmented(ops.map((id) => ({ id, name: OPS[id] })), draft.op, (id) => { draft.op = id; if (id === "within") draft.value = "@today"; build(); }, { label: "Условие" })),
        ["empty", "notEmpty"].includes(draft.op) ? null : valueControl(state, rel, format, draft, build),
        h("button", { class: "btn btn-primary", onclick: () => {
          if (draft.value == null && !["empty", "notEmpty"].includes(draft.op)) { toast("Выберите значение", { error: true }); return; }
          close();
          setQuery({ filters: [...(m.query.filters || []), { rel: draft.rel, op: draft.op, ...(["empty", "notEmpty"].includes(draft.op) ? {} : { value: draft.value }) }] });
        } }, "Применить"),
      );
    };
    build();
    return body;
  });
}

function valueControl(state, rel, format, draft, rebuild) {
  const wrap = (control) => h("div", { class: "field" }, h("span", { class: "field-label", text: "Значение" }), control);
  if (draft.op === "within") return wrap(segmented(PERIODS.map((p) => ({ id: p.value, name: p.name })), draft.value, (v) => { draft.value = v; rebuild(); }, { label: "Период" }));
  if (format === "checkbox") return wrap(segmented([{ id: true, name: "да" }, { id: false, name: "нет" }], draft.value, (v) => { draft.value = v; rebuild(); }, { label: "Значение" }));
  if (format === "select" || format === "multiselect") return wrap(segmented(rel.options || [], draft.value, (v) => { draft.value = v; rebuild(); }, { label: "Вариант" }));
  if (format === "object" || format === "objects") {
    return wrap(h("button", { class: "chip chip-add", onclick: () => pickObject({ title: rel.name, types: rel.types, onPick: (id) => { draft.value = id; rebuild(); } }) }, draft.value ? nameOf(state.objects[draft.value]) : "Выбрать"));
  }
  const type = { date: "date", time: "time" }[format] || "text";
  const input = h("input", { class: "input", type, inputmode: ["number", "formula"].includes(format) ? "decimal" : null, value: draft.value ?? "", "aria-label": "Значение" });
  input.addEventListener("input", () => { draft.value = ["number", "formula"].includes(format) ? parseNumber(input.value) ?? null : input.value || null; });
  return wrap(input);
}

function sortSheet(state, m, setQuery) {
  const keys = ["name", ...relationsOfModel(state, m).filter((k) => !["objects", "multiselect"].includes(state.relations[k].format))];
  openSheet("Сортировка", (close) => {
    const draft = { rel: keys[0], dir: "asc" };
    const pick = (dir) => { close(); setQuery({ sorts: [...(m.query.sorts || []).filter((s) => s.rel !== draft.rel), { rel: draft.rel, dir }] }); };
    return h("div", { class: "form" },
      field("Связь", relationSelect(state, keys, draft.rel, (k) => { draft.rel = k; })),
      h("div", { class: "actions" }, h("button", { class: "btn btn-quiet", onclick: () => pick("asc") }, "↑ По возрастанию"), h("button", { class: "btn btn-quiet", onclick: () => pick("desc") }, "↓ По убыванию")),
    );
  });
}

function groupSheet(state, m, setQuery) {
  const keys = relationsOfModel(state, m).filter((k) => GROUPABLE.includes(state.relations[k].format));
  openSheet("Группировка", (close) => {
    if (!keys.length) return empty("Группировать можно по выбору, флажку, ссылке или дате, а у этого типа таких связей нет");
    return h("div", { class: "pick-list" }, keys.flatMap((k) => {
      const rel = state.relations[k];
      const byDate = rel.format === "date" || rel.format === "datetime";
      return (byDate ? [["day", "по дням"], ["week", "по неделям"], ["month", "по месяцам"]] : [[null, ""]]).map(([by, text]) => h("button", {
        class: "row row-btn", onclick: () => { close(); setQuery({ group: { rel: k, ...(by ? { by } : {}) } }); },
      }, h("span", { class: "row-title", text: `${rel.name}${text ? `, ${text}` : ""}` })));
    }));
  });
}

function fieldsSheet(state, m) {
  openSheet("Поля", () => {
    const list = h("div", { class: "pick-list" });
    const shown = [...m.keys];
    const draw = () => fill(list, ...relationsOfModel(state, m).map((k) => {
      const on = shown.includes(k);
      return h("button", { class: "row row-btn", role: "switch", "aria-checked": String(on), onclick: () => {
        if (on) shown.splice(shown.indexOf(k), 1); else shown.push(k);
        m.update({ view: { ...m.view, relations: [...shown] } });
        draw();
      } }, h("span", { class: `tick${on ? " is-on" : ""}` }, on ? icon("check", 18) : null), h("span", { class: "row-title", text: relName(state, k) }));
    }));
    draw();
    return list;
  });
}

function groupLabel(state, group, g) {
  if (g.key === "" || g.key == null) return "Без значения";
  const rel = state.relations[group.rel];
  if (rel?.format === "date" || rel?.format === "datetime") return group.by === "month" ? monthLabel(`${g.key}-01`) : group.by === "week" ? `Неделя с ${dayShort(g.key)}` : dayShort(g.key);
  if (rel?.format === "object" || rel?.format === "multiselect") return valueLabel(state, rel, g.key);
  if (rel?.format === "checkbox") return g.key ? "да" : "нет";
  return String(g.label);
}

function totalsRow(state, rows, m) {
  const sums = m.keys.filter((k) => isNumeric(state, k)).map((k) => {
    const total = aggregate(state, rows, { rel: k, fn: "sum" }, m.c);
    return `${state.relations[k].name}: ${num(total)}${state.relations[k].unit ? ` ${state.relations[k].unit}` : ""}`;
  });
  if (!rows.length || !sums.length) return null;
  return h("p", { class: "totals" }, h("span", { class: "totals-label", text: "Итого" }), h("span", { text: sums.join(" · ") }));
}

const objectRow = (state, obj, m, extra = null) => h("a", { class: "row", href: hrefFor(obj) },
  h("span", { class: "row-icon", text: iconOf(state, obj) }),
  h("span", { class: "row-main" }, h("span", { class: "row-title", text: nameOf(obj) }), h("span", { class: "row-sub", text: subtitle(state, obj, m.keys, m.c) })),
  extra,
);

function listRows(state, rows, m) {
  return h("div", { class: "card list" }, rows.map((obj) => objectRow(state, obj, m)));
}

function tableLayout(state, rows, m) {
  const sortBy = (k) => {
    const current = m.query.sorts?.[0];
    const dir = current?.rel === k && current.dir === "asc" ? "desc" : "asc";
    m.update({ query: { ...m.query, sorts: [{ rel: k, dir }] } });
  };
  const head = (k) => h("th", { scope: "col" }, h("button", { class: "th-btn", onclick: () => sortBy(k) }, relName(state, k)));
  return h("div", { class: "table-wrap" }, h("table", { class: "table" },
    h("thead", {}, h("tr", {}, head("name"), m.keys.map(head))),
    h("tbody", {}, rows.map((obj) => h("tr", {},
      h("th", { scope: "row" }, h("a", { class: "cell-link", href: hrefFor(obj) }, nameOf(obj))),
      m.keys.map((k) => h("td", { class: isNumeric(state, k) ? "num" : "", text: shownValue(state, obj, k, m.c) })),
    ))),
  ));
}

function kanbanLayout(state, rows, m) {
  const candidates = relationsOfModel(state, m).filter((k) => state.relations[k].format === "select");
  if (!candidates.length) return empty("Для канбана нужна связь с вариантами, например «Статус»");
  const groupRel = candidates.includes(m.view.groupRel) ? m.view.groupRel : candidates[0];
  const rel = state.relations[groupRel];
  const columns = [...(rel.options || []).map((o) => ({ id: o.id, name: o.name })), { id: null, name: "Без значения" }];
  const byColumn = (id) => rows.filter((obj) => (obj.props?.[groupRel] ?? null) === id);
  return [
    candidates.length > 1 ? h("div", { class: "field inline" }, h("span", { class: "field-label", text: "Колонки по" }), relationSelect(state, candidates, groupRel, (k) => m.update({ view: { ...m.view, groupRel: k } }))) : null,
    h("div", { class: "kanban" }, columns.filter((col) => col.id !== null || byColumn(null).length).map((col) => h("section", { class: "kanban-col" },
      h("h3", { class: "group-title" }, h("span", { text: col.name }), h("span", { class: "muted", text: String(byColumn(col.id).length) })),
      byColumn(col.id).map((obj) => h("a", { class: "kcard", href: hrefFor(obj) }, h("span", { class: "row-title", text: `${iconOf(state, obj)} ${nameOf(obj)}` }), h("span", { class: "row-sub", text: subtitle(state, obj, m.keys.filter((k) => k !== groupRel), m.c) }))),
    ))),
  ];
}

function calendarLayout(state, rows, m) {
  const candidates = relationsOfModel(state, m).filter((k) => ["date", "datetime"].includes(state.relations[k].format));
  if (!candidates.length) return empty("Для календаря нужна связь с датой");
  const dateRel = candidates.includes(m.view.dateRel) ? m.view.dateRel : candidates[0];
  const cal = local(`cal:${m.key}`, () => ({ month: m.c.today.slice(0, 7), day: m.c.today }));
  const dayOf = (obj) => String(obj.props?.[dateRel] ?? "").slice(0, 10);
  const first = `${cal.month}-01`;
  const start = shiftDate(first, -((new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7));
  const cells = [];
  for (let d = start; cells.length < 42; d = shiftDate(d, 1)) {
    if (cells.length >= 35 && d.slice(0, 7) !== cal.month) break;
    cells.push(d);
  }
  const moveMonth = (n) => { const d = new Date(`${first}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); cal.month = d.toISOString().slice(0, 7); rerender(); };
  const picked = rows.filter((obj) => dayOf(obj) === cal.day);
  return [
    candidates.length > 1 ? h("div", { class: "field inline" }, h("span", { class: "field-label", text: "Даты по" }), relationSelect(state, candidates, dateRel, (k) => m.update({ view: { ...m.view, dateRel: k } }))) : null,
    h("div", { class: "cal-head" },
      h("button", { class: "icon-btn", "aria-label": "Предыдущий месяц", onclick: () => moveMonth(-1) }, icon("back")),
      h("span", { class: "cal-title", text: monthLabel(first) }),
      h("button", { class: "icon-btn", "aria-label": "Следующий месяц", onclick: () => moveMonth(1) }, icon("next")),
    ),
    h("div", { class: "cal-grid", role: "grid" },
      ["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((d) => h("span", { class: "cal-wd", text: d })),
      cells.map((d) => {
        const count = rows.filter((obj) => dayOf(obj) === d).length;
        return h("button", {
          class: `cal-day${d.slice(0, 7) !== cal.month ? " is-out" : ""}${d === m.c.today ? " is-today" : ""}${d === cal.day ? " is-on" : ""}`,
          "aria-label": `${dayShort(d)}${count ? `, ${count}` : ""}`, onclick: () => { cal.day = d; rerender(); },
        }, h("span", { text: String(Number(d.slice(8))) }), count ? h("span", { class: "cal-dot", text: count > 1 ? String(count) : "" }) : null);
      }),
    ),
    h("h3", { class: "group-title" }, h("span", { text: dayShort(cal.day) }), h("span", { class: "muted", text: String(picked.length) })),
    picked.length ? listRows(state, picked, m) : empty("В этот день ничего"),
  ];
}

function galleryLayout(state, rows, m) {
  return h("div", { class: "gallery" }, rows.map((obj) => h("a", { class: "gcard", href: hrefFor(obj) },
    h("span", { class: "gcard-icon", "aria-hidden": "true", text: iconOf(state, obj) }),
    h("span", { class: "row-title", text: nameOf(obj) }),
    m.keys.slice(0, 2).map((k) => shownValue(state, obj, k, m.c)).filter(Boolean).map((text) => h("span", { class: "row-sub", text })),
  )));
}

function checklistLayout(state, rows, m) {
  const rel = [...m.keys, ...relationsOfModel(state, m)].map((k) => state.relations[k]).find((r) => r?.format === "checkbox");
  if (!rel) return empty("Для чек-листа нужна связь «да или нет»: добавьте её типу");
  return h("div", { class: "card list" }, rows.map((obj) => {
    const on = Boolean(obj.props?.[rel.key]);
    return h("div", { class: "row" },
      h("button", { class: `check${on ? " is-on" : ""}`, role: "checkbox", "aria-checked": String(on), "aria-label": nameOf(obj), onclick: () => act({ op: "update", id: obj.id, props: { [rel.key]: !on } }, { summary: `${nameOf(obj)}: ${on ? "снято" : "отмечено"}` }) }, on ? icon("check", 20) : null),
      h("a", { class: "row-main", href: hrefFor(obj) }, h("span", { class: `row-title${on ? " is-done" : ""}`, text: nameOf(obj) }), h("span", { class: "row-sub", text: subtitle(state, obj, m.keys.filter((k) => k !== rel.key), m.c) })),
    );
  }));
}
