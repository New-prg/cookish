// Builds output/viz/gallery.inline.html: the kit, its tokens, the demo data and the
// example dashboards in ONE self-contained file (no imports, no external URLs), to
// show in a T3 Code chat frame.
//
//   node scripts/viz-gallery-inline.mjs
//
// The file reads T3's injected theme variables (--background, --card, --chart-1 ...)
// when the host sets them, and keeps its own Cookish values otherwise. The data of
// every bound element is computed here, at build time, with the real data source
// against the demo space, so the page needs no state and no core modules.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemoState } from "../mobile-shell/objects/viz/demo.js";
import { stateDataSource } from "../mobile-shell/objects/viz/data.js";
import { DEMOS, GROUPS } from "../mobile-shell/objects/viz/demos.js";

import { exampleRequest, normalizeMarkup, parseMarkup, validateMarkup } from "../mobile-shell/objects/viz/validate.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viz = path.join(root, "mobile-shell", "objects", "viz");
export const OUTPUT = path.join(root, "output", "viz", "gallery.inline.html");

// Modules in dependency order. Each is stripped of its imports and exports and
// the results share one scope inside a function.
const MODULES = ["util.js", "source.js", "el.js", "styles.js", "charts.js", "kit.js", "audit.js"];

function strip(source) {
  return source
    .replace(/^import\s[\s\S]*?\sfrom\s+["'][^"']+["'];?[ \t]*$/gm, "")
    .replace(/^import\s+["'][^"']+["'];?[ \t]*$/gm, "")
    .replace(/^export\s*\{[^}]*\}(\s*from\s+["'][^"']+["'])?;?[ \t]*$/gm, "")
    .replace(/^export\s+(async\s+function|function|class|const|let|var)\b/gm, "$1");
}

const specKey = (spec) => JSON.stringify(Object.keys(spec).sort().map((k) => [k, spec[k]]));

function treeOf(markup) {
  const fixed = normalizeMarkup(markup).markup;
  const node = parseMarkup(fixed).nodes.find((n) => n.type === "el");
  const walk = (n) => (n.type === "text" ? n.text : { tag: n.tag, attrs: Object.fromEntries(n.attrList.map((a) => [a.name, a.value])), children: n.children.map(walk) });
  return walk(node);
}

const BOUND = new Set(["c-stat", "c-meter", "c-bars", "c-line", "c-spark", "c-heatmap", "c-table", "c-list"]);

export function buildInline({ today = localToday() } = {}) {
  const state = buildDemoState(today);
  const source = stateDataSource(() => state, () => ({ today }), {});
  const table = {};
  const record = (spec) => { const key = specKey(spec); if (!(key in table)) table[key] = source(spec); };

  const demos = DEMOS.map((d) => {
    if (d.data === undefined && BOUND.has(d.tag) && d.attrs.set) record({ tag: d.tag, ...d.attrs });
    return d;
  });

  const names = JSON.parse(fs.readFileSync(path.join(viz, "examples", "index.json"), "utf8"));
  const examples = names.map((name) => {
    const markup = fs.readFileSync(path.join(viz, "examples", name), "utf8");
    const checked = validateMarkup(markup, { state, today });
    if (!checked.ok) throw new Error(`${name}: ${checked.messages.join(" ")}`);
    const tree = treeOf(markup);
    const visit = (n) => {
      if (typeof n === "string") return;
      if (BOUND.has(n.tag) && n.attrs.set) record({ tag: n.tag, ...n.attrs });
      n.children.forEach(visit);
    };
    visit(tree);
    return { name, request: exampleRequest(markup), tree };
  });

  const tokens = fs.readFileSync(path.join(viz, "tokens.css"), "utf8");
  const contractStart = tokens.indexOf("/* @contract-start */");
  const contractEnd = tokens.indexOf("/* @contract-end */");
  const contract = tokens.slice(contractStart, contractEnd);
  const chartRoles = tokens.slice(contractEnd + "/* @contract-end */".length);
  const bundle = MODULES.map((file) => `// ---- ${file}\n${strip(fs.readFileSync(path.join(viz, file), "utf8"))}`).join("\n");
  const data = JSON.stringify({ today, groups: GROUPS, demos, examples, table }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Cookish: набор графиков</title>
<style>
html, body { margin: 0; }
* { box-sizing: border-box; }
.viz { min-height: 100vh; padding: 16px; font-family: var(--font-sans); background: var(--background); color: var(--foreground); }
.viz .page { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 28px; }
.viz .page h1 { margin: 0; font-size: 26px; line-height: 1.15; }
.viz .page h2 { margin: 0 0 4px; font-size: 20px; }
.viz .page h3 { margin: 12px 0 8px; font-size: 17px; color: var(--muted-foreground); }
.viz .page p.note { margin: 6px 0 0; font-size: 14px; color: var(--muted-foreground); }
.viz .example { display: flex; flex-direction: column; gap: 8px; margin-bottom: 28px; }
.viz .example .request { margin: 0; font-size: 14px; color: var(--muted-foreground); }
.viz .demo { min-width: 0; }
</style>
<style id="viz-contract">
${contract}
</style>
<style id="viz-chart-roles">
${chartRoles}
</style>
</head>
<body>
<div class="viz" id="app"></div>
<script>
(() => {
${bundle}

const DATA = ${data};
const key = (spec) => JSON.stringify(Object.keys(spec).sort().map((k) => [k, spec[k]]));
setDataSource((spec) => {
  const k = key(spec);
  if (!(k in DATA.table)) throw new Error("нет данных для " + k);
  return DATA.table[k];
});

// Theme: T3 injects --background, --card, --chart-1 ... on the page. When it does, they are used
// as they are and Cookish's own contract values are dropped; the chart-only roles (grid, ramp,
// status) stay and follow the light or dark mode read from --background.
const html = document.documentElement;
function colorOf(value) {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillStyle = value;
  g.fillRect(0, 0, 1, 1);
  const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
  return 0.2126 * (r / 255) + 0.7152 * (gr / 255) + 0.0722 * (b / 255);
}
function theme() {
  const cs = getComputedStyle(html);
  const t3 = cs.getPropertyValue("--card").trim() !== "" && cs.getPropertyValue("--background").trim() !== "";
  if (t3) {
    document.getElementById("viz-contract")?.remove();
    if (!document.getElementById("viz-extras")) {
      const extras = document.createElement("style");
      extras.id = "viz-extras";
      extras.textContent = ".viz { " + (cs.getPropertyValue("--radius").trim() ? "" : "--radius: 14px; ") + (cs.getPropertyValue("--font-sans").trim() ? "" : "--font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; ") + "}";
      document.head.append(extras);
    }
    html.dataset.vizMode = colorOf(cs.getPropertyValue("--background").trim()) < 0.35 ? "dark" : "light";
  }
  html.dataset.vizHost = t3 ? "t3" : "own";
}
theme();
new MutationObserver(theme).observe(html, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
new MutationObserver(theme).observe(document.head, { childList: true, subtree: true, characterData: true });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", theme);

function build(node) {
  if (typeof node === "string") return document.createTextNode(node);
  const el = document.createElement(node.tag);
  for (const [k, v] of Object.entries(node.attrs)) el.setAttribute(k, v);
  for (const child of node.children) el.append(build(child));
  return el;
}

const app = document.getElementById("app");
const page = h("div", { class: "page" }, h("h1", { text: "Набор графиков Cookish" }),
  h("p", { class: "note", text: "Те же компоненты, что в приложении. Тема берётся у страницы: светлая и тёмная." }));
app.append(page);
const components = h("section", null, h("h2", { text: "Компоненты" }));
page.append(components);
for (const [group, title] of Object.entries(DATA.groups)) {
  const cards = DATA.demos.filter((d) => d.group === group).map((d) => {
    const el = h(d.tag, d.attrs);
    if (d.text) el.textContent = d.text;
    if (d.data !== undefined) el.data = d.data;
    return h("div", { class: "demo", "data-demo": d.id }, h("c-card", { title: d.title }, el));
  });
  components.append(h("h3", { text: title }), h("c-grid", { cols: "2" }, cards));
}
const examples = h("section", null, h("h2", { text: "Примеры панелей" }));
page.append(examples);
for (const ex of DATA.examples) {
  examples.append(h("div", { class: "example", "data-example": ex.name }, h("p", { class: "request", text: ex.request }), build(ex.tree)));
}
window.vizGallery = { audit: auditRendered, today: DATA.today };
html.dataset.ready = "1";
})();
</script>
</body>
</html>
`;
}

function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function writeInline(options) {
  const html = buildInline(options);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, html);
  return { file: OUTPUT, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { file, bytes } = writeInline();
  console.log(`${file} (${Math.round(bytes / 1024)} KB)`);
}
