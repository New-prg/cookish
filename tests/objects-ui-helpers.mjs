// Shared harness of the browser tests of objects.html: a static server, one
// Chromium, layout audits and screenshots.
import assert from "node:assert/strict";
import { after, before } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { serveShell } from "../scripts/serve-objects.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let shotsDir;
export const VIEWPORT = { width: 390, height: 844 };

let server;
let browser;
export let baseUrl;

// Starts the shell server and a browser for one test file. Pass a shots
// directory name so parallel files never share one.
export function useUi(shots = "objects-shots") {
  shotsDir = process.env.OBJECTS_SHOTS || path.join(root, "output", shots);
  before(async () => {
    server = await serveShell(0);
    baseUrl = `http://127.0.0.1:${server.address().port}/objects.html`;
    browser = await chromium.launch();
    fs.rmSync(shotsDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(shotsDir, "full"), { recursive: true });
  });
  after(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  });
}

export async function openApp({ colorScheme = "light", storageState, viewport = VIEWPORT } = {}) {
  const context = await browser.newContext({ viewport, colorScheme, storageState });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.locator("#screen > *").first().waitFor();
  return { context, page, errors };
}

// Layout defects a screenshot can hide: the page scrolling sideways, content
// past the right edge outside a scroller, and tap targets under 44 px.
async function audit(page, name) {
  const problems = await page.evaluate(() => {
    const out = [];
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > width + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${width}`);
    const inScroller = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll") return true;
      }
      return false;
    };
    const label = (el) => `${el.tagName.toLowerCase()}.${el.className || ""} «${(el.getAttribute("aria-label") || el.textContent || el.value || "").trim().slice(0, 30)}»`;
    for (const el of document.querySelectorAll("#screen *, #nav *, .sheet *")) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (rect.right > width + 1 && !inScroller(el)) out.push(`past the right edge: ${label(el)} right=${Math.round(rect.right)}`);
      const interactive = el.matches("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=switch], [role=checkbox]");
      if (interactive && getComputedStyle(el).visibility !== "hidden" && (rect.height < 43.5 || rect.width < 43.5)) out.push(`small tap target ${Math.round(rect.width)}x${Math.round(rect.height)}: ${label(el)}`);
    }
    return out;
  });
  assert.deepEqual(problems, [], `${name}: layout problems`);
}

// A viewport shot as the person sees it, and the whole page with the bottom
// navigation moved into the flow so it does not cover the middle.
export async function shot(page, name) {
  await page.waitForTimeout(250);
  await audit(page, name);
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`) });
  const style = await page.addStyleTag({ content: ".nav { position: static !important; } .toasts { display: none !important; }" });
  await page.screenshot({ path: path.join(shotsDir, "full", `${name}.png`), fullPage: true });
  await style.evaluate((node) => node.remove());
}

export const text = (locator) => locator.innerText().then((s) => s.replace(/\s+/g, " ").trim());
export const rationWidget = (page) => page.locator('[data-widget="ration-today"]');
export const eatenKcal = async (page) => Number((await text(rationWidget(page).locator(".metric-value"))).replace(/\s/g, ""));

export async function back(page) {
  await page.getByRole("button", { name: "Назад" }).click();
}

export async function tapNav(page, name) {
  await page.locator("#nav").getByText(name, { exact: true }).click();
}

// Screens re-render a task after the click that changed the store: wait for
// the text instead of reading it once. Returns the matched text.
export async function waitText(locator, pattern, timeout = 10000) {
  const end = Date.now() + timeout;
  let last = "";
  for (;;) {
    last = await text(locator.first()).catch(() => "");
    if (pattern.test(last)) return last;
    if (Date.now() > end) assert.fail(`${pattern} never matched: «${last}»`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
