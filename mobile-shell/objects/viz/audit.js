// Audit of what the kit actually put on the screen, the render-side twin of
// the markup validator: thrown errors, sideways overflow, small tap targets, a
// chart without data that hides its empty state, touching axis labels, text in a
// series color, a status shown by color alone, and for the input elements of the
// kit (buttons, fields, marks, and the search box and edit buttons of a list or table) a control without a label. Same spirit as the layout audit
// in tests/objects-ui-helpers.mjs. Returns a list of Russian sentences; an empty
// list means the render passed.
const VIZ = "c-card, c-stat, c-meter, c-bars, c-line, c-spark, c-heatmap, c-table, c-list, c-empty, c-quick, c-form, c-marks, c-streak, c-embed";
const INPUTS = "c-quick, c-form, c-marks, c-streak";
const WITH_CONTROLS = `${INPUTS}, c-list, c-table`;
const CONTROLS = "button, input:not([type=hidden]), select, textarea";
const INSIDE = VIZ.split(",").map((tag) => `${tag.trim()} *`).join(",");
const CHARTS = new Set(["c-stat", "c-meter", "c-bars", "c-line", "c-spark", "c-heatmap", "c-table", "c-list"]);
const INTERACTIVE = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=switch], [role=checkbox]";

const visible = (el) => {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
};

const inScroller = (el, root) => {
  for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) {
    const o = getComputedStyle(p).overflowX;
    if (o === "auto" || o === "scroll") return true;
  }
  return false;
};

const label = (el) => {
  const title = el.getAttribute?.("data-title") || el.closest?.("[data-title]")?.getAttribute("data-title") || "";
  return `<${el.localName}${title ? ` «${title}»` : ""}>`;
};

// The name a screen reader would give a control: its label, what it points at, or its own text.
function controlName(el) {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const text = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
    if (text) return text;
  }
  const labels = [...(el.labels || [])].map((l) => l.textContent).join(" ").trim();
  if (labels) return labels;
  if (el.matches("button, [role=button]")) return el.textContent.trim();
  return el.getAttribute("title")?.trim() || "";
}

// What names an element for a screen reader: its own title, or the title of the
// card around it (a kit c-card, or a classic home widget with its heading).
function elementName(el) {
  const own = el.nameText?.() || el.getAttribute("data-title") || "";
  if (own) return own;
  const widget = el.closest(".widget");
  return widget?.querySelector(".widget-title")?.textContent.trim() || "";
}

const overlap = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

// Resolves a CSS color (a custom property value) to the form getComputedStyle reports.
function resolved(el, value) {
  const probe = document.createElement("span");
  probe.style.color = value;
  el.append(probe);
  const out = getComputedStyle(probe).color;
  probe.remove();
  return out;
}

export function auditRendered(root = document.body) {
  const problems = [];
  const scope = root.nodeType === 9 ? root.body : root;
  const width = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > width + 1) problems.push(`Страница прокручивается вбок: ${document.documentElement.scrollWidth} > ${width}.`);

  const elements = [...scope.querySelectorAll(VIZ)];
  for (const el of elements) {
    const state = el.vizState;
    if (el.hasAttribute("data-error") || state?.error) problems.push(`${label(el)}: ошибка отрисовки: ${el.getAttribute("data-error") || state.error?.message}.`);
    if (el.matches(INPUTS) && el.getClientRects().length && !state?.error && !el.children.length) problems.push(`${label(el)}: ничего не нарисовано.`);
    if (!CHARTS.has(el.localName)) continue;
    if (el.getClientRects().length === 0) continue; // display: none, e.g. a closed tab
    if (state?.empty) {
      const box = el.querySelector(".viz-empty");
      if (!box || !box.textContent.trim() || !visible(box)) problems.push(`${label(el)}: данных нет, но пустое состояние не показано.`);
    } else if (!state?.error && !el.children.length) {
      problems.push(`${label(el)}: ничего не нарисовано и нет пустого состояния.`);
    }
    if (!elementName(el)) problems.push(`${label(el)}: у элемента нет названия ни на нём самом, ни на карточке.`);
  }

  const rects = new Map();
  for (const el of scope.querySelectorAll("*")) {
    if (!el.getBoundingClientRect) continue;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    if (rect.right > width + 1 && !inScroller(el, scope)) problems.push(`${label(el)} .${(el.getAttribute("class") || el.localName).toString().split(" ")[0]}: выходит за правый край экрана, right=${Math.round(rect.right)}.`);
    if (el.matches(INTERACTIVE) && getComputedStyle(el).visibility !== "hidden" && (rect.height < 43.5 || rect.width < 43.5)) {
      problems.push(`${label(el.closest(VIZ) || el)}: маленькая цель нажатия ${Math.round(rect.width)}x${Math.round(rect.height)} («${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}»), нужно не меньше 44x44.`);
    }
    rects.set(el, rect);
  }

  for (const root of scope.querySelectorAll(WITH_CONTROLS)) {
    for (const control of root.querySelectorAll(CONTROLS)) {
      if (visible(control) && !controlName(control)) problems.push(`${label(root)}: у элемента управления <${control.localName}> нет подписи, экранный диктор не скажет, что это.`);
    }
  }

  for (const svg of scope.querySelectorAll(".viz-plot svg")) {
    for (const cls of ["viz-xlabel", "viz-ylabel"]) {
      const labels = [...svg.querySelectorAll(`text.${cls}`)].map((t) => ({ t, r: t.getBoundingClientRect() })).filter(({ r }) => r.width > 0);
      for (let i = 0; i < labels.length; i += 1) {
        for (let j = i + 1; j < labels.length; j += 1) {
          if (overlap(labels[i].r, labels[j].r)) problems.push(`${label(svg.closest(VIZ))}: подписи оси «${labels[i].t.textContent}» и «${labels[j].t.textContent}» наложились.`);
        }
      }
    }
  }

  // Text wears text tokens, never a series color.
  const series = new Map();
  for (const el of elements) {
    if (!el.isConnected) continue;
    const cs = getComputedStyle(el);
    for (let n = 1; n <= 6; n += 1) {
      const value = cs.getPropertyValue(`--chart-${n}`).trim();
      if (value && !series.has(`${value}`)) series.set(value, { n, rgb: resolved(el, value) });
    }
  }
  const palette = [...series.values()];
  if (palette.length) {
    for (const el of scope.querySelectorAll(INSIDE)) {
      if (!el.closest(VIZ)) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(el);
      const color = el instanceof SVGElement ? cs.fill : cs.color;
      const hit = palette.find((p) => p.rgb === color);
      if (hit) problems.push(`${label(el)}: текст «${el.textContent.trim().slice(0, 24)}» окрашен в цвет ряда chart-${hit.n}; текст должен брать цвет из токенов текста.`);
    }
  }

  for (const el of scope.querySelectorAll(".viz-status.is-good, .viz-status.is-warning, .viz-status.is-critical, .viz-delta")) {
    if (!el.querySelector("svg") || !el.textContent.trim()) problems.push(`${label(el)}: состояние показано одним цветом, нужны значок и слово.`);
  }
  return problems;
}
