// Рацион and Спорт of one date: the plan with its marks, discrepancies and
// totals, and editing the plan of that date. The home widgets reuse the
// same bodies in a compact form.
import { dayActual, discrepancyOps, editableDayOps, markFor, markMealOps, markSessionOps, measureOf, planDay, sportDay } from "../core/domain.js";
import { profileOf } from "../core/values.js";
import { act, hrefFor, local, nameOf, rerender, store } from "./runtime.js";
import { fill, empty, field, h, icon, num, openSheet, pageHeader, progressBar, relativeDay, segmented, shiftDate, toast } from "./dom.js";
import { parseNumber, pickObject } from "./editors.js";
import { followControls } from "../kit/screen.js";

const MEAL_CONTROL = [{ id: "eaten", name: "съедено", color: "green" }, { id: "changed", name: "изменено", color: "amber" }, { id: "skipped", name: "не съедено", color: "red" }];
const SESSION_CONTROL = [{ id: "done", name: "выполнено", color: "green" }, { id: "changed", name: "изменено", color: "amber" }, { id: "skipped", name: "пропущено", color: "red" }];

const optionName = (state, rel, id) => state.relations[rel]?.options?.find((o) => o.id === id)?.name || id || "";

function dateNav(route, date, today) {
  return h("nav", { class: "date-nav", "aria-label": "Дата" },
    h("a", { class: "icon-btn", href: `#/${route}/${shiftDate(date, -1)}`, "aria-label": "Предыдущий день" }, icon("back")),
    h("span", { class: "date-nav-title", text: relativeDay(date, today) }),
    h("a", { class: "icon-btn", href: `#/${route}/${shiftDate(date, 1)}`, "aria-label": "Следующий день" }, icon("next")),
  );
}

function macro(label, value, target) {
  return h("span", { class: "macro" }, h("b", { text: num(value) }), target ? ` / ${num(target)}` : "", ` г ${label}`);
}

export function rationDayBody(state, date, c, { compact = false, editing = false } = {}) {
  const plan = planDay(state, "ration", date);
  const actual = dayActual(state, date, c);
  const profile = profileOf(state)?.props || {};
  const target = profile.targetCalories || actual.planned.kcal;
  const byMeal = new Map(actual.meals.map((m) => [m.mealId, m]));
  const future = date > c.today;
  const totals = future ? h("p", { class: "metric-line" }, h("span", { class: "metric-value metric-small", text: num(actual.planned.kcal) }), h("span", { class: "metric-of", text: `ккал по плану, цель ${num(target)}` })) : h("div", { class: `totals-card${compact ? "" : " card"}` },
    h("p", { class: "metric-line" }, h("span", { class: "metric-value", text: num(actual.eaten.kcal) }), h("span", { class: "metric-of", text: `из ${num(target)} ккал съедено` })),
    progressBar(actual.eaten.kcal, target),
    h("p", { class: "macros" }, macro("белка", actual.eaten.protein, profile.targetProtein), macro("жиров", actual.eaten.fat, profile.targetFat), macro("углев.", actual.eaten.carbs, profile.targetCarbs)),
  );
  if (!plan.items.length) return [totals, empty(compact ? "На сегодня в Рационе ничего нет" : "На этот день в Рационе ничего нет")];
  return [totals, h("div", { class: "meals" }, plan.items.map((mealId) => mealCard(state, date, mealId, byMeal.get(mealId), { compact, editing, future })))];
}

function mealCard(state, date, mealId, mark, { compact, editing, future }) {
  const meal = state.objects[mealId];
  if (!meal) return null;
  const mealState = mark?.state || "unmarked";
  const portions = (meal.props?.items || []).map((id) => state.objects[id]).filter(Boolean);
  const productName = (p) => nameOf(state.objects[p.props?.product]) || nameOf(p);
  const kcal = mark?.planned?.kcal ?? 0;
  const head = h("div", { class: "meal-head" },
    editing
      ? h("input", { class: "input input-time", type: "time", value: meal.props?.time || "", "aria-label": `Время: ${nameOf(meal)}`, onchange: (e) => act({ op: "update", id: mealId, props: { time: e.target.value || null } }, { summary: `${nameOf(meal)}: время` }) })
      : h("span", { class: "meal-time", text: meal.props?.time || "" }),
    h("a", { class: "meal-name", href: hrefFor(meal) }, nameOf(meal)),
    h("span", { class: "meal-kcal", text: `${num(kcal)} ккал` }),
  );
  const items = compact
    ? h("p", { class: "meal-products", text: portions.map(productName).join(", ") || "без продуктов" })
    : h("ul", { class: "portions" }, portions.map((p) => h("li", { class: "portion" },
      h("span", { class: "portion-name", text: productName(p) }),
      editing
        ? h("span", { class: "with-unit portion-amount" },
          h("input", { class: "input input-amount", type: "text", inputmode: "decimal", value: p.props?.amount ?? "", "aria-label": `Количество: ${productName(p)}`, onchange: (e) => {
            const amount = parseNumber(e.target.value.trim());
            if (amount == null || amount === undefined) { toast("Нужно число", { error: true }); return; }
            act({ op: "update", id: p.id, props: { amount } }, { summary: `${productName(p)}: ${amount} ${p.props?.unit || ""}` });
          } }),
          h("span", { class: "unit", text: p.props?.unit || "" }),
          h("button", { class: "icon-btn", "aria-label": `Убрать «${productName(p)}»`, onclick: () => act({ op: "update", id: mealId, props: { items: meal.props.items.filter((x) => x !== p.id) } }, { summary: `Убрано «${productName(p)}»` }) }, icon("close", 20)),
        )
        : h("span", { class: "portion-amount", text: `${num(p.props?.amount)} ${p.props?.unit || ""}` }),
    )));
  const discrepancies = (mark?.discrepancies || []).map((id) => state.objects[id]).filter(Boolean);
  const follow = compact || editing || future ? null : followControls(store, "ration", date, mark?.slot ?? meal.props?.slot ?? meal.id, mealState);
  return h("article", { class: `meal state-${mealState}`, "data-meal": nameOf(meal) },
    head,
    items,
    discrepancies.length ? h("ul", { class: "discrepancies" }, discrepancies.map((d) => h("li", { text: discrepancyText(state, d) }))) : null,
    editing
      ? h("button", { class: "chip chip-add", onclick: () => addPortion(meal) }, "+ Продукт")
      : future ? null : h("div", { class: "meal-controls" },
        segmented(MEAL_CONTROL, mealState, (next) => {
          const ops = markMealOps(store.state(), date, mealId, next || "unmarked");
          act(ops, { summary: `${nameOf(meal)}: ${next ? MEAL_CONTROL.find((o) => o.id === next).name : "не отмечено"}` });
        }, { label: `Как прошёл приём «${nameOf(meal)}»`, allowClear: true }),
        compact ? null : h("button", { class: "btn btn-quiet btn-small", onclick: () => discrepancySheet(date, meal, portions) }, "Расхождение"),
      ),
    follow,
  );
}

function discrepancyText(state, d) {
  const p = d.props || {};
  const kind = optionName(state, "discrepancyKind", p.discrepancyKind);
  const product = nameOf(state.objects[p.product]);
  const by = p.replacedBy ? ` → ${nameOf(state.objects[p.replacedBy])}` : "";
  const amount = p.amount != null ? `, ${num(p.amount)} ${p.unit || ""}` : "";
  return `${kind}: ${product}${by}${amount}`.trim();
}

function addPortion(meal) {
  pickObject({ title: "Продукт", types: ["product"], onPick: (productId) => {
    const state = store.state();
    const product = state.objects[productId];
    const id = store.newId("portion");
    act([
      { op: "create", type: "portion", id, name: nameOf(product), props: { product: productId, amount: 100, unit: product.props?.unit || "г" } },
      { op: "update", id: meal.id, props: { items: [...(state.objects[meal.id].props?.items || []), id] } },
    ], { summary: `«${nameOf(product)}» в «${nameOf(meal)}»` });
  } });
}

function discrepancySheet(date, meal, portions) {
  openSheet(`Расхождение: ${nameOf(meal)}`, (close) => {
    const state = store.state();
    const d = { kind: "replaced", product: portions[0]?.props?.product || null, replacedBy: null, amount: "" };
    const body = h("div", { class: "form" });
    const kinds = state.relations.discrepancyKind.options;
    // The unit follows the product: the portion's own for a product of the meal,
    // the default of its kind for one added from outside.
    const unitOf = () => {
      const portion = portions.find((p) => p.props?.product === d.product);
      return d.kind === "added" || !portion ? measureOf(state.objects[d.product]).unit : portion.props?.unit || "г";
    };
    const pickKind = (id) => {
      // «Добавлено» starts with no product: it is one outside the meal.
      if ((id === "added") !== (d.kind === "added")) d.product = id === "added" ? null : portions[0]?.props?.product || null;
      d.kind = id;
      build();
    };
    const pickButton = (key, title, types) => h("button", { class: "chip chip-add", onclick: () => pickObject({ title, types, onPick: (id) => { d[key] = id; build(); } }) }, d[key] ? nameOf(state.objects[d[key]]) : "Выбрать");
    const build = () => {
      const amount = h("input", { class: "input", type: "text", inputmode: "decimal", value: d.amount, "aria-label": "Количество", oninput: (e) => { d.amount = e.target.value; } });
      fill(body,
        h("div", { class: "field" }, h("span", { class: "field-label", text: "Что изменилось" }), segmented(kinds, d.kind, pickKind, { label: "Что изменилось" })),
        h("div", { class: "field" }, h("span", { class: "field-label", text: d.kind === "added" ? "Что добавили" : "Продукт" }),
          d.kind === "added" ? pickButton("product", "Продукт", ["product"]) : segmented(portions.map((p) => ({ id: p.props?.product, name: nameOf(state.objects[p.props?.product]) || nameOf(p) })), d.product, (id) => { d.product = id; build(); }, { label: "Продукт" })),
        d.kind === "replaced" ? h("div", { class: "field" }, h("span", { class: "field-label", text: "Чем заменили" }), pickButton("replacedBy", "Чем заменили", ["product"])) : null,
        d.kind === "excluded" ? null : field("Сколько", h("div", { class: "with-unit" }, amount, h("span", { class: "unit", text: unitOf() }))),
        h("button", { class: "btn btn-primary", onclick: () => {
          if (!d.product) { toast("Выберите продукт", { error: true }); return; }
          if (d.kind === "replaced" && !d.replacedBy) { toast("Выберите, чем заменили", { error: true }); return; }
          const value = parseNumber(String(d.amount).trim());
          if (value === undefined) { toast("Количество: нужно число", { error: true }); return; }
          const ops = discrepancyOps(store.state(), date, meal.id, { kind: d.kind, product: d.product, replacedBy: d.replacedBy, amount: value, unit: unitOf() });
          if (act(ops, { summary: `${nameOf(meal)}: расхождение` }).ok) close();
        } }, "Записать"),
      );
    };
    build();
    return body;
  });
}

export function rationScreen(date) {
  const state = store.state();
  const today = store.today();
  const c = { today };
  const mode = local(`ration:${date}`, () => ({ editing: false }));
  const plan = planDay(state, "ration", date);
  // Editing belongs to an Особый день: when undo takes it away, the cycle day is locked again.
  if (plan.source !== "special") mode.editing = false;
  const startEdit = () => {
    if (plan.source !== "special") {
      const { ops } = editableDayOps(store.state(), "ration", date);
      if (!act(ops, { summary: `Особый день ${date}` }).ok) return;
    }
    mode.editing = true;
    rerender();
  };
  const addMeal = () => {
    const s = store.state();
    const day = s.objects[planDay(s, "ration", date).dayId];
    const id = store.newId("meal");
    act([
      { op: "create", type: "meal", id, name: "Перекус", props: { time: "12:00", items: [], slot: id } },
      { op: "update", id: day.id, props: { meals: [...(day.props?.meals || []), id] } },
    ], { summary: "Новый приём пищи" });
  };
  return [
    pageHeader({ title: "Рацион", back: true }),
    dateNav("ration", date, today),
    rationDayBody(state, date, c, { editing: mode.editing }),
    date < today ? null : h("div", { class: "actions" },
      mode.editing
        ? [plan.dayId ? h("button", { class: "btn btn-quiet", onclick: addMeal }, "+ Приём пищи") : null, h("button", { class: "btn btn-primary", onclick: () => { mode.editing = false; rerender(); } }, "Готово")]
        : h("button", { class: "btn btn-quiet", onclick: startEdit }, plan.source === "special" ? "Изменить план дня" : "Изменить план этого дня"),
    ),
    plan.source === "special" && !mode.editing ? h("p", { class: "hint", text: "У этого дня свой план, он не меняет остальные дни." }) : null,
  ];
}

// Minutes of a sport day; sportDay counts energy, the person thinks in time.
function sportMinutes(state, date, day) {
  let planned = 0;
  let actual = 0;
  for (const s of day.sessions) {
    const duration = Number(state.objects[s.sessionId]?.props?.duration) || 0;
    planned += duration;
    if (s.state === "done" || s.state === "changed") actual += Number(markFor(state, "sport", date, s.slot)?.props?.actualDuration) || duration;
  }
  for (const id of day.activities) actual += Number(state.objects[id]?.props?.duration) || 0;
  return { planned, actual };
}

export function sportDayBody(state, date, c, { compact = false } = {}) {
  const day = sportDay(state, date, c);
  const minutes = sportMinutes(state, date, day);
  const future = date > c.today;
  const header = h("p", { class: "metric-line" },
    h("span", { class: "metric-value metric-small", text: num(minutes.actual) }),
    h("span", { class: "metric-of", text: [`из ${num(minutes.planned)} мин`, day.actual != null ? `${num(day.actual)} из ${num(day.planned)} ккал` : ""].filter(Boolean).join(" · ") }),
  );
  if (!day.sessions.length && !day.activities.length) return [header, empty(compact ? "Сегодня тренировок нет" : "Тренировок нет")];
  return [
    header,
    h("div", { class: "meals" }, day.sessions.map((s) => sessionCard(state, date, s, { future, compact }))),
    day.activities.length ? h("div", { class: "list" }, day.activities.map((id) => state.objects[id]).filter(Boolean).map((a) => h("a", { class: "row", href: hrefFor(a) },
      h("span", { class: "row-icon", text: "⚡" }),
      h("span", { class: "row-main" }, h("span", { class: "row-title", text: nameOf(a) }), h("span", { class: "row-sub", text: [a.props?.time, a.props?.duration ? `${a.props.duration} мин` : "", optionName(state, "intensity", a.props?.intensity)].filter(Boolean).join(" · ") })),
    ))) : null,
  ];
}

function sessionCard(state, date, s, { future, compact }) {
  const session = state.objects[s.sessionId];
  if (!session) return null;
  const p = session.props || {};
  const title = nameOf(session) || optionName(state, "kind", p.kind);
  const follow = compact || future ? null : followControls(store, "sport", date, s.slot, s.state || "unmarked");
  return h("article", { class: `meal state-${s.state || "unmarked"}`, "data-session": title },
    h("div", { class: "meal-head" },
      h("span", { class: "meal-time", text: p.time || "" }),
      h("a", { class: "meal-name", href: hrefFor(session) }, title),
      h("span", { class: "meal-kcal", text: `${num(p.duration)} мин` }),
    ),
    h("p", { class: "meal-products", text: [title === optionName(state, "kind", p.kind) ? "" : optionName(state, "kind", p.kind), optionName(state, "intensity", p.intensity), changedMinutes(state, date, s)].filter(Boolean).join(" · ") }),
    future ? null : h("div", { class: "meal-controls" }, segmented(SESSION_CONTROL, s.state || "unmarked", (next) => {
      if (next === "changed") { changedSessionSheet(date, session); return; }
      act(markSessionOps(store.state(), date, session.id, next || "unmarked"), { summary: `${title}: ${next ? SESSION_CONTROL.find((o) => o.id === next).name : "не отмечено"}` });
    }, { label: `Как прошла тренировка «${title}»`, allowClear: true })),
    follow,
  );
}

function changedMinutes(state, date, s) {
  const mark = s.state === "changed" ? markFor(state, "sport", date, s.slot) : null;
  return mark?.props?.actualDuration ? `фактически ${num(mark.props.actualDuration)} мин` : "";
}

function changedSessionSheet(date, session) {
  openSheet(`Как прошло: ${nameOf(session)}`, (close) => {
    const state = store.state();
    const d = { minutes: String(session.props?.duration ?? ""), intensity: session.props?.intensity || "medium" };
    const minutes = h("input", { class: "input", type: "text", inputmode: "numeric", value: d.minutes, "aria-label": "Минут фактически", oninput: (e) => { d.minutes = e.target.value; } });
    const body = h("div", { class: "form" });
    const build = () => fill(body,
      field("Минут фактически", h("div", { class: "with-unit" }, minutes, h("span", { class: "unit", text: "мин" }))),
      h("div", { class: "field" }, h("span", { class: "field-label", text: "Интенсивность" }), segmented(state.relations.intensity.options, d.intensity, (id) => { d.intensity = id; build(); }, { label: "Интенсивность" })),
      h("button", { class: "btn btn-primary", onclick: () => {
        const value = parseNumber(d.minutes.trim());
        if (!(value > 0)) { toast("Сколько минут: нужно число", { error: true }); return; }
        const ops = markSessionOps(store.state(), date, session.id, "changed", { actualDuration: value, actualIntensity: d.intensity });
        if (act(ops, { summary: `${nameOf(session)}: изменено` }).ok) close();
      } }, "Записать"),
    );
    build();
    return body;
  });
}

function activitySheet(date) {
  openSheet("Активность вне плана", (close) => {
    const state = store.state();
    const d = { kind: "walk", minutes: "30", intensity: "medium", time: "" };
    const minutes = h("input", { class: "input", type: "text", inputmode: "numeric", value: d.minutes, "aria-label": "Минут", oninput: (e) => { d.minutes = e.target.value; } });
    const time = h("input", { class: "input", type: "time", value: d.time, "aria-label": "Время", oninput: (e) => { d.time = e.target.value; } });
    const body = h("div", { class: "form" });
    const build = () => fill(body,
      h("div", { class: "field" }, h("span", { class: "field-label", text: "Вид" }), segmented(state.relations.kind.options, d.kind, (id) => { d.kind = id; build(); }, { label: "Вид" })),
      h("div", { class: "row-fields" }, field("Минут", minutes), field("Время", time)),
      h("div", { class: "field" }, h("span", { class: "field-label", text: "Интенсивность" }), segmented(state.relations.intensity.options, d.intensity, (id) => { d.intensity = id; build(); }, { label: "Интенсивность" })),
      h("button", { class: "btn btn-primary", onclick: () => {
        const value = parseNumber(d.minutes.trim());
        if (!(value > 0)) { toast("Сколько минут: нужно число", { error: true }); return; }
        const name = optionName(state, "kind", d.kind);
        if (act({ op: "create", type: "activity", name, props: { date, kind: d.kind, duration: value, intensity: d.intensity, ...(d.time ? { time: d.time } : {}) } }, { summary: `Активность «${name}»` }).ok) close();
      } }, "Записать"),
    );
    build();
    return body;
  });
}

export function sportScreen(date) {
  const state = store.state();
  const today = store.today();
  return [
    pageHeader({ title: "Спорт", back: true }),
    dateNav("sport", date, today),
    h("div", { class: "card day-card" }, sportDayBody(state, date, { today })),
    date > today ? h("p", { class: "hint", text: "Отметить тренировки можно в их день." }) : h("div", { class: "actions" }, h("button", { class: "btn btn-quiet", onclick: () => activitySheet(date) }, "+ Активность")),
  ];
}

