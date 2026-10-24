// Shared by every script of the lab: paths, the fixed clock, stores over a
// memory storage, the corpus, and the dynamic import of kit modules that other
// agents write (a missing one stops the script with a message naming it).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = path.resolve(LAB, "..", "..");
export const SHELL = path.join(ROOT, "mobile-shell");
export const SPACES = path.join(ROOT, "output", "primitives", "spaces");
export const TODAY = "2026-10-24";
export const NOW = `${TODAY}T09:00:00.000Z`;
export const STORAGE_KEY = "cookish.objects.v1";
export const SURFACES = { json: { file: "answer.json" }, html: { file: "answer.html" } };

export class LabError extends Error {
  constructor(message, code = 2) { super(message); this.code = code; }
}

export function die(error) {
  console.error(error instanceof LabError ? error.message : error?.stack || String(error));
  process.exit(error instanceof LabError ? error.code : 2);
}

const OWNERS = { "kit/pipeline.js": "K1", "kit/manual.js": "K5", "kit/markup.js": "K3", "kit/spec.js": "K1" };

// Imports a module of mobile-shell/objects and checks the named exports exist.
export async function need(rel, names = []) {
  // The selftest points LAB_KIT_DIR at a folder of fakes to test the scripts alone;
  // a module the folder does not fake is the real one.
  const fake = process.env.LAB_KIT_DIR && rel.startsWith("kit/") ? path.join(process.env.LAB_KIT_DIR, rel.slice(4)) : null;
  const file = fake && fs.existsSync(fake) ? fake : path.join(SHELL, "objects", rel);
  if (!fs.existsSync(file)) throw new LabError(`Нет модуля mobile-shell/objects/${rel}${OWNERS[rel] ? ` (его пишет агент ${OWNERS[rel]})` : ""}. Харнес не может работать без него.`);
  let mod;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") throw new LabError(`Модуль objects/${rel} не загрузился, потому что чего-то в нём не хватает: ${String(error.message).split("\n")[0]}`);
    if (error instanceof SyntaxError) throw new LabError(`Модуль objects/${rel} или его зависимость не разбирается (${error.message}). Скорее всего, его сейчас правит другой агент.`);
    throw error;
  }
  const missing = names.filter((n) => typeof mod[n] !== "function");
  if (missing.length) throw new LabError(`В mobile-shell/objects/${rel} нет экспорта ${missing.join(", ")}.`);
  return mod;
}

export function memoryStorage(initial = null) {
  const data = new Map(initial == null ? [] : [[STORAGE_KEY, initial]]);
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    dump: () => data.get(STORAGE_KEY) ?? null,
  };
}

// A store on the fixed clock; `serialized` is the localStorage form of a space.
export async function openStore(serialized = null) {
  const { openObjectStore } = await need("core/store.js");
  const storage = memoryStorage(serialized);
  let n = 0;
  const store = openObjectStore({ storage, clock: () => new Date(NOW), today: () => TODAY, idFactory: (prefix) => `${prefix}_lab${++n}` });
  return { store, storage };
}

export const readText = (file) => fs.readFileSync(file, "utf8");
export const readJson = (file) => JSON.parse(readText(file));
export const exists = (file) => fs.existsSync(file);
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export const SETS = ["corpus", "holdout"];
export function corpus(set = "corpus") {
  if (!SETS.includes(set)) throw new LabError(`Набор «${set}» неизвестен: нужен corpus или holdout.`);
  return readJson(path.join(LAB, `${set}.json`));
}

// Splits the command line into positional words and the value of --set.
export function parseArgs(argv) {
  const words = [];
  let set = "corpus";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--set") set = argv[++i] || "";
    else if (argv[i].startsWith("--set=")) set = argv[i].slice(6);
    else words.push(argv[i]);
  }
  return { words, set };
}
export const spaceFile = (name) => path.join(SPACES, `${name}.json`);

export function surfaceOf(name) {
  if (!SURFACES[name]) throw new LabError(`Поверхность «${name}» неизвестна: нужна json или html.`);
  return name;
}

export function itemDir(runDir, surface, id) {
  return path.join(path.resolve(runDir), surface, id);
}

export function appendLine(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

export function readLines(file) {
  if (!exists(file)) return [];
  return readText(file).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
}

export function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`));
}

// Runs `main` and exits with its code, turning thrown errors into a message.
export function run(main) {
  Promise.resolve().then(main).then((code) => { process.exitCode = code ?? 0; }, die);
}

export const isMain = (url) => Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(url);

const posix = (p) => p.split(path.sep).join("/");
// A path for prompts: relative to the repo with forward slashes when inside it.
export const relToRoot = (p) => {
  const rel = path.relative(ROOT, p);
  return posix(rel.startsWith("..") || path.isAbsolute(rel) ? p : rel);
};
