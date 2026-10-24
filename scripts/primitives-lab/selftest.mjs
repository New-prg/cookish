// End-to-end proof of the lab:
//   node scripts/primitives-lab/selftest.mjs
// Exits 0 when every assertion holds, 1 otherwise. Pieces that wait for another
// agent's module print ОЖИДАЕТ and do not fail the run.
//   1. spaces are built and rebuild byte for byte;
//   2. the hand-built water space (lib/fixture.mjs) is described and diffed;
//   3. the real browser path: render, audit, screenshot, smoke interaction, on
//      the hand-built space and on the demo's day screen (a button that writes,
//      a button that does not);
//   4. the CLIs prepare, check, judge-packet and report over a run folder, with
//      fake kit modules (LAB_KIT_DIR) standing in for K1, K3 and K5;
//   5. the real kit modules, when they exist, over the kit's own examples.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LAB, ROOT, SHELL, SURFACES, TODAY, exists, need, openStore, readJson, readLines, readText, run, spaceFile, writeJson, writeText } from "./lib/common.mjs";
import { builtCounts, builtLine, changedScreens, describeMarkdown } from "./lib/describe.mjs";
import { waterOps } from "./lib/fixture.mjs";
import { audit, diffObjects, openPage, press, renderRoutes, withBrowser } from "./lib/render.mjs";
import { buildSpaces } from "./spaces.mjs";

const OUT = path.join(ROOT, "output", "primitives", "lab-selftest");
const results = [];
const pending = [];

async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok      ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL    ${name}\n        ${String(error.message).split("\n").join("\n        ")}`);
  }
}
const wait = (what) => { pending.push(what); console.log(`ОЖИДАЕТ ${what}`); };

function cli(script, args, env = {}) {
  const r = spawnSync(process.execPath, [path.join(LAB, script), ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env }, timeout: 240000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// Fake kit modules: the scripts import them by path, LAB_KIT_DIR redirects.
function writeFakeKit(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  writeJson(path.join(dir, "package.json"), { type: "module" });
  const fixture = pathToFileURL(path.join(LAB, "lib", "fixture.mjs")).href;
  writeText(path.join(dir, "pipeline.js"), `import { waterOps } from ${JSON.stringify(fixture)};
export function checkBundle(raw) {
  if (!raw || !raw.name) return { ok: false, layer: "validate", problems: [{ path: "name", rule: "required", message: "у ответа нет name" }] };
  if (raw.bad) return { ok: false, layer: "validate", problems: Array.from({ length: 9 }, (_, i) => ({ path: "tracks.t" + i, rule: "bad-key", message: "плохой ключ " + i })) };
  if (raw.reply && !raw.build) return { ok: true, layer: "ok", problems: [], ops: [], changes: [] };
  return { ok: true, layer: "ok", problems: [], changes: ["name: убраны пробелы"], ops: waterOps(raw.refuse ? { weekAttrs: { onclick: "alert(1)" } } : {}) };
}
export function applyBundle(store, checked) {
  const r = store.apply(checked.ops, { actor: "human", summary: "selftest" });
  return r.ok ? { ok: true, changeSetId: r.changeSetId } : { ok: false, reason: r.reason };
}
`);
  writeText(path.join(dir, "markup.js"), `export function bundleFromMarkup(src) {
  const m = /<c-bundle[^>]*name="([^"]*)"/.exec(src);
  if (!m) return { bundle: null, problems: [{ path: "c-bundle", rule: "no-bundle", message: "нет тега c-bundle" }], changes: [] };
  return { bundle: { v: 2, name: m[1], build: true }, problems: [], changes: ["фраза вне разметки записана как ответ"] };
}
`);
  writeText(path.join(dir, "manual.js"), "export const renderManual = (state, { surface }) => `# Руководство (${surface})\\n\\nТекст руководства.`;\n");
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  let empty;
  let demo;

  await step("spaces: built, loadable and rebuilt byte for byte", async () => {
    const a = await buildSpaces();
    const b = await buildSpaces();
    assert.equal(a.empty, b.empty);
    assert.equal(a.demo, b.demo);
    assert.equal(cli("spaces.mjs", []).code, 0);
    empty = readText(spaceFile("empty"));
    demo = readText(spaceFile("demo"));
    assert.equal(empty, a.empty);
    assert.equal(demo, a.demo);
    assert.equal(Object.keys(JSON.parse(empty).objects).length, 1);
    assert.ok(Object.keys(JSON.parse(demo).objects).length > 300);
    const demoStore = (await openStore(demo)).store;
    assert.equal(demoStore.today(), TODAY);
  });

  let before;
  let after;
  let serializedAfter;
  await step("hand-built water space: described, diffed, screens found", async () => {
    const a = await openStore(empty);
    before = a.store.state();
    const r = a.store.apply(waterOps(), { actor: "human", summary: "лаб" });
    assert.equal(r.ok, true, r.reason);
    after = a.store.state();
    serializedAfter = a.storage.dump();
    assert.deepEqual(changedScreens(before, after), ["home", "water"]);
    assert.equal(builtLine(before, after), "трекеры: Вода; экраны: home (карточек затронуто 1), water (карточек затронуто 1)");
    const counts = builtCounts(before, after);
    assert.deepEqual({ ...counts }, { tracksNew: 1, tracksChanged: 0, tracksRemoved: 0, screensTouched: 2, cardsTouched: 2, cardsRemoved: 0, screensRemoved: 0, empty: false });
    const md = describeMarkdown(before, after);
    for (const needle of ["цель: не меньше 2000 в день", "единица мл", "от 1 до 5000", "шкала прогресса к цели", "кнопки быстрой записи", "Записей в хранилище: 7", "столбчатый график", "последние 7 дн."]) assert.ok(md.includes(needle), `описание без «${needle}»`);
    assert.deepEqual(builtCounts(after, after).empty, true, "ничего не менялось");
    assert.equal(changedScreens(after, after).length, 0);
  });

  await step("diffObjects: a new human object and an unchanged one", () => {
    const base = JSON.stringify({ objects: { a: { id: "a", type: "t", name: "A", createdBy: "human", updatedBy: "human" } } });
    const next = JSON.stringify({ objects: { a: { id: "a", type: "t", name: "A", createdBy: "human", updatedBy: "human" }, b: { id: "b", type: "t", name: "B", createdBy: "human", updatedBy: "human" } } });
    assert.deepEqual(diffObjects(base, next).created.map((o) => o.id), ["b"]);
    assert.deepEqual(diffObjects(base, next).changed, []);
    assert.deepEqual(diffObjects(next, next).created, []);
  });

  await step("browser: hand-built space on home renders, audits, saves a screenshot", async () => {
    const [entry] = await withBrowser((env) => renderRoutes(env, serializedAfter, [{ key: "home", hash: "#/" }], path.join(OUT, "direct"), { smoke: false }));
    const png = path.join(OUT, "direct", "screen-home.png");
    assert.ok(exists(png) && fs.statSync(png).size > 5000, "скриншот записан");
    assert.ok(Array.isArray(entry.audit) && Array.isArray(entry.pageErrors));
    assert.deepEqual(entry.pageErrors, [], "страница без ошибок");
    assert.match(entry.text, /Сегодня/, "экран главной открылся");
    if (entry.inputs["c-quick"] > 0) assert.deepEqual(entry.audit, [], "аудит кита чист");
  });

  await step("browser: smoke on the demo day screen, a writing button passes and a quiet one does not", async () => {
    const kinds = {
      meal: { selector: "[data-meal].state-unmarked", act: async (page, el) => press(el.locator(".seg-btn").first()) },
      quiet: { selector: "[data-meal].state-unmarked", act: async (page, el) => press(el.getByRole("button", { name: "Расхождение" })) },
    };
    const [entry] = await withBrowser((env) => renderRoutes(env, demo, [{ key: "ration", hash: `#/ration/${TODAY}` }], path.join(OUT, "direct"), { kinds }));
    assert.ok(entry.inputs.meal > 0, "в демо есть неотмеченный приём сегодня");
    const writes = entry.smoke.find((s) => s.element === "meal");
    assert.equal(writes.ok, true, JSON.stringify(writes));
    assert.ok(writes.created.length + writes.changed.length >= 1 && [...writes.created, ...writes.changed].every((o) => o.by === "human"));
    assert.deepEqual(writes.pageErrors, []);
    const quiet = entry.smoke.find((s) => s.element === "quiet");
    if (quiet.clicked) {
      assert.equal(quiet.ok, false, "кнопка без записи не засчитана");
      assert.deepEqual(quiet.created, []);
    }
  });

  await step("browser: the audit reports a real defect (a 20 px button on the screen)", async () => {
    const found = await withBrowser(async (env) => {
      const { page, context } = await openPage(env, serializedAfter, "#/");
      try {
        const clean = await audit(page);
        await page.evaluate(() => {
          const b = document.createElement("button");
          b.textContent = "x";
          b.style.cssText = "width:20px;height:20px";
          const wrap = document.createElement("div");
          wrap.append(b);
          (document.querySelector("#screen .kit-home") || document.getElementById("screen")).append(wrap);
        });
        return { clean, broken: await audit(page) };
      } finally {
        await context.close();
      }
    });
    assert.deepEqual(found.clean, [], "без дефекта аудит чист");
    assert.ok(found.broken.some((m) => /маленькая цель нажатия 20x20/.test(m)), found.broken.join(" | "));
  });

  await step("browser: an element is named by its own title or its card's, and refused with neither", async () => {
    const found = await withBrowser(async (env) => {
      const { page, context } = await openPage(env, serializedAfter, "#/");
      try {
        return await page.evaluate(async () => {
          const { auditRendered } = await import("/objects/viz/audit.js");
          const host = document.createElement("div");
          document.getElementById("screen").append(host);
          const unnamed = (html) => {
            host.innerHTML = html;
            return auditRendered(host).filter((m) => m.includes("нет названия")).length;
          };
          return {
            cardTitle: unnamed('<c-card title="Вода"><c-list></c-list><c-meter></c-meter></c-card>'),
            ownTitle: unnamed('<c-list title="Вода"></c-list>'),
            widgetTitle: unnamed('<section class="widget"><header><h2 class="widget-title">Рацион</h2></header><div><c-list></c-list></div></section>'),
            neither: unnamed("<c-list></c-list><c-meter></c-meter>"),
            untitledCard: unnamed("<c-card><c-list></c-list></c-card>"),
          };
        });
      } finally {
        await context.close();
      }
    });
    assert.deepEqual(found, { cardTitle: 0, ownTitle: 0, widgetTitle: 0, neither: 2, untitledCard: 1 });
  });

  let wired = false;
  await step("browser: the kit's own elements on the hand-built space", async () => {
    const entries = await withBrowser((env) => renderRoutes(env, serializedAfter, [{ key: "home", hash: "#/" }, { key: "water", hash: "#/screen/water" }], path.join(OUT, "direct")));
    const home = entries.find((e) => e.key === "home");
    wired = home.inputs["c-quick"] > 0;
    if (!wired) { wait("K3: главная не показывает c-quick из карточки water_today, проверка нажатия на +250 мл не запущена"); return; }
    const quick = home.smoke.find((s) => s.element === "c-quick");
    assert.equal(quick.ok, true, JSON.stringify(quick));
    assert.ok(quick.created.some((o) => o.type === "tr_water"), "появилась запись воды");
    assert.deepEqual(home.audit, []);
    const water = entries.find((e) => e.key === "water");
    assert.ok(water.cards >= 1, "экран water показал карточку");
    assert.deepEqual(water.audit, []);
  });

  const fakeKit = path.join(OUT, "fake-kit");
  writeFakeKit(fakeKit);
  await step("check: a card that the screen does not show is a render problem", () => {
    const cards = path.join(OUT, "run-cards");
    const withFake = { LAB_KIT_DIR: fakeKit };
    assert.equal(cli("prepare.mjs", ["json", cards, "water-quick"], withFake).code, 0);
    const dir = path.join(cards, "json", "water-quick");
    writeText(path.join(dir, "answer.json"), JSON.stringify({ v: 2, name: "Вода", build: true }));
    const r = cli("check.mjs", ["json", dir], withFake);
    if (wired) {
      assert.equal(r.code, 0, r.out + r.err);
    } else {
      assert.equal(r.code, 1, r.out + r.err);
      assert.match(r.out, /экран home: карточка «Вода сегодня» не показана на экране/);
      assert.deepEqual(readLines(path.join(dir, "attempts.jsonl")).map((a) => [a.ok, a.layer, a.rules.join()]), [[false, "L4", "render-card-missing"]]);
      assert.ok(exists(path.join(dir, "state-after.json")), "приложение создано, отказала отрисовка");
    }
  });

  await step("check: a card the kit refuses to draw (a script attribute) is a render problem", () => {
    if (!wired) { wait("K3: без показа карточек нечего проверять на отказ карточки"); return; }
    const cards = path.join(OUT, "run-refused");
    const withFake = { LAB_KIT_DIR: fakeKit };
    assert.equal(cli("prepare.mjs", ["json", cards, "water-quick"], withFake).code, 0);
    const dir = path.join(cards, "json", "water-quick");
    writeText(path.join(dir, "answer.json"), JSON.stringify({ v: 2, name: "Вода", build: true, refuse: true }));
    const r = cli("check.mjs", ["json", dir], withFake);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, /экран water: Карточка «Вода за неделю» не показана/);
    assert.deepEqual(readLines(path.join(dir, "attempts.jsonl")).map((a) => [a.ok, a.layer, a.rules.join()]), [[false, "L4", "render-card-refused"]]);
  });

  const env = { LAB_KIT_DIR: fakeKit, ...(wired ? {} : { LAB_SKIP_CARD_CHECK: "1" }) };
  const runDir = path.join(OUT, "run");
  const dirOf = (surface, id) => path.join(runDir, surface, id);

  await step("prepare: ready items get prompt, task and state; a followup without a parent is blocked", () => {
    const r = cli("prepare.mjs", ["json", runDir, "water-quick,fu-water-goal"], env);
    assert.equal(r.code, 0, r.out + r.err);
    const dir = dirOf("json", "water-quick");
    const prompt = readText(path.join(dir, "prompt.md"));
    assert.ok(prompt.startsWith("# Руководство (json)"));
    assert.ok(prompt.trimEnd().endsWith(readJson(path.join(dir, "item.json")).text), "запрос в конце");
    const task = readText(path.join(dir, "task.md"));
    assert.ok(task.includes("node scripts/primitives-lab/check.mjs json output/primitives/lab-selftest/run/json/water-quick"), task);
    assert.ok(task.includes("answer.json"));
    assert.equal(readText(path.join(dir, "state-before.json")), empty);
    const blocked = dirOf("json", "fu-water-goal");
    assert.equal(readJson(path.join(blocked, "item.json")).blocked, true);
    assert.equal(exists(path.join(blocked, "prompt.md")), false);
    assert.match(r.out, /blocked: fu-water-goal \(ждёт water-quick\)/);
  });

  await step("check: no file, then a failing answer, then a good one; attempts count from the file", () => {
    const dir = dirOf("json", "water-quick");
    let r = cli("check.mjs", ["json", dir], env);
    assert.equal(r.code, 1);
    assert.match(r.out, /answer\.json: файла с ответом нет/);
    writeText(path.join(dir, "answer.json"), JSON.stringify({ v: 2 }));
    r = cli("check.mjs", ["json", dir], env);
    assert.equal(r.code, 1);
    assert.ok(r.out.split("\n").includes("name: у ответа нет name"), r.out);
    assert.equal(exists(path.join(dir, "state-after.json")), false);
    writeText(path.join(dir, "answer.json"), JSON.stringify({ v: 2, name: "Вода", build: true, reply: "Добавил журнал воды с целью 2 литра." }));
    r = cli("check.mjs", ["json", dir], env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /^Готово: трекеры: Вода; экраны: home \(карточек затронуто 1\), water \(карточек затронуто 1\)\./m);
    assert.match(r.out, /Исправлено автоматически: name: убраны пробелы/);
    const attempts = readLines(path.join(dir, "attempts.jsonl"));
    assert.deepEqual(attempts.map((a) => [a.n, a.ok, a.layer]), [[1, false, "file"], [2, false, "validate"], [3, true, "ok"]]);
    assert.deepEqual(attempts[1].rules, ["required"]);
    const verdict = readJson(path.join(dir, "verdict.json"));
    assert.equal(verdict.ok, true);
    assert.equal(verdict.n, 3);
    assert.equal(verdict.reply, "Добавил журнал воды с целью 2 литра.");
    assert.deepEqual(verdict.screens.map((s) => s.key), ["home", "water"]);
    for (const s of verdict.screens) assert.ok(exists(path.join(dir, s.png)), s.png);
    assert.ok(exists(path.join(dir, "state-after.json")));
    assert.equal(JSON.parse(readText(path.join(dir, "state-after.json"))).objects.cd_water_today.name, "Вода сегодня");
    const home = verdict.screens.find((s) => s.key === "home");
    if (home.inputs["c-quick"]) {
      assert.equal(verdict.smokeTotals.passed, verdict.smokeTotals.total);
      assert.ok(verdict.smokeTotals.total >= 1);
    } else wait("K3: c-quick на главной, итоги нажатий в verdict.json пока пустые");
  });

  await step("check: the model sees at most six lines, only of the first layer", () => {
    const dir = dirOf("json", "weight-tracker");
    assert.equal(cli("prepare.mjs", ["json", runDir, "weight-tracker"], env).code, 0);
    writeText(path.join(dir, "answer.json"), JSON.stringify({ v: 2, name: "x", bad: true }));
    const r = cli("check.mjs", ["json", dir], env);
    assert.equal(r.code, 1);
    const lines = r.out.trim().split("\n").slice(1);
    assert.equal(lines.length, 6);
    assert.equal(lines[0], "tracks.t0: плохой ключ 0");
    const last = readLines(path.join(dir, "attempts.jsonl")).at(-1);
    assert.equal(last.problems.length, 6);
    assert.equal(readJson(path.join(dir, "verdict.json")).total, 9);
    writeText(path.join(dir, "answer.json"), "{ не json");
    assert.match(cli("check.mjs", ["json", dir], env).out, /answer\.json: это не JSON/);
  });

  await step("check: a reply-only answer is accepted and builds nothing", () => {
    const dir = dirOf("json", "vague-health");
    assert.equal(cli("prepare.mjs", ["json", runDir, "vague-health"], env).code, 0);
    writeText(path.join(dir, "answer.json"), JSON.stringify({ v: 2, name: "Вопрос", reply: "Что именно вы хотите отслеживать?" }));
    const r = cli("check.mjs", ["json", dir], env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /Готово: ничего не построено, ответ только текстом\./);
    assert.equal(readJson(path.join(dir, "verdict.json")).built.empty, true);
    assert.equal(readText(path.join(dir, "state-after.json")), empty);
  });

  await step("followup: prepared from the parent's state-after once the parent is built", () => {
    const r = cli("prepare.mjs", ["json", runDir, "fu-water-goal"], env);
    assert.equal(r.code, 0, r.out + r.err);
    const dir = dirOf("json", "fu-water-goal");
    assert.equal(readJson(path.join(dir, "item.json")).blocked, false);
    assert.equal(readText(path.join(dir, "state-before.json")), readText(path.join(dirOf("json", "water-quick"), "state-after.json")));
  });

  await step("check: the html surface goes through bundleFromMarkup", () => {
    assert.equal(cli("prepare.mjs", ["html", runDir, "water-quick"], env).code, 0);
    const dir = dirOf("html", "water-quick");
    writeText(path.join(dir, "answer.html"), "<c-track key=\"x\"/>");
    let r = cli("check.mjs", ["html", dir], env);
    assert.equal(r.code, 1);
    assert.match(r.out, /c-bundle: нет тега c-bundle/);
    writeText(path.join(dir, "answer.html"), "<c-bundle v=\"2\" name=\"Вода\"></c-bundle>");
    r = cli("check.mjs", ["html", dir], env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /Исправлено автоматически: фраза вне разметки/);
    assert.deepEqual(readLines(path.join(dir, "attempts.jsonl")).map((a) => a.ok), [false, true]);
  });

  await step("judge-packet: describes the app and keeps the attempts and the answer out", async () => {
    const dir = dirOf("json", "water-quick");
    const r = cli("judge-packet.mjs", [dir], env);
    assert.equal(r.code, 0, r.out + r.err);
    const md = readText(path.join(dir, "judge.md"));
    for (const needle of ["# Оценка: water-quick", "## Проверки", "Добавил журнал воды с целью 2 литра.", "цель: не меньше 2000 в день", "screen-home.png", "screen-water.png", "Нажатия на элементы ввода", "Метки [новое]"]) assert.ok(md.includes(needle), `в judge.md нет «${needle}»`);
    for (const leak of ["у ответа нет name", "это не JSON", "attempts", "answer.json", "\"v\":2", "Попытк"]) assert.ok(!md.includes(leak), `в judge.md просочилось «${leak}»`);
    const task = readText(path.join(dir, "judge-task.md"));
    assert.ok(task.includes("output/primitives/lab-selftest/run/json/water-quick/judge.md") && task.includes("rubric.md") && task.includes("judge.json"), task);
    const refused = dirOf("json", "vague-health");
    cli("judge-packet.mjs", [refused], env);
    assert.match(readText(path.join(refused, "judge.md")), /Ничего не создано и не изменено/);
  });

  await step("report: counts come from the files", () => {
    writeJson(path.join(dirOf("json", "water-quick"), "judge.json"), { id: "water-quick", checks: [], hallucinations: [], verdict: "fit", summary: "ок" });
    writeJson(path.join(dirOf("json", "vague-health"), "judge.json"), { id: "vague-health", checks: [], hallucinations: [], verdict: "partial", summary: "ок" });
    const r = cli("report.mjs", [runDir]);
    assert.equal(r.code, 0, r.out + r.err);
    const report = readJson(path.join(runDir, "report.json"));
    const j = report.surfaces.json.total;
    assert.deepEqual({ items: j.items, built1: j.built1, repair1: j.repair1, repair2: j.repair2, failed: j.failed, blocked: j.blocked, notrun: j.notrun, replyOnly: j.replyOnly }, { items: 4, built1: 1, repair1: 0, repair2: 1, failed: 1, blocked: 0, notrun: 1, replyOnly: 1 });
    assert.deepEqual(j.verdicts, { fit: 1, partial: 1, miss: 0, "wrong-refusal": 0, "correct-refusal": 0 });
    assert.equal(j.judged, 2);
    const rules = Object.fromEntries(report.surfaces.json.problemsByRule.map((p) => [p.rule, p.attempts]));
    assert.deepEqual(rules, { required: 1, "no-answer-file": 1, "bad-key": 1, "json-parse": 1 });
    const h = report.surfaces.html.total;
    assert.deepEqual({ built1: h.built1, repair1: h.repair1, repair2: h.repair2 }, { built1: 0, repair1: 1, repair2: 0 });
    assert.deepEqual(report.surfaces.json.failures.map((f) => [f.id, f.layer, f.rules.join()]), [["weight-tracker", "parse", "json-parse"]]);
    assert.equal(report.surfaces.json.byCategory.tracker.items, 2);
    assert.ok(readText(path.join(runDir, "report.md")).includes("## Поверхность json"));
    writeText(path.join(dirOf("json", "water-quick"), "answer.json"), "{}");
    cli("report.mjs", [runDir]);
    assert.ok(readJson(path.join(runDir, "report.json")).surfaces.json.integrity.some((x) => x.id === "water-quick" && x.notes.some((n) => n.includes("изменён после"))), "правка после принятия замечена");
  });

  await step("prepare: --set holdout, and a second call for one id keeps answers and attempts", () => {
    const hold = path.join(OUT, "run-hold");
    const first = cli("prepare.mjs", ["json", hold, "h-plank-30,h-fu-plank-rest-days", "--set", "holdout"], env);
    assert.equal(first.code, 0, first.out + first.err);
    assert.ok(first.out.includes("blocked: h-fu-plank-rest-days (ждёт h-plank-30)"), first.out);
    assert.equal(readJson(path.join(hold, "json", "h-plank-30", "item.json")).id, "h-plank-30");
    assert.equal(cli("prepare.mjs", ["json", hold, "h-plank-30"], env).code, 2, "по умолчанию набор corpus, h-plank-30 в нём нет");
    const dir = path.join(hold, "json", "h-plank-30");
    writeText(path.join(dir, "answer.json"), JSON.stringify({ v: 2, name: "Планка", build: true }));
    assert.equal(cli("check.mjs", ["json", dir], env).code, 0);
    const kept = { answer: readText(path.join(dir, "answer.json")), attempts: readText(path.join(dir, "attempts.jsonl")), before: readText(path.join(dir, "state-before.json")) };
    const second = cli("prepare.mjs", ["json", hold, "h-plank-30", "--set", "holdout"], env);
    assert.match(second.out, /уже запускали 1/);
    assert.deepEqual({ answer: readText(path.join(dir, "answer.json")), attempts: readText(path.join(dir, "attempts.jsonl")), before: readText(path.join(dir, "state-before.json")) }, kept);
    const child = cli("prepare.mjs", ["json", hold, "h-fu-plank-rest-days", "--set", "holdout"], env);
    assert.match(child.out, /готово 1/);
    const childDir = path.join(hold, "json", "h-fu-plank-rest-days");
    assert.equal(readText(path.join(childDir, "state-before.json")), readText(path.join(dir, "state-after.json")));
    writeText(path.join(childDir, "answer.json"), "{}");
    cli("prepare.mjs", ["json", hold, "h-fu-plank-rest-days", "--set", "holdout"], env);
    assert.equal(readText(path.join(childDir, "answer.json")), "{}", "повторная подготовка не трогает ответ");
  });

  await step("waves: chains hold a root and every dependent, parents first", () => {
    const corpus = JSON.parse(cli("waves.mjs", ["corpus"]).out).chains;
    const flat = corpus.flat();
    assert.equal(flat.length, 49);
    assert.equal(new Set(flat).size, 49);
    assert.deepEqual(corpus.find((c) => c[0] === "water-quick"), ["water-quick", "fu-water-goal", "fu-water-home"]);
    assert.deepEqual(JSON.parse(cli("waves.mjs", ["corpus", "fu-water-home"]).out).chains, [["water-quick", "fu-water-goal", "fu-water-home"]]);
    assert.deepEqual(JSON.parse(cli("waves.mjs", ["holdout", "cat:followup"]).out).chains, [["h-plank-30", "h-fu-plank-rest-days"], ["h-gift-list", "h-fu-gift-occasion"]]);
    assert.equal(cli("waves.mjs", ["corpus", "no-such-id"]).code, 2);
  });

  await step("slots: waiting checks all finish, a stale lock is taken over, and a lab failure costs no attempt", async () => {
    const slots = path.join(OUT, "slots");
    fs.rmSync(slots, { recursive: true, force: true });
    const slotEnv = { ...env, LAB_SLOT_DIR: slots, LAB_SLOTS: "1" };
    const dirs = ["water-quick", "weight-tracker", "steps-goal"].map((id) => {
      assert.equal(cli("prepare.mjs", ["json", path.join(OUT, "run-slots"), id], env).code, 0);
      const dir = path.join(OUT, "run-slots", "json", id);
      writeText(path.join(dir, "answer.json"), JSON.stringify({ v: 2, name: "Вода", build: true }));
      return dir;
    });
    fs.mkdirSync(slots, { recursive: true });
    writeJson(path.join(slots, "slot-0.lock"), { pid: 2 ** 22 + 12345, token: "dead", at: new Date().toISOString() });
    const codes = await Promise.all(dirs.map((dir) => new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(LAB, "check.mjs"), "json", dir], { cwd: ROOT, env: { ...process.env, ...slotEnv }, stdio: "ignore" });
      child.on("close", resolve);
    })));
    assert.deepEqual(codes, [0, 0, 0], "один слот, три проверки: все прошли, а замок мёртвого процесса не помешал");
    assert.deepEqual(fs.readdirSync(slots), [], "слоты освобождены");
    const live = path.join(slots, "slot-0.lock");
    writeJson(live, { pid: process.pid, token: "busy", at: new Date().toISOString() });
    const dir = dirs[0];
    const attemptsBefore = readLines(path.join(dir, "attempts.jsonl")).length;
    const r = cli("check.mjs", ["json", dir], { ...slotEnv, LAB_SLOT_WAIT_MS: "1500" });
    assert.equal(r.code, 2);
    assert.match(r.err, /сбой стенда, не вашего ответа, и попытка не засчитана/);
    const lines = readLines(path.join(dir, "attempts.jsonl"));
    assert.equal(lines.length, attemptsBefore + 1);
    assert.equal(lines.at(-1).harness, true);
    fs.rmSync(live);
    assert.equal(cli("check.mjs", ["json", dir], slotEnv).code, 0);
    assert.equal(readJson(path.join(dir, "verdict.json")).n, attemptsBefore + 1, "сбой стенда не занял номер попытки");
  });

  await realKit();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} шагов прошли${pending.length ? `, ждут других агентов: ${pending.length}` : ""}.`);
  return failed.length ? 1 : 0;
}

// The real modules of K1, K3 and K5 over the kit's own examples. Reported, not
// asserted: a mismatch here belongs to the module that owns it.
async function realKit() {
  const kit = path.join(SHELL, "objects", "kit");
  const missing = ["pipeline.js", "markup.js", "manual.js", "examples/index.js"].filter((f) => !exists(path.join(kit, f)));
  if (missing.length) { wait(`kit/${missing.join(", kit/")}: реальных модулей ещё нет, прогон примеров через них не запущен`); return; }
  const { EXAMPLES } = await import(pathToFileURL(path.join(kit, "examples", "index.js")).href);
  const { bundleToMarkup } = await need("kit/markup.js", ["bundleToMarkup"]);
  const real = path.join(OUT, "real");
  const crashes = [];
  for (const surface of ["json", "html"]) {
    const accepted = new Map();
    const notes = [];
    let taps = 0;
    let tapped = 0;
    for (const ex of EXAMPLES) {
      const dir = path.join(real, surface, ex.id);
      const parent = ex.after?.length ? accepted.get(ex.after.at(-1)) : null;
      if (ex.after?.length && !parent) { notes.push(`${ex.id}: родитель ${ex.after.at(-1)} не принят`); continue; }
      writeText(path.join(dir, "state-before.json"), parent ? readText(path.join(parent, "state-after.json")) : readText(spaceFile(ex.space)));
      const answer = ex.bundle ?? { reply: ex.reply };
      writeText(path.join(dir, SURFACES[surface].file), surface === "html" ? bundleToMarkup(answer) : JSON.stringify(answer));
      const r = cli("check.mjs", [surface, dir]);
      if (r.code === 2) { crashes.push(`${surface}/${ex.id}: ${(r.err || r.out).split("\n")[0]}`); continue; }
      if (r.code === 0) {
        accepted.set(ex.id, dir);
        const v = readJson(path.join(dir, "verdict.json"));
        taps += v.smokeTotals?.total || 0;
        tapped += v.smokeTotals?.passed || 0;
      } else notes.push(`${ex.id}: ${r.out.split("\n").slice(1, 3).join(" / ")}`);
    }
    console.log(`INFO    реальный kit, ${surface}: принято ${accepted.size} из ${EXAMPLES.length}, нажатий записало данные ${tapped} из ${taps}${notes.length ? `\n        ${notes.slice(0, process.env.LAB_VERBOSE ? 99 : 5).join("\n        ")}` : ""}`);
  }
  results.push({ name: "real kit: the lab does not crash on any example", ok: crashes.length === 0 });
  if (crashes.length) console.log(`FAIL    real kit: ${crashes.slice(0, 3).join(" | ")}`);
}

run(main);
