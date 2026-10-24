// From "a model wrote a bundle" to "one undoable store change". `checkBundle`
// is pure plus a scratch store: L0 normalize, L1 validate, defaults, merge,
// lower, then L2, a dry run of the ops as actor "ai" on a copy of the space.
// Nothing is written. `applyBundle` writes the checked ops as the person, in
// one call, so one revert undoes the whole bundle. The model never writes an
// entry (a fact): the ops hold structure only, and the L2 dry run refuses facts.
import { localDateKey, openObjectStore, registerRule } from "../core/store.js";
import { AT, FIELD_TYPES, GOAL_PERS, KINDS, STATE_LABELS } from "./catalogue.js";
import { expandDefaults } from "./defaults.js";
import { lower } from "./lower.js";
import { mergeBundle } from "./merge.js";
import { appSlug, isReplyOnly, normalizeBundle } from "./normalize.js";
import { checkCardMarkup } from "./markup.js";
import { registerKitRules } from "./rules.js";
import { cardsOf, readSpec, same } from "./spec.js";
import { validateBundle } from "./validate.js";

registerKitRules(registerRule);

export const MAX_PROBLEMS = 6;

const ELEMENT_NAMES = {
  stat: "число", meter: "шкала цели", bars: "столбцы", line: "линия", spark: "мини-график", heatmap: "календарь", table: "таблица", list: "список",
  p: "текст", empty: "подсказка", quick: "кнопка записи", form: "форма записи", marks: "отметки", streak: "серия", embed: "блок раздела",
};
const PER = { day: "в день", week: "в неделю", month: "в месяц" };

// -- change rows in the person's words ---------------------------------------------
const fieldLabel = (f) => `${f.name}${f.unit ? `, ${f.unit}` : ""}`;
const goalText = (f) => (f.goal == null ? "" : `${f.goalType === "max" ? "лимит" : "цель"} ${f.goal} ${PER[f.goalPer || "day"] || GOAL_PERS[f.goalPer]}`);
const fieldText = (f) => [`поле «${fieldLabel(f)}»`, goalText(f)].filter(Boolean).join(", ");
const atText = (at) => AT.words[at] || at;
const itemText = (i) => `${i.name}${i.at ? ` (${atText(i.at)})` : ""}`;
const listed = (list, max = 4) => (list.length > max ? `${list.slice(0, max).join(", ")} и ещё ${list.length - max}` : list.join(", "));
const bodyText = (body) => listed((body || []).map((el) => ELEMENT_NAMES[el.el] || el.el), 6);

function fieldChanges(was, now) {
  const out = [];
  if (was.name !== now.name || was.unit !== now.unit) out.push(`название «${fieldLabel(now)}»`);
  if (was.goal !== now.goal || was.goalType !== now.goalType || was.goalPer !== now.goalPer) {
    out.push(now.goal == null ? "цель снята" : `${goalText(now).split(" ")[0]} ${was.goal ?? "нет"} → ${now.goal} ${PER[now.goalPer || "day"]}`);
  }
  if (was.type !== now.type) out.push(`тип ${now.type}`);
  if (was.min !== now.min || was.max !== now.max) out.push(`границы ${now.min ?? "—"}…${now.max ?? "—"}`);
  if (!same(was.options, now.options)) out.push(`варианты: ${(now.options || []).join(", ")}`);
  if (was.calc !== now.calc) out.push(`формула ${now.calc}`);
  if (was.hint !== now.hint) out.push("подсказка");
  return out;
}

function itemChanges(was, now) {
  const out = [];
  if (was.name !== now.name) out.push(`название «${now.name}»`);
  if (was.every !== now.every) out.push(`повтор ${now.every}`);
  if (was.at !== now.at) out.push(`время ${atText(now.at)}`);
  if (was.until !== now.until) out.push(now.until ? `до ${now.until}` : "срок снят");
  if (!same(was.plan, now.plan)) out.push("план");
  return out;
}

export function rowsOf(prev, next, cascades = []) {
  const rows = [];
  const swept = new Set(cascades.filter((c) => c.kind === "card").map((c) => c.key));
  for (const track of Object.values(next.tracks)) {
    if (track.readonly) continue;
    const was = prev.tracks[track.key];
    const kind = KINDS[track.kind];
    if (!was || (was.archived && !track.archived)) {
      const parts = [...track.fields.map(fieldText), ...(track.items.length ? [`пункты: ${listed(track.items.filter((i) => !i.archived).map(itemText))}`] : [])];
      rows.push([was ? "Вернётся трек" : "Трек", track.name, parts.length ? `${track.kind === "log" ? "" : `${kind.name.toLowerCase()}: `}${parts.join("; ")}` : kind.name.toLowerCase()]);
      continue;
    }
    if (track.archived && !was.archived) { rows.push(["Уберётся трек", track.name, was.usage?.entries ? `записи (${was.usage.entries}) останутся` : ""]); continue; }
    const head = [];
    if (was.name !== track.name) head.push(`название «${track.name}»`);
    if (was.icon !== track.icon) head.push(`значок ${track.icon}`);
    if (!same(was.states, track.states) || !same(was.labels, track.labels)) head.push(`кнопки отметки: ${(track.states || []).map((s) => track.labels?.[s] || STATE_LABELS[s]).join(", ")}`);
    for (const key of ["unmarked", "grace", "times", "per"]) if (was[key] !== track[key]) head.push(`${key} ${track[key] ?? "—"}`);
    if (head.length) rows.push(["Изменится трек", track.name, head.join("; ")]);
    for (const field of track.fields) {
      const before = was.fields.find((f) => f.key === field.key);
      if (!before) rows.push(["Новое поле", `${track.name}: ${fieldLabel(field)}`, [FIELD_TYPES[field.type].doc.split(",")[0], goalText(field)].filter(Boolean).join(", ")]);
      else {
        const diff = fieldChanges(before, field);
        if (diff.length) rows.push(["Изменится поле", `${track.name}: ${fieldLabel(field)}`, diff.join("; ")]);
      }
    }
    for (const field of was.fields) if (!track.fields.some((f) => f.key === field.key)) rows.push(["Уберётся поле", `${track.name}: ${fieldLabel(field)}`, "записанные значения останутся"]);
    for (const item of track.items) {
      const before = was.items.find((i) => i.key === item.key);
      if (item.archived && before && !before.archived) rows.push(["Уберётся пункт", `${track.name}: ${item.name}`, ""]);
      else if (!item.archived && (!before || before.archived)) rows.push(["Новый пункт", `${track.name}: ${item.name}`, [item.at && atText(item.at), item.every].filter(Boolean).join(", ")]);
      else if (before && !item.archived) {
        const diff = itemChanges(before, item);
        if (diff.length) rows.push(["Изменится пункт", `${track.name}: ${item.name}`, diff.join("; ")]);
      }
    }
  }
  for (const screen of Object.values(next.screens)) {
    const was = prev.screens[screen.key];
    if (screen.archived && was && !was.archived) rows.push(["Уберётся экран", screen.name, ""]);
    else if (!screen.archived && screen.key !== "home" && (!was || was.archived)) rows.push(["Новый экран", `${screen.icon || ""} ${screen.name}`.trim(), ""]);
    else if (was && !screen.archived && (was.name !== screen.name || was.icon !== screen.icon)) rows.push(["Изменится экран", screen.name, ""]);
  }
  for (const screen of Object.values(next.screens)) {
    const before = cardsOf(prev, screen.key).map((c) => c.key);
    const after = cardsOf(next, screen.key).map((c) => c.key);
    if (!same(before.filter((key) => after.includes(key)), after.filter((key) => before.includes(key)))) rows.push(["Карточки переставятся", screen.name, after.map((key) => next.cards[key].title).join(", ")]);
  }
  for (const card of Object.values(next.cards)) {
    const was = prev.cards[card.key];
    const where = next.screens[card.screen]?.name || card.screen;
    if (card.archived) {
      if (was && !was.archived && !swept.has(card.key)) rows.push(["Уберётся карточка", card.title, `экран «${where}»`]);
    } else if (!was || was.archived) rows.push(["Новая карточка", card.title, `экран «${where}»: ${bodyText(card.body)}`]);
    else if (was.title !== card.title || was.caption !== card.caption || was.size !== card.size || !same(was.body, card.body)) {
      if (!cascades.some((c) => c.kind === "card-part" && c.key === card.key)) rows.push(["Изменится карточка", card.title, `экран «${where}»: ${bodyText(card.body)}`]);
    }
  }
  for (const c of cascades) rows.push([c.kind === "card" ? "Уберётся карточка" : "Изменится карточка", c.title, c.reason]);
  return rows;
}

// -- L3: the markup of each created or changed card -------------------------------
// "c-card[0] > c-stat[1]@fn" names the second element of the card: screens.home.cards.t1.body[1].fn
function markupPath(card, path) {
  const base = `screens.${card.screen}.cards.${card.key}`;
  const last = String(path).split(" > ").at(-1);
  const at = /\[(\d+)\](?:@(.+))?$/.exec(last);
  if (!at || last.startsWith("c-card")) return base;
  return `${base}.body[${at[1]}]${at[2] ? `.${at[2]}` : ""}`;
}

const cardChanged = (was, card) => !was || was.archived || !same(
  { title: was.title, caption: was.caption, size: was.size, body: was.body },
  { title: card.title, caption: card.caption, size: card.size, body: card.body },
);

function markupProblems(prev, next) {
  const out = [];
  for (const card of Object.values(next.cards)) {
    if (card.archived || !cardChanged(prev.cards[card.key], card)) continue;
    for (const p of checkCardMarkup({ title: card.title, caption: card.caption, body: card.body }).problems) out.push({ ...p, path: markupPath(card, p.path) });
  }
  return out;
}

// -- the check -----------------------------------------------------------------------
export function checkBundle(raw, state, ctx = {}) {
  const today = ctx.today || localDateKey();
  const spec = readSpec(state);
  const stop = (layer, problems, changes) => ({ ok: false, layer, problems: problems.slice(0, MAX_PROBLEMS), changes, ops: [], rows: [], cascades: [], spec });

  const normalized = normalizeBundle(raw, { spec });
  if (!normalized.bundle) return stop("L0", normalized.problems, normalized.changes);
  const { changes } = normalized;
  const problems = validateBundle(normalized.bundle, spec, { ...ctx, today });
  if (problems.length) return stop("L1", problems, changes);

  // A refusal or a question: nothing to build, and the reply has passed the number rule.
  if (isReplyOnly(normalized.bundle)) {
    return { ok: true, layer: null, problems: [], changes, ops: [], rows: [], cascades: [], spec, name: "", reply: normalized.bundle.reply, summary: "", warnings: [], noop: true };
  }

  const bundle = expandDefaults(spec, normalized.bundle, { today });
  const own = validateBundle(bundle, spec, { ...ctx, today });
  if (own.length) return stop("L1", own.map((p) => ({ ...p, message: `Выбор по умолчанию не сработал: ${p.message} Задайте это явно.` })), changes);

  const { spec: next, cascades } = mergeBundle(spec, bundle, { today, app: ctx.app || appSlug(bundle.name) });
  const ops = lower(spec, next, { today });

  const scratch = openObjectStore({ storage: null, today: () => today });
  scratch.replaceAll(state);
  const run = scratch.apply(ops, { actor: "ai", summary: bundle.name });
  if (!run.ok) return stop("L2", (run.problems || [run.reason]).map((message) => ({ path: "", rule: "store", message: String(message) })), changes);

  const markup = markupProblems(spec, next);
  if (markup.length) return stop("L3", markup, changes);

  return {
    ok: true, layer: null, problems: [], changes, ops, rows: rowsOf(spec, next, cascades), cascades, spec: next,
    name: bundle.name, reply: normalized.bundle.reply || "", summary: bundle.name, warnings: run.warnings || [], noop: ops.length === 0,
  };
}

// One call, one change set, as the person: revert undoes all of it.
export function applyBundle(store, checked, { summary } = {}) {
  if (!checked?.ok) return { ok: false, reason: "Пакет не прошёл проверку, применять нечего" };
  if (!checked.ops.length) return { ok: true, changeSetId: null, noop: true };
  return store.apply(checked.ops, { actor: "human", summary: String(summary || checked.summary || "Изменение приложения").slice(0, 200) });
}
