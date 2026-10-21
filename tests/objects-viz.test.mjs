import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkCategorical, checkRamp, checkStatus, checkTokens, contrast, deltaE, readTokens } from "../scripts/check-palette.mjs";
import { runSeries } from "../mobile-shell/objects/core/query.js";
import { valueOf } from "../mobile-shell/objects/core/values.js";
import { buildDemoState } from "../mobile-shell/objects/viz/demo.js";
import { checkDashboard, resolveMeter, resolveRows, resolveSeries, resolveStat } from "../mobile-shell/objects/viz/data.js";
import { COMPONENTS, LIMITS, TAGS, normalizeMarkup, parseMarkup, validateMarkup } from "../mobile-shell/objects/viz/validate.js";
import {
  bucketKey, bucketsOf, dateLabel, fmtAxis, fmtNum, fmtValue, niceTicks, normalizeSeries, previousRange, rangeProblem, resolveRange, weekStart,
} from "../mobile-shell/objects/viz/util.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const viz = path.join(here, "..", "mobile-shell", "objects", "viz");
const TODAY = "2026-10-21"; // a Wednesday
const state = buildDemoState(TODAY);
const ctx = { today: TODAY };
const wrap = (inner) => `<c-dashboard v="1">${inner}</c-dashboard>`;
const bars = (attrs, title = "Вода") => wrap(`<c-card title="${title}"><c-bars ${attrs}></c-bars></c-card>`);
const check = (markup, options = {}) => validateMarkup(markup, { state, today: TODAY, ...options });

test("weeks start on Monday and months bucket by calendar month", () => {
  assert.equal(weekStart("2026-10-21"), "2026-10-19");
  assert.equal(weekStart("2026-10-25"), "2026-10-19", "Sunday belongs to the week of the Monday before");
  assert.equal(weekStart("2026-10-26"), "2026-10-26");
  assert.equal(bucketKey("2026-10-25T23:59", "week"), "2026-10-19");
  assert.equal(bucketKey("2026-10-25", "month"), "2026-10");
  assert.deepEqual(resolveRange("@thisWeek", TODAY), { from: "2026-10-19", to: "2026-10-25" });
  assert.deepEqual(resolveRange("@last12w", TODAY), { from: "2026-08-03", to: TODAY });
  assert.deepEqual(resolveRange("@last6m", TODAY), { from: "2026-05-01", to: TODAY });
  assert.deepEqual(resolveRange("@thisMonth", TODAY), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(bucketsOf({ from: "2026-05-01", to: TODAY }, "month"), ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  assert.equal(bucketsOf(resolveRange("@last12w", TODAY), "week").length, 12);
  assert.deepEqual(previousRange("@last7d", TODAY), { from: "2026-10-08", to: "2026-10-14" });
  assert.deepEqual(previousRange("@thisWeek", TODAY), { from: "2026-10-12", to: "2026-10-14" }, "a running week is compared with the same days of the last one");
  assert.equal(rangeProblem("@last400d") != null, true);
  assert.equal(rangeProblem("@last12w"), null);
  // across a year end the weeks and months still line up
  assert.equal(weekStart("2027-01-01"), "2026-12-28");
  assert.deepEqual(bucketsOf({ from: "2026-11-15", to: "2027-01-10" }, "month"), ["2026-11", "2026-12", "2027-01"]);
});

test("day, week and month series add up the same entries", () => {
  const water = Object.values(state.objects).filter((o) => o.type === "water");
  const spec = { tag: "c-bars", set: "set_water", value: "drunk", fn: "sum", range: "@last12w" };
  const days = resolveSeries(state, { ...spec, by: "day" }, ctx);
  const weeks = resolveSeries(state, { ...spec, by: "week" }, ctx);
  const months = resolveSeries(state, { ...spec, by: "month" }, ctx);
  const sum = (list) => list.reduce((a, b) => a + (b || 0), 0);
  const all = sum(water.map((o) => o.props.drunk));
  assert.equal(sum(days.series[0].values), all);
  assert.equal(sum(weeks.series[0].values), all);
  assert.equal(sum(months.series[0].values), all);
  assert.equal(weeks.buckets.length, 12);
  assert.ok(weeks.buckets.every((b) => weekStart(b) === b), "week buckets are Mondays");
  for (const [i, week] of weeks.buckets.entries()) {
    const expected = sum(water.filter((o) => weekStart(o.props.date) === week).map((o) => o.props.drunk));
    assert.equal(weeks.series[0].values[i] ?? 0, expected, `week of ${week}`);
  }
  for (const [i, month] of months.buckets.entries()) {
    const expected = sum(water.filter((o) => o.props.date.startsWith(month)).map((o) => o.props.drunk));
    assert.equal(months.series[0].values[i] ?? 0, expected, `month ${month}`);
  }
});

test("the day series equals runSeries of query.js, and the other functions follow", () => {
  const set = state.objects.set_water;
  const mine = resolveSeries(state, { tag: "c-bars", set: "set_water", value: "drunk", fn: "sum", range: "@last30d" }, ctx);
  const theirs = runSeries(state, set.props.query, { dateRel: "date", valueRel: "drunk", fn: "sum", range: "@last30d" }, ctx);
  assert.deepEqual(mine.buckets, theirs.map((p) => p.date));
  assert.deepEqual(mine.series[0].values, theirs.map((p) => p.value));
  const avg = resolveSeries(state, { tag: "c-line", set: "set_weight", value: "weightKg", fn: "avg", range: "@last30d" }, ctx);
  const theirAvg = runSeries(state, state.objects.set_weight.props.query, { dateRel: "date", valueRel: "weightKg", fn: "avg", range: "@last30d" }, ctx);
  assert.deepEqual(avg.series[0].values, theirAvg.map((p) => p.value));
  assert.ok(avg.series[0].values.includes(null), "a day without a weighing stays a gap");
});

test("categories become series in a stable order, a long tail folds into «Другое»", () => {
  const stacked = resolveSeries(state, { tag: "c-bars", set: "set_activity", value: "duration", fn: "sum", range: "@last12w", by: "week", category: "kind" }, ctx);
  assert.ok(stacked.series.length >= 2 && stacked.series.length <= 6);
  assert.deepEqual(stacked.series.map((s) => s.color), stacked.series.map((_, i) => i));
  const names = stacked.series.map((s) => s.label);
  const order = state.relations.kind.options.map((o) => o.name);
  assert.deepEqual(names, [...names].sort((a, b) => order.indexOf(a) - order.indexOf(b)), "the order of the select options, not the rank by size");
  const byProduct = resolveSeries(state, { tag: "c-bars", set: "set_spend", value: "price", fn: "sum", range: "@last12w", by: "month", category: "product" }, ctx);
  assert.ok(byProduct.series.length <= 6);
  const stat = resolveStat(state, { tag: "c-stat", set: "set_activity", value: "duration", fn: "sum", range: "@last30d", compare: "yes", spark: "yes" }, ctx);
  assert.equal(typeof stat.value, "number");
  assert.equal(stat.periodLabel, "предыдущим 30 дням");
  assert.equal(stat.spark.length, 30);
  const meter = resolveMeter(state, { tag: "c-meter", set: "set_water", value: "drunk", range: "@today", goal: "2000" }, ctx);
  assert.equal(meter.goal, 2000);
  const rows = resolveRows(state, { tag: "c-table", set: "set_activity", columns: "date,kind,duration", limit: "3" }, ctx);
  assert.equal(rows.rows.length, 3);
  assert.equal(rows.rows[0].cells[2].text.endsWith("мин"), true);
});

test("numbers and dates read in Russian", () => {
  assert.equal(fmtNum(1250).replace(/\s/g, ""), "1250");
  assert.equal(fmtNum(82.4), "82,4");
  assert.equal(fmtNum(2000000), "2 млн");
  assert.equal(fmtNum(null), "—");
  assert.equal(fmtValue(2000, "мл"), "2 000 мл");
  assert.equal(fmtAxis(1500), "1,5 тыс.");
  assert.equal(dateLabel("2026-10-05"), "5 окт");
  assert.equal(dateLabel("2026-10-05", "day", "long"), "пн, 5 октября");
  assert.equal(dateLabel("2026-10", "month", "long"), "октябрь 2026");
  const t = niceTicks(0, 1950, 4);
  assert.deepEqual(t.ticks, [0, 500, 1000, 1500, 2000]);
  const loose = normalizeSeries([{ date: "2026-10-02", value: 2 }, { date: "2026-10-01", value: "1" }, { date: "2026-10-03", value: null }]);
  assert.deepEqual(loose.buckets, ["2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.deepEqual(loose.series[0].values, [1, 2, null]);
  assert.deepEqual(normalizeSeries([3, 4, 5]).series[0].values, [3, 4, 5]);
});

test("the parser reads tags, attributes, entities and refuses broken structure", () => {
  const ok = parseMarkup(`<!-- c --><c-dashboard v="1"><p>a &amp; b &lt;</p></c-dashboard>`);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.nodes[0].children[0].children[0].text, "a & b <");
  assert.equal(parseMarkup(`<c-card><c-bars></c-card>`).problems[0].rule, "unclosed-tag");
  assert.equal(parseMarkup(`<c-card></c-bars>`).problems[0].rule, "stray-close");
  assert.equal(parseMarkup(`<c-card title="x`).problems[0].rule, "parse-error");
  assert.equal(parseMarkup(`<c-spark title=a />`).problems.map((p) => p.rule).sort().join(), "self-closing,unquoted-attr");
  assert.equal(parseMarkup(`<!doctype html>`).problems[0].rule, "parse-error");
  const dup = parseMarkup(`<c-card title="a" title="b"></c-card>`);
  assert.deepEqual(dup.nodes[0].duplicates, ["title"]);
});

test("the normalizer fixes slips with one reading and reports what it changed", () => {
  const messy = `<c-dashboard v="1.0"><C-Card TITLE=" Вода "><c-bars set="set_water" value="drunk" fn="Average" by="weekly" range="last 7 days" goal="2 000 мл" stack=""></c-bars></C-Card></c-dashboard>`;
  const fixed = normalizeMarkup(messy);
  assert.equal(fixed.markup, `<c-dashboard v="1"><c-card title="Вода"><c-bars set="set_water" value="drunk" fn="avg" by="week" range="@last7d" goal="2000"></c-bars></c-card></c-dashboard>`);
  assert.ok(fixed.changes.length >= 6, fixed.changes.join("\n"));
  assert.ok(fixed.changes.some((c) => c.includes('fn="Average"')) || fixed.changes.some((c) => c.includes("average") || c.includes("Average")));
  const again = normalizeMarkup(fixed.markup);
  const bools = normalizeMarkup(wrap(`<c-card title="a"><c-line set="set_water" value="drunk" area="no"></c-line><c-line set="set_water" value="drunk" area=""></c-line><c-line set="set_water" value="drunk" area="да"></c-line></c-card>`));
  assert.equal(bools.markup.includes('area="no"'), false);
  assert.equal(bools.markup.match(/area="yes"/g).length, 2, "an empty or affirmative flag is written as yes, a negative one is dropped");
  assert.deepEqual(again.changes, [], "normalizing twice changes nothing");
  assert.equal(again.markup, fixed.markup);
  // what it cannot fix stays for the validator
  const left = normalizeMarkup(`<c-dashboard v="1"><c-card title="a"></c-bars></c-dashboard>`);
  assert.equal(left.changes.length, 0);
  assert.equal(check(`<c-dashboard v="1"><c-card title="a"></c-bars></c-dashboard>`).problems[0].rule, "stray-close");
  const viaValidator = check(bars(`set="set_water" value="drunk" fn="average" by="weekly" range="7d" goal="2 000 мл"`));
  assert.equal(viaValidator.ok, true);
  assert.equal(viaValidator.changes.length, 4);
  assert.match(viaValidator.markup, /fn="avg" by="week" range="@last7d" goal="2000"/);
});

test("every example is valid against the demo space, short and in the format of the examples", () => {
  const files = JSON.parse(fs.readFileSync(path.join(viz, "examples", "index.json"), "utf8"));
  assert.equal(files.length, 6);
  const tagCounts = {};
  for (const file of files) {
    const src = fs.readFileSync(path.join(viz, "examples", file), "utf8");
    assert.match(src, /^<!-- Запрос: [^\n]+ -->\n<c-dashboard v="1">/, `${file}: one request line on top`);
    const result = checkDashboard(src, state, ctx);
    assert.deepEqual(result.problems, [], `${file}: ${result.messages.join(" ")}`);
    assert.deepEqual(result.changes, [], `${file}: an example needs no normalizing`);
    const { nodes } = parseMarkup(result.markup);
    let elements = 0;
    const walk = (list) => { for (const n of list) if (n.type === "el") { elements += 1; tagCounts[n.tag] = (tagCounts[n.tag] || 0) + 1; walk(n.children); } };
    walk(nodes);
    assert.ok(elements - 1 <= LIMITS.elements, `${file}: ${elements - 1} elements`);
  }
  for (const tag of TAGS) assert.ok((tagCounts[tag] || 0) >= 3, `${tag} appears ${tagCounts[tag] || 0} times across the examples, need 3`);
});

test("the validator refuses unsafe and unknown markup with an exact, machine-readable problem", () => {
  const onclick = check(bars(`set="set_water" value="drunk" onclick="x()"`));
  assert.deepEqual(onclick.problems, [{
    path: "c-card[0] > c-bars[0]@onclick", rule: "unknown-attr",
    message: "У <c-bars> нет атрибута «onclick» (скрипты, стили, классы и ссылки запрещены). Допустимы: title, set, value, fn, range, date, unit, by, category, goal, stack.",
    allowed: ["title", "set", "value", "fn", "range", "date", "unit", "by", "category", "goal", "stack"],
  }]);
  assert.deepEqual(onclick.messages, [onclick.problems[0].message]);
  const script = check(wrap(`<script>alert(1)</script><c-card title="Вода"><c-bars set="set_water" value="drunk"></c-bars></c-card>`));
  assert.equal(script.problems.length, 1);
  assert.equal(script.problems[0].rule, "unknown-tag");
  assert.equal(script.problems[0].path, "script[0]");
  assert.ok(script.problems[0].allowed.includes("c-bars") && !script.problems[0].allowed.includes("script"));
  for (const bad of [`<a href="x">q</a>`, `<style>p{}</style>`, `<img src="x">`, `<iframe></iframe>`, `<div class="a"></div>`]) assert.equal(check(wrap(bad)).ok, false, bad);
  for (const attr of [`class="a"`, `id="a"`, `style="color:red"`, `href="x"`, `src="x"`, `onload="x"`]) {
    const r = check(bars(`set="set_water" value="drunk" ${attr}`));
    assert.deepEqual(r.problems.map((p) => p.rule), ["unknown-attr"], attr);
  }
  const noRoot = check(`<c-card title="Вода"></c-card>`);
  assert.deepEqual(noRoot.problems.map((p) => [p.rule, p.path]), [["no-root", "c-dashboard"]]);
  assert.deepEqual(check(`<c-dashboard v="2"><c-card title="a"><c-bars set="set_water" value="drunk"></c-bars></c-card></c-dashboard>`).problems, [{
    path: "c-dashboard@v", rule: "bad-version", message: 'Версия формата v="2" не поддерживается. Поддерживается только v="1".', allowed: ["1"],
  }]);
  assert.equal(check(`<c-dashboard><c-card title="a"></c-card></c-dashboard>`).problems[0].rule, "missing-attr");
  assert.ok(check(wrap(`<c-card title="a"></c-card>`) + "<p>x</p>").problems.some((p) => p.rule === "extra-root"), "nothing may stand outside the root");
  assert.equal(check("").problems[0].rule, "no-root");
  assert.equal(check(`<c-dashboard v="1"><c-bars set="set_water" value="drunk" title="a"></c-bars>text</c-dashboard>`).problems[0].rule, "text-not-allowed");
});

test("limits: sixteen elements, two levels, short text, flat structure", () => {
  const many = wrap(Array.from({ length: 17 }, () => `<c-card title="Вода"><c-spark set="set_water" value="drunk"></c-spark></c-card>`).join(""));
  assert.deepEqual(check(many).problems.map((p) => p.rule), ["too-many-elements"]);
  const sixteen = wrap(Array.from({ length: 8 }, () => `<c-card title="Вода"><c-spark set="set_water" value="drunk"></c-spark></c-card>`).join(""));
  assert.equal(check(sixteen).ok, true);
  const deep = check(wrap(`<section><c-grid><c-card title="a"><c-bars set="set_water" value="drunk"></c-bars></c-card></c-grid></section>`));
  assert.deepEqual(deep.problems.map((p) => p.rule), ["not-allowed-here", "too-deep"]);
  assert.equal(check(wrap(`<c-grid><c-card title="a"><c-bars set="set_water" value="drunk"></c-bars></c-card></c-grid>`)).ok, true, "grid > card > chart is two levels");
  assert.equal(check(wrap(`<section><c-card title="a"><c-bars set="set_water" value="drunk"></c-bars></c-card></section>`)).ok, true);
  assert.deepEqual(check(wrap(`<p>${"а".repeat(201)}</p><c-card title="a"><c-bars set="set_water" value="drunk"></c-bars></c-card>`)).problems.map((p) => p.rule), ["text-too-long"]);
  assert.deepEqual(check(wrap(`<c-card title="${"а".repeat(61)}"><c-bars set="set_water" value="drunk"></c-bars></c-card>`)).problems.map((p) => p.rule), ["text-too-long"]);
  assert.equal(check(wrap(`<c-card title="a"><c-card title="b"></c-card></c-card>`)).problems[0].rule, "not-allowed-here");
  assert.equal(check(wrap(`<h2><c-stat set="set_water" value="drunk" title="a"></c-stat></h2>`)).problems[0].rule, "not-allowed-here");
});

test("every chart has a title, and the model cannot write numbers about the person", () => {
  const untitled = check(wrap(`<c-bars set="set_water" value="drunk"></c-bars>`));
  assert.deepEqual(untitled.problems, [{ path: "c-bars[0]", rule: "no-title", message: 'У <c-bars> нет названия. Добавьте title="…" ему или его карточке <c-card title="…">.' }]);
  assert.equal(check(wrap(`<c-bars set="set_water" value="drunk" title="Вода"></c-bars>`)).ok, true, "a title on the chart itself is enough");
  assert.equal(check(wrap(`<c-card><c-bars set="set_water" value="drunk"></c-bars></c-card>`)).problems[0].rule, "no-title");

  const invented = check(wrap(`<h2>Вы выпили 1800 мл</h2><c-card title="Вода"><c-bars set="set_water" value="drunk"></c-bars></c-card>`));
  assert.deepEqual(invented.problems, [{
    path: "h2[0]", rule: "number-in-text",
    message: "В тексте «Вы выпили 1800 мл» стоит число 1800, которого нет в привязках. Не пишите числа о человеке сами: уберите число или возьмите его из goal, limit или периода.",
  }]);
  assert.equal(check(wrap(`<c-card title="Вода: 1800 мл"><c-bars set="set_water" value="drunk"></c-bars></c-card>`)).problems[0].rule, "number-in-text", "titles are text too");
  assert.equal(check(wrap(`<p>Рекомендуем 2 000 мл</p><c-card title="Вода"><c-bars set="set_water" value="drunk" goal="2000"></c-bars></c-card>`)).ok, true, "a number equal to a goal is a binding");
  assert.equal(check(wrap(`<c-card title="Вода за 7 дней"><c-bars set="set_water" value="drunk" range="@last7d"></c-bars></c-card>`)).ok, true, "the period is a binding too");
  assert.equal(check(wrap(`<c-card title="Вода за 8 дней"><c-bars set="set_water" value="drunk" range="@last7d"></c-bars></c-card>`)).problems[0].rule, "number-in-text");
});

test("a dashboard of empty charts is refused, and so is a chart with nothing to draw", () => {
  const markup = bars(`set="set_water" value="drunk" range="@last7d"`);
  assert.equal(check(markup).ok, true);
  const refused = check(markup, { probe: () => false });
  assert.deepEqual(refused.problems.map((p) => p.rule), ["all-empty"]);
  assert.equal(check(markup, { probe: (tag) => (tag === "c-bars" ? false : true) }).ok, false);
  const mixed = wrap(`<c-card title="Вода"><c-bars set="set_water" value="drunk"></c-bars></c-card><c-card title="Вес"><c-line set="set_weight" value="weightKg" fn="avg"></c-line></c-card>`);
  assert.equal(check(mixed, { probe: (tag) => tag === "c-line" }).ok, true, "one chart with data is enough");
  assert.equal(check(wrap(`<p>Только слова</p>`)).problems[0].rule, "no-charts");
  // the real probe: a set with entries only far in the past has no data in the range
  const dry = { ...state, objects: Object.fromEntries(Object.entries(state.objects).filter(([, o]) => o.type !== "water")) };
  const stale = checkDashboard(wrap(`<c-card title="Вода"><c-bars set="set_water" value="drunk" range="@last7d"></c-bars></c-card>`), dry, ctx);
  assert.deepEqual(stale.problems.map((p) => p.rule), ["all-empty"]);
  assert.equal(checkDashboard(wrap(`<c-card title="Вода"><c-bars set="set_water" value="drunk" range="@last7d"></c-bars></c-card>`), state, ctx).ok, true);
});

test("bindings are checked against the object space", () => {
  const one = (attrs, expected, path) => {
    const r = check(bars(attrs));
    assert.equal(r.problems[0]?.rule, expected, `${attrs}: ${r.messages.join(" ")}`);
    if (path) assert.equal(r.problems[0].path, `c-card[0] > c-bars[0]${path}`);
    return r.problems[0];
  };
  const unknownSet = one(`set="set_nothing" value="drunk"`, "unknown-set", "@set");
  assert.ok(unknownSet.allowed.includes("set_water") && unknownSet.message.includes("set_water («Вода»)"), "the repair message lists the sets that exist");
  assert.equal(one(`set="dashboard_home" value="drunk"`, "unknown-set").rule, "unknown-set");
  const unknownRel = one(`set="set_water" value="nope"`, "unknown-relation", "@value");
  assert.deepEqual(unknownRel.allowed, ["date", "drunk"]);
  assert.equal(one(`set="set_water" value="price"`, "not-in-set", "@value").allowed.includes("drunk"), true);
  assert.match(one(`set="set_water" value="date"`, "not-numeric", "@value").message, /не число/);
  one(`set="set_water" value="date" fn="count"`, undefined);
  assert.equal(check(bars(`set="set_water" fn="count"`)).ok, true, "count needs no relation");
  one(`set="set_water"`, "missing-attr");
  one(`set="set_products" fn="count"`, "no-date-relation");
  assert.equal(check(bars(`set="set_water" value="drunk" date="drunk"`)).problems[0].rule, "no-date-relation");
  assert.equal(check(bars(`set="set_water" value="drunk" date="nope"`)).problems[0].rule, "unknown-relation");
  one(`set="set_activity" value="duration" category="duration"`, "bad-category", "@category");
  assert.equal(check(bars(`set="set_activity" value="duration" category="kind"`)).ok, true);
  assert.equal(check(bars(`set="set_spend" value="price" category="product"`)).ok, true, "an object relation can split a chart");
  one(`set="set_water" value="drunk" fn="median"`, "bad-value", "@fn");
  one(`set="set_water" value="drunk" range="@last999d"`, "bad-value", "@range");
  one(`set="set_water" value="drunk" by="year"`, "bad-value", "@by");
  one(`set="set_water" value="drunk" goal="-5"`, "bad-goal", "@goal");
  one(`set="set_water" value="drunk" goal="много"`, "bad-value", "@goal");
  one(`set="set_water" value="drunk" goal="0"`, "bad-goal", "@goal");
  one(`set="set_water" value="drunk" goal="99999999"`, "bad-goal", "@goal");
  one(`set="set_water" value="drunk" range="@today"`, "range-too-short", "@range");
  one(`set="set_water" value="drunk" range="@last366d"`, "too-many-points");
  one(`set="set_water" value="drunk" range="@last366d" by="day"`, "too-many-points", "@by");
  assert.equal(check(bars(`set="set_water" value="drunk" range="@last12w" by="week"`)).ok, true);
  assert.equal(check(wrap(`<c-card title="a"><c-heatmap set="set_water" value="drunk" range="@last7d"></c-heatmap></c-card>`)).problems[0].rule, "range-too-short");
  assert.equal(check(wrap(`<c-card title="a"><c-meter set="set_water" value="drunk" range="@today"></c-meter></c-card>`)).problems[0].rule, "missing-attr", "a meter needs a goal");
  assert.equal(check(wrap(`<c-card title="a"><c-table set="set_water" columns="date,nope"></c-table></c-card>`)).problems[0].rule, "unknown-relation");
  assert.equal(check(wrap(`<c-card title="a"><c-table set="set_water" columns="date,drunk,date,drunk,date,drunk"></c-table></c-card>`)).problems[0].rule, "bad-value");
  assert.equal(check(wrap(`<c-card title="a"><c-list set="set_open_requests" limit="500"></c-list></c-card>`)).problems[0].rule, "bad-goal");
});

test("an energy goal under 1200 kcal is refused, other goals are not", () => {
  const refused = check(bars(`set="set_eaten" value="eaten_kcal" goal="900"`));
  assert.deepEqual(refused.problems, [{
    path: "c-card[0] > c-bars[0]@goal", rule: "kcal-goal-floor",
    message: "Цель по энергии 900 ккал ниже 1200 ккал: приложение не ставит такие цели, потому что это ниже безопасного минимума. Поставьте не меньше 1200 или уберите цель.",
  }]);
  assert.equal(check(bars(`set="set_eaten" value="eaten_kcal" goal="1200"`)).ok, true);
  assert.equal(check(bars(`set="set_eaten" value="eaten_kcal" goal="2400"`)).ok, true);
  assert.equal(check(bars(`set="set_eaten" value="eaten_protein" goal="140"`)).ok, true, "protein is not energy");
  assert.equal(check(wrap(`<c-card title="a"><c-meter set="set_eaten" value="eaten_kcal" range="@today" goal="1000" goal-type="max"></c-meter></c-card>`)).problems[0].rule, "kcal-goal-floor", "a limit is a goal too");
  const burned = check(wrap(`<c-card title="a"><c-bars set="set_sessions" fn="count" range="@last7d" goal="3"></c-bars></c-card>`));
  assert.equal(burned.problems.some((p) => p.rule === "kcal-goal-floor"), false);
});

test("the components table is what the validator and the prompt will read", () => {
  assert.deepEqual(TAGS, ["c-dashboard", "section", "h2", "h3", "p", "c-grid", "c-card", "c-stat", "c-meter", "c-bars", "c-line", "c-spark", "c-heatmap", "c-table", "c-list", "c-empty"]);
  for (const [tag, spec] of Object.entries(COMPONENTS)) {
    assert.ok(spec.doc, `${tag} has a description`);
    for (const child of spec.children) assert.ok(COMPONENTS[child], `${tag} allows a known child ${child}`);
  }
  assert.deepEqual(Object.keys(COMPONENTS["c-bars"].attrs).sort(), ["by", "category", "date", "fn", "goal", "range", "set", "stack", "title", "unit", "value"]);
});

test("the palettes pass the six checks in light and dark", () => {
  const report = checkTokens();
  for (const mode of ["light", "dark"]) {
    const r = report[mode];
    assert.equal(r.categorical.ok, true, JSON.stringify(r.categorical.results));
    assert.equal(r.sequential.ok, true, JSON.stringify(r.sequential.results));
    assert.equal(r.status.ok, true, JSON.stringify(r.status.results));
    const states = Object.fromEntries(r.categorical.results.map((x) => [x.name, x.state]));
    assert.deepEqual(states, { "Lightness band": "pass", "Chroma floor": "pass", "CVD separation": "pass", "Normal-vision floor": "pass", "Contrast vs surface": mode === "light" ? "warn" : "pass" });
    assert.equal(r.categorical.palette.length, 6);
    assert.equal(new Set(r.categorical.palette).size, 6);
  }
  assert.equal(report.dark.surface, "#1c1f1c");
  assert.equal(report.light.surface, "#ffffff");
  // the light contrast warning is the documented one: relief is the table twin and the tooltip
  assert.match(report.light.categorical.results.find((x) => x.name === "Contrast vs surface").detail, /table view/);
});

test("the palette checker fails what it must fail", () => {
  assert.equal(checkCategorical(["#2a78d6", "#2b79d7", "#eb6834"], { mode: "light", surface: "#ffffff" }).ok, false, "near twins");
  const gray = checkCategorical(["#808080", "#2a78d6"], { mode: "light", surface: "#ffffff" });
  assert.equal(gray.results.find((r) => r.name === "Chroma floor").state, "fail");
  const dim = checkCategorical(["#1b3a8a", "#eb6834"], { mode: "light", surface: "#ffffff" });
  assert.equal(dim.results.find((r) => r.name === "Lightness band").state, "fail");
  assert.equal(checkCategorical(["#2a78d6", "nope"], { mode: "light", surface: "#ffffff" }).ok, false);
  assert.equal(checkRamp(["#cfe6d8", "#2e8758", "#98cdb0"], { mode: "light", surface: "#ffffff" }).ok, false, "a ramp must be monotone");
  assert.equal(checkRamp(["#cfe6d8", "#98cdb0", "#5b7fab"], { mode: "light", surface: "#ffffff" }).ok, false, "a ramp is one hue");
  const status = checkStatus({ good: "#0ca30c", warning: "#0ca30d", serious: "#ec835a", critical: "#d03b3b" }, ["#1f7a46"], { surface: "#ffffff" });
  assert.equal(status.ok, false, "status steps must stay apart");
  assert.ok(Math.abs(contrast("#000000", "#ffffff") - 21) < 1e-9);
  assert.ok(deltaE("#2a78d6", "#2a78d6") === 0);
  // the reference palette of the method gives its documented worst pair
  const ref = checkCategorical(["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"], { mode: "light", surface: "#fcfcfb" });
  assert.match(ref.results.find((r) => r.name === "CVD separation").detail, /dE 9\.1 /);
  assert.match(ref.results.find((r) => r.name === "Normal-vision floor").detail, /dE 19\.6 /);
});

test("scripts/check-palette.mjs runs from the command line and exits with the result", () => {
  const script = path.join(here, "..", "scripts", "check-palette.mjs");
  const out = execFileSync(process.execPath, [script], { encoding: "utf8" });
  assert.match(out, /light categorical .*: OK/);
  assert.match(out, /dark categorical .*: OK/);
  assert.match(out, /dark status .*: OK/);
  assert.throws(() => execFileSync(process.execPath, [script, "#2a78d6,#2b79d7", "--mode", "light"], { encoding: "utf8", stdio: "pipe" }));
});

test("tokens.css: the T3 contract names, the Cookish palette behind them, both dark blocks equal", () => {
  const css = fs.readFileSync(path.join(viz, "tokens.css"), "utf8");
  const tokens = readTokens(css);
  const contract = ["background", "foreground", "muted", "muted-foreground", "card", "card-foreground", "border", "input", "ring", "primary", "primary-foreground", "accent", "accent-foreground", "destructive", "warning", "success", "info", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6"];
  for (const mode of ["light", "dark"]) for (const name of contract) assert.match(tokens[mode][`--${name}`] || "", /^#[0-9a-f]{6}$/, `--${name} (${mode})`);
  for (const name of ["radius", "font-sans"]) assert.match(css, new RegExp(`--${name}:`));
  // the contract is scoped to the kit's elements: --accent and --ring mean something else in objects.css
  assert.ok(!/^:root\s*\{/m.test(css), "no :root rule");
  const dark = [...css.matchAll(/\/\*\s*@mode dark\s*\*\/([\s\S]*?)\/\*\s*@end\s*\*\//g)].map((m) => [...m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => `${d[1]}:${d[2].trim()}`).join("|"));
  assert.equal(dark.length, 4, "contract and chart roles, each in the media query and in the forced theme");
  assert.equal(dark[0], dark[1], "contract: media query and forced theme");
  assert.equal(dark[2], dark[3], "chart roles: media query and forced theme");
  // the values come from objects.css
  const app = fs.readFileSync(path.join(viz, "..", "objects.css"), "utf8");
  const root = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));
  const light = root(app.slice(app.indexOf(":root {"), app.indexOf("@media (prefers-color-scheme: dark)")));
  const night = root(app.slice(app.indexOf(":root[data-theme=\"dark\"]")));
  const hex6 = (v) => (/^#[0-9a-f]{3}$/i.test(v) ? `#${[...v.slice(1)].map((c) => c + c).join("")}` : v);
  const map = { background: "--bg", foreground: "--ink", muted: "--track", "muted-foreground": "--muted", card: "--surface", border: "--line", input: "--ring", primary: "--accent", accent: "--accent-soft", destructive: "--red", warning: "--amber" };
  for (const [name, source] of Object.entries(map)) {
    assert.equal(tokens.light[`--${name}`], hex6(light[source]), `light --${name} is ${source} of objects.css`);
    if (name !== "primary") assert.equal(tokens.dark[`--${name}`], hex6(night[source]), `dark --${name} is ${source} of objects.css`);
  }
  assert.equal(tokens.dark["--primary"], night["--accent"]);
  assert.equal(tokens.light["--accent-foreground"], light["--accent-text"]);
  assert.equal(tokens.dark["--accent-foreground"], night["--accent-text"]);
  // text tokens read on the card surface
  for (const mode of ["light", "dark"]) {
    for (const name of ["foreground", "muted-foreground", "destructive", "warning", "success", "info", "accent-foreground"]) {
      const surface = name === "accent-foreground" ? tokens[mode]["--accent"] : tokens[mode]["--card"];
      assert.ok(contrast(tokens[mode][`--${name}`], surface) >= 4.5, `${mode} --${name} on its surface`);
    }
  }
});
