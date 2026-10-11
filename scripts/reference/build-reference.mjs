// Builds the built-in reference of common products (#63) from USDA FoodData
// Central, SR Legacy (CSV, CC0, no key): node scripts/reference/build-reference.mjs
// The archive is downloaded once into output/reference/ and checked by its
// SHA-256, so a rerun gives the same file. КБЖУ per 100 г/мл; carbs are the
// available ones (by difference minus fiber). Every card passes the card check
// of the Core; the report compares a sample with the Russian tables.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

import { checkNutritionCard } from "../../mobile-shell/core/nutrition-check.js";
import { normalizeProductName } from "../../mobile-shell/core/ration-domain.js";
import { FOODS } from "./foods.mjs";
import { RUSSIAN_SAMPLE } from "./russian-sample.mjs";

const ARCHIVE = {
  url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip",
  sha256: "b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0",
  folder: "FoodData_Central_sr_legacy_food_csv_2018-04/",
};
const NUTRIENTS = { 1008: "calories", 1003: "protein", 1004: "fat", 1005: "carbs", 1079: "fiber" };
const OUTPUT = new URL("../../mobile-shell/services/catalog/reference-foods.js", import.meta.url);
const CACHE = new URL("../../output/reference/", import.meta.url);

async function archive() {
  mkdirSync(CACHE, { recursive: true });
  const file = new URL("sr-legacy-2018-04.zip", CACHE);
  if (!existsSync(file)) {
    const response = await fetch(ARCHIVE.url);
    if (!response.ok) throw new Error(`USDA answered ${response.status}`);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  const bytes = readFileSync(file);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== ARCHIVE.sha256) throw new Error(`The archive changed: sha256 ${hash}`);
  return bytes;
}

// The entries of a zip archive by name: deflate or stored, no zip64.
function unzip(bytes, names) {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("Not a zip archive");
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const files = {};
  for (let index = 0; index < count; index += 1) {
    const method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const skip = nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (names.includes(name)) {
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const data = bytes.subarray(start, start + size);
      files[name] = (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    }
    offset += 46 + skip;
  }
  return files;
}

function csv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell || row.length) rows.push([...row, cell]);
  const [head, ...body] = rows;
  return body.map((values) => Object.fromEntries(head.map((key, index) => [key, values[index]])));
}

const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

function build(files) {
  const descriptions = new Map(csv(files[`${ARCHIVE.folder}food.csv`]).map((food) => [Number(food.fdc_id), food.description]));
  const amounts = new Map();
  for (const entry of csv(files[`${ARCHIVE.folder}food_nutrient.csv`])) {
    const field = NUTRIENTS[entry.nutrient_id];
    if (!field) continue;
    const id = Number(entry.fdc_id);
    if (!amounts.has(id)) amounts.set(id, {});
    amounts.get(id)[field] = Number(entry.amount);
  }
  const problems = [];
  const foods = FOODS.map(([id, name, category, unit, fdcId]) => {
    const raw = amounts.get(fdcId);
    if (!descriptions.has(fdcId) || !raw) {
      problems.push(`${id}: нет записи ${fdcId}`);
      return null;
    }
    const fiber = Number.isFinite(raw.fiber) ? round(raw.fiber) : null;
    const nutrition = {
      calories: Math.round(raw.calories),
      protein: round(raw.protein),
      fat: round(raw.fat),
      carbs: round(Math.max(0, raw.carbs - (fiber || 0))),
      fiber,
    };
    const check = checkNutritionCard(nutrition);
    if (!check.ok) problems.push(`${id} (${name}): ${check.problems.join("; ")}`);
    return { id, name, category, unit, nutrition, fdcId, description: descriptions.get(fdcId) };
  });
  const seen = (key) => {
    const counts = new Map();
    foods.forEach((food) => food && counts.set(key(food), (counts.get(key(food)) || 0) + 1));
    return [...counts].filter(([, count]) => count > 1).map(([value]) => value);
  };
  seen((food) => food.id).forEach((id) => problems.push(`повторяется id ${id}`));
  seen((food) => normalizeProductName(food.name)).forEach((name) => problems.push(`повторяется название ${name}`));
  return { foods: foods.filter(Boolean), problems };
}

function moduleText(foods) {
  const rows = foods.map(({ description, ...food }) => `  ${JSON.stringify(food)},`);
  return `// Generated by scripts/reference/build-reference.mjs from USDA FoodData
// Central, SR Legacy (2018-04), public domain (CC0 1.0). Do not edit by hand:
// change scripts/reference/foods.mjs and run the script again.
// КБЖУ per 100 г/мл; carbs are the available ones, without fiber.
export const REFERENCE_SOURCE = Object.freeze({
  name: "USDA FoodData Central, SR Legacy",
  release: "2018-04",
  license: "CC0 1.0",
  url: "https://fdc.nal.usda.gov/",
});

export const REFERENCE_FOODS = Object.freeze([
${rows.join("\n")}
]);
`;
}

// Differences from the Russian tables above 15% that also matter in
// absolute terms (more than 10 ккал or 1.5 г).
function compare(foods) {
  const byId = new Map(foods.map((food) => [food.id, food]));
  const fields = [["calories", "ккал", 10], ["protein", "Б", 1.5], ["fat", "Ж", 1.5], ["carbs", "У", 1.5]];
  return RUSSIAN_SAMPLE.flatMap(([id, pageId, name, ...russian]) => {
    const food = byId.get(id);
    const differences = fields.map(([field, label, floor], index) => {
      const ours = food.nutrition[field];
      const theirs = russian[index];
      const delta = ours - theirs;
      const share = theirs ? delta / theirs : 0;
      return Math.abs(delta) > floor && Math.abs(share) > 0.15 ? `${label} ${ours} / ${theirs} (${share > 0 ? "+" : ""}${Math.round(share * 100)}%)` : "";
    }).filter(Boolean);
    return differences.length ? [`${food.name} ↔ ${name} [${pageId}]: ${differences.join(", ")}`] : [];
  });
}

const { foods, problems } = build(unzip(await archive(), [`${ARCHIVE.folder}food.csv`, `${ARCHIVE.folder}food_nutrient.csv`]));
const verbose = process.argv.includes("--list");
if (verbose) foods.forEach((food) => console.log(`${food.id} | ${food.name} | ${JSON.stringify(food.nutrition)} | ${food.description}`));
const differences = compare(foods);
console.log(`Записей: ${foods.length}. Сверка с российскими таблицами: ${RUSSIAN_SAMPLE.length} пар, расхождений больше 15%: ${differences.length}.`);
differences.forEach((line) => console.log(`  ${line}`));
if (problems.length) {
  console.error(`Проверка не пройдена:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
writeFileSync(OUTPUT, moduleText(foods));
console.log(`Записано: ${OUTPUT.pathname}`);
