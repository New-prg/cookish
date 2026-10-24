import assert from "node:assert/strict";
import { test } from "node:test";
import { baseUrl, openApp, useUi } from "./objects-ui-helpers.mjs";

useUi("objects-shots-kit-element");

const galleryUrl = () => new URL("objects/viz/gallery.html?today=2026-10-24", baseUrl).href;

test("an element written with `of` takes its data from the registered source and asks again when of, where or value change", async () => {
  const app = await openApp();
  await app.page.goto(galleryUrl(), { waitUntil: "load" });
  await app.page.waitForSelector("html[data-ready]");
  const result = await app.page.evaluate(async (sourceUrl) => {
    const { setDataSource } = await import(sourceUrl);
    const asked = [];
    setDataSource((spec) => {
      if (spec.of) asked.push(`${spec.of}|${spec.value}|${spec.where ?? ""}`);
      return spec.of ? { value: spec.where ? 700 : 1500, unit: "мл", label: "Вода", rows: 3, goal: null, goalType: "min", segments: null } : null;
    });
    const stat = document.createElement("c-stat");
    stat.setAttribute("of", "water");
    stat.setAttribute("value", "ml");
    stat.setAttribute("range", "@today");
    document.body.append(stat);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
    await settle();
    const first = { text: stat.textContent, empty: stat.hasAttribute("data-empty") };
    stat.setAttribute("where", "ml=250");
    await settle();
    const withWhere = stat.textContent;
    stat.setAttribute("value", "kcal");
    await settle();
    stat.setAttribute("of", "tea");
    await settle();
    stat.remove();
    setDataSource(null);
    return { asked, first, withWhere };
  }, new URL("objects/viz/source.js", baseUrl).href);
  assert.deepEqual(result.asked, ["water|ml|", "water|ml|ml=250", "water|kcal|ml=250", "tea|kcal|ml=250"], "each of the three attributes triggers a refresh with the new spec");
  assert.equal(result.first.empty, false);
  assert.match(result.first.text, /1\D?500/, "the number the source returned is drawn");
  assert.match(result.withWhere, /700/);
  assert.deepEqual(app.errors, []);
  await app.context.close();
});
