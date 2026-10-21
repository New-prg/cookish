// The page of one object: name, type, every relation edited by its format,
// links from other objects, a note, its history and the archive.
import { act, allBacklinks, hrefFor, iconOf, isVisibleRelation, local, nameOf, rerender, store, typeOf } from "./runtime.js";
import { h, pageHeader, empty } from "./dom.js";
import { pickRelation, relationEditor } from "./editors.js";

const ACTORS = { human: "Вы", ai: "Ассистент", import: "Перенос", connector: "Коннектор" };
const TIME = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function objectScreen(id) {
  const state = store.state();
  const obj = state.objects[id];
  if (!obj) return [pageHeader({ title: "Объект", back: true }), empty("Такого объекта нет")];
  const type = typeOf(state, obj);
  const extra = local(`object:${id}`, () => ({ added: [] }));
  const relKeys = [...new Set([
    ...(type.relations || []),
    ...Object.keys(obj.props || {}),
    ...extra.added,
  ])].filter((key) => isVisibleRelation(state.relations[key]) && key !== "name");

  const name = h("input", { class: "title-input", type: "text", value: obj.name, placeholder: "Без названия", "aria-label": "Название", maxlength: "200" });
  name.addEventListener("change", () => {
    if (name.value.trim() !== obj.name) act({ op: "update", id, name: name.value.trim() }, { summary: `Название «${name.value.trim()}»` });
  });
  name.addEventListener("keydown", (event) => { if (event.key === "Enter") name.blur(); });

  const addRelation = () => pickRelation({
    exclude: relKeys,
    onPick: (key, def) => {
      // A person-made type grows for all its objects; a built-in type cannot
      // change, so the relation stays on this object once it gets a value.
      if (!type.system) {
        act([...(def ? [{ op: "defineRelation", relation: def }] : []), { op: "defineType", type: { ...type, relations: [...(type.relations || []), key] } }], { summary: `Связь «${def?.name || state.relations[key].name}» у типа «${type.name}»` });
        return;
      }
      if (def && !act({ op: "defineRelation", relation: def }, { summary: `Связь «${def.name}»` }).ok) return;
      extra.added.push(key);
      rerender();
    },
  });

  const note = h("textarea", { class: "input note-input", rows: "4", placeholder: "Заметка", "aria-label": "Заметка", value: obj.blocks?.find((b) => b.type === "text")?.text || "" });
  note.addEventListener("change", () => act({ op: "update", id, blocks: note.value.trim() ? [{ type: "text", text: note.value }] : [] }, { summary: `Заметка «${nameOf(obj)}»` }));

  const links = allBacklinks(state, id);
  const history = state.journal.filter((set) => id in (set.after || {}) || id in (set.before || {})).slice(-8).reverse();

  return [
    pageHeader({ title: type.name, back: true }),
    h("section", { class: "hero" },
      h("span", { class: "hero-icon", "aria-hidden": "true", text: iconOf(state, obj) }),
      name,
      h("a", { class: "type-chip", href: `#/type/${encodeURIComponent(type.key)}` }, `${type.icon || ""} ${type.name}`),
    ),
    obj.archivedAt ? h("div", { class: "banner" }, h("span", { text: "Объект в архиве" }), h("button", { class: "btn btn-quiet", onclick: () => act({ op: "restore", id }, { summary: `Возвращён «${nameOf(obj)}»` }) }, "Вернуть")) : null,
    h("section", { class: "card props" },
      relKeys.map((key) => {
        const rel = state.relations[key];
        return h("div", { class: `prop prop-${rel.format}` }, h("span", { class: "prop-label", text: rel.name }), h("div", { class: "prop-value" }, relationEditor(state, obj, rel)));
      }),
      h("button", { class: "btn btn-quiet btn-block", onclick: addRelation }, "+ Добавить связь"),
    ),
    h("section", { class: "block" }, h("h2", { class: "section-title", text: "Заметка" }), note),
    links.length ? h("section", { class: "block" },
      h("h2", { class: "section-title", text: "Ссылаются сюда" }),
      groupLinks(state, links).map(({ title, rows }) => h("div", { class: "card list" },
        h("p", { class: "list-head" }, h("span", { text: title }), h("span", { class: "row-count", text: String(rows.length) })),
        rows.slice(0, 3).map((from) => linkRow(state, from)),
        rows.length > 3 ? h("details", { class: "more-links" }, h("summary", { class: "btn btn-quiet btn-block" }, `Показать все ${rows.length}`), rows.slice(3, 200).map((from) => linkRow(state, from))) : null,
      )),
    ) : null,
    history.length ? h("section", { class: "block" },
      h("h2", { class: "section-title", text: "История" }),
      h("div", { class: "card list" }, history.map((set) => h("div", { class: "row" },
        h("span", { class: "row-main" }, h("span", { class: "row-title", text: set.summary }), h("span", { class: "row-sub", text: `${ACTORS[set.actor] || set.actor} · ${TIME.format(new Date(set.at))}` })),
        h("button", { class: "btn btn-quiet btn-small", onclick: () => act({ op: "revert", changeSetId: set.id }, { summary: `Отменено: ${set.summary}` }) }, "Отменить"),
      ))),
    ) : null,
    obj.archivedAt ? null : h("button", { class: "btn btn-danger btn-block", onclick: () => {
      if (act({ op: "archive", id }, { summary: `В архиве «${nameOf(obj)}»` }).ok) history.back();
    } }, "В архив"),
  ];
}

const linkRow = (state, from) => h("a", { class: "row", href: hrefFor(from) },
  h("span", { class: "row-icon", text: iconOf(state, from) }),
  h("span", { class: "row-main" }, h("span", { class: "row-title", text: nameOf(from) })),
);

// Links grouped by where they come from: «Порции · Продукт», «Покупки · Продукт».
function groupLinks(state, links) {
  const groups = new Map();
  for (const { obj, rel } of links) {
    const key = `${obj.type}|${rel.key}`;
    if (!groups.has(key)) groups.set(key, { title: `${typeOf(state, obj).plural || typeOf(state, obj).name} · ${rel.name}`, rows: [] });
    groups.get(key).rows.push(obj);
  }
  return [...groups.values()];
}
