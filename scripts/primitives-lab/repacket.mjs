// Judges an old run again under the current lab, without touching it:
//   node scripts/primitives-lab/repacket.mjs <fromRunDir> <toRunDir> [ids] [--jobs N]
// For every item folder of <fromRunDir>/{json,html} (or only the ids given) it
// copies the folder to <toRunDir>/<surface>/<id>, keeping the answer, the states
// and the verdict of the old run, and regenerates what the lab now shows: the
// description with built-in behaviour, the seeded history, the screens with and
// without it, the taps before and after, and judge.md. The old judge files are not copied, so
// the next judge starts clean and never sees the old verdict. The old run is
// never written to. Judging itself is not done here.
import fs from "node:fs";
import path from "node:path";
import { LabError, SURFACES, corpus, exists, isMain, openStore, readJson, readText, run, writeJson } from "./lib/common.mjs";
import { builtCounts } from "./lib/describe.mjs";
import { renderStage, routesFor } from "./lib/stage.mjs";
import { judgePacket } from "./judge-packet.mjs";

const SKIP = [/^judge(-task)?\.(md|json)$/, /^screen-.*\.png$/, /^state-seeded\.json$/];

function copyItem(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (SKIP.some((re) => re.test(name))) continue;
    fs.copyFileSync(path.join(from, name), path.join(to, name));
  }
  // A judge.json that the judges wrote into the copy is theirs: regenerating packets leaves it.
  for (const name of fs.readdirSync(to)) if (name !== "judge.json" && SKIP.some((re) => re.test(name))) fs.rmSync(path.join(to, name), { force: true });
}

export async function repacketItem(from, to) {
  copyItem(from, to);
  // The request and its checks come from the corpus as it is now, so a reworded check is judged as reworded.
  const itemFile = path.join(to, "item.json");
  const now = corpus().find((c) => c.id === readJson(itemFile).id);
  if (now) writeJson(itemFile, { ...readJson(itemFile), ...now });
  const verdictFile = path.join(to, "verdict.json");
  if (!exists(verdictFile)) return { id: path.basename(to), status: "нет verdict.json" };
  const verdict = readJson(verdictFile);
  if (verdict.ok || verdict.layer === "L4") {
    const before = (await openStore(readText(path.join(to, "state-before.json")))).store.state();
    const afterText = readText(path.join(to, "state-after.json"));
    const after = (await openStore(afterText)).store.state();
    const routes = routesFor(before, after);
    const { screens, seed } = routes.length ? await renderStage(to, afterText, routes) : { screens: [], seed: null };
    const attempted = screens.flatMap((s) => s.smoke).filter((x) => !x.skipped);
    writeJson(verdictFile, {
      ...verdict,
      screens,
      seed,
      built: builtCounts(before, after),
      smokeTotals: { total: attempted.length, passed: attempted.filter((x) => x.ok).length, skipped: screens.flatMap((s) => s.smoke).length - attempted.length },
    });
  }
  await judgePacket(to);
  return { id: path.basename(to), status: verdict.ok || verdict.layer === "L4" ? "перерисован" : "без приложения" };
}

async function pool(items, jobs, fn) {
  const out = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

if (isMain(import.meta.url)) {
  run(async () => {
    const args = process.argv.slice(2);
    const jobsAt = args.indexOf("--jobs");
    const jobs = jobsAt >= 0 ? Number(args.splice(jobsAt, 2)[1]) || 3 : 3;
    const [fromDir, toDir, ...ids] = args;
    if (!fromDir || !toDir) { console.error("Использование: repacket.mjs <fromRunDir> <toRunDir> [ids] [--jobs N]"); return 2; }
    if (path.resolve(fromDir) === path.resolve(toDir)) throw new LabError("Куда писать должно отличаться от откуда: старый прогон не меняют.");
    const wanted = ids.flatMap((i) => i.split(/[,\s]+/)).filter(Boolean);
    const jobsList = Object.keys(SURFACES).flatMap((surface) => {
      const root = path.join(path.resolve(fromDir), surface);
      return exists(root) ? fs.readdirSync(root).filter((id) => (!wanted.length || wanted.includes(id)) && fs.statSync(path.join(root, id)).isDirectory()).map((id) => ({ surface, id })) : [];
    });
    const started = Date.now();
    const done = await pool(jobsList, jobs, async ({ surface, id }) => {
      try {
        const r = await repacketItem(path.join(path.resolve(fromDir), surface, id), path.join(path.resolve(toDir), surface, id));
        console.log(`${surface}/${id}: ${r.status}`);
        return { surface, ...r };
      } catch (error) {
        console.log(`${surface}/${id}: СБОЙ ${String(error?.message || error).split("\n")[0]}`);
        return { surface, id, status: "сбой", error: String(error?.message || error).split("\n")[0] };
      }
    });
    const bad = done.filter((r) => r.status === "сбой");
    console.log(`Готово за ${Math.round((Date.now() - started) / 1000)} с: ${done.length - bad.length} из ${done.length}${bad.length ? `; сбои: ${bad.map((r) => `${r.surface}/${r.id}`).join(", ")}` : ""}.`);
    return bad.length ? 1 : 0;
  });
}
