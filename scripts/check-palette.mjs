// Palette checks for the chart tokens of mobile-shell/objects/viz/tokens.css.
// The method is the dataviz one: color is computed, not eyeballed. A categorical
// palette is legal only if it passes six checks:
//   1. fixed hue anchors  (structural: chart-1..6 keep their order, see the test)
//   2. lightness band per mode (OKLCH L)
//   3. chroma floor (OKLCH C)
//   4. CVD separation of neighbours (OKLab dE x100 under Machado 2009 protan and
//      deutan at severity 1), plus the normal-vision floor
//   5. contrast of a mark against its surface (>= 3:1, or relief with labels)
//   6. documented palette only (structural: every slot is a hex of tokens.css)
// Sequential ramps are checked for monotone lightness, status colors for
// contrast, mutual distance and distance from the categorical slots.
//
//   node scripts/check-palette.mjs            # reads viz/tokens.css, both modes
//   node scripts/check-palette.mjs "#hex,#hex,..." --mode dark --surface "#1c1f1c"
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BAND = { light: [0.43, 0.77], dark: [0.48, 0.67] };
export const CHROMA_FLOOR = 0.10;
export const CVD_TARGET = 8;
export const CVD_FLOOR = 6;
export const NORMAL_FLOOR = 15;
export const CONTRAST_MIN = 3;
export const ORDINAL_MIN_DL = 0.06;

// Machado, Oliveira, Fernandes 2009, severity 1.0, applied in linear RGB.
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

export const isHex = (value) => /^#[0-9a-fA-F]{6}$/.test(value);
const toSrgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linear = (hex) => toSrgb(hex).map(toLinear);

export function luminance(hex) {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function oklabOf([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklch(hex) {
  const [L, a, b] = oklabOf(linear(hex));
  return { L, C: Math.hypot(a, b), H: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

function simulate(hex, kind) {
  const [r, g, b] = linear(hex);
  const M = MACHADO[kind];
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return [0, 1, 2].map((i) => clamp(M[i][0] * r + M[i][1] * g + M[i][2] * b));
}

export function deltaE(a, b, kind = null) {
  const x = oklabOf(kind ? simulate(a, kind) : linear(a));
  const y = oklabOf(kind ? simulate(b, kind) : linear(b));
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

const pairsOf = (n, mode) => (mode === "all"
  ? Array.from({ length: n }, (_, i) => Array.from({ length: n - i - 1 }, (_, k) => [i, i + 1 + k])).flat()
  : Array.from({ length: Math.max(0, n - 1) }, (_, i) => [i, i + 1]));

// Result of one check: { name, state: "pass" | "warn" | "fail", detail }.
export function checkCategorical(palette, { mode = "light", surface, pairs = "adjacent" } = {}) {
  const [lo, hi] = BAND[mode];
  const results = [];
  const bad = palette.filter((c) => !isHex(c));
  if (bad.length) return { ok: false, results: [{ name: "Documented palette", state: "fail", detail: `not #rrggbb: ${bad.join(", ")}` }] };

  const off = palette.map((c) => [c, oklch(c).L]).filter(([, L]) => L < lo || L > hi);
  results.push({ name: "Lightness band", state: off.length ? "fail" : "pass", detail: off.length ? `outside L ${lo}-${hi}: ${off.map(([c, L]) => `${c} ${L.toFixed(3)}`).join(", ")}` : `all ${palette.length} inside L ${lo}-${hi}` });

  const gray = palette.map((c) => [c, oklch(c).C]).filter(([, C]) => C < CHROMA_FLOOR);
  results.push({ name: "Chroma floor", state: gray.length ? "fail" : "pass", detail: gray.length ? `reads gray: ${gray.map(([c, C]) => `${c} ${C.toFixed(3)}`).join(", ")}` : `all >= ${CHROMA_FLOOR}` });

  const list = pairsOf(palette.length, pairs);
  let worst = null;
  for (const kind of ["protan", "deutan"]) {
    for (const [i, j] of list) {
      const d = deltaE(palette[i], palette[j], kind);
      if (!worst || d < worst.d) worst = { d, kind, a: palette[i], b: palette[j] };
    }
  }
  if (worst) {
    const state = worst.d >= CVD_TARGET ? "pass" : worst.d >= CVD_FLOOR ? "warn" : "fail";
    results.push({ name: "CVD separation", state, detail: `worst ${pairs} ${worst.a}/${worst.b} dE ${worst.d.toFixed(1)} (${worst.kind})${state === "warn" ? ", needs secondary encoding" : ""}` });
  }
  let normal = null;
  for (const [i, j] of list) {
    const d = deltaE(palette[i], palette[j]);
    if (!normal || d < normal.d) normal = { d, a: palette[i], b: palette[j] };
  }
  if (normal) results.push({ name: "Normal-vision floor", state: normal.d >= NORMAL_FLOOR ? "pass" : "fail", detail: `worst ${pairs} ${normal.a}/${normal.b} dE ${normal.d.toFixed(1)} (floor ${NORMAL_FLOOR})` });

  const low = palette.map((c) => [c, contrast(c, surface)]).filter(([, r]) => r < CONTRAST_MIN);
  results.push({ name: "Contrast vs surface", state: low.length ? "warn" : "pass", detail: low.length ? `below ${CONTRAST_MIN}:1, needs labels or table view: ${low.map(([c, r]) => `${c} ${r.toFixed(2)}`).join(", ")}` : `all >= ${CONTRAST_MIN}:1 on ${surface}` });
  return { ok: results.every((r) => r.state !== "fail"), results };
}

// A one-hue ramp: lightness is monotone with visible steps, one hue.
export function checkRamp(ramp, { mode = "light", surface, lightEndMin = 1.2 } = {}) {
  const results = [];
  const L = ramp.map((c) => oklch(c).L);
  const dir = Math.sign(L[L.length - 1] - L[0]);
  const mono = L.every((v, i) => i === 0 || (v - L[i - 1]) * dir > 0);
  results.push({ name: "Lightness monotone", state: mono ? "pass" : "fail", detail: `L ${L.map((v) => v.toFixed(2)).join(" ")}` });
  const gaps = L.slice(1).map((v, i) => Math.abs(v - L[i]));
  const thin = gaps.filter((g) => g < ORDINAL_MIN_DL);
  results.push({ name: "Step gaps", state: thin.length ? "fail" : "pass", detail: `smallest dL ${Math.min(...gaps).toFixed(3)} (min ${ORDINAL_MIN_DL})` });
  const hues = ramp.map((c) => oklch(c).H);
  let spread = Math.max(...hues) - Math.min(...hues);
  if (spread > 180) spread = 360 - spread;
  results.push({ name: "Single hue", state: spread <= 40 ? "pass" : "fail", detail: `hue spread ${spread.toFixed(0)} deg` });
  // The pale end means «near zero» and may recede toward the surface, but the
  // first step still has to be visible as a mark.
  const edge = ramp[mode === "light" ? L.indexOf(Math.max(...L)) : L.indexOf(Math.min(...L))];
  const cr = contrast(edge, surface);
  results.push({ name: "Light-end contrast", state: cr >= lightEndMin ? "pass" : "fail", detail: `${edge} ${cr.toFixed(2)}:1 (min ${lightEndMin}:1)` });
  return { ok: results.every((r) => r.state !== "fail"), results };
}

// Status colors: fixed meaning, always shipped with an icon and a label. Checks:
// each one is readable as a mark (3:1, or relief via icon + label), neighbours on
// the good-to-critical scale are told apart, and no status impersonates a series.
export function checkStatus(status, categorical, { surface } = {}) {
  const names = ["good", "warning", "serious", "critical"];
  const colors = names.map((n) => status[n]);
  const results = [];
  const missing = names.filter((n) => !isHex(status[n] || ""));
  if (missing.length) return { ok: false, results: [{ name: "Documented palette", state: "fail", detail: `missing or not #rrggbb: ${missing.join(", ")}` }] };
  const low = names.map((n, i) => [n, contrast(colors[i], surface)]).filter(([, r]) => r < CONTRAST_MIN);
  results.push({ name: "Contrast vs surface", state: low.length ? "warn" : "pass", detail: low.length ? `below ${CONTRAST_MIN}:1, icon + label carry the meaning: ${low.map(([n, r]) => `${n} ${r.toFixed(2)}`).join(", ")}` : `all >= ${CONTRAST_MIN}:1` });
  const adjacent = colors.slice(1).map((c, i) => ({ pair: `${names[i]}/${names[i + 1]}`, d: deltaE(colors[i], c) }));
  const near = adjacent.filter((p) => p.d < 8);
  results.push({ name: "Scale neighbours", state: near.length ? "fail" : "pass", detail: adjacent.map((p) => `${p.pair} ${p.d.toFixed(1)}`).join(", ") });
  const ends = Math.min(deltaE(colors[0], colors[3], "protan"), deltaE(colors[0], colors[3], "deutan"));
  // Red and green collapse under CVD in every palette; the legal answer is that a status
  // never rides on hue alone (audit.js refuses a status without its glyph and word).
  results.push({ name: "Good vs critical under CVD", state: ends >= CVD_TARGET ? "pass" : "warn", detail: `dE ${ends.toFixed(1)} (target ${CVD_TARGET})${ends >= CVD_TARGET ? "" : ", glyph + word are mandatory"}` });
  let closest = null;
  for (const [i, c] of colors.entries()) {
    for (const [j, s] of categorical.entries()) {
      const d = deltaE(c, s);
      if (!closest || d < closest.d) closest = { d, name: `${names[i]}/chart-${j + 1}` };
    }
  }
  results.push({ name: "Not a series color", state: closest && closest.d >= 4 ? "pass" : "fail", detail: closest ? `closest ${closest.name} dE ${closest.d.toFixed(1)} (min 4; identity is carried by icon + label, not hue alone)` : "n/a" });
  return { ok: results.every((r) => r.state !== "fail"), results };
}

// tokens.css keeps the values of each mode in blocks marked by comments:
//   /* @mode light */ ... /* @end */   (and the same for dark)
// Only declarations between the markers are read, so the checks always see
// the values that ship.
export function readTokens(css) {
  const out = { light: {}, dark: {} };
  const re = /\/\*\s*@mode (light|dark)\s*\*\/([\s\S]*?)\/\*\s*@end\s*\*\//g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]][d[1]] = d[2].trim();
  }
  return out;
}

export const TOKENS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "mobile-shell", "objects", "viz", "tokens.css");

export function checkTokens(css = fs.readFileSync(TOKENS_PATH, "utf8")) {
  const tokens = readTokens(css);
  const report = {};
  for (const mode of ["light", "dark"]) {
    const t = tokens[mode];
    const surface = t["--card"];
    const categorical = [1, 2, 3, 4, 5, 6].map((n) => t[`--chart-${n}`]);
    const ramp = [1, 2, 3, 4, 5].map((n) => t[`--viz-seq-${n}`]);
    const status = { good: t["--viz-good"], warning: t["--viz-warning"], serious: t["--viz-serious"], critical: t["--viz-critical"] };
    report[mode] = {
      surface,
      categorical: { palette: categorical, ...checkCategorical(categorical, { mode, surface }) },
      sequential: { palette: ramp, ...checkRamp(ramp, { mode, surface }) },
      status: { palette: status, ...checkStatus(status, categorical, { surface }) },
    };
  }
  return report;
}

const GLYPH = { pass: "PASS", warn: "WARN", fail: "FAIL" };
function print(title, { results, ok }) {
  console.log(`\n${title}: ${ok ? "OK" : "FAILED"}`);
  for (const r of results) console.log(`  [${GLYPH[r.state]}] ${r.name.padEnd(28)} ${r.detail}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const positional = args.find((a) => !a.startsWith("--") && a.includes("#"));
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  if (positional) {
    const mode = flag("--mode") || "light";
    const surface = flag("--surface") || (mode === "light" ? "#ffffff" : "#1c1f1c");
    const result = checkCategorical(positional.split(",").map((s) => s.trim()), { mode, surface, pairs: flag("--pairs") || "adjacent" });
    print(`categorical ${mode}`, result);
    process.exit(result.ok ? 0 : 1);
  }
  const report = checkTokens();
  let ok = true;
  for (const [mode, parts] of Object.entries(report)) {
    for (const [name, result] of Object.entries(parts)) {
      if (name === "surface") continue;
      print(`${mode} ${name} ${JSON.stringify(result.palette)}`, result);
      ok &&= result.ok;
    }
  }
  process.exit(ok ? 0 : 1);
}
