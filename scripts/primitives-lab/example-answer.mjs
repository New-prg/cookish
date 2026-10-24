// Writes a known-good answer into one lab folder, in the form a model gives it
// (the text the manual prints):
//   node scripts/primitives-lab/example-answer.mjs <json|html> <dir> <exampleId | bundle.json>
// An example id comes from kit/examples; a .json path is a bundle (with reply)
// written by hand. A dry run pushes such answers through check.mjs.
import path from "node:path";
import { SURFACES, exists, isMain, need, readJson, run, surfaceOf, writeText } from "./lib/common.mjs";

export async function exampleAnswer(surface, dirArg, source) {
  surfaceOf(surface);
  const { printAnswer } = await need("kit/manual.js", ["printAnswer"]);
  let example;
  if (source.endsWith(".json") && exists(source)) {
    const { reply, ...bundle } = readJson(source);
    example = { reply, bundle: Object.keys(bundle).length ? bundle : null };
  } else {
    example = (await need("kit/examples/index.js")).exampleById(source);
    if (!example) throw new Error(`Нет примера «${source}» в kit/examples и нет такого файла.`);
  }
  const file = path.join(path.resolve(dirArg), SURFACES[surface].file);
  writeText(file, `${printAnswer(example, surface)}\n`);
  return file;
}

if (isMain(import.meta.url)) {
  run(async () => {
    const [surface, dir, source] = process.argv.slice(2);
    if (!surface || !dir || !source) { console.error("Использование: example-answer.mjs <json|html> <dir> <exampleId | bundle.json>"); return 2; }
    console.log(await exampleAnswer(surface, dir, source));
    return 0;
  });
}
