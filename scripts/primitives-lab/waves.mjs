// Groups the items of a set into chains an agent can run one after another:
//   node scripts/primitives-lab/waves.mjs <corpus|holdout> [ids|cat:<category>]
// prints {"chains": [[rootId, followupId, ...], ...]}. A chain is a root item (its
// space is empty or demo) and every item that depends on it, a followup of a
// followup after its parent. Chains are independent of each other and can run in
// parallel; inside a chain run the items in order, calling
// `prepare.mjs <surface> <runDir> <id>` for each followup once its parent is
// checked. A selected followup pulls in its ancestors, because it cannot run
// without their state.
import { corpus, isMain, parseArgs, run } from "./lib/common.mjs";
import { select } from "./prepare.mjs";

const parentOf = (item) => (item.space.startsWith("after:") ? item.space.slice(6) : null);

export function chains(items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const kids = new Map();
  for (const item of items) {
    const parent = parentOf(item);
    if (!parent) continue;
    if (!byId.has(parent)) throw new Error(`«${item.id}» ждёт «${parent}», которого нет в наборе.`);
    kids.set(parent, [...(kids.get(parent) || []), item.id]);
  }
  const walk = (id) => [id, ...(kids.get(id) || []).flatMap(walk)];
  return items.filter((i) => !parentOf(i)).map((root) => walk(root.id));
}

export function wavesOf(set, args = []) {
  const all = corpus(set);
  const byId = new Map(all.map((i) => [i.id, i]));
  const keep = new Set();
  for (const item of select(all, args)) {
    for (let cur = item; cur && !keep.has(cur.id); cur = byId.get(parentOf(cur))) keep.add(cur.id);
  }
  return { chains: chains(all.filter((i) => keep.has(i.id))) };
}

if (isMain(import.meta.url)) {
  run(async () => {
    const { words } = parseArgs(process.argv.slice(2));
    const [set, ...args] = words;
    if (!set) { console.error("Использование: waves.mjs <corpus|holdout> [ids|cat:<category>]"); return 2; }
    console.log(JSON.stringify(wavesOf(set, args)));
    return 0;
  });
}
