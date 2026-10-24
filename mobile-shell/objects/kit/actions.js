// What a tap becomes. Every function returns store ops and writes nothing; the
// caller applies them with `actor: "human"` (a mark, a record or a deletion is a
// fact, and the store refuses facts from `ai`). A request that cannot be done
// throws an Error whose message is the Russian reason, ready for a toast.
//
//   const ops = markOps(store.state(), "vitamins", { item: "vit_d", state: "done", today: store.today() });
//   store.apply(ops, { actor: "human" });
import { localDateKey } from "../core/store.js";
import { atProblem, dueOn, everyProblem } from "./schedule.js";
import { asksField, entriesOf, fieldOf, itemsOf, MARK_STATES, requireTrack, trackOf } from "./ledger.js";
import { slotsOf } from "./sources.js";
import { isDateKey } from "../viz/util.js";

const MAX_ITEMS = 200;
const fail = (message) => { throw new Error(message); };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const TRANSLIT = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e", ю: "yu", я: "ya" };

// A key from a name by transliteration: «Витамин D» -> vitamin_d.
export function slugOf(name) {
  const s = String(name || "").toLowerCase().split("").map((c) => TRANSLIT[c] ?? (/[a-z0-9]/.test(c) ? c : "_")).join("").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return (/^[a-z]/.test(s) ? s : `x_${s}`).slice(0, 24).replace(/_$/, "") || "item";
}

function dayOf(opts) {
  const today = opts?.today || localDateKey();
  const date = opts?.date ?? today;
  if (!isDateKey(date)) fail(`Дата «${date}» не подходит: нужна запись вида ГГГГ-ММ-ДД`);
  if (date > today) fail("Нельзя записывать и отмечать будущие дни");
  return { date, today };
}

const withUnit = (field, n) => `${n}${field.unit ? ` ${field.unit}` : ""}`;

// One raw value as the store keeps it. null means «clear the field».
function coerce(state, track, field, raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const name = `«${field.name}»`;
  switch (field.type) {
    case "calc": return fail(`${name} считается само, его не записывают`);
    case "number":
    case "scale": {
      const n = typeof raw === "string" ? Number(raw.trim().replace(",", ".")) : raw;
      if (typeof n !== "number" || !Number.isFinite(n)) return fail(`${name}: нужно число`);
      const [min, max] = field.type === "scale" ? [field.min ?? 1, field.max ?? 5] : [field.min, field.max];
      if (field.type === "scale" && !Number.isInteger(n)) return fail(`${name}: нужна целая оценка от ${min} до ${max}`);
      if (min != null && n < min) return fail(`${name}: не меньше ${withUnit(field, min)}`);
      if (max != null && n > max) return fail(`${name}: не больше ${withUnit(field, max)}`);
      return n;
    }
    case "text": {
      const text = String(raw).trim();
      return text.length > 2000 ? fail(`${name}: не больше 2000 символов`) : text || null;
    }
    case "choice": {
      const option = field.options?.find((o) => o.id === raw || o.name === raw);
      return option ? option.id : fail(`${name}: выберите одно из ${(field.options || []).map((o) => `«${o.name}»`).join(", ")}`);
    }
    case "yesno": {
      if (typeof raw === "boolean") return raw;
      const word = String(raw).trim().toLowerCase();
      if (["yes", "да", "true", "1"].includes(word)) return true;
      if (["no", "нет", "false", "0"].includes(word)) return false;
      return fail(`${name}: нужно да или нет`);
    }
    case "date": return isDateKey(raw) ? raw : fail(`${name}: нужна дата ГГГГ-ММ-ДД`);
    case "time": return TIME.test(raw) ? raw : fail(`${name}: нужно время ЧЧ:ММ`);
    case "link": {
      const rows = field.to && trackOf(state, field.to) ? itemsOf(state, field.to).filter((i) => !i.archived) : null;
      if (rows) {
        const row = rows.find((i) => i.id === raw || i.key === raw || i.name === raw);
        return row ? row.id : fail(`${name}: в разделе «${trackOf(state, field.to).name}» нет «${raw}»`);
      }
      return state.objects[raw] && !state.objects[raw].archivedAt ? raw : fail(`${name}: такого объекта нет`);
    }
  }
  return fail(`${name}: неизвестный вид поля`);
}

// values (local keys) -> props (relation keys). `only` limits the allowed fields.
function propsOf(state, track, values, only = null) {
  const props = {};
  for (const [key, raw] of Object.entries(values || {})) {
    const field = fieldOf(track, key);
    if (!field) fail(`В разделе «${track.name}» нет поля «${key}». Есть: ${track.fields.filter((f) => f.type !== "calc").map((f) => f.key).join(", ") || "полей нет"}`);
    if (only && !only(field)) continue;
    props[field.rel] = coerce(state, track, field, raw);
  }
  return props;
}

const present = (props) => Object.fromEntries(Object.entries(props).filter(([, v]) => v != null));

function checkRequired(track, props, fields, planned = {}) {
  for (const field of fields) {
    if (field.required && field.type !== "calc" && props[field.rel] == null && planned[field.key] == null) fail(`Заполните «${field.name}»`);
  }
}

// -- records ----------------------------------------------------------------------------
/** A record of a log (or an unplanned entry of a habit or a list) at a date. */
export function formOps(state, trackKey, values, opts = {}) {
  const track = requireTrack(state, trackKey);
  if (!["log", "habit", "list"].includes(track.kind)) fail(`В разделе «${track.name}» записи не вводят (вид «${track.kind}»)`);
  const { date } = dayOf(opts);
  const props = propsOf(state, track, values);
  checkRequired(track, props, track.fields);
  if (track.fields.length && !Object.values(props).some((v) => v != null)) fail("Нечего записывать: укажите значение");
  return [{ op: "create", type: track.typeKey, name: track.name, props: { date, ...present(props) } }];
}

/** One tap with preset values («+250 мл»). */
export const quickOps = formOps;

// -- marks ------------------------------------------------------------------------------
function findItem(state, track, wanted) {
  const items = itemsOf(state, track.key).filter((item) => !item.archived);
  const key = typeof wanted === "object" && wanted ? wanted.id ?? wanted.key : wanted;
  return items.find((item) => item.id === key || item.key === key || item.name === key) || fail(`В разделе «${track.name}» нет позиции «${key}»`);
}

function targetOf(state, track, { item, slot }, date) {
  if (track.follows) {
    if (!slot) fail(`Отметка раздела «${track.name}» — это приём или тренировка плана: укажите slot`);
    const found = slotsOf(state, track.follows, date).find((s) => s.slot === slot);
    if (!found) fail(`На ${date} в плане нет «${slot}»`);
    return { ref: `s:${found.slot}`, name: found.name, props: { kit_slot: found.slot }, item: null, open: false };
  }
  if (item == null) fail(`Укажите позицию раздела «${track.name}»`);
  const found = findItem(state, track, item);
  const open = String(found.every).toLowerCase() === "open";
  if (found.from && date < found.from) fail(`«${found.name}» появилось ${found.from}: раньше отмечать нельзя`);
  if (!open && !dueOn(found, date)) fail(`«${found.name}» не запланировано на ${date}`);
  if (open && found.until && date > found.until) fail(`«${found.name}» уже закрыто`);
  return { ref: `i:${found.id}`, name: found.name, props: { kit_item: found.id }, item: found, open };
}

function marksAt(state, track, target, date, today) {
  return entriesOf(state, track.key, { today }).filter((e) => e.ref === target.ref && (target.open || e.date === date));
}

/**
 * The mark of one item (or classic slot) on a date: created, or updated when it
 * already exists, so a second tap never makes a second mark. For a list item,
 * which has one mark in all, the date moves to the day of the new tap.
 */
export function markOps(state, trackKey, { item, slot, date, state: markState, values, today } = {}) {
  const track = requireTrack(state, trackKey);
  if (!["habit", "list", "follow"].includes(track.kind)) fail(`В разделе «${track.name}» отметок нет (вид «${track.kind}»)`);
  const day = dayOf({ date, today });
  if (!MARK_STATES.includes(markState)) fail("Не указано состояние отметки");
  if (!track.states.includes(markState)) fail(`В разделе «${track.name}» нет состояния «${markState}». Есть: ${track.states.join(", ")}`);
  const target = targetOf(state, track, { item, slot }, day.date);
  const asked = track.fields.filter((f) => asksField(f, markState));
  const given = propsOf(state, track, values, (field) => asksField(field, markState));
  checkRequired(track, given, asked, markState === "skipped" ? {} : target.item?.plan);
  const existing = marksAt(state, track, target, day.date, day.today);
  if (!existing.length) {
    return [{ op: "create", type: track.typeKey, name: target.name, props: { date: day.date, kit_state: markState, ...target.props, ...present(given) } }];
  }
  const cleared = Object.fromEntries(track.fields.filter((f) => f.type !== "calc").map((f) => [f.rel, null]));
  const [keep, ...extra] = existing;
  return [
    { op: "update", id: keep.id, props: { date: day.date, kit_state: markState, ...target.props, ...cleared, ...present(given) } },
    ...extra.map((e) => ({ op: "archive", id: e.id })),
  ];
}

/** Takes a mark back. Nothing to take back gives no ops. */
export function unmarkOps(state, trackKey, { item, slot, date, today } = {}) {
  const track = requireTrack(state, trackKey);
  const day = dayOf({ date, today });
  const target = targetOf(state, track, { item, slot }, day.date);
  return marksAt(state, track, target, day.date, day.today).map((e) => ({ op: "archive", id: e.id }));
}

// -- items --------------------------------------------------------------------------------
/**
 * A person adds a row to a list or a habit, or a row to a catalog. It is a plan
 * object, not a fact, so the change is journaled and can be undone.
 * input: { name, every?, at?, until?, plan?, key? }
 */
export function addItemOps(state, trackKey, input = {}, opts = {}) {
  const track = requireTrack(state, trackKey);
  if (!["habit", "list", "catalog"].includes(track.kind)) fail(`В разделе «${track.name}» позиции не добавляют (вид «${track.kind}»)`);
  const today = opts.today || localDateKey();
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 60) fail("Название позиции: от 1 до 60 символов");
  const items = itemsOf(state, track.key).filter((item) => !item.archived);
  if (items.length >= MAX_ITEMS) fail(`В разделе «${track.name}» уже ${MAX_ITEMS} позиций`);
  if (items.some((item) => item.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"))) fail(`«${name}» уже есть в разделе «${track.name}»`);
  const scheduled = track.kind !== "catalog";
  const every = scheduled ? input.every ?? (track.kind === "list" ? "open" : "day") : null;
  const problem = (scheduled && everyProblem(every)) || atProblem(input.at) || (input.until && !isDateKey(input.until) ? "до: нужна дата ГГГГ-ММ-ДД" : null);
  if (problem) fail(problem);
  if (input.until && input.until < today) fail("Дата окончания раньше сегодняшнего дня");
  for (const key of Object.keys(input.plan || {})) {
    const field = fieldOf(track, key);
    if (field && track.kind !== "catalog" && !field.planned) fail(`Поле «${field.name}» не плановое: в позиции его не задают`);
  }
  const plan = present(propsOf(state, track, input.plan));
  const localPlan = Object.fromEntries(Object.entries(plan).map(([rel, v]) => [track.fields.find((f) => f.rel === rel).key, v]));
  const base = /^[a-z][a-z0-9_]{1,23}$/.test(input.key || "") ? input.key : slugOf(name);
  let key = base;
  for (let n = 2; state.objects[`ti_${track.key}_${key}`]; n += 1) key = `${base}_${n}`;
  return [{
    op: "create", type: "track_item", id: `ti_${track.key}_${key}`, name,
    props: { kit_track: track.key, kit_key: key, ...(scheduled ? { kit_every: every } : {}), ...(input.at ? { kit_at: input.at } : {}), kit_from: today, ...(input.until ? { kit_until: input.until } : {}), ...(Object.keys(localPlan).length ? { kit_plan: localPlan } : {}) },
  }];
}

/**
 * Changes an item the person made, or takes it out. patch: { name?, plan?, end?, archive? }.
 * A plan value of null clears it. `end` stops a scheduled item after today: it is not due
 * from tomorrow and its marks stay. `archive` takes the item out of the lists; marks that
 * point at it stay in the history. A plan object, not a fact, so the change is journaled.
 */
export function itemOps(state, itemId, patch = {}, opts = {}) {
  const obj = state.objects[itemId];
  const track = obj && !obj.archivedAt && obj.type === "track_item" ? trackOf(state, obj.props.kit_track) : null;
  if (!track) fail("Пункт не найден");
  if (patch.archive) return [{ op: "archive", id: obj.id }];
  const today = opts.today || localDateKey();
  const all = itemsOf(state, track.key);
  const props = {};
  const out = { op: "update", id: obj.id };
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name || name.length > 60) fail("Название позиции: от 1 до 60 символов");
    if (all.some((item) => !item.archived && item.id !== obj.id && item.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"))) fail(`«${name}» уже есть в разделе «${track.name}»`);
    if (name !== obj.name) out.name = name;
  }
  if (patch.plan) {
    for (const key of Object.keys(patch.plan)) {
      const field = fieldOf(track, key);
      if (field && track.kind !== "catalog" && !field.planned) fail(`Поле «${field.name}» не плановое: в позиции его не задают`);
    }
    const given = propsOf(state, track, patch.plan);
    const plan = { ...all.find((item) => item.id === obj.id).plan };
    for (const [rel, value] of Object.entries(given)) {
      const field = track.fields.find((f) => f.rel === rel);
      if (value == null) delete plan[field.key];
      else plan[field.key] = value;
      if (obj.props[rel] != null) props[rel] = value;
    }
    props.kit_plan = Object.keys(plan).length ? plan : null;
  }
  if (patch.end) {
    if (track.kind === "catalog") fail("Строка справочника не расписание: её можно только удалить");
    props.kit_until = today;
  }
  if (out.name === undefined && !Object.keys(props).length) fail("Нечего менять");
  return [{ ...out, ...(Object.keys(props).length ? { props } : {}) }];
}

// -- own entries ----------------------------------------------------------------------------
/**
 * Edits or deletes an entry the person made. patch: { values?, date?, state? } or { remove: true }.
 * A value of null clears a field.
 */
export function entryOps(state, entryId, patch = {}, opts = {}) {
  const obj = state.objects[entryId];
  const track = obj && !obj.archivedAt ? trackOf(state, state.types[obj.type]?.kit?.track) : null;
  if (!track) fail("Запись не найдена");
  if (patch.remove) return [{ op: "archive", id: obj.id }];
  const today = opts.today || localDateKey();
  const props = {};
  if (patch.date !== undefined) props.date = dayOf({ date: patch.date, today }).date;
  const isMark = Boolean(obj.props.kit_item || obj.props.kit_slot);
  if (patch.state !== undefined) {
    if (!isMark) fail("У записи без позиции нет состояния");
    if (!track.states.includes(patch.state)) fail(`В разделе «${track.name}» нет состояния «${patch.state}». Есть: ${track.states.join(", ")}`);
    props.kit_state = patch.state;
  }
  Object.assign(props, propsOf(state, track, patch.values, isMark ? (field) => asksField(field, patch.state ?? obj.props.kit_state ?? "done") || obj.props[field.rel] != null : null));
  for (const field of track.fields) {
    if (field.required && field.type !== "calc" && field.rel in props && props[field.rel] == null) fail(`«${field.name}» нужно заполнить, очистить нельзя`);
  }
  if (!Object.keys(props).length) fail("Нечего менять");
  return [{ op: "update", id: obj.id, props }];
}
