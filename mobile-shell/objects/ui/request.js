// A Запрос: its items as a checklist. Tapping an item asks how much was
// bought and for how much, and writes a Покупка.
import { markBoughtOps, requestFromPlanOps } from "../core/domain.js";
import { backlinks, valueOf } from "../core/values.js";
import { act, ctx, go, hrefFor, nameOf, store } from "./runtime.js";
import { dayShort, empty, field, fill, h, icon, num, openSheet, pageHeader, progressBar, segmented, shiftDate, toast } from "./dom.js";
import { parseNumber, pickObject } from "./editors.js";

export function requestScreen(id) {
  const state = store.state();
  const req = state.objects[id];
  if (!req) return [pageHeader({ title: "Запрос", back: true }), empty("Такого запроса нет")];
  const c = ctx();
  const items = (req.props?.items || []).map((x) => state.objects[x]).filter((x) => x && !x.archivedAt);
  const bought = items.filter((it) => valueOf(state, it, "isBought", c)).length;
  const spent = valueOf(state, req, "total", c) || 0;
  const purchases = backlinks(state, "purchase", "request", id).map((x) => state.objects[x]).filter(Boolean)
    .sort((a, b) => String(b.props?.date || "").localeCompare(String(a.props?.date || "")));
  const done = req.props?.status === "done";
  const name = h("input", { class: "title-input", type: "text", value: req.name, "aria-label": "Название запроса", onchange: (e) => act({ op: "update", id, name: e.target.value.trim() }, { summary: `Запрос «${e.target.value.trim()}»` }) });

  return [
    pageHeader({ title: "Запрос", back: true }),
    h("section", { class: "hero" }, h("span", { class: "hero-icon", "aria-hidden": "true", text: "🛒" }), name),
    h("section", { class: "card totals-card" },
      h("p", { class: "metric-line" }, h("span", { class: "metric-value", text: `${bought} из ${items.length}` }), h("span", { class: "metric-of", text: "куплено" })),
      progressBar(bought, items.length),
      h("p", { class: "macros", text: `Потрачено ${num(spent)} ₽${done ? " · запрос закрыт" : ""}` }),
    ),
    h("section", { class: "block" },
      h("h2", { class: "section-title", text: "Позиции" }),
      items.length ? h("div", { class: "card list" }, items.map((it) => itemRow(state, req, it, c))) : empty("В запросе пока нет позиций"),
      h("button", { class: "btn btn-quiet btn-block", onclick: () => addItem(req) }, "+ Позиция"),
    ),
    purchases.length ? h("section", { class: "block" },
      h("h2", { class: "section-title", text: "Покупки" }),
      h("div", { class: "card list" }, purchases.map((p) => {
        const planned = state.objects[p.props?.item]?.props?.product;
        const other = p.props?.product && planned && p.props.product !== planned ? state.objects[p.props.product] : null;
        return h("a", { class: "row", href: hrefFor(p) },
          h("span", { class: "row-icon", text: "🧾" }),
          h("span", { class: "row-main" }, h("span", { class: "row-title", text: other ? nameOf(other) : nameOf(p) }), h("span", { class: "row-sub", text: [p.props?.date ? dayShort(p.props.date) : "", p.props?.quantity != null ? `${num(p.props.quantity)} ${state.objects[p.props.item]?.props?.unit || ""}`.trim() : "", other ? `вместо «${nameOf(state.objects[planned])}»` : ""].filter(Boolean).join(" · ") })),
          h("span", { class: "row-count", text: `${num(p.props?.price)} ₽` }),
        );
      })),
    ) : null,
    h("button", { class: "btn btn-quiet btn-block", onclick: () => act({ op: "update", id, props: { status: done ? "open" : "done" } }, { summary: done ? "Запрос снова открыт" : "Запрос закрыт" }) }, done ? "Открыть снова" : "Закрыть запрос"),
    h("button", { class: "btn btn-quiet btn-block", onclick: requestFromPlanSheet }, "Запрос из плана"),
  ];
}

function itemRow(state, req, it, c) {
  const product = state.objects[it.props?.product];
  const title = nameOf(product) || nameOf(it);
  const quantity = it.props?.quantity ?? 0;
  const got = valueOf(state, it, "bought", c) || 0;
  const all = Boolean(valueOf(state, it, "isBought", c));
  const unit = it.props?.unit || "";
  return h("button", { class: "row row-btn", "data-item": title, onclick: () => buySheet(it, title, Math.max(0, quantity - got), unit) },
    h("span", { class: `check${all ? " is-on" : ""}`, role: "img", "aria-label": all ? "куплено" : "не куплено" }, all ? icon("check", 20) : null),
    h("span", { class: "row-main" },
      h("span", { class: `row-title${all ? " is-done" : ""}`, text: title }),
      h("span", { class: "row-sub", text: got && !all ? `куплено ${num(got)} из ${num(quantity)} ${unit}` : `${num(quantity)} ${unit}` }),
    ),
  );
}

function buySheet(item, title, left, unit) {
  openSheet(`Купил: ${title}`, (close) => {
    const quantity = h("input", { class: "input", type: "text", inputmode: "decimal", value: String(left || 1), "aria-label": "Сколько купили" });
    const price = h("input", { class: "input", type: "text", inputmode: "decimal", placeholder: "0", "aria-label": "Сумма" });
    // «Купил другое»: the purchase is recorded for another product and still
    // counts toward this item.
    let other = null;
    const otherLine = h("div", { class: "form" });
    const paintOther = () => fill(otherLine, other
      ? h("div", { class: "chips" },
        h("span", { class: "fchip" }, h("span", { class: "fchip-text", text: `Вместо этого: ${nameOf(other)}` }), h("button", { class: "fchip-x", "aria-label": "Вернуть план", onclick: () => { other = null; paintOther(); } }, icon("close", 18))),
      )
      : h("button", { class: "btn btn-quiet", onclick: () => pickObject({ title: "Что купили вместо", types: ["product"], exclude: [item.props?.product].filter(Boolean), onPick: (id) => { other = store.state().objects[id]; paintOther(); } }) }, "Купил другое"));
    paintOther();
    const submit = () => {
      const q = parseNumber(quantity.value.trim());
      const p = parseNumber(price.value.trim());
      if (!(q > 0)) { toast("Сколько купили: нужно число больше нуля", { error: true }); return; }
      if (p === undefined) { toast("Сумма: нужно число", { error: true }); return; }
      const ops = markBoughtOps(store.state(), item.id, { quantity: q, price: p ?? 0, date: store.today(), ...(other ? { product: other.id } : {}) });
      if (act(ops, { summary: other ? `Куплено «${nameOf(other)}» вместо «${title}»` : `Куплено «${title}»` }).ok) close();
    };
    return h("div", { class: "form" },
      h("div", { class: "row-fields" },
        field("Сколько", h("div", { class: "with-unit" }, quantity, h("span", { class: "unit", text: unit }))),
        field("Сумма", h("div", { class: "with-unit" }, price, h("span", { class: "unit", text: "₽" }))),
      ),
      otherLine,
      h("button", { class: "btn btn-primary", onclick: submit }, "Купил"),
    );
  });
}

// A Запрос from the plan of some days. The default is the next 7 days from
// today; the person can narrow it or move it. The sheet says how many
// products it found before anything is written.
export function requestFromPlanSheet() {
  openSheet("Запрос из плана", (close) => {
    const today = store.today();
    const range = { from: today, to: shiftDate(today, 6) };
    const body = h("div", { class: "form" });
    const days = () => {
      const out = [];
      for (let d = range.from; d <= range.to && out.length < 62; d = shiftDate(d, 1)) out.push(d);
      return out;
    };
    const build = () => {
      const dates = days();
      let ops = null;
      let problem = "";
      if (!dates.length || dates.length > 31) problem = "Выберите от 1 до 31 дня";
      else {
        try { ops = requestFromPlanOps(store.state(), { dates, name: dates.length > 1 ? `Запрос на ${dayShort(dates[0])} – ${dayShort(dates.at(-1))}` : `Запрос на ${dayShort(dates[0])}`, today }); } catch (error) { problem = error.message; }
      }
      const presets = [{ id: 1, name: "Сегодня" }, { id: 3, name: "3 дня" }, { id: 7, name: "7 дней" }, { id: 14, name: "14 дней" }];
      const current = range.from === today ? presets.find((x) => shiftDate(today, x.id - 1) === range.to)?.id : null;
      const dateInput = (label, key) => h("input", { class: "input", type: "date", "aria-label": label, value: range[key], onchange: (event) => { if (event.target.value) range[key] = event.target.value; build(); } });
      fill(body,
        h("div", { class: "field" }, h("span", { class: "field-label", text: "Дни" }), segmented(presets, current, (n) => { range.from = today; range.to = shiftDate(today, n - 1); build(); }, { label: "Дни" })),
        h("div", { class: "row-fields row-dates" }, field("С", dateInput("С", "from")), field("По", dateInput("По", "to"))),
        h("p", { class: problem ? "profile-status is-error" : "hint", role: "status", text: problem || `Продуктов по плану: ${ops.length - 1}. Количество округлится до упаковок.` }),
        h("button", { class: "btn btn-primary", disabled: !ops, onclick: () => { if (act(ops, { summary: ops[0].name }).ok) { close(); go(`#/request/${encodeURIComponent(ops[0].id)}`); } } }, "Создать запрос"),
      );
    };
    build();
    return body;
  });
}

function addItem(req) {
  const state = store.state();
  const taken = (req.props?.items || []).map((x) => state.objects[x]?.props?.product).filter(Boolean);
  pickObject({ title: "Продукт", types: ["product"], exclude: taken, onPick: (productId) => {
    const s = store.state();
    const product = s.objects[productId];
    const id = store.newId("request_item");
    act([
      { op: "create", type: "request_item", id, name: nameOf(product), props: { request: req.id, product: productId, quantity: 1, unit: "шт." } },
      { op: "update", id: req.id, props: { items: [...(s.objects[req.id].props?.items || []), id] } },
    ], { summary: `«${nameOf(product)}» в запросе` });
  } });
}
