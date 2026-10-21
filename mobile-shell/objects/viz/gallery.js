// The gallery page: every component with demo data and every example dashboard,
// for review and for the browser tests. ?theme=light|dark forces a theme,
// ?today=ГГГГ-ММ-ДД pins the date of the demo data.
import "./kit.js";
import { buildDemoState } from "./demo.js";
import { setDataSource, stateDataSource, checkDashboard } from "./data.js";
import { exampleRequest, mountMarkup } from "./mount.js";
import { auditRendered } from "./audit.js";
import { h } from "./el.js";
import { DEMOS, GROUPS } from "./demos.js";

const params = new URLSearchParams(location.search);
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const today = params.get("today") || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
if (params.get("theme")) document.documentElement.dataset.theme = params.get("theme");

const state = buildDemoState(today);
setDataSource(stateDataSource(() => state, () => ({ today }), { hrefFor: (obj) => (obj.type === "request" ? `#/request/${obj.id}` : null) }));

function pressed(name) {
  for (const b of document.querySelectorAll("[data-theme-button]")) b.setAttribute("aria-pressed", String(b.dataset.themeButton === name));
}
pressed(params.get("theme") || "system");
for (const b of document.querySelectorAll("[data-theme-button]")) {
  b.addEventListener("click", () => {
    const name = b.dataset.themeButton;
    if (name === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = name;
    pressed(name);
  });
}

// One component on a card: attrs bind it to the demo state, `data` hands it data by code.
function demo(d) {
  const el = h(d.tag, d.attrs);
  if (d.text) el.textContent = d.text;
  if (d.data !== undefined) el.data = d.data;
  return h("div", { class: "gallery-demo", "data-demo": d.id }, h("c-card", { title: d.title }, el));
}

const host = document.querySelector('[data-gallery="components"]');
for (const [group, title] of Object.entries(GROUPS)) {
  host.append(h("h3", { text: title }), h("c-grid", { cols: "2" }, DEMOS.filter((d) => d.group === group).map(demo)));
}

const examplesHost = document.querySelector('[data-gallery="examples"]');
const names = await (await fetch("examples/index.json")).json();
for (const name of names) {
  const markup = await (await fetch(`examples/${name}`)).text();
  const box = h("div", { class: "gallery-example", "data-example": name });
  const slot = h("div", { class: "gallery-slot" });
  box.append(h("p", { class: "gallery-request", text: exampleRequest(markup) }), slot);
  examplesHost.append(box);
  const checked = checkDashboard(markup, state, { today });
  if (!checked.ok) box.append(h("p", { class: "gallery-problems", text: checked.messages.join(" ") }));
  else mountMarkup(slot, markup, { state, today });
}

window.vizGallery = { state, today, audit: auditRendered };
document.documentElement.dataset.ready = "1";
