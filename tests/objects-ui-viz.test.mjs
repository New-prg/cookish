import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { baseUrl, openApp, shot, useUi } from "./objects-ui-helpers.mjs";
import { buildDemoState } from "../mobile-shell/objects/viz/demo.js";
import { resolveSeries } from "../mobile-shell/objects/viz/data.js";
import { axisLabel, dateLabel, fmtValue } from "../mobile-shell/objects/viz/util.js";

useUi("objects-shots-viz");

const TODAY = "2026-10-21";
const state = buildDemoState(TODAY);
const ctx = { today: TODAY };
const galleryUrl = (query = "") => new URL(`objects/viz/gallery.html?today=${TODAY}${query}`, baseUrl).href;
const plain = (text) => text.replace(/[\s ]+/g, " ").trim();

async function openGallery({ colorScheme = "light", width = 390, query = "" } = {}) {
  const app = await openApp({ colorScheme, viewport: { width, height: 844 } });
  await app.page.goto(galleryUrl(query), { waitUntil: "load" });
  await app.page.waitForSelector("html[data-ready]");
  await app.page.waitForTimeout(200);
  return app;
}

const demo = (page, id) => page.locator(`[data-demo="${id}"]`);
const tipText = async (page, id) => plain(await demo(page, id).locator(".viz-tip").innerText());

test("every component and example renders at 390 and 728 px, in light and dark, and the audit is clean", async () => {
  for (const colorScheme of ["light", "dark"]) {
    for (const width of [390, 728]) {
      const name = `${width}-${colorScheme}`;
      const { context, page, errors } = await openGallery({ colorScheme, width });
      const counts = await page.evaluate(() => ({
        demos: document.querySelectorAll("[data-demo]").length,
        examples: document.querySelectorAll("[data-example]").length,
        dashboards: document.querySelectorAll("[data-example] c-dashboard").length,
        problems: document.querySelectorAll(".gallery-problems").length,
        broken: [...document.querySelectorAll("[data-error]")].map((el) => `${el.localName}: ${el.getAttribute("data-error")}`),
        unpainted: [...document.querySelectorAll("c-stat, c-meter, c-bars, c-line, c-spark, c-heatmap, c-table, c-list, c-empty")].filter((el) => !el.vizState?.painted || !el.children.length).map((el) => el.localName),
      }));
      assert.ok(counts.demos >= 20, `${name}: ${counts.demos} demos`);
      assert.equal(counts.examples, 6);
      assert.equal(counts.dashboards, 6, "every example dashboard passed the validator and was mounted");
      assert.equal(counts.problems, 0);
      assert.deepEqual(counts.broken, []);
      assert.deepEqual(counts.unpainted, []);
      assert.deepEqual(await page.evaluate(() => window.vizGallery.audit()), [], `${name}: audit`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, `${name}: no sideways scroll`);
      await shot(page, `gallery-${name}`);
      assert.deepEqual(errors, [], `${name}: page errors`);
      await context.close();
    }
  }
});

test("the theme follows the system or a forced choice, with the validated palettes", async () => {
  const read = (page) => page.evaluate(() => {
    const el = document.querySelector('[data-demo="bars-single"] c-bars');
    const cs = getComputedStyle(el);
    return { chart1: cs.getPropertyValue("--chart-1").trim(), card: cs.getPropertyValue("--card").trim(), seq: cs.getPropertyValue("--viz-seq-5").trim(), accentOfApp: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() };
  });
  const light = await openGallery({ colorScheme: "light" });
  assert.deepEqual(await read(light.page), { chart1: "#1f7a46", card: "#ffffff", seq: "#1b5a39", accentOfApp: "" });
  await light.context.close();
  const dark = await openGallery({ colorScheme: "dark" });
  assert.deepEqual(await read(dark.page), { chart1: "#3a9d68", card: "#1c1f1c", seq: "#a3dcbb", accentOfApp: "" });
  await dark.page.locator('[data-theme-button="light"]').click();
  assert.equal((await read(dark.page)).chart1, "#1f7a46", "a forced light theme beats the dark system");
  await dark.context.close();
  const forced = await openGallery({ colorScheme: "light", query: "&theme=dark" });
  assert.equal((await read(forced.page)).chart1, "#3a9d68", "a forced dark theme beats the light system");
  assert.deepEqual(await forced.page.evaluate(() => window.vizGallery.audit()), []);
  await forced.context.close();
  // the app keeps its own --accent: the kit's contract is scoped to its elements
  const app = await openApp();
  assert.equal(await app.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()), "#1f5d3b");
  await app.context.close();
});

test("a bar shows its tooltip on hover and the table twin shows the same numbers", async () => {
  const { context, page, errors } = await openGallery({ width: 390 });
  const box = demo(page, "bars-single");
  await box.scrollIntoViewIfNeeded();
  const expected = resolveSeries(state, { tag: "c-bars", set: "set_water", value: "drunk", fn: "sum", range: "@last7d" }, ctx);
  const cols = box.locator(".viz-col");
  assert.equal(await cols.count(), 7);
  const seen = [];
  for (let i = 0; i < 7; i += 1) {
    const rect = await cols.nth(i).boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await box.locator(".viz-tip:not([hidden])").waitFor();
    const text = await tipText(page, "bars-single");
    assert.ok(text.includes(plain(fmtValue(expected.series[0].values[i], "мл"))), `bar ${i}: «${text}» has ${expected.series[0].values[i]}`);
    assert.ok(text.includes(axisLabel(expected.buckets[i], "day", "long")), `bar ${i}: the day`);
    assert.equal(await cols.nth(i).evaluate((el) => el.classList.contains("is-hover")), true, "the hovered bar lifts");
    seen.push(plain(await box.locator(".viz-tip-value").innerText()));
  }
  await page.mouse.move(2, 2);
  await box.locator(".viz-tip").waitFor({ state: "hidden" });
  await shot(page, "gallery-bars-hover");

  await box.locator(".viz-toggle").click();
  assert.equal(await box.locator(".viz-plot").isHidden(), true);
  const cells = await box.locator(".viz-table tbody tr td").allInnerTexts();
  assert.deepEqual(cells.map(plain), seen, "the table shows the numbers of the tooltips");
  assert.equal(await box.locator(".viz-table tbody tr").count(), 7);
  assert.equal(plain(await box.locator(".viz-table tbody tr th").first().innerText()), axisLabel(expected.buckets[0], "day", "long"));
  await shot(page, "gallery-bars-table");
  await box.locator(".viz-toggle").click();
  assert.equal(await box.locator(".viz-plot").isVisible(), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test("a stacked bar lists every series and the total, a line has a crosshair on the nearest point", async () => {
  const { context, page, errors } = await openGallery({ width: 390 });
  const stacked = demo(page, "bars-stacked");
  await stacked.scrollIntoViewIfNeeded();
  const spec = { tag: "c-bars", set: "set_activity", value: "duration", fn: "sum", range: "@last8w", by: "week", category: "kind" };
  const data = resolveSeries(state, spec, ctx);
  const week = data.buckets.findIndex((_, i) => data.series.filter((s) => s.values[i] != null).length >= 2);
  const rect = await stacked.locator(".viz-col").nth(week).boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height - 3);
  await stacked.locator(".viz-tip:not([hidden])").waitFor();
  const rows = await stacked.locator(".viz-tip-row").allInnerTexts();
  const present = data.series.filter((s) => s.values[week] != null);
  assert.equal(rows.length, present.length + 1, "one row per series plus the total");
  for (const s of present) assert.ok(rows.map(plain).some((r) => r.includes(s.label) && r.includes(plain(fmtValue(s.values[week], "мин")))), s.label);
  assert.ok(plain(rows[rows.length - 1]).includes("всего"));
  assert.ok(plain(await stacked.locator(".viz-legend").innerText()).includes(present[0].label), "two or more series have a legend");

  const line = demo(page, "line-area");
  await line.scrollIntoViewIfNeeded();
  const weight = resolveSeries(state, { tag: "c-line", set: "set_weight", value: "weightKg", fn: "avg", range: "@last30d" }, ctx);
  const svg = await line.locator(".viz-plot svg").boundingBox();
  await page.mouse.move(svg.x + svg.width - 60, svg.y + 80);
  await line.locator(".viz-tip:not([hidden])").waitFor();
  assert.equal(await line.locator(".viz-hover").getAttribute("visibility"), "visible", "the crosshair is shown");
  const text = await tipText(page, "line-area");
  const last = weight.buckets.map((b, i) => [b, weight.series[0].values[i]]).filter(([, v]) => v != null);
  assert.ok(last.some(([b, v]) => text.includes(dateLabel(b, "day", "long")) && text.includes(plain(fmtValue(v, "кг")))), `the tooltip names a real day and its weight: ${text}`);
  assert.equal(await line.locator(".viz-legend").count(), 0, "one series needs no legend");
  await shot(page, "gallery-line-hover");

  const multi = demo(page, "line-multi");
  await multi.scrollIntoViewIfNeeded();
  const box = await multi.locator(".viz-plot svg").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 90);
  await multi.locator(".viz-tip:not([hidden])").waitFor();
  assert.ok((await multi.locator(".viz-tip-row").count()) >= 2, "one tooltip lists every series at that day");
  assert.deepEqual(errors, []);
  await context.close();
});

test("a heatmap cell shows its day and minutes, and the table lists the same days", async () => {
  const { context, page, errors } = await openGallery({ width: 390 });
  const box = demo(page, "heatmap");
  await box.scrollIntoViewIfNeeded();
  const data = resolveSeries(state, { tag: "c-heatmap", set: "set_activity", value: "duration", fn: "sum", range: "@last12w" }, ctx);
  const day = data.buckets.findLast((_, i) => data.series[0].values[i] > 0);
  const value = data.series[0].values[data.buckets.indexOf(day)];
  const cell = await box.locator(`.viz-cell[data-date="${day}"]`).boundingBox();
  await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2);
  await box.locator(".viz-tip:not([hidden])").waitFor();
  const text = await tipText(page, "heatmap");
  assert.ok(text.includes(dateLabel(day, "day", "long")) && text.includes(plain(fmtValue(value, "мин"))), text);
  // the gap between two cells still belongs to the nearest cell
  await page.mouse.move(cell.x + cell.width + 1, cell.y + cell.height / 2);
  assert.ok((await tipText(page, "heatmap")).length > 0);
  await box.locator(".viz-toggle").click();
  const rows = (await box.locator(".viz-table tbody tr").allInnerTexts()).map(plain);
  assert.ok(rows.some((r) => r.includes(dateLabel(day, "day", "long")) && r.includes(plain(fmtValue(value, "мин")))), "the table has the same day and number");
  const withData = data.buckets.filter((_, i) => data.series[0].values[i] > 0).length;
  assert.equal(rows.length, withData, "the table lists every day with minutes");
  assert.deepEqual(errors, []);
  await context.close();
});

test("the keyboard reaches the same details as the pointer", async () => {
  const { context, page, errors } = await openGallery({ width: 390 });
  const box = demo(page, "bars-single");
  await box.scrollIntoViewIfNeeded();
  const plot = box.locator(".viz-plot");
  await plot.focus();
  await page.keyboard.press("ArrowLeft");
  await box.locator(".viz-tip:not([hidden])").waitFor();
  const first = await tipText(page, "bars-single");
  await page.keyboard.press("ArrowLeft");
  assert.notEqual(await tipText(page, "bars-single"), first, "arrows move between days");
  await page.keyboard.press("Home");
  assert.ok((await tipText(page, "bars-single")).length > 0);
  await page.keyboard.press("Escape");
  await box.locator(".viz-tip").waitFor({ state: "hidden" });
  assert.equal(await plot.getAttribute("role"), "img");
  assert.match(await plot.getAttribute("aria-label"), /^Вода за 7 дней, с целью: от /);
  assert.deepEqual(errors, []);
  await context.close();
});

test("a tap shows the tooltip and a tap outside takes it away", async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: "light" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(galleryUrl(), { waitUntil: "load" });
  await page.waitForSelector("html[data-ready]");
  const box = demo(page, "bars-single");
  await box.scrollIntoViewIfNeeded();
  const expected = resolveSeries(state, { tag: "c-bars", set: "set_water", value: "drunk", fn: "sum", range: "@last7d" }, ctx);
  const rect = await box.locator(".viz-col").nth(3).boundingBox();
  await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await box.locator(".viz-tip:not([hidden])").waitFor();
  assert.ok((await tipText(page, "bars-single")).includes(plain(fmtValue(expected.series[0].values[3], "мл"))));
  const next = await box.locator(".viz-col").nth(5).boundingBox();
  await page.touchscreen.tap(next.x + next.width / 2, next.y + next.height / 2);
  assert.ok((await tipText(page, "bars-single")).includes(plain(fmtValue(expected.series[0].values[5], "мл"))), "a second tap moves it");
  await page.touchscreen.tap(8, 8);
  await box.locator(".viz-tip").waitFor({ state: "hidden" });
  const heat = demo(page, "heatmap");
  await heat.scrollIntoViewIfNeeded();
  const cell = await heat.locator(".viz-cell").nth(20).boundingBox();
  await page.touchscreen.tap(cell.x + cell.width / 2, cell.y + cell.height / 2);
  await heat.locator(".viz-tip:not([hidden])").waitFor();
  assert.deepEqual(errors, []);
  await browser.close();
});

test("a chart redraws when its width changes and never overflows", async () => {
  const { context, page, errors } = await openGallery({ width: 728 });
  const box = page.locator('[data-example="water.html"] c-bars');
  await box.scrollIntoViewIfNeeded();
  const width = () => box.locator(".viz-plot svg").evaluate((svg) => Number(svg.getAttribute("width")));
  const wide = await width();
  await page.setViewportSize({ width: 340, height: 844 });
  await page.waitForFunction((before) => Number(document.querySelector('[data-example="water.html"] c-bars .viz-plot svg').getAttribute("width")) < before, wide);
  const narrow = await width();
  assert.ok(narrow < wide - 100, `${wide} → ${narrow}`);
  assert.equal(await box.locator(".viz-plot svg").evaluate((svg) => svg.getBoundingClientRect().right <= document.documentElement.clientWidth), true);
  assert.deepEqual(await page.evaluate(() => window.vizGallery.audit()), []);
  assert.equal(await box.locator(".viz-plot").evaluate((el) => el.getBoundingClientRect().height), 210, "the plot height is fixed and includes the axis");
  await shot(page, "gallery-340-narrow");
  assert.deepEqual(errors, []);
  await context.close();
});

test("charts without data show their empty state", async () => {
  const { context, page, errors } = await openGallery({ width: 390 });
  for (const id of ["empty-bars", "empty-stat", "empty-heatmap"]) {
    const box = demo(page, id);
    assert.equal(await box.locator(".viz-empty").count(), 1, id);
    assert.match(plain(await box.locator(".viz-empty").innerText()), /Пока нет данных/);
    assert.equal(await box.locator("svg.viz-glyph").count() > 0, true, "the empty state has an icon");
    assert.equal(await box.locator(".viz-plot, .viz-toggle").count(), 0, "no empty axes or table toggle");
  }
  assert.match(plain(await demo(page, "empty").innerText()), /Пока нет записей: добавьте первую/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("the audit finds what a screenshot hides", async () => {
  const { context, page } = await openGallery({ width: 390 });
  const problems = await page.evaluate(async () => {
    const auditRendered = window.vizGallery.audit;
    const root = document.createElement("div");
    root.id = "scratch";
    document.querySelector("#screen").append(root);
    const card = document.createElement("c-card");
    card.setAttribute("title", "Проверка");
    root.append(card);
    const make = (tag, attrs = {}) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); card.append(el); return el; };
    const wait = () => new Promise((resolve) => setTimeout(resolve, 50));

    const out = {};
    const thrown = make("c-bars");
    thrown.data = { buckets: ["a"], series: [{ values: 5 }] };
    await wait();
    out.thrown = auditRendered(root);
    thrown.remove();

    const hidden = make("c-bars");
    hidden.data = [];
    await wait();
    hidden.querySelector(".viz-empty").remove();
    out.hiddenEmpty = auditRendered(root);
    hidden.remove();

    const text = document.createElement("p");
    text.textContent = "Цветной текст";
    text.style.color = "var(--chart-2)";
    card.append(text);
    out.color = auditRendered(root);
    text.remove();

    const tiny = document.createElement("button");
    tiny.style.cssText = "width:20px;height:20px";
    tiny.textContent = "x";
    card.append(tiny);
    out.tap = auditRendered(root);
    tiny.remove();

    const wide = document.createElement("div");
    wide.style.cssText = "width:900px;height:10px";
    card.append(wide);
    out.overflow = auditRendered(root);
    wide.remove();

    const status = document.createElement("span");
    status.className = "viz-status is-good";
    status.textContent = "хорошо";
    card.append(status);
    out.status = auditRendered(root);
    status.remove();

    const bars = make("c-bars", { title: "Вода" });
    bars.data = { by: "day", buckets: ["2026-10-19", "2026-10-20"], series: [{ key: "a", label: "a", color: 0, values: [1, 2] }] };
    await wait();
    const svg = bars.querySelector("svg");
    for (const x of [100, 104]) {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("class", "viz-xlabel");
      label.setAttribute("x", x);
      label.setAttribute("y", 150);
      label.textContent = "пн";
      svg.append(label);
    }
    out.labels = auditRendered(root);
    bars.remove();

    const unnamed = document.createElement("c-spark");
    card.removeAttribute("data-title");
    card.append(unnamed);
    unnamed.data = [1, 2, 3];
    await wait();
    out.unnamed = auditRendered(root);
    root.remove();
    return out;
  });
  assert.ok(problems.thrown.some((p) => p.includes("ошибка отрисовки")), JSON.stringify(problems.thrown));
  assert.ok(problems.hiddenEmpty.some((p) => p.includes("пустое состояние не показано")), JSON.stringify(problems.hiddenEmpty));
  assert.ok(problems.color.some((p) => p.includes("окрашен в цвет ряда chart-2")), JSON.stringify(problems.color));
  assert.ok(problems.tap.some((p) => p.includes("маленькая цель нажатия 20x20")), JSON.stringify(problems.tap));
  assert.ok(problems.overflow.some((p) => p.includes("выходит за правый край")), JSON.stringify(problems.overflow));
  assert.ok(problems.status.some((p) => p.includes("значок и слово")), JSON.stringify(problems.status));
  assert.ok(problems.labels.some((p) => p.includes("подписи оси «пн» и «пн» наложились")), JSON.stringify(problems.labels));
  assert.ok(problems.unnamed.some((p) => p.includes("нет названия")), JSON.stringify(problems.unnamed));
  await context.close();
});

test("the single-file gallery is self-contained and reads the variables a host injects", async () => {
  const { writeInline, OUTPUT } = await import("../scripts/viz-gallery-inline.mjs");
  const { bytes } = writeInline({ today: TODAY });
  assert.ok(bytes > 50_000);
  const html = fs.readFileSync(OUTPUT, "utf8");
  assert.equal(/^\s*(import|export)\s/m.test(html), false, "no module syntax left");
  assert.equal(/<link\b|<script[^>]+src=|@import|url\(|fetch\(|XMLHttpRequest/.test(html), false, "nothing is loaded from anywhere");
  assert.deepEqual([...html.matchAll(/https?:\/\/[^"'\s)]+/g)].map((m) => m[0]), ["http://www.w3.org/2000/svg"], "the only URL is the SVG namespace identifier");

  const browser = await chromium.launch();
  const fileUrl = pathToFileURL(OUTPUT).href;
  const open = async (options, init) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...options });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("request", (request) => requests.push(request.url()));
    if (init) await page.addInitScript(init);
    await page.goto(fileUrl);
    await page.waitForSelector("html[data-ready]");
    await page.waitForTimeout(200);
    return { context, page, errors, requests };
  };
  const probe = (page) => page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('[data-demo="bars-single"] c-bars'));
    return { host: document.documentElement.dataset.vizHost, mode: document.documentElement.dataset.vizMode || "", chart1: cs.getPropertyValue("--chart-1").trim(), contract: Boolean(document.getElementById("viz-contract")), demos: document.querySelectorAll("[data-demo]").length, examples: document.querySelectorAll("[data-example] c-dashboard").length, audit: window.vizGallery.audit(), error: document.querySelectorAll("[data-error]").length };
  });
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });

  for (const colorScheme of ["light", "dark"]) {
    const { context, page, errors, requests } = await open({ colorScheme });
    const got = await probe(page);
    assert.equal(got.host, "own");
    assert.equal(got.chart1, colorScheme === "light" ? "#1f7a46" : "#3a9d68", "its own palette outside a host");
    assert.ok(got.demos >= 20 && got.examples === 6 && got.error === 0);
    assert.deepEqual(got.audit, []);
    assert.deepEqual(requests, [fileUrl], "one request: the file");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(path.dirname(OUTPUT), `gallery.inline-${colorScheme}.png`), fullPage: false });
    // the inline page keeps the interaction: hover shows a tooltip
    await page.locator('[data-demo="bars-single"]').scrollIntoViewIfNeeded();
    const rect = await page.locator('[data-demo="bars-single"] .viz-col').nth(2).boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.locator('[data-demo="bars-single"] .viz-tip:not([hidden])').waitFor();
    await context.close();
  }

  // a host that injects the T3 contract on the page, here a dark one with its own series colors
  const t3 = () => {
    const vars = { "--background": "#0b0b0c", "--foreground": "#fafafa", "--card": "#18181b", "--card-foreground": "#fafafa", "--muted": "#27272a", "--muted-foreground": "#a1a1aa", "--border": "#27272a", "--accent": "#27272a", "--primary": "#e4e4e7", "--chart-1": "#e11d48", "--chart-2": "#3b82f6", "--chart-3": "#f59e0b", "--chart-4": "#10b981", "--chart-5": "#a855f7", "--chart-6": "#14b8a6" };
    const css = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";");
    // an init script runs before the document has a root: set the variables the moment it appears
    const set = () => { if (document.documentElement) { document.documentElement.style.cssText = css; return true; } return false; };
    if (!set()) new MutationObserver((_, observer) => { if (set()) observer.disconnect(); }).observe(document, { childList: true });
  };
  const host = await open({ colorScheme: "light" }, t3);
  const got = await probe(host.page);
  assert.equal(got.host, "t3");
  assert.equal(got.mode, "dark", "the mode is read from --background, not from the system");
  assert.equal(got.chart1, "#e11d48", "the host's series color is used");
  assert.equal(got.contract, false, "Cookish's own contract values are dropped");
  assert.deepEqual(got.audit, []);
  assert.deepEqual(host.errors, []);
  assert.equal(await host.page.evaluate(() => getComputedStyle(document.querySelector(".viz")).backgroundColor), "rgb(11, 11, 12)");
  await host.page.screenshot({ path: path.join(path.dirname(OUTPUT), "gallery.inline-t3-dark.png"), fullPage: false });
  // the host switches its theme later: the mode follows
  await host.page.evaluate(() => { document.documentElement.style.cssText = "--background:#ffffff;--foreground:#09090b;--card:#ffffff;--card-foreground:#09090b;--muted:#f4f4f5;--muted-foreground:#71717a;--border:#e4e4e7;--accent:#f4f4f5;--primary:#18181b;--chart-1:#e76e50;--chart-2:#2a9d90;--chart-3:#274754;--chart-4:#e8c468;--chart-5:#f4a462;--chart-6:#8ab17d"; });
  await host.page.waitForFunction(() => document.documentElement.dataset.vizMode === "light");
  assert.equal(await host.page.evaluate(() => getComputedStyle(document.querySelector('[data-demo="bars-single"] c-bars')).getPropertyValue("--chart-1").trim()), "#e76e50");
  await host.context.close();
  await browser.close();
});
