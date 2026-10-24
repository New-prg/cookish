// Runs check.mjs on every folder of a run that has an answer, all at once, to
// prove the lab holds the load of many builders:
//   node scripts/primitives-lab/load-test.mjs <runDir>
// Prints the exit codes and the wall time. Exit 0 when none exited 2.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { LAB, SURFACES, exists, isMain, run } from "./lib/common.mjs";

export async function loadTest(runDirArg) {
  const runDir = path.resolve(runDirArg);
  const jobs = [];
  for (const surface of Object.keys(SURFACES)) {
    const base = path.join(runDir, surface);
    if (!exists(base)) continue;
    for (const id of fs.readdirSync(base)) if (exists(path.join(base, id, SURFACES[surface].file))) jobs.push({ surface, id, dir: path.join(base, id) });
  }
  const started = Date.now();
  const results = await Promise.all(jobs.map((job) => new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(LAB, "check.mjs"), job.surface, job.dir], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (code) => resolve({ ...job, code, seconds: Math.round((Date.now() - t0) / 100) / 10, out: out.trim().split("\n").slice(-2).join(" / ").slice(0, 200) }));
  })));
  return { results, wallSeconds: Math.round((Date.now() - started) / 100) / 10 };
}

if (isMain(import.meta.url)) {
  run(async () => {
    const dir = process.argv[2];
    if (!dir) { console.error("Использование: load-test.mjs <runDir>"); return 2; }
    const { results, wallSeconds } = await loadTest(dir);
    for (const r of results) console.log(`${r.code} ${String(r.seconds).padStart(5)}s ${r.surface}/${r.id}: ${r.out}`);
    const count = (c) => results.filter((r) => r.code === c).length;
    console.log(`процессов ${results.length}: выход 0 — ${count(0)}, выход 1 — ${count(1)}, выход 2 — ${count(2)}; общее время ${wallSeconds} с`);
    return count(2) ? 1 : 0;
  });
}
