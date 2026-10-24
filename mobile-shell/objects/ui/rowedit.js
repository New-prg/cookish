// The sheet that opens when a row of a list or table with edit="yes" is tapped. A
// record or a mark of a track shows its fields, a date, «Сохранить» and «Удалить»;
// an item shows its name and the fields it plans, «Сохранить», «Закончить» (a scheduled
// item) and «Удалить». The sheet writes nothing: it hands `perform` a closed detail
// (kit/screen.js turns it into ops and applies it as the person, with the undo toast)
// and closes when that returned true.
//
//   openRowEditor(store, { id, track }, perform)
//   perform({ do: "editEntry" | "removeEntry" | "editItem" | "endItem" | "removeItem", id, patch?, summary })
import { button, errorLine, fieldSet, showError } from "../kit/inputs.js";
import { asksField, describeField, entriesOf, itemsOf, trackOf } from "../kit/ledger.js";
import { dateLabel } from "../viz/util.js";
import { h, openSheet, toast } from "./dom.js";

// The fields whose value differs from the row's, an emptied one as null.
const changes = (next, was) => Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== (was[key] ?? null)));

export function openRowEditor(store, { id, track: trackKey }, perform) {
  const state = store.state();
  const obj = state.objects[id];
  const track = trackOf(state, trackKey);
  if (!obj || obj.archivedAt || !track) {
    toast("Эта строка уже убрана", { error: true });
    return;
  }
  const today = store.today();
  if (obj.type === "track_item") itemSheet(state, track, id, today, perform);
  else entrySheet(state, track, id, today, perform);
}

function entrySheet(state, track, id, today, perform) {
  const entry = entriesOf(state, track.key, { today }).find((e) => e.id === id);
  if (!entry) { toast("Эта строка уже убрана", { error: true }); return; }
  const isMark = Boolean(entry.item || entry.slot);
  const fields = track.fields
    .filter((field) => field.type !== "calc" && (!isMark || asksField(field, entry.state) || entry.values[field.key] != null))
    .map((field) => describeField(state, track, field));
  const name = entry.name || track.name;
  openSheet(`${name}, ${dateLabel(entry.date)}`, (close) => {
    const set = fieldSet(fields, entry.values, today);
    const error = errorLine();
    const dateId = `kit-edit-date-${id}`;
    const date = h("input", { class: "kit-input", type: "date", max: today, "aria-labelledby": dateId });
    date.value = entry.date;
    const form = h("form", { class: "kit-form", novalidate: true, "aria-label": `Изменить: ${name}, ${dateLabel(entry.date)}` },
      set.node,
      isMark ? null : h("div", { class: "kit-field" }, h("span", { class: "kit-label", id: dateId, text: "Дата записи" }), date),
      error,
      h("div", { class: "kit-buttons" },
        button("Сохранить", { primary: true, type: "submit" }),
        button("Удалить", { quiet: true, danger: true, label: `Удалить запись: ${name}, ${dateLabel(entry.date)}`, onclick: () => { if (perform({ do: "removeEntry", id, summary: `${name}: запись удалена` })) close(); } })));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const out = set.read({ clearing: true });
      if (out.error) { showError(error, out.error); return; }
      const values = changes(out.values, entry.values);
      const patch = { ...(Object.keys(values).length ? { values } : {}), ...(!isMark && date.value && date.value !== entry.date ? { date: date.value } : {}) };
      if (!Object.keys(patch).length || perform({ do: "editEntry", id, patch, summary: `${name}: запись изменена` })) close();
    });
    return h("div", { class: "viz kit-sheet" }, form);
  });
}

function itemSheet(state, track, id, today, perform) {
  const item = itemsOf(state, track.key).find((i) => i.id === id);
  if (!item) { toast("Эта строка уже убрана", { error: true }); return; }
  const fields = track.fields
    .filter((field) => field.type !== "calc" && (track.kind === "catalog" || field.planned))
    .map((field) => describeField(state, track, field));
  const scheduled = track.kind !== "catalog";
  openSheet(item.name, (close) => {
    const set = fieldSet(fields, item.values, today);
    const error = errorLine();
    const name = h("input", { class: "kit-input", type: "text", maxlength: "60", autocomplete: "off", value: item.name });
    const apply = (detail) => { if (perform({ ...detail, id })) close(); };
    const form = h("form", { class: "kit-form", novalidate: true, "aria-label": `Изменить: ${item.name}` },
      h("label", { class: "kit-field" }, h("span", { class: "kit-label", text: "Название" }), name),
      set.node,
      error,
      h("div", { class: "kit-buttons" }, button("Сохранить", { primary: true, type: "submit" })),
      h("div", { class: "kit-buttons" },
        scheduled ? button("Закончить", { quiet: true, label: `Закончить: ${item.name}`, onclick: () => apply({ do: "endItem", summary: `${item.name}: закончено` }) }) : null,
        button("Удалить", { quiet: true, danger: true, label: `Удалить: ${item.name}`, onclick: () => apply({ do: "removeItem", summary: `${item.name}: удалено` }) })),
      scheduled ? h("p", { class: "kit-hint", text: "Закончить: со следующего дня пункта не будет в отметках. Удалить: пункт уйдёт из списка. Отметки в истории останутся." }) : null);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const out = set.read({ clearing: true });
      if (out.error) { showError(error, out.error); return; }
      const plan = changes(out.values, item.values);
      const title = name.value.trim();
      const patch = { ...(title !== item.name ? { name: title } : {}), ...(Object.keys(plan).length ? { plan } : {}) };
      if (!Object.keys(patch).length) { close(); return; }
      apply({ do: "editItem", patch, summary: `${title || item.name}: изменено` });
    });
    return h("div", { class: "viz kit-sheet" }, form);
  });
}
