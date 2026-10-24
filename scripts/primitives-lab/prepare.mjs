// Makes the folder of every item of one set and surface:
//   node scripts/primitives-lab/prepare.mjs <json|html> <runDir> [ids] [--set corpus|holdout]
// ids: comma or space separated item ids, `cat:<category>` for a category,
// nothing for the whole set (corpus by default). Run it again for one id after
// its parent has been checked: an item whose parent has no state-after.json is
// `blocked` until then. It is safe to repeat: it rewrites only the prompt files
// (item.json, state-before.json, prompt.md, task.md) of the ids it is given, and
// leaves an answer, attempts, verdict, screenshots and judge file alone. An item
// that already has attempts is not rewritten at all, so its baseline never moves.
import fs from "node:fs";
import path from "node:path";
import { LAB, SURFACES, TODAY, corpus, exists, fill, isMain, itemDir, need, openStore, parseArgs, readText, relToRoot, run, spaceFile, surfaceOf, writeJson, writeText } from "./lib/common.mjs";

export function select(items, args) {
  const wanted = args.flatMap((a) => a.split(/[,\s]+/)).filter(Boolean);
  if (!wanted.length) return items;
  const chosen = items.filter((item) => wanted.some((w) => (w.startsWith("cat:") ? item.category === w.slice(4) : item.id === w)));
  const known = new Set(items.map((i) => i.id));
  const unknown = wanted.filter((w) => !w.startsWith("cat:") && !known.has(w));
  if (unknown.length) throw new Error(`Нет в корпусе: ${unknown.join(", ")}`);
  return chosen;
}

export function startState(item, runDir, surface) {
  if (item.space.startsWith("after:")) {
    const parent = item.space.slice(6);
    const file = path.join(itemDir(runDir, surface, parent), "state-after.json");
    return { parent, file, ready: exists(file) };
  }
  const file = spaceFile(item.space);
  if (!exists(file)) throw new Error(`Нет ${file}: запустите spaces.mjs`);
  return { parent: null, file, ready: true };
}

export async function prepare(surface, runDir, ids = [], set = "corpus") {
  surfaceOf(surface);
  const { renderManual } = await need("kit/manual.js", ["renderManual"]);
  const template = readText(path.join(LAB, "haiku-prompt.md"));
  const out = [];
  for (const item of select(corpus(set), ids)) {
    const dir = itemDir(runDir, surface, item.id);
    fs.mkdirSync(dir, { recursive: true });
    if (exists(path.join(dir, "attempts.jsonl"))) {
      out.push({ id: item.id, status: "started", by: null });
      continue;
    }
    const start = startState(item, runDir, surface);
    const meta = { ...item, surface, answerFile: SURFACES[surface].file, parent: start.parent, blocked: !start.ready };
    writeJson(path.join(dir, "item.json"), meta);
    if (!start.ready) {
      for (const f of ["prompt.md", "task.md", "state-before.json"]) fs.rmSync(path.join(dir, f), { force: true });
      out.push({ id: item.id, status: "blocked", by: start.parent });
      continue;
    }
    const serialized = readText(start.file);
    writeText(path.join(dir, "state-before.json"), serialized);
    const { store } = await openStore(serialized);
    let manual = String(renderManual(store.state(), { surface, request: item.text, today: TODAY })).trimEnd();
    if (!manual.includes(item.text)) manual += `\n\n## Запрос человека\n\n${item.text}`;
    writeText(path.join(dir, "prompt.md"), `${manual}\n`);
    writeText(path.join(dir, "task.md"), fill(template, { surface, dir: relToRoot(dir), ext: path.extname(SURFACES[surface].file).slice(1) }));
    out.push({ id: item.id, status: "ready", by: null });
  }
  return out;
}

if (isMain(import.meta.url)) {
  run(async () => {
    const { words, set } = parseArgs(process.argv.slice(2));
    const [surface, runDir, ...ids] = words;
    if (!surface || !runDir) { console.error("Использование: prepare.mjs <json|html> <runDir> [ids] [--set corpus|holdout]"); return 2; }
    const rows = await prepare(surface, runDir, ids, set);
    const count = (status) => rows.filter((r) => r.status === status).length;
    for (const r of rows.filter((x) => x.status === "blocked")) console.log(`blocked: ${r.id} (ждёт ${r.by})`);
    console.log(`${surface} (${set}): готово ${count("ready")}, заблокировано ${count("blocked")}, уже запускали ${count("started")}, всего ${rows.length}`);
    return 0;
  });
}
