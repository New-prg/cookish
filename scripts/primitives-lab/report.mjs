// Aggregates one run:
//   node scripts/primitives-lab/report.mjs <runDir>
// Reads only files the scripts wrote (attempts.jsonl, verdict.json, item.json,
// the answer file for its hash) and the judge's judge.json. Writes report.json
// and report.md in <runDir>. A number here is a count over those files.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SURFACES, exists, isMain, readJson, readLines, run, writeJson, writeText } from "./lib/common.mjs";

const VERDICTS = ["fit", "partial", "miss", "wrong-refusal", "correct-refusal"];
const REPAIRS = 2;

const sha = (file) => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 12);

export function readItem(dir, surface) {
  const item = readJson(path.join(dir, "item.json"));
  const all = readLines(path.join(dir, "attempts.jsonl"));
  const attempts = all.filter((a) => !a.harness);
  const harness = all.length - attempts.length;
  const verdict = exists(path.join(dir, "verdict.json")) ? readJson(path.join(dir, "verdict.json")) : null;
  let judge = null;
  let judgeError = null;
  if (exists(path.join(dir, "judge.json"))) {
    try {
      judge = readJson(path.join(dir, "judge.json"));
      if (!VERDICTS.includes(judge.verdict)) { judgeError = `вердикт «${judge.verdict}» не из списка`; judge = null; }
    } catch (error) {
      judgeError = `judge.json не разобрался: ${error.message}`;
    }
  }
  const firstOk = attempts.findIndex((a) => a.ok) + 1; // 0 when none
  let status;
  if (!all.length) status = item.blocked ? "blocked" : "notrun";
  else if (!attempts.length) status = "harness";
  else if (firstOk === 1) status = "built1";
  else if (firstOk === 2) status = "repair1";
  else if (firstOk === 3) status = "repair2";
  else status = "failed";
  const lastOk = [...attempts].reverse().find((a) => a.ok);
  const answer = path.join(dir, SURFACES[surface].file);
  const integrity = [];
  if (attempts.length > 1 + REPAIRS) integrity.push(`проверок запущено ${attempts.length}, а допустимо ${1 + REPAIRS}`);
  if (firstOk > 1 + REPAIRS) integrity.push(`принято только с попытки ${firstOk}: за пределом бюджета, считается провалом`);
  if (lastOk?.sha && exists(answer) && sha(answer) !== lastOk.sha) integrity.push("ответ изменён после последней принятой проверки");
  if (!verdict && attempts.length) integrity.push("нет verdict.json");
  if (judgeError) integrity.push(judgeError);
  const ok = Boolean(verdict?.ok) && status !== "failed" && status !== "harness";
  const lastFailed = [...attempts].reverse().find((a) => !a.ok);
  return {
    id: item.id, category: item.category, refuse: Boolean(item.refuse), status, attempts: attempts.length, firstOk, harness,
    layer: status === "failed" ? lastFailed?.layer || null : null,
    lastRules: status === "failed" ? lastFailed?.rules || [] : [],
    replyOnly: ok && Boolean(verdict.built?.empty),
    smoke: ok && verdict.smokeTotals ? verdict.smokeTotals : { total: 0, passed: 0 },
    judge: judge ? { verdict: judge.verdict, summary: judge.summary || "", checks: judge.checks || [], hallucinations: judge.hallucinations || [] } : null,
    failedAttempts: attempts.filter((a) => !a.ok).map((a) => ({ n: a.n, layer: a.layer, rules: a.rules || [], problems: a.problems || [] })),
    integrity,
  };
}

const BUILT = ["built1", "repair1", "repair2"];
const zero = () => ({ items: 0, built1: 0, repair1: 0, repair2: 0, builtWithin2: 0, failed: 0, blocked: 0, notrun: 0, labOnly: 0, harnessErrors: 0, replyOnly: 0, smokeTotal: 0, smokePassed: 0, judged: 0, unjudged: 0, verdicts: Object.fromEntries(VERDICTS.map((v) => [v, 0])) });

export function aggregate(rows) {
  const t = zero();
  for (const r of rows) {
    t.items += 1;
    if (r.status === "built1") t.built1 += 1;
    if (r.status === "repair1") t.repair1 += 1;
    if (r.status === "repair2") t.repair2 += 1;
    if (r.status === "failed") t.failed += 1;
    if (r.status === "harness") t.labOnly += 1;
    if (r.status === "blocked") t.blocked += 1;
    if (r.status === "notrun") t.notrun += 1;
    if (r.harness) t.harnessErrors += r.harness;
    if (r.replyOnly) t.replyOnly += 1;
    t.smokeTotal += r.smoke.total;
    t.smokePassed += r.smoke.passed;
    if (r.judge) { t.judged += 1; t.verdicts[r.judge.verdict] += 1; }
    else if (BUILT.includes(r.status)) t.unjudged += 1;
  }
  t.builtWithin2 = t.built1 + t.repair1 + t.repair2;
  return t;
}

export function problemsByRule(rows) {
  const map = new Map();
  for (const r of rows) {
    for (const a of r.failedAttempts) {
      for (const rule of new Set(a.rules)) {
        const e = map.get(rule) || { rule, attempts: 0, items: new Set(), sample: "" };
        e.attempts += 1;
        e.items.add(r.id);
        if (!e.sample) e.sample = a.problems.find((p) => p.rule === rule)?.message || "";
        map.set(rule, e);
      }
    }
  }
  return [...map.values()].map((e) => ({ rule: e.rule, attempts: e.attempts, items: e.items.size, sample: e.sample })).sort((a, b) => b.attempts - a.attempts || a.rule.localeCompare(b.rule));
}

export function failures(rows) {
  return rows.filter((r) => r.status === "failed").map((r) => ({ id: r.id, category: r.category, attempts: r.attempts, layer: r.layer, rules: r.lastRules }));
}

export function buildReport(runDir) {
  const surfaces = {};
  for (const surface of Object.keys(SURFACES)) {
    const base = path.join(runDir, surface);
    if (!exists(base)) continue;
    const rows = fs.readdirSync(base).map((id) => path.join(base, id)).filter((d) => exists(path.join(d, "item.json"))).map((d) => readItem(d, surface));
    const categories = [...new Set(rows.map((r) => r.category))];
    surfaces[surface] = {
      total: aggregate(rows),
      byCategory: Object.fromEntries(categories.map((c) => [c, aggregate(rows.filter((r) => r.category === c))])),
      failures: failures(rows),
      problemsByRule: problemsByRule(rows),
      integrity: rows.filter((r) => r.integrity.length).map((r) => ({ id: r.id, notes: r.integrity })),
      items: rows,
    };
  }
  return { runDir, surfaces };
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");

function table(head, rows) {
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

export function renderMarkdown(report) {
  const out = [`# Отчёт прогона ${path.basename(report.runDir)}`, "", "Все числа посчитаны по attempts.jsonl, verdict.json и judge.json в папках заданий. «Собрано с 1-й попытки» значит, что первая же проверка приняла ответ. «С двух правок» включает их: принято с попытки 1, 2 или 3. Принятое позже считается провалом."];
  for (const [surface, s] of Object.entries(report.surfaces)) {
    const t = s.total;
    const live = t.items - t.blocked;
    out.push("", `## Поверхность ${surface}`, "", table(["", "заданий", "доля"], [
      ["всего в папке", t.items, ""],
      ["заблокировано (родитель не собран)", t.blocked, ""],
      ["не запускали", t.notrun, ""],
      ["собрано с 1-й попытки", t.built1, pct(t.built1, live)],
      ["собрано после 1 правки", t.repair1, pct(t.repair1, live)],
      ["собрано после 2 правок", t.repair2, pct(t.repair2, live)],
      ["всего собрано, не больше 2 правок", t.builtWithin2, pct(t.builtWithin2, live)],
      ["провал", t.failed, pct(t.failed, live)],
      ["из принятых: только текст без постройки", t.replyOnly, ""],
      ["сбои самого стенда (не попытки)", t.harnessErrors, ""],
      ["только сбои стенда, ответ не оценён", t.labOnly, ""],
    ]), "", `Доли считаны от ${live} заданий без заблокированных.`);
    out.push("", `Нажатия на элементы ввода (только по принятым ответам): записали данные ${t.smokePassed} из ${t.smokeTotal}.`);
    out.push("", `Вердикты судьи (оценено ${t.judged}, принято без оценки ${t.unjudged}): ${VERDICTS.map((v) => `${v} ${t.verdicts[v]}`).join(", ")}.`);
    out.push("", "### По категориям", "", table(["категория", "заданий", "1-я", "после 1 правки", "после 2 правок", "провал", "только текст", "блок.", "нажатия", ...VERDICTS], Object.entries(s.byCategory).map(([c, a]) => [c, a.items, a.built1, a.repair1, a.repair2, a.failed, a.replyOnly, a.blocked, `${a.smokePassed}/${a.smokeTotal}`, ...VERDICTS.map((v) => a.verdicts[v])])));
    out.push("", "### Провалы: слой и правила последней проверки", "");
    out.push(s.failures.length ? table(["id", "категория", "попыток", "слой", "правила"], s.failures.map((f) => [f.id, f.category, f.attempts, f.layer || "", f.rules.join(", ")])) : "Провалов нет.");
    out.push("", "### Проблемы по правилам", "");
    out.push(s.problemsByRule.length ? table(["правило", "отказов проверки с ним", "заданий", "пример"], s.problemsByRule.map((p) => [p.rule, p.attempts, p.items, p.sample.replace(/\|/g, "/").slice(0, 90)])) : "Отказов проверки нет.");
    out.push("", "### Задания", "", table(["id", "категория", "статус", "попыток", "слой отказа", "нажатия", "судья"], s.items.map((r) => [r.id, r.category, r.status + (r.replyOnly ? " (текст)" : ""), r.attempts, r.layer || "", r.smoke.total ? `${r.smoke.passed}/${r.smoke.total}` : "", r.judge?.verdict || ""])));
    if (s.integrity.length) out.push("", "### Нарушения порядка", "", ...s.integrity.map((x) => `- ${x.id}: ${x.notes.join("; ")}`));
  }
  if (!Object.keys(report.surfaces).length) out.push("", "В папке нет ни json, ни html.");
  return `${out.join("\n")}\n`;
}

if (isMain(import.meta.url)) {
  run(async () => {
    const runDir = process.argv[2];
    if (!runDir) { console.error("Использование: report.mjs <runDir>"); return 2; }
    const dir = path.resolve(runDir);
    const report = buildReport(dir);
    writeJson(path.join(dir, "report.json"), report);
    writeText(path.join(dir, "report.md"), renderMarkdown(report));
    for (const [surface, s] of Object.entries(report.surfaces)) {
      const t = s.total;
      console.log(`${surface}: заданий ${t.items}, с 1-й ${t.built1}, после 1 правки ${t.repair1}, после 2 правок ${t.repair2}, провал ${t.failed}, только текст ${t.replyOnly}, блок. ${t.blocked}, нажатия ${t.smokePassed}/${t.smokeTotal}, судья ${t.judged}`);
      for (const p of s.problemsByRule.slice(0, 5)) console.log(`  ${p.rule}: ${p.attempts}`);
    }
    console.log(path.join(dir, "report.md"));
    return 0;
  });
}
