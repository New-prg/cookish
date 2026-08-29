import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shellDir = path.join(root, "mobile-shell");

let server;
let baseUrl;
let browser;

before(async () => {
  server = http.createServer((request, response) => {
    const url = request.url === "/" ? "/index.html" : request.url.split("?")[0];
    const file = path.join(shellDir, decodeURIComponent(url));
    fs.readFile(file, (error, data) => {
      if (error) {
        response.writeHead(404);
        response.end();
        return;
      }
      const type = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      }[path.extname(file)] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
      response.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});

async function openPage(viewport = { width: 412, height: 915 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    throw new Error(`Unhandled page error: ${error.message}`);
  });
  await page.goto(baseUrl, { waitUntil: "load" });
  return { context, page };
}

async function openRoute(page, route) {
  await page.click(`nav button[data-route="${route}"]`);
  await page.waitForTimeout(50);
}

test("smoke: request with two items and one purchase mark", async () => {
  const { context, page } = await openPage();
  try {
    await page.click("#summary-empty-request");
    await page.waitForSelector("#request-items .request-line-editor");
    const first = page.locator("#request-items .request-line-editor").first();
    await first.click();
    await first.fill("Хлеб");
    await first.press("Enter");
    await page.waitForTimeout(120);
    assert.equal(await page.locator("#request-items .request-item.is-resolved").count(), 1);
    await page.click("#add-request-item");
    await page.waitForTimeout(80);
    const second = page.locator("#request-items .request-line-editor").nth(1);
    await second.click();
    await second.fill("Молоко");
    await second.press("Enter");
    await page.waitForTimeout(120);
    assert.equal(await page.locator("#request-items .request-item.is-resolved").count(), 2);

    await page.click("#header-action");
    await page.waitForTimeout(120);
    await page.locator(".request-link").first().click();
    await page.waitForSelector("#request-items .request-line-editor");

    const firstRow = page.locator("#request-items .request-item:not(.is-blank)").first();
    const box = await firstRow.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 160, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForSelector("#answer-action-dialog[open]", { timeout: 3000 });
    await page.click("#save-purchase-item");
    await page.waitForTimeout(120);

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cookish.android.data.v1")));
    const request = stored.requests[0];
    assert.equal(request.items.length, 2);
    const boughtLines = request.responses.filter((response) => !response.deletedAt)
      .flatMap((response) => response.items);
    assert.equal(boughtLines.length, 1);
    assert.ok(boughtLines[0].quantity > 0);
  } finally {
    await context.close();
  }
});

test("smoke: ration opens the today screen with states and rail", async () => {
  const { context, page } = await openPage();
  try {
    await openRoute(page, "ration");
    await page.waitForSelector(".ration-today");
    assert.ok(await page.locator(".ration-rail-flag").count() === 2);
    assert.equal(await page.locator("#ration-view-button").count(), 0);

    const bodyText = await page.locator("#app").innerText();
    assert.doesNotMatch(bodyText, /Цикл|Версия/);
    assert.match(bodyText, /не отмечено|На сегодня приёмов пока нет/);

    await page.click("#ration-add-meal");
    await page.waitForSelector("#ration-meal-dialog[open]");
    assert.ok(await page.locator("#ration-meal-dialog .ration-state-set").count() >= 4);
    await page.click("#close-ration-meal");
    await page.waitForTimeout(80);

    const meal = page.locator(".ration-today-meal").first();
    await meal.locator(".ration-eat-button").click();
    await page.waitForTimeout(80);
    const chip = await page.locator(".ration-today-meal .ration-state-chip").first().innerText();
    assert.equal(chip, "съедено");
    assert.ok((await page.locator(".ration-today-meal.state-eaten").count()) === 1);
  } finally {
    await context.close();
  }
});

test("smoke: ration plan overlay edits a future day and creates a request", async () => {
  const { context, page } = await openPage();
  try {
    await openRoute(page, "ration");
    await page.click('.ration-rail-flag[data-overlay="plan"]');
    await page.waitForSelector(".ration-overlay");
    const days = page.locator(".ration-overlay-day");
    assert.equal(await days.count(), 14);
    await days.nth(0).click();
    await page.waitForSelector(".ration-overlay-editor");
    await page.click(".ration-overlay-editor .add-ration-meal");
    await page.waitForSelector(".ration-overlay-editor .add-ration-food");
    await page.click(".ration-overlay-editor .add-ration-food");
    const input = page.locator(".ration-overlay-editor .ration-food-input").last();
    await input.fill("Крупа");
    await page.locator(".ration-overlay-editor .save-ration-food").last().click();
    await page.waitForTimeout(80);

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cookish.android.data.v1")));
    const specialDates = Object.keys(stored.ration.specialDays);
    assert.equal(specialDates.length, 1);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const key = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    assert.ok(specialDates[0].endsWith(key));

    await page.click("#ration-plan-request button[type=submit]");
    await page.waitForTimeout(150);
    const afterRequest = await page.evaluate(() => JSON.parse(localStorage.getItem("cookish.android.data.v1")));
    assert.equal(afterRequest.requests.length, 1);
    assert.equal(afterRequest.requests[0].items[0].unit, "уп.");
  } finally {
    await context.close();
  }
});

test("smoke: profile opens and bottom navigation stays pinned", async () => {
  const { context, page } = await openPage();
  try {
    for (const route of ["summary", "requests", "ration", "profile"]) {
      await openRoute(page, route);
      const nav = await page.locator("nav.bottom-nav").boundingBox();
      const viewport = page.viewportSize();
      assert.ok(nav, `nav must exist on ${route}`);
      assert.ok(nav.y > 0 && nav.y + nav.height <= viewport.height + 1, `nav must stay pinned on ${route}`);
      assert.ok((await page.locator("#app").innerText()).length > 0, `main must render on ${route}`);
    }
    assert.match(await page.locator("#app").innerText(), /Обнов|Данные|Очистить/);
  } finally {
    await context.close();
  }
});

test("smoke: action elements stay visible at 360 px width", async () => {
  const { context, page } = await openPage({ width: 360, height: 780 });
  try {
    await openRoute(page, "ration");
    await page.waitForSelector(".ration-today-meal, .ration-today");
    const scrollWidth = await page.evaluate(() => document.scrollingElement.scrollWidth);
    assert.ok(scrollWidth <= 360, `no horizontal overflow at 360 px, got ${scrollWidth}`);
    const rail = await page.locator(".ration-rail").boundingBox();
    assert.ok(rail && rail.x + rail.width <= 360);
    const eatButton = page.locator(".ration-eat-button").first();
    if (await eatButton.count()) {
      const eat = await eatButton.boundingBox();
      assert.ok(eat.x + eat.width <= rail.x + 1, "eat action must not be covered by the rail");
    }
    await openRoute(page, "requests");
    assert.ok(await page.locator("nav.bottom-nav").isVisible());
  } finally {
    await context.close();
  }
});
