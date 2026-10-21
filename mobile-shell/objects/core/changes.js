// What a list of store ops changes, in the person's words: one row per change,
// [kind, name, detail]. The Сборщик and the Ассистент show their Предложения
// with it, so the person reads «Связь · Выпито, мл · Число, мл» instead of ops.
import { homeOf } from "./values.js";

export const FORMAT_NAMES = {
  text: "Текст", number: "Число", date: "Дата", time: "Время", datetime: "Дата и время",
  select: "Один вариант", multiselect: "Несколько вариантов", checkbox: "Да или нет",
  object: "Ссылка на объект", objects: "Ссылки на объекты", url: "Ссылка на сайт", formula: "Формула",
};

export const DISPLAY_NAMES = { list: "Список", number: "Число", bars: "Столбцы за 7 дней" };

const fmt = (value) => Math.round(Number(value) || 0).toLocaleString("ru-RU");

// A value as the person reads it. Links show the name of the object.
function shown(state, rel, value) {
  if (value == null || value === "") return "";
  switch (rel.format) {
    case "select": return rel.options?.find((o) => o.id === value)?.name ?? String(value);
    case "multiselect": return (Array.isArray(value) ? value : []).map((v) => rel.options?.find((o) => o.id === v)?.name ?? v).join(", ");
    case "checkbox": return value ? "да" : "нет";
    case "object": return state.objects[value]?.name || "";
    case "objects": return (Array.isArray(value) ? value : []).map((id) => state.objects[id]?.name).filter(Boolean).join(", ");
    case "number": return `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}${rel.unit ? ` ${rel.unit}` : ""}`;
    default: return String(value);
  }
}

function propsLine(state, props, limit = 3) {
  return Object.entries(props || {})
    .map(([key, value]) => ({ rel: state.relations[key], value }))
    .filter(({ rel }) => rel && !rel.hidden && rel.format !== "json")
    .map(({ rel, value }) => `${rel.name}: ${shown(state, rel, value) || "—"}`)
    .slice(0, limit)
    .join(", ");
}

export function changeRows(state, ops) {
  const home = homeOf(state);
  const had = new Set((home?.props?.widgets || []).map((w) => w.id));
  const typeName = (key) => state.types[key]?.name || key;
  return ops.flatMap((op) => {
    if (op.op === "defineRelation") return [["Связь", op.relation.name, [FORMAT_NAMES[op.relation.format] || op.relation.format, op.relation.unit].filter(Boolean).join(", ")]];
    if (op.op === "defineType") return [["Тип", `${op.type.icon || ""} ${op.type.name}`.trim(), op.type.fact ? "записи вносите вы" : ""]];
    if (op.op === "create" && op.type === "set") return [["Набор", op.name, ""]];
    if (op.op === "update" && op.id === home?.id) {
      return (op.props.widgets || []).filter((w) => !had.has(w.id)).map((w) => ["Виджет на главной", w.title, [DISPLAY_NAMES[w.display], w.goal != null ? `цель ${fmt(w.goal)}` : ""].filter(Boolean).join(", ")]);
    }
    if (op.op === "create") return [[`Новый ${typeName(op.type).toLowerCase()}`, op.name || "Без названия", propsLine(state, op.props)]];
    if (op.op === "update") {
      const obj = state.objects[op.id];
      const rename = op.name !== undefined && op.name !== obj?.name ? `название: ${op.name}` : "";
      return [[`Изменится ${typeName(obj?.type).toLowerCase()}`, obj?.name || op.id, [rename, propsLine(state, op.props)].filter(Boolean).join(", ")]];
    }
    if (op.op === "archive") return [[`Уберётся ${typeName(state.objects[op.id]?.type).toLowerCase()}`, state.objects[op.id]?.name || op.id, ""]];
    return [];
  });
}
