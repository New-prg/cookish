// Opens screens of objects.html in Chromium at 390x844, light, on a fixed clock,
// runs the render audit, takes the screenshot and performs the smoke
// interactions. Every number it returns is read from the page or from the
// store the page saved, never reported by a model.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { serveShell } from "../../serve-objects.mjs";
import { NOW, STORAGE_KEY } from "./common.mjs";

export const VIEWPORT = { width: 390, height: 844 };
const MAX_PER_KIND = 4;

// The input elements of the kit and the one interaction a smoke test performs on
// each. An `act` presses the button, returns its label and may report a note;
// it returns null when the element has no button to press.
//   c-quick: the first button.
//   c-marks: the first state button of the first unmarked row; when the state
//            asks for fields, the ask form is then submitted as it stands.
//   c-form:  the submit with the defaults. A form that refuses an empty submit
//            (its error line shows) is filled with minimal values and sent again,
//            and the result says so in `mode`.
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
// a small range gets a value inside it on the next pass.
async function fillForm(form, limits) {
  for (const input of await form.locator("input.kit-input[type=text]:visible").all()) {
    const numeric = (await input.getAttribute("inputmode")) === "decimal";
    const name = numeric ? await fieldName(input) : "";
    if (numeric && limits.has(name)) { await input.fill(limits.get(name)); continue; }
    if (await input.inputValue()) continue;
    await input.fill(numeric ? "5" : "проверка");
  }
  for (const input of await form.locator("input.kit-input[type=time]:visible").all()) if (!(await input.inputValue())) await input.fill("08:00");
  for (const select of await form.locator("select.kit-input:visible").all()) if (!(await select.inputValue())) await select.selectOption({ index: 1 }).catch(() => {});
  for (const group of await form.locator(".kit-picker:visible").all()) {
    if (!(await group.locator("[aria-pressed=true]").count())) await group.locator("button").first().click();
  }
}

async function submitForm(page, form, submit) {
  const out = await press(submit);
  if (!out || out.skipped) return out;
  await page.waitForTimeout(300);
  out.mode = "defaults";
  const limits = new Map();
  for (let pass = 0; pass < 5 && (await showsError(form)); pass += 1) {
    const text = (await form.locator(".kit-error:not([hidden])").first().innerText()).trim();
    const bound = /^(.+?): не (?:больше|меньше) (-?[\d\s.,]+)/.exec(text);
    if (bound) limits.set(bound[1].trim(), bound[2].replace(/\s/g, "").replace(",", "."));
    await fillForm(form, limits);
    await submit.click({ timeout: 4000 });
    await page.waitForTimeout(300);
    out.mode = "filled";
  }
  if (await showsError(form)) out.note = `форма отказала: ${(await form.locator(".kit-error:not([hidden])").first().innerText()).trim().slice(0, 120)}`;
  return out;
}

export const KIT_INPUTS = {
  "c-quick": { selector: "c-quick", act: async (page, el) => press(el.locator("button").first()) },
  "c-marks": {
    selector: "c-marks",
    act: async (page, el) => {
      const unmarked = el.locator('li.kit-mark[data-state="none"]');
      const row = (await unmarked.count()) ? unmarked.first() : el.locator("li.kit-mark").first();
      const button = row.locator(".kit-buttons button:not(.is-quiet)").first();
      // A follow row shows its form at once, its button is the submit.
      if (await row.locator("form.kit-form:not(.kit-ask)").count()) return submitForm(page, row.locator("form.kit-form").first(), button);
      const out = await press(button);
      if (!out || out.skipped) return out;
      await page.waitForTimeout(300);
      const ask = el.locator("form.kit-ask");
      if (await ask.count()) return { ...(await submitForm(page, ask.first(), ask.first().locator("button[type=submit]"))), label: out.label };
      return out;
    },
  },
  "c-form": {
    selector: "c-form",
    act: async (page, el) => {
      const form = el.locator("form").first();
      return submitForm(page, form, form.locator("button[type=submit]").first());
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

// A page on the space `serialized`, with the clock stopped at NOW.
export async function openPage({ browser, origin }, serialized, hash) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    colorScheme: "light",
    timezoneId: "UTC",
    locale: "ru-RU",
    storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: STORAGE_KEY, value: serialized }] }] },
  });
  await context.clock.setFixedTime(new Date(NOW));
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

async function smokeOne({ browser, origin }, serialized, hash, kinds, tag, index) {
  let opened;
  try {
    opened = await openPage({ browser, origin }, serialized, hash);
  } catch (error) {
    if (error instanceof BlankScreen) return null;
    throw error;
  }
  const { page, context, errors } = opened;
  const result = { element: tag, index, label: "", clicked: false, ok: false, mode: "defaults", newObject: false, created: [], changed: [], pageErrors: [], note: "" };
  try {
    const element = page.locator(`#screen ${kinds[tag].selector}`).nth(index);
    const before = await readStore(page);
    errors.length = 0;
    const acted = await kinds[tag].act(page, element);
    if (!acted) {
      // Nothing scheduled for today is a state of the answer, not a missed tap.
      result.skipped = (await element.getAttribute("data-empty")) !== null;
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
      const style = await page.addStyleTag({ content: ".nav { position: static !important; } .toasts { display: none !important; }" });
      await page.screenshot({ path: png, fullPage: true });
      await style.evaluate((node) => node.remove());
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
