// Fills a COPY of the state after an answer with two weeks of plausible history,
// written the way the person writes it: every record goes through the kit's own
// actions (markOps, formOps, quickOps) and is applied as `human`, so a field
// bound, a missing item, a date before the item began or a required field the
// answer forgot is refused exactly as the app would refuse it. A refusal is
// counted and reported, never hidden: seeding must not make a broken app look
// working. The answer's state and `state-after.json` are never touched.
//
// What the copy changes besides records, said in the report: an item that began
// today (the day the answer was applied) is dated 12 days back, as if the app
// had been in use all that time; otherwise nothing could be marked for the past.
import { TODAY, need, openStore } from "./common.mjs";
import { shiftDate } from "../../../mobile-shell/objects/viz/util.js";

export const SEED_DAYS = 12;
const QUICK_BODY = new Set(["quick"]);

// A small seeded generator, so a re-run writes the same history.
function rng(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INTEGER_UNITS = new Set(["шт.", "раз", "подх.", "шагов", "стр.", "порц.", "таб.", "мин", "мл", "ккал", "г", "₽", "сек", "МЕ", "мг", "мкг", "очк.", "баллов", "уд./мин"]);
const NOTES = ["по плану", "всё хорошо", "устал", "без изменений", "быстро", "тяжело", "как обычно"];

function roundTo(value, field) {
  if (field.step) return Math.round(value / field.step) * field.step;
  const abs = Math.abs(value);
  if (INTEGER_UNITS.has(field.unit) || abs >= 100) {
    const nice = abs >= 1000 ? 50 : abs >= 300 ? 10 : 1;
    return Math.round(value / nice) * nice;
  }
  return abs >= 10 ? Math.round(value * 2) / 2 : Math.round(value * 10) / 10;
}

// `base` in [0, 1) is the person's usual level for this field, so a series wobbles
// around one value (a weight, a pressure) instead of jumping across the bounds.
function numberValue(field, rnd, base) {
  const { min, max, goal, goalType } = field;
  let v;
  if (goal != null && goal > 0) v = goal * (goalType === "max" ? 0.4 + rnd() * 0.95 : 0.55 + rnd() * 0.6);
  else if (min != null && max != null) v = min + (max - min) * (0.15 + base * 0.25 + (rnd() - 0.5) * 0.12);
  else if (max != null) v = max * (0.15 + rnd() * 0.5);
  else if (min != null) v = Math.max(min, 1) * (1 + rnd() * 4);
  else v = 2 + rnd() * 28;
  if (min != null) v = Math.max(min, v);
  if (max != null) v = Math.min(max, v);
  v = roundTo(v, field);
  if (min != null) v = Math.max(min, v);
  if (max != null) v = Math.min(max, v);
  return Number(v.toFixed(2));
}

function timeValue(index, rnd) {
  const [lo, span] = index === 0 ? [22 * 60, 150] : index === 1 ? [6 * 60, 150] : [8 * 60, 600];
  const minutes = (lo + Math.floor(rnd() * span)) % (24 * 60);
  const rounded = Math.round(minutes / 15) * 15 % (24 * 60);
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

// One value of one field, or `undefined` when nothing plausible can be made (the
// caller reports it when the field is required).
function valueFor(field, ctx) {
  const { rnd, date } = ctx;
  switch (field.type) {
    case "number": return numberValue(field, rnd, ctx.base(field));
    case "scale": {
      const lo = field.min ?? 1;
      const hi = field.max ?? 5;
      return Math.min(hi, Math.max(lo, Math.round(lo + (hi - lo) * (0.35 + rnd() * 0.6))));
    }
    case "text": return NOTES[Math.floor(rnd() * NOTES.length)];
    case "choice": return field.options?.length ? field.options[Math.floor(rnd() * field.options.length)].id : undefined;
    case "yesno": return rnd() < 0.6;
    case "date": return date;
    case "time": return timeValue(ctx.timeIndex++, rnd);
    case "link": return ctx.links(field);
    default: return undefined;
  }
}

const baseOf = (track) => (field) => rng(`${track.key}|${field.key}`)();

function linksFor(api, state, rnd) {
  return (field) => {
    const rows = field.to && api.trackOf(state, field.to) ? api.itemsOf(state, field.to).filter((i) => !i.archived) : null;
    if (rows) return rows.length ? rows[Math.floor(rnd() * rows.length)].id : undefined;
    const pool = Object.values(state.objects).filter((o) => !o.archivedAt && (o.type === field.to || o.type === "product"));
    return pool.length ? pool[Math.floor(rnd() * pool.length)].id : undefined;
  };
}

function valuesFor(fields, ctx, { always = false } = {}) {
  const values = {};
  const missing = [];
  ctx.timeIndex = 0;
  for (const field of fields) {
    if (field.type === "calc") continue;
    if (!field.required && !always && ctx.rnd() < 0.25) continue;
    const value = valueFor(field, ctx);
    if (value === undefined) { if (field.required) missing.push(field.name); continue; }
    values[field.key] = value;
  }
  if (!Object.keys(values).length) {
    const first = fields.find((f) => f.type !== "calc");
    const value = first && valueFor(first, ctx);
    if (value !== undefined && first) values[first.key] = value;
  }
  return { values, missing };
}

// The quick elements of the answer, by track: the presets the person taps.
function quickPresets(state) {
  const out = new Map();
  for (const card of Object.values(state.objects)) {
    if (card.type !== "kit_card" || card.archivedAt) continue;
    for (const el of card.props.kit_body || []) {
      if (!QUICK_BODY.has(el.el) || !el.of) continue;
      const values = typeof el.values === "string" ? Object.fromEntries(el.values.split(",").map((p) => p.split("=").map((x) => x.trim())).filter((p) => p.length === 2).map(([k, v]) => [k, Number(v)])) : el.values;
      if (values && Object.keys(values).length) out.set(el.of, [...(out.get(el.of) || []), values]);
    }
  }
  return out;
}

// Which input elements the answer put on its screens for a track.
function inputsOn(state, key) {
  const found = new Set();
  for (const card of Object.values(state.objects)) {
    if (card.type !== "kit_card" || card.archivedAt) continue;
    for (const el of card.props.kit_body || []) {
      if (el.of !== key) continue;
      if (["quick", "form", "marks"].includes(el.el)) found.add(el.el);
      if (["list", "marks"].includes(el.el) && (el.add === true || el.add === "yes")) found.add("add");
    }
  }
  return [...found];
}

// `actions` replaces the kit's four actions; the selftest uses it to prove that a refusal is reported.
export async function seedState(serialized, { days = SEED_DAYS, actions = null } = {}) {
  const [{ markOps, formOps, quickOps, addItemOps }, ledger, { dueOn }, { slotsOf }] = await Promise.all([
    actions ?? need("kit/actions.js", ["markOps", "formOps", "quickOps", "addItemOps"]),
    need("kit/ledger.js", ["listTracks", "itemsOf", "trackOf", "asksField"]),
    need("kit/schedule.js", ["dueOn"]),
    need("kit/sources.js", ["slotsOf"]),
  ]);
  const { store, storage } = await openStore(serialized);
  const report = { days, from: shiftDate(TODAY, -days), to: shiftDate(TODAY, -1), records: 0, marks: 0, refused: [], backdated: [], examples: [], tracks: {} };
  const opts = (date) => ({ date, today: TODAY });
  const stat = (key) => (report.tracks[key] ||= { records: 0, marks: 0, refused: 0, inputs: [] });

  const write = (key, date, label, make) => {
    const track = stat(key);
    try {
      const ops = make();
      if (!ops.length) return false;
      const result = store.apply(ops, { actor: "human", summary: `лаб: ${label}` });
      if (!result.ok) throw new Error(result.reason || "хранилище отказало");
      return true;
    } catch (error) {
      track.refused += 1;
      report.refused.push({ track: key, date, what: label, message: String(error.message).split("\n")[0] });
      return false;
    }
  };

  // A list or a catalog the person fills by hand starts empty; a few example rows
  // stand in for what they would have added with «Добавить».
  for (const track of ledger.listTracks(store.state())) {
    if (!["list", "catalog"].includes(track.kind) || ledger.itemsOf(store.state(), track.key).some((i) => !i.archived)) continue;
    const rnd = rng(`items|${track.key}`);
    for (let n = 1; n <= 5; n += 1) {
      const ctx = { rnd, date: shiftDate(TODAY, -n), base: baseOf(track), links: linksFor({ trackOf: ledger.trackOf, itemsOf: ledger.itemsOf }, store.state(), rnd) };
      const plan = track.kind === "catalog" ? valuesFor(track.fields, ctx).values : {};
      if (write(track.key, TODAY, "пример позиции", () => addItemOps(store.state(), track.key, { name: `${track.name}: пример ${n}`, plan }, { today: TODAY }))) report.examples.push(track.key);
    }
  }

  // Items that began today are dated back, so the history can be written at all.
  const state0 = store.state();
  for (const track of ledger.listTracks(state0)) {
    for (const item of ledger.itemsOf(state0, track.key)) {
      if (item.archived || item.from < TODAY || track.kind === "catalog") continue;
      const result = store.apply([{ op: "update", id: item.id, props: { kit_from: shiftDate(TODAY, -days) } }], { actor: "human", summary: "лаб: позиция начата раньше" });
      if (result.ok) report.backdated.push(`${track.key}.${item.key}`);
    }
  }

  const presets = quickPresets(store.state());
  const dates = Array.from({ length: days }, (_, i) => shiftDate(TODAY, i - days));
  for (const track of ledger.listTracks(store.state())) {
    const t = stat(track.key);
    t.inputs = inputsOn(store.state(), track.key);
    const rnd = rng(`${track.key}`);
    const gaps = new Set(dates.filter(() => rnd() < 0.2));
    if (gaps.size === 0) gaps.add(dates[3]);
    if (gaps.size > days - 6) gaps.clear();

    if (track.kind === "log") {
      for (const date of dates) {
        if (gaps.has(date)) continue;
        const day = rng(`${track.key}|${date}`);
        const state = store.state();
        const own = presets.get(track.key);
        if (own) {
          const goal = track.fields.find((f) => f.goal != null);
          const unit = Object.values(own[0]).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
          const target = goal ? goal.goal * (goal.goalType === "max" ? 0.4 + day() * 0.95 : 0.55 + day() * 0.6) : 0;
          const taps = goal ? Math.max(1, Math.min(10, Math.round(target / unit))) : 1 + Math.floor(day() * 3);
          for (let i = 0; i < taps; i += 1) {
            const values = own[Math.floor(day() * own.length)];
            if (write(track.key, date, "быстрая запись", () => quickOps(store.state(), track.key, values, opts(date)))) { report.records += 1; t.records += 1; }
          }
          continue;
        }
        const entries = day() < 0.3 ? 2 : 1;
        for (let i = 0; i < entries; i += 1) {
          const ctx = { rnd: day, date, base: baseOf(track), links: linksFor({ trackOf: ledger.trackOf, itemsOf: ledger.itemsOf }, state, day) };
          const { values, missing } = valuesFor(track.fields, ctx);
          if (missing.length) {
            report.refused.push({ track: track.key, date, what: "запись", message: `не из чего выбрать для поля ${missing.map((m) => `«${m}»`).join(", ")}: вариантов нет` });
            t.refused += 1;
            continue;
          }
          if (write(track.key, date, "запись формы", () => formOps(store.state(), track.key, values, opts(date)))) { report.records += 1; t.records += 1; }
        }
      }
      continue;
    }

    if (track.kind === "catalog") continue;
    const markStates = track.states.filter((s) => ["done", "changed", "skipped"].includes(s));
    for (const date of dates) {
      const day = rng(`${track.key}|${date}`);
      const targets = [];
      if (track.kind === "follow") {
        for (const slot of slotsOf(store.state(), track.follows, date)) targets.push({ slot: slot.slot });
      } else {
        for (const item of ledger.itemsOf(store.state(), track.key)) {
          if (item.archived) continue;
          const open = String(item.every).toLowerCase() === "open";
          if (open) {
            const pick = rng(`${track.key}|${item.id}`);
            if (date !== dates[Math.floor(pick() * days)] || pick() < 0.4) continue;
          } else if (!dueOn(item, date)) continue;
          targets.push({ item: item.id });
        }
      }
      for (const target of targets) {
        if (gaps.has(date) && day() < 0.7) continue;
        const roll = day();
        const state = !markStates.length ? null : roll < 0.15 && markStates.includes("skipped") ? "skipped" : roll < 0.27 && markStates.includes("changed") ? "changed" : markStates.includes("done") ? "done" : markStates[0];
        if (!state) continue;
        const asked = track.fields.filter((f) => ledger.asksField(f, state));
        const ctx = { rnd: day, date, base: baseOf(track), links: linksFor({ trackOf: ledger.trackOf, itemsOf: ledger.itemsOf }, store.state(), day) };
        const { values } = valuesFor(asked, ctx, { always: state === "changed" });
        if (write(track.key, date, `отметка «${state}»`, () => markOps(store.state(), track.key, { ...target, date, state, values, today: TODAY }))) { report.marks += 1; t.marks += 1; }
      }
    }
  }
  report.empty = report.records + report.marks + report.examples.length === 0;
  return { serialized: storage.dump(), report };
}

// A few lines for the judge packet and for the console.
export function seedLines(report) {
  if (!report) return [];
  const out = [];
  const tracks = Object.entries(report.tracks).filter(([, t]) => t.records + t.marks + t.refused > 0);
  out.push(`За ${report.days} прошлых дней (${report.from} … ${report.to}) лаборатория внесла от имени человека ${report.records} записей и ${report.marks} отметок через те же действия, что и кнопки приложения; часть дней оставлена без данных, часть отметок пропущена.`);
  for (const [key, t] of tracks) out.push(`- ${key}: записей ${t.records}, отметок ${t.marks}${t.refused ? `, отказов ${t.refused}` : ""}; элементы ввода на экранах: ${t.inputs.length ? t.inputs.join(", ") : "нет"}.`);
  for (const [key, t] of Object.entries(report.tracks)) {
    if (report.examples.includes(key) && !t.inputs.includes("add")) out.push(`ВНИМАНИЕ: у трекера ${key} нет ни одного элемента с add (список с add или marks с add): человек сам не мог завести строки, их добавила лаборатория.`);
    if (t.records + t.marks > 0 && !t.inputs.length) out.push(`ВНИМАНИЕ: у трекера ${key} на экранах нет ни quick, ни form, ни marks: данные внесены лабораторией, человек так внести их не мог.`);
  }
  const examples = Object.entries(report.examples.reduce((acc, key) => ({ ...acc, [key]: (acc[key] || 0) + 1 }), {}));
  if (examples.length) out.push(`Пустые списки и справочники лаборатория заполнила примерными строками «<название>: пример N», как будто человек добавил их кнопкой «Добавить»: ${examples.map(([key, n]) => `${key} (${n})`).join(", ")}.`);
  if (report.backdated.length) out.push(`Позиции, начатые сегодня, в этой копии датированы ${report.days} днями раньше (${report.backdated.slice(0, 4).join(", ")}${report.backdated.length > 4 ? `, … всего ${report.backdated.length}` : ""}): иначе за прошлые дни нечего было бы отмечать.`);
  const groups = new Map();
  for (const r of report.refused) groups.set(`${r.track}: ${r.message}`, (groups.get(`${r.track}: ${r.message}`) || 0) + 1);
  if (groups.size) {
    out.push(`ОТКАЗЫ ВВОДА (${report.refused.length}): приложение не приняло то, что принял бы человек. Это дефект ответа, данные в этих местах не появились:`);
    for (const [message, n] of [...groups].slice(0, 6)) out.push(`- ${message}${n > 1 ? ` (раз: ${n})` : ""}`);
  }
  if (report.empty) out.push("Ни одной записи внести не удалось: экраны ниже показаны почти без данных, и это не вина лаборатории.");
  return out;
}
