// Opens screens of objects.html in Chromium at 390x844, light, on a fixed clock,
// runs the render audit, takes the screenshot and performs the smoke
// interactions. Every number it returns is read from the page or from the
// store the page saved, never reported by a model.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { serveShell } from "../../serve-objects.mjs";
import { NOW, STORAGE_KEY, TODAY } from "./common.mjs";

export const VIEWPORT = { width: 390, height: 844 };
const MAX_PER_KIND = 4;
const MAX_SEEDED_PER_KIND = 2;

// The input elements of the kit and the one interaction a smoke test performs on
// each. An `act` presses the button, returns its label and may report a note;
// it returns null when the element has no button to press.
//   c-quick: the first button.
//   c-marks: the first state button of the first unmarked row; when the state
//            asks for fields, the ask form is then submitted as it stands. A list
//            with nothing in it but an «Добавить» button is added to first: the
//            button is pressed, a name typed and the form saved.
//   c-add:   the same add flow, for the form under a list with `add`.
//   c-form:  the submit with the defaults. A form that refuses an empty submit
//            (its error line shows) is filled with minimal values and sent again,
//            and the result says so in `mode`. Fill: text gets a word, a number 5
//            or the bound its error named, a time 08:00, a date the page's today,
//            a select or a picker its first option; a link with no rows to pick
//            from is reported in the note, not hidden.
export async function press(button) {
  if (!(await button.count())) return null;
  const label = ((await button.getAttribute("aria-label")) || (await button.innerText()) || "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!(await button.isEnabled())) return { label, note: "кнопка отключена", skipped: true };
  await button.click({ timeout: 4000 });
  return { label };
}

const showsError = (form) => form.locator(".kit-error:not([hidden])").count().then((n) => n > 0);

// The name of a field, as the form's error line spells it.
const fieldName = (input) => input.evaluate((el) => (el.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ").replace(/\*/g, "").trim());

// Minimal valid input for a form that rejected the last submit. `limits` maps a
// field name to the bound its error line named («не больше 20»), so a field with
// a small range gets a value inside it on the next pass. `day` is the page's
// today. Returns the fields that cannot be filled at all.
async function fillForm(form, limits, day) {
  const blocked = [];
  for (const input of await form.locator("input.kit-input[type=text]:visible").all()) {
    const numeric = (await input.getAttribute("inputmode")) === "decimal";
    const name = numeric ? await fieldName(input) : "";
    if (numeric && limits.has(name)) { await input.fill(limits.get(name)); continue; }
    if (await input.inputValue()) continue;
    await input.fill(numeric ? "5" : "проверка");
  }
  for (const input of await form.locator("input.kit-input[type=time]:visible").all()) if (!(await input.inputValue())) await input.fill("08:00");
  for (const input of await form.locator("input.kit-input[type=date]:visible").all()) if (!(await input.inputValue())) await input.fill(day);
  for (const select of await form.locator("select.kit-input:visible").all()) {
    if (await select.inputValue()) continue;
    const first = await select.locator("option:not([value=''])").first().getAttribute("value").catch(() => null);
    if (first) await select.selectOption(first).catch(() => {});
  }
  for (const group of await form.locator(".kit-picker:visible").all()) {
    if (!(await group.locator("[aria-pressed=true]").count())) await group.locator("button").first().click();
  }
  for (const hint of await form.locator(".kit-hint:visible", { hasText: "Вариантов пока нет" }).all()) {
    const field = hint.locator("xpath=ancestor::div[contains(@class,'kit-field')][1]/span[contains(@class,'kit-label')]");
    blocked.push(((await field.count()) ? (await field.first().innerText()).replace(/\*/g, "").trim() : "") || "поле выбора");
  }
  return blocked;
}

async function submitForm(page, form, submit, { day, prefill = false } = {}) {
  const limits = new Map();
  const blocked = new Set();
  if (prefill) (await fillForm(form, limits, day)).forEach((b) => blocked.add(b));
  const out = await press(submit);
  if (!out || out.skipped) return out;
  await page.waitForTimeout(300);
  out.mode = prefill ? "filled" : "defaults";
  for (let pass = 0; pass < 5 && (await showsError(form)); pass += 1) {
    const text = (await form.locator(".kit-error:not([hidden])").first().innerText()).trim();
    const bound = /^(.+?): не (?:больше|меньше) (-?[\d\s.,]+)/.exec(text);
    if (bound) limits.set(bound[1].trim(), bound[2].replace(/\s/g, "").replace(",", "."));
    (await fillForm(form, limits, day)).forEach((b) => blocked.add(b));
    await submit.click({ timeout: 4000 });
    await page.waitForTimeout(300);
    out.mode = "filled";
  }
  if (await showsError(form)) out.note = `форма отказала: ${(await form.locator(".kit-error:not([hidden])").first().innerText()).trim().slice(0, 120)}`;
  if (blocked.size) out.note = `${out.note ? `${out.note}; ` : ""}нечего выбрать в поле ${[...blocked].map((b) => `«${b}»`).join(", ")}: вариантов нет`;
  return out;
}

// «Добавить», a name, the fields, save: the way a person fills an empty list.
async function addFlow(page, root, ctx) {
  const open = root.locator(".kit-add button").first();
  if (!(await open.count())) return null;
  const first = await press(open);
  await page.waitForTimeout(150);
  const form = root.locator("form.kit-add").first();
  if (!(await form.count())) return { ...first, note: "кнопка «Добавить» не открыла форму" };
  const out = await submitForm(page, form, form.locator("button[type=submit]").first(), { ...ctx, prefill: true });
  return { ...out, label: first.label };
}

export const KIT_INPUTS = {
  "c-quick": { selector: "c-quick", act: async (page, el) => press(el.locator("button").first()) },
  "c-marks": {
    selector: "c-marks",
    act: async (page, el, ctx) => {
      if (!(await el.locator("li.kit-mark").count())) return addFlow(page, el, ctx);
      const unmarked = el.locator('li.kit-mark[data-state="none"]');
      const row = (await unmarked.count()) ? unmarked.first() : el.locator("li.kit-mark").first();
      const button = row.locator(".kit-buttons button:not(.is-quiet)").first();
      // A follow row shows its form at once, its button is the submit.
      if (await row.locator("form.kit-form:not(.kit-ask)").count()) return submitForm(page, row.locator("form.kit-form").first(), button, ctx);
      const out = await press(button);
      if (!out || out.skipped) return out;
      await page.waitForTimeout(300);
      const ask = el.locator("form.kit-ask");
      if (await ask.count()) return { ...(await submitForm(page, ask.first(), ask.first().locator("button[type=submit]"), ctx)), label: out.label };
      return out;
    },
  },
  "c-add": { selector: "c-add", act: async (page, el, ctx) => addFlow(page, el, ctx) },
  "c-form": {
    selector: "c-form",
    act: async (page, el, ctx) => {
      const form = el.locator("form").first();
      return submitForm(page, form, form.locator("button[type=submit]").first(), ctx);
    },
  },
};

export const RENDER_LIMIT_MS = Number(process.env.LAB_RENDER_LIMIT_MS) || 150_000;

// A page that showed nothing: the answer's fault when the page reported errors
// or stayed blank on a second try, so it is a value, not a lab failure.
export class BlankScreen extends Error {}
const MODULE_FAILURE = /Invalid or unexpected token|Unexpected (token|end|identifier)|SyntaxError|Failed to (fetch|load)|does not provide an export|Cannot find module|Importing a module script failed/i;

// One static server and one Chromium for `fn`. After limitMs the browser is
// closed under it, so a hung render ends as a lab error instead of hanging.
export async function withBrowser(fn, { limitMs = RENDER_LIMIT_MS } = {}) {
  const server = await serveShell(0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let timedOut = false;
  let timer;
  try {
    browser = await chromium.launch();
    timer = setTimeout(() => { timedOut = true; browser.close().catch(() => {}); }, limitMs);
    return await fn({ browser, origin });
  } catch (error) {
    if (timedOut) throw new Error(`отрисовка не уложилась в ${Math.round(limitMs / 1000)} с`);
    throw error;
  } finally {
    clearTimeout(timer);
    await browser?.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

// A page on the space `serialized`, with the clock stopped at 09:00 UTC of `day`
// (the lab's fixed today unless a smoke test needs the next due day).
export async function openPage({ browser, origin }, serialized, hash, day = TODAY) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    colorScheme: "light",
    timezoneId: "UTC",
    locale: "ru-RU",
    storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: STORAGE_KEY, value: serialized }] }] },
  });
  await context.clock.setFixedTime(new Date(day === TODAY ? NOW : `${day}T09:00:00.000Z`));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/favicon/i.test(text) || (/Failed to load resource/.test(text) && /favicon/i.test(message.location().url || ""))) return;
    errors.push(`console: ${text}`);
  });
  await page.goto(`${origin}/objects.html${hash}`, { waitUntil: "load", timeout: 30_000 });
  const shown = (timeout) => page.locator("#screen > *").first().waitFor({ timeout }).then(() => true, () => false);
  // Errors on the page make a blank screen the answer's fault at once; without
  // any, one reload on a longer wait rules out a slow machine.
  if (!(await shown(8000)) && !errors.length) {
    await page.reload({ waitUntil: "load", timeout: 30_000 });
    await shown(20_000);
  }
  if (!(await page.locator("#screen > *").count())) {
    await context.close();
    // The app's own code failing to load is the lab's or the kit's fault, never the answer's.
    if (errors.some((e) => MODULE_FAILURE.test(e))) throw new Error(`код приложения не загрузился на ${hash}: ${errors.slice(0, 2).join(" | ")}`);
    throw new BlankScreen(`страница ${hash} ничего не показала${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : " (ни содержимого, ни ошибок)"}`);
  }
  await settle(page);
  return { page, context, errors };
}

// Waits until the screen's markup stops changing.
export async function settle(page) {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 50 && stable < 2; i += 1) {
    const size = await page.evaluate(() => document.getElementById("screen").innerHTML.length);
    stable = size === last ? stable + 1 : 0;
    last = size;
    await page.waitForTimeout(120);
  }
}

export const readStore = (page) => page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);

export function diffObjects(beforeText, afterText) {
  const before = JSON.parse(beforeText).objects || {};
  const after = JSON.parse(afterText).objects || {};
  const brief = (o) => ({ id: o.id, type: o.type, name: o.name, by: o.updatedBy });
  const created = Object.values(after).filter((o) => !before[o.id]).map((o) => ({ ...brief(o), by: o.createdBy }));
  const changed = Object.values(after).filter((o) => before[o.id] && JSON.stringify(before[o.id]) !== JSON.stringify(o)).map(brief);
  return { created, changed };
}

async function inventory(page, kinds, expectCards) {
  return page.evaluate(({ selectors, titles }) => {
    const screen = document.getElementById("screen");
    const flat = (s) => s.replace(/\s+/g, " ").trim();
    const whole = flat(screen.innerText);
    const count = (sel) => screen.querySelectorAll(sel).length;
    return {
      cards: count("c-card"),
      inputs: Object.fromEntries(Object.entries(selectors).map(([name, sel]) => [name, count(sel)])),
      broken: [...screen.querySelectorAll("[data-error]")].map((el) => `${el.localName}: ${el.getAttribute("data-error")}`),
      refused: [...screen.querySelectorAll(".kit-refused")].map((el) => flat(el.innerText)),
      missingCards: titles.filter((t) => !whole.includes(flat(t))),
      text: whole.slice(0, 2500),
    };
  }, { selectors: Object.fromEntries(Object.entries(kinds).map(([name, k]) => [name, k.selector])), titles: expectCards });
}

// Only the kit's own part of the page is audited, as tests/objects-ui-kit.test.mjs does:
// the classic widgets of the home are not the builder's work.
export async function audit(page) {
  return page.evaluate(async () => {
    const { auditRendered } = await import("/objects/viz/audit.js");
    const roots = [...document.querySelectorAll("#screen .kit-home, #screen .kit-screen, #screen .kit-follow")];
    return roots.length ? roots.flatMap((root) => auditRendered(root)) : auditRendered(document.getElementById("screen"));
  });
}

// The text of every card of the kit's part of the screen, so a tap can be shown
// as the cards it changed.
async function cardsText(page) {
  return page.evaluate(() => {
    const flat = (s) => s.replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll("#screen .kit-home c-card, #screen .kit-screen c-card")].map((card, i) => {
      const title = flat(card.querySelector(".viz-card-title")?.textContent || card.getAttribute("title") || `карточка ${i + 1}`);
      // A chart's numbers as the page holds them, since the drawn axis says little as text.
      const charts = [...card.querySelectorAll("c-bars, c-line, c-spark, c-heatmap")].map((el) => {
        const d = el._resolved;
        if (!d || !Array.isArray(d.buckets) || !Array.isArray(d.series) || !d.series.length) return "";
        const cut = Math.max(0, d.buckets.length - 40);
        const label = (b) => (/^\d{4}-\d{2}-\d{2}$/.test(b) ? b.slice(5) : String(b));
        const rows = d.series.map((ser) => `${d.series.length > 1 ? `${ser.label}: ` : ""}${d.buckets.slice(cut).map((b, i) => `${label(b)}=${ser.values[cut + i] == null ? "–" : Math.round(ser.values[cut + i] * 100) / 100}`).join(" ")}`);
        return `Данные графика ${el.localName.slice(2)}${d.unit ? ` (${d.unit})` : ""}${d.goal != null ? `, цель ${d.goal}` : ""}: ${rows.join(" | ")}`;
      }).filter(Boolean);
      return { title, text: flat(card.innerText).replace(title, "").trim().slice(0, 900), charts };
    });
  });
}

const toastText = (page) => page.evaluate(() => (document.getElementById("toasts")?.innerText || "").replace(/\s+/g, " ").trim());

const PAGE_STYLE = ".nav { position: static !important; } .toasts { display: none !important; }";

async function shoot(page, file) {
  const style = await page.addStyleTag({ content: PAGE_STYLE });
  await page.screenshot({ path: file, fullPage: true });
  await style.evaluate((node) => node.remove());
}

// One tap on one element on a fresh page. `day` is the page's today. `shots`,
// when given, is { dir, key, taken } and the first tap of the route saves the
// screen after it; `cards` makes the result carry the cards that tap changed.
async function smokeOne({ browser, origin }, serialized, hash, kinds, tag, index, { day = TODAY, shots = null, cards = false } = {}) {
  let opened;
  try {
    opened = await openPage({ browser, origin }, serialized, hash, day);
  } catch (error) {
    if (error instanceof BlankScreen) return null;
    throw error;
  }
  const { page, context, errors } = opened;
  const result = { element: tag, index, label: "", clicked: false, ok: false, mode: "defaults", newObject: false, created: [], changed: [], pageErrors: [], note: "", day };
  try {
    const element = page.locator(`#screen ${kinds[tag].selector}`).nth(index);
    result.of = await element.getAttribute("of");
    const before = await readStore(page);
    const cardsBefore = cards ? await cardsText(page) : null;
    errors.length = 0;
    const acted = await kinds[tag].act(page, element, { day });
    if (!acted) {
      // Nothing scheduled for today is a state of the answer, not a missed tap.
      result.skipped = (await element.getAttribute("data-empty")) !== null || (tag === "c-marks" && !(await element.locator("li.kit-mark, .kit-add").count()));
      result.note = result.skipped ? "нечего нажимать: на этот день ничего нет" : "в элементе нет кнопки";
      return result;
    }
    result.label = acted.label;
    if (acted.mode) result.mode = acted.mode;
    if (acted.skipped) { result.note = acted.note; return result; }
    let after = before;
    for (let i = 0; i < 25 && after === before; i += 1) {
      await page.waitForTimeout(100);
      after = await readStore(page);
    }
    await page.waitForTimeout(300);
    after = await readStore(page);
    result.clicked = true;
    const diff = diffObjects(before, after);
    result.created = diff.created;
    result.changed = diff.changed;
    result.pageErrors = [...errors];
    // A mark on an item that already has one is an update, not a new object.
    const written = [...diff.created, ...diff.changed].filter((o) => o.by === "human");
    result.newObject = diff.created.some((o) => o.by === "human");
    result.ok = written.length > 0 && !errors.length;
    if (acted.note && !result.note) result.note = acted.note;
    if (!written.length) result.note = result.note || (diff.created.length || diff.changed.length ? "запись сделана не от имени человека" : "данные не записаны");
    else if (errors.length) result.note = "страница написала ошибку";
    if (cards) {
      await settle(page);
      result.toast = await toastText(page);
      const cardsAfter = await cardsText(page);
      const whole = (c) => (c ? [c.text, ...(c.charts || [])].join(" ¦ ") : "");
      result.changedCards = cardsAfter.map((c) => ({ title: c.title, before: whole(cardsBefore.find((b) => b.title === c.title)), after: whole(c) })).filter((c) => c.before !== c.after);
      result.cardsAfter = cardsAfter;
    }
    if (shots && !shots.taken) {
      shots.taken = true;
      result.png = `screen-${shots.key}-seeded-after.png`;
      await shoot(page, path.join(shots.dir, result.png));
    }
  } catch (error) {
    result.note = `не удалось нажать: ${String(error.message).split("\n")[0]}`;
    result.pageErrors = [...errors];
  } finally {
    await context.close();
  }
  return result;
}

// routes: [{ key, hash, expectCards? }]; expectCards are the titles the screen
// must show, so a route the app does not know (it falls back to home) is caught.
// → one entry per route.
export async function renderRoutes(env, serialized, routes, outDir, { smoke = true, kinds = KIT_INPUTS } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const out = [];
  for (const route of routes) {
    let opened;
    try {
      opened = await openPage(env, serialized, route.hash);
    } catch (error) {
      if (!(error instanceof BlankScreen)) throw error;
      out.push({ key: route.key, hash: route.hash, png: "", cards: 0, missingCards: [], refused: [], inputs: {}, broken: [], text: "", audit: [], pageErrors: [], smoke: [], blank: error.message });
      continue;
    }
    const { page, context, errors } = opened;
    let entry;
    try {
      const inv = await inventory(page, kinds, route.expectCards || []);
      const problems = await audit(page);
      const png = path.join(outDir, `screen-${route.key}.png`);
      await shoot(page, png);
      entry = { key: route.key, hash: route.hash, png: path.basename(png), cards: inv.cards, missingCards: inv.missingCards, refused: inv.refused, inputs: inv.inputs, broken: inv.broken, text: inv.text, audit: problems, pageErrors: [...errors], smoke: [] };
    } finally {
      await context.close();
    }
    if (smoke) {
      for (const tag of Object.keys(kinds)) {
        for (let i = 0; i < Math.min(entry.inputs[tag], MAX_PER_KIND); i += 1) {
          const done = await smokeOne(env, serialized, route.hash, kinds, tag, i);
          if (done) entry.smoke.push(done);
        }
      }
    }
    out.push(entry);
  }
  return out;
}

// The same routes on the seeded copy of the space: the screen as it looks with
// two weeks of history (`screen-<key>-seeded.png`, the cards' text), then the
// smoke taps with the cards each one changed and the screen after the first
// (`screen-<key>-seeded-after.png`). An element that has nothing to tap today
// is tapped on the next day it has something (`nextDue(track) → date | null`),
// and the result says which day. A tap that cannot be made is reported, never
// dressed up: the seed does not decide whether an input works.
// → one entry per route: { png, cards[], audit, pageErrors, blank?, smoke[] }.
export async function renderSeeded(env, serialized, routes, outDir, { kinds = KIT_INPUTS, nextDue = () => null } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const out = [];
  for (const route of routes) {
    let opened;
    try {
      opened = await openPage(env, serialized, route.hash);
    } catch (error) {
      if (!(error instanceof BlankScreen)) throw error;
      out.push({ key: route.key, png: "", cards: [], audit: [], pageErrors: [], smoke: [], blank: error.message });
      continue;
    }
    const { page, context, errors } = opened;
    let entry;
    try {
      const inv = await inventory(page, kinds, []);
      const png = `screen-${route.key}-seeded.png`;
      await shoot(page, path.join(outDir, png));
      entry = { key: route.key, png, cards: await cardsText(page), audit: await audit(page), pageErrors: [...errors], smoke: [] };
      entry.inputs = inv.inputs;
    } finally {
      await context.close();
    }
    const shots = { dir: outDir, key: route.key, taken: false };
    for (const tag of Object.keys(kinds)) {
      for (let i = 0; i < Math.min(entry.inputs[tag], MAX_SEEDED_PER_KIND); i += 1) {
        let done = await smokeOne(env, serialized, route.hash, kinds, tag, i, { shots, cards: true });
        if (done?.skipped && done.of) {
          const day = nextDue(done.of);
          if (day) {
            const later = await smokeOne(env, serialized, route.hash, kinds, tag, i, { day, shots, cards: true });
            if (later) done = { ...later, note: `${later.note ? `${later.note}; ` : ""}сегодня отмечать нечего, нажатие сделано в ближайший день с расписанием, ${day}`.trim() };
          }
        }
        if (done) entry.smoke.push(done);
      }
    }
    delete entry.inputs;
    out.push(entry);
  }
  return out;
}
