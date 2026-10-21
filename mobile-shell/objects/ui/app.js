// Entry of objects.html: routes, the bottom navigation, the first run and
// the render loop over the one store.
import { ensureHome, store } from "./runtime.js";
import { fill, h, icon, openSheet, toast } from "./dom.js";
import { homeScreen } from "./home.js";
import { createSheet, libraryScreen, newTypeScreen, searchScreen } from "./library.js";
import { setScreen } from "./setview.js";
import { objectScreen } from "./object.js";
import { rationScreen, sportScreen } from "./day.js";
import { requestScreen } from "./request.js";
import { profileScreen } from "./profile.js";
import { assistantScreen } from "./assistant.js";

const LEGACY_KEY = "cookish.android.data.v1";
// A calendar date: 2026-13-45 has the shape but is not a day.
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

const ROUTES = {
  "": { tab: "home", render: homeScreen },
  library: { tab: "library", render: libraryScreen },
  search: { tab: "search", render: searchScreen },
  "new-type": { tab: "library", render: newTypeScreen },
  type: { tab: "library", render: (arg) => setScreen("type", arg) },
  set: { tab: "library", render: (arg) => setScreen("set", arg) },
  object: { tab: null, render: objectScreen },
  request: { tab: null, render: requestScreen },
  profile: { tab: null, render: profileScreen },
  assistant: { tab: "assistant", render: assistantScreen },
  ration: { tab: "home", render: (arg) => rationScreen(isDate(arg) ? arg : store.today()) },
  sport: { tab: "home", render: (arg) => sportScreen(isDate(arg) ? arg : store.today()) },
};

// A route that does not parse (a broken % escape, an unknown name) is home.
function parseRoute() {
  const [name = "", ...rest] = location.hash.replace(/^#\/?/, "").split("/");
  try {
    return { name: Object.hasOwn(ROUTES, name) ? name : "", arg: decodeURIComponent(rest.join("/")) };
  } catch {
    return { name: "", arg: "" };
  }
}

const screen = document.getElementById("screen");
const nav = document.getElementById("nav");
const scrolls = new Map();
let shownRoute = null;

function render() {
  const state = store.state();
  const route = parseRoute();
  const key = `${route.name}/${route.arg}`;
  if (shownRoute && shownRoute !== key) scrolls.set(shownRoute, window.scrollY);
  const first = !Object.keys(state.objects).length;
  fill(screen, first ? firstRun() : screenOf(route));
  nav.hidden = first;
  if (!first) renderNav(ROUTES[route.name].tab);
  if (shownRoute !== key) window.scrollTo(0, scrolls.get(key) || 0);
  shownRoute = key;
}

// One screen that throws must not leave the page blank.
function screenOf(route) {
  try {
    return ROUTES[route.name].render(route.arg);
  } catch (error) {
    console.error(error);
    return [h("p", { class: "empty", text: "Этот экран не открылся" }), h("a", { class: "btn btn-quiet", href: "#/" }, "На главную")];
  }
}

function renderNav(tab) {
  const item = (id, href, label, name) => h("a", { class: `nav-item${tab === id ? " is-on" : ""}`, href, "aria-current": tab === id ? "page" : null }, icon(name), h("span", { text: label }));
  fill(nav,
    item("home", "#/", "Главная", "home"),
    item("library", "#/library", "Библиотека", "library"),
    h("button", { class: "nav-plus", "aria-label": "Создать", onclick: createSheet }, icon("plus", 28)),
    item("search", "#/search", "Поиск", "search"),
    item("assistant", "#/assistant", "Ассистент", "assistant"),
  );
}

// What the import left out, so the person can enter it again.
function importIssuesSheet(issues) {
  const n = issues.length;
  const word = n % 10 === 1 && n % 100 !== 11 ? "значение не подошло" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "значения не подошли" : "значений не подошли";
  openSheet(`Перенесено, ${n} ${word}`, (close) => h("div", { class: "form" },
    h("p", { class: "hint", text: "Остальное перенесено. Эти значения в новом виде хранить нельзя, их можно ввести заново." }),
    h("ul", { class: "discrepancies" }, issues.map((issue) => h("li", { text: issue }))),
    h("button", { class: "btn btn-primary", onclick: close }, "Понятно"),
  ));
}

function firstRun() {
  const today = store.today();
  const hasLegacy = Boolean(localStorage.getItem(LEGACY_KEY));
  // The importer and the example load only here, on the first run.
  const start = (fn) => async () => {
    let result = null;
    try {
      if (fn) result = await fn(await import("../core/migrate.js"));
    } catch (error) {
      result = { ok: false, reason: error.message };
    }
    if (result && result.ok === false) { toast(result.reason || "Не получилось", { error: true }); return; }
    ensureHome();
    location.hash = "#/";
    if (result?.issues?.length) importIssuesSheet(result.issues);
  };
  return h("section", { class: "first-run" },
    h("h1", { class: "page-title", text: "Cookish" }),
    h("p", { class: "page-sub", text: "Рацион, Спорт и Покупки как объекты: свои типы, наборы и виджеты на главной." }),
    h("div", { class: "first-run-actions" },
      h("button", { class: `btn btn-block ${hasLegacy ? "btn-primary" : "btn-quiet"}`, disabled: !hasLegacy, onclick: start((m) => m.importLegacy(store, localStorage)) }, "Перенести мои данные из Cookish"),
      hasLegacy ? null : h("p", { class: "field-hint", text: "На этом устройстве нет данных Cookish" }),
      h("button", { class: `btn btn-block ${hasLegacy ? "btn-quiet" : "btn-primary"}`, onclick: start((m) => store.replaceAll(m.legacyToObjects(m.demoLegacyState(today), { today }))) }, "Начать с примера"),
      h("button", { class: "btn btn-quiet btn-block", onclick: start(null) }, "Пустое пространство"),
    ),
  );
}

// A store write re-renders the screen. A write from an input's change event
// lands while a finger or mouse is still on the button the person pressed;
// rendering then would replace that button and swallow its click, so the
// render waits until the press ends.
let scheduled = false;
let pressing = false;
function flush() {
  if (pressing) return;
  scheduled = false;
  render();
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(flush);
}
addEventListener("pointerdown", () => { pressing = true; }, true);
for (const type of ["pointerup", "pointercancel"]) addEventListener(type, () => { pressing = false; if (scheduled) setTimeout(flush); }, true);

store.subscribe(schedule);
addEventListener("objects:render", schedule);
addEventListener("hashchange", render);
if (Object.keys(store.state().objects).length) ensureHome();
render();
