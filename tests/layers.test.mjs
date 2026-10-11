import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Core and Services move to a server (ADR-0002), so they import nothing from
// the browser: no UI modules, no WebView globals, no Capacitor. Storage and
// fetch come in as adapters.

const shellDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../mobile-shell");

const RULES = {
  core: { forbiddenLayers: ["ui", "services", "transport"] },
  services: { forbiddenLayers: ["ui", "transport"] },
};

const FORBIDDEN_GLOBALS = ["window", "document", "localStorage", "sessionStorage", "navigator", "globalThis", "Capacitor", "NativeCookish", "fetch", "XMLHttpRequest"];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function stripStrings(source) {
  return source.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""');
}

function importSpecifiers(source) {
  const pattern = /\b(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*["']([^"']+)["']/g;
  return [...source.matchAll(pattern)].map((match) => match[1] || match[2] || match[3]);
}

// Problems in one module of `layer`; `file` is relative to mobile-shell.
export function layerViolations(layer, file, source) {
  const problems = [];
  const code = stripComments(source);
  for (const specifier of importSpecifiers(code)) {
    if (!specifier.startsWith(".")) {
      problems.push(`${file}: imports package "${specifier}"`);
      continue;
    }
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    const targetLayer = target.split("/")[0];
    if (target.startsWith("..") || !(targetLayer in RULES || RULES[layer].forbiddenLayers.includes(targetLayer))) {
      problems.push(`${file}: imports "${specifier}" outside core and services`);
    } else if (RULES[layer].forbiddenLayers.includes(targetLayer)) {
      problems.push(`${file}: imports "${specifier}" from ${targetLayer}/`);
    }
  }
  const bare = stripStrings(code);
  for (const name of FORBIDDEN_GLOBALS) {
    // A property (`.fetch`) or an object key (`fetch:`) is not the global.
    if (new RegExp(`(?<![.\\w$])${name}\\b(?!\\s*:)`).test(bare)) problems.push(`${file}: uses ${name}`);
  }
  return problems;
}

function modules(dir) {
  return fs.readdirSync(path.join(shellDir, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return modules(relative);
    return entry.name.endsWith(".js") ? [relative] : [];
  });
}

test("core and services import nothing from the browser or the UI", () => {
  const problems = Object.keys(RULES).flatMap((layer) => modules(layer).map((file) =>
    layerViolations(layer, file, fs.readFileSync(path.join(shellDir, file), "utf8"))
  )).flat();
  assert.deepEqual(problems, []);
  assert.ok(modules("core").includes("core/local-data.js"));
  assert.ok(modules("services").includes("services/catalog/catalog.js"));
});

test("the layer check catches UI imports, packages and browser globals", () => {
  const cases = [
    ["core", "core/x.js", 'import { render } from "../ui/app.js";', /from ui\//],
    ["core", "core/x.js", 'export { a } from "../services/index.js";', /from services\//],
    ["services", "services/catalog/x.js", 'const m = await import("../../ui/platform.js");', /from ui\//],
    ["services", "services/x.js", 'import { Capacitor } from "@capacitor/core";', /package "@capacitor\/core"/],
    ["core", "core/x.js", "const raw = localStorage.getItem(key);", /uses localStorage/],
    ["core", "core/x.js", "const width = window.innerWidth;", /uses window/],
    ["services", "services/x.js", 'document.getElementById("a");', /uses document/],
    ["services", "services/x.js", "const response = await fetch(url);", /uses fetch/],
    ["services", "services/x.js", "const online = globalThis.navigator?.onLine;", /uses globalThis/],
    ["core", "core/x.js", "if (Capacitor.isNativePlatform()) {}", /uses Capacitor/],
  ];
  for (const [layer, file, source, expected] of cases) {
    const problems = layerViolations(layer, file, source);
    assert.ok(problems.some((problem) => expected.test(problem)), `${source} → ${problems.join("; ") || "no problems"}`);
  }
  const clean = [
    ["core", "core/x.js", 'import { readRationDay } from "./ration-domain.js";'],
    ["services", "services/catalog/x.js", 'import { normalizeProductName } from "../../core/ration-domain.js";'],
    ["core", "core/x.js", "// window and document live in the UI"],
    ["core", "core/x.js", 'const text = "откройте document";'],
    ["services", "services/x.js", "const response = await fetchImpl(url);"],
    ["services", "services/x.js", "const options = { fetch: adapters.fetch };"],
  ];
  for (const [layer, file, source] of clean) assert.deepEqual(layerViolations(layer, file, source), [], source);
});
