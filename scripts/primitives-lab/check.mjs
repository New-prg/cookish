// The check command a builder model runs on its own answer:
//   node scripts/primitives-lab/check.mjs <json|html> <dir>
// Reads <dir>/answer.json or answer.html and <dir>/state-before.json. On a
// problem it prints at most six lines «путь: сообщение» of the first failing
// layer and exits 1. Otherwise it applies the bundle to a store seeded from the
// item's state, saves state-after.json, renders the changed screens, audits
// them, saves screenshots, performs the smoke interactions, then does the same
// on a copy of the state with two weeks of history entered as the person
// (state-seeded.json, screen-<key>-seeded*.png; see lib/seed.mjs; only the
// judge packet uses it), prints «Готово: …» and exits 0. Exit 2 is a failure of the lab itself, not of the answer.
// Every run appends one line to attempts.jsonl and rewrites verdict.json.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LabError, SURFACES, TODAY, appendLine, exists, isMain, need, openStore, readLines, readText, run, surfaceOf, writeJson, writeText } from "./lib/common.mjs";
import { builtCounts, builtLine } from "./lib/describe.mjs";
import { renderStage, routesFor } from "./lib/stage.mjs";

const MAX_SHOWN = 6;

const RENDER_RULES = [
  [/прокручивается вбок|выходит за правый край/, "render-overflow"],
  [/маленькая цель/, "render-tap-target"],
  [/пустое состояние|ничего не нарисовано/, "render-empty-state"],
  [/нет названия/, "render-no-title"],
  [/ошибка отрисовки/, "render-error"],
  [/наложились/, "render-axis-overlap"],
  [/окрашен в цвет ряда/, "render-text-color"],
  [/одним цветом/, "render-status-color"],
];
const renderRule = (message) => RENDER_RULES.find(([re]) => re.test(message))?.[1] || "render-other";

const pathText = (p) => (Array.isArray(p) ? p.join(".") : p == null ? "" : String(p));

export function normalizeProblems(list) {
  const items = (Array.isArray(list) ? list : [list]).filter(Boolean).map((p) => (typeof p === "string"
    ? { path: "", rule: "unknown", message: p }
    : { path: pathText(p.path), rule: p.rule || "unknown", message: String(p.message ?? p.text ?? ""), layer: p.layer, allowed: p.allowed }));
  // The model sees only the first failing layer.
  const layer = items.find((p) => p.layer != null)?.layer;
  return layer == null ? items : items.filter((p) => p.layer === layer);
}

function unwrapMarkup(result) {
  if (result && result.ok === false) return { problems: result.problems?.length ? result.problems : [{ path: "answer.html", rule: "markup", message: result.message || "разметка не разобрана" }] };
  if (result && Array.isArray(result.problems) && result.problems.length) return { problems: result.problems };
  const isWrapped = result && typeof result === "object" && "bundle" in result;
  return { bundle: isWrapped ? result.bundle : result, changes: isWrapped ? result.changes || [] : [] };
}

function fail({ dir, n, layer, problems, extra = {} }) {
  const shown = problems.slice(0, MAX_SHOWN).map(({ path: p, rule, message }) => ({ path: p, rule, message }));
  const verdict = { n, at: new Date().toISOString(), ok: false, layer: String(layer), rules: [...new Set(problems.map((p) => p.rule))], problems: shown, total: problems.length, ...extra };
  appendLine(path.join(dir, "attempts.jsonl"), { n, at: verdict.at, ok: false, layer: verdict.layer, rules: verdict.rules, problems: shown, ...(extra.sha ? { sha: extra.sha } : {}), ...(extra.harness ? { harness: true } : {}) });
  writeJson(path.join(dir, "verdict.json"), verdict);
  return shown;
}

export async function check(surface, dirArg) {
  surfaceOf(surface);
  const dir = path.resolve(dirArg);
  const answerFile = path.join(dir, SURFACES[surface].file);
  const attemptsFile = path.join(dir, "attempts.jsonl");
  // A lab failure is not an attempt: it must not use up the model's budget.
  const n = readLines(attemptsFile).filter((a) => !a.harness).length + 1;
  if (!exists(path.join(dir, "state-before.json"))) {
    console.error(`В ${dir} нет state-before.json: запустите prepare.mjs.`);
    return 2;
  }
  const { checkBundle, applyBundle } = await need("kit/pipeline.js", ["checkBundle", "applyBundle"]);
  const { bundleFromMarkup } = surface === "html" ? await need("kit/markup.js", ["bundleFromMarkup"]) : {};
  for (const f of ["state-after.json", "state-seeded.json", "verdict.json", ...fs.readdirSync(dir).filter((x) => /^screen-.*\.png$/.test(x))]) fs.rmSync(path.join(dir, f), { force: true });

  const show = (shown) => {
    console.log(`Проблемы, исправьте ответ в ${SURFACES[surface].file} и запустите проверку снова:`);
    for (const p of shown) console.log(`${p.path || "ответ"}: ${p.message}`);
    return 1;
  };

  if (!exists(answerFile)) {
    return show(fail({ dir, n, layer: "file", problems: [{ path: SURFACES[surface].file, rule: "no-answer-file", message: "файла с ответом нет, запишите его в эту папку" }] }));
  }
  const source = readText(answerFile);
  const sha = crypto.createHash("sha1").update(source).digest("hex").slice(0, 12);
  if (!source.trim()) return show(fail({ dir, n, layer: "file", problems: [{ path: SURFACES[surface].file, rule: "empty-answer", message: "файл с ответом пустой" }], extra: { sha } }));

  const stateBefore = readText(path.join(dir, "state-before.json"));
  let raw;
  let reply = "";
  let markupChanges = [];
  try {
    if (surface === "json") {
      try {
        raw = JSON.parse(source);
      } catch (error) {
        return show(fail({ dir, n, layer: "parse", problems: [{ path: "answer.json", rule: "json-parse", message: `это не JSON: ${error.message}` }], extra: { sha } }));
      }
    } else {
      const got = unwrapMarkup(bundleFromMarkup(source));
      if (got.problems) return show(fail({ dir, n, layer: "markup", problems: normalizeProblems(got.problems), extra: { sha } }));
      raw = got.bundle;
      markupChanges = got.changes;
    }
    reply = typeof raw?.reply === "string" ? raw.reply : "";

    const before = await openStore(stateBefore);
    const checked = await checkBundle(raw, before.store.state(), { today: TODAY });
    if (!checked?.ok) {
      const problems = normalizeProblems(checked?.problems?.length ? checked.problems : [{ path: "", rule: "unknown", message: "проверка отклонила ответ без пояснения" }]);
      return show(fail({ dir, n, layer: checked?.layer ?? "check", problems, extra: { sha } }));
    }

    const after = await openStore(stateBefore);
    if (!(Array.isArray(checked.ops) && checked.ops.length === 0)) {
      const applied = await applyBundle(after.store, checked);
      if (!applied?.ok) {
        return show(fail({ dir, n, layer: "apply", problems: normalizeProblems([{ path: "", rule: "apply-refused", message: applied?.reason || applied?.message || "хранилище не приняло изменение" }]), extra: { sha } }));
      }
    }
    const serializedAfter = after.storage.dump();
    writeText(path.join(dir, "state-after.json"), serializedAfter);

    const stateA = before.store.state();
    const stateB = after.store.state();
    const counts = builtCounts(stateA, stateB);
    const line = builtLine(stateA, stateB);
    const routes = routesFor(stateA, stateB);
    const { screens, seed } = routes.length ? await renderStage(dir, serializedAfter, routes) : { screens: [], seed: null };

    const renderProblems = [];
    for (const s of screens) {
      if (s.blank) renderProblems.push({ path: `экран ${s.key}`, rule: "render-blank", message: s.blank });
      for (const message of new Set(s.audit)) renderProblems.push({ path: `экран ${s.key}`, rule: renderRule(message), message });
      for (const text of s.refused) renderProblems.push({ path: `экран ${s.key}`, rule: "render-card-refused", message: text });
      for (const title of s.missingCards) renderProblems.push({ path: `экран ${s.key}`, rule: "render-card-missing", message: `карточка «${title}» не показана на экране` });
      for (const message of s.broken) renderProblems.push({ path: `экран ${s.key}`, rule: "render-error", message });
      for (const message of s.pageErrors) renderProblems.push({ path: `экран ${s.key}`, rule: "render-page-error", message: `на странице ошибка: ${message}` });
    }
    const smoke = screens.flatMap((s) => s.smoke.map((x) => ({ screen: s.key, ...x })));
    const attempted = smoke.filter((x) => !x.skipped);
    const smokeTotals = { total: attempted.length, passed: attempted.filter((x) => x.ok).length, skipped: smoke.length - attempted.length };
    const extra = { sha, reply, built: counts, line, screens, seed, smokeTotals, changes: [...markupChanges, ...(checked.changes || [])].map((c) => (typeof c === "string" ? c : c.message || JSON.stringify(c))) };

    if (renderProblems.length) {
      return show(fail({ dir, n, layer: "L4", problems: renderProblems, extra }));
    }

    const at = new Date().toISOString();
    appendLine(attemptsFile, { n, at, ok: true, layer: "ok", rules: [], problems: [], sha });
    writeJson(path.join(dir, "verdict.json"), { n, at, ok: true, layer: "ok", rules: [], problems: [], ...extra });
    if (extra.changes.length) console.log(`Исправлено автоматически: ${extra.changes.slice(0, 3).join("; ")}.`);
    console.log(`Готово: ${line}.${screens.length ? ` Экранов проверено: ${screens.length}, замечаний нет.` : ""}${smokeTotals.total ? ` Нажатий проверено: ${smokeTotals.total}, записали данные: ${smokeTotals.passed}.` : ""}`);
    return 0;
  } catch (error) {
    fail({ dir, n, layer: "harness", problems: [{ path: "", rule: "harness-error", message: error?.message || String(error) }], extra: { sha, harness: true } });
    if (error instanceof LabError) console.error(error.message);
    else console.error(`Сбой стенда проверки, это вина стенда, а не вашего ответа. Ответ не оценён, попытка не засчитана: запустите ту же команду ещё раз.
Подробности для автора стенда: ${error?.stack || error}`);
    return 2;
  }
}

if (isMain(import.meta.url)) {
  run(async () => {
    const [surface, dir] = process.argv.slice(2);
    if (!surface || !dir) { console.error("Использование: check.mjs <json|html> <dir>"); return 2; }
    return check(surface, dir);
  });
}
