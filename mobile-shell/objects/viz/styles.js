// Styles of the kit, injected once. Colors come only from the tokens
// (tokens.css): the theme contract of T3 Code plus the chart-only roles.
export const CSS = `
c-dashboard, c-grid, c-card, c-stat, c-meter, c-bars, c-line, c-spark, c-heatmap, c-table, c-list, c-empty { display: block; min-width: 0; font-family: var(--font-sans); color: var(--card-foreground); -webkit-text-size-adjust: 100%; }
c-dashboard { display: flex; flex-direction: column; gap: 16px; }
c-dashboard h2 { margin: 0; font-size: 24px; line-height: 1.2; font-weight: 720; letter-spacing: -0.01em; color: var(--foreground); }
c-dashboard h3 { margin: 0; font-size: 17px; line-height: 1.3; font-weight: 680; color: var(--foreground); }
c-dashboard p { margin: 0; font-size: 15px; line-height: 1.4; color: var(--muted-foreground); }
c-dashboard section { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
c-grid { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
c-grid[cols="2"] { grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); }
c-card { position: relative; display: flex; flex-direction: column; gap: 12px; padding: 16px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); }
:is(c-dashboard, c-grid, section) > :is(c-stat, c-meter, c-bars, c-line, c-spark, c-heatmap, c-table, c-list, c-empty) { padding: 16px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); }
c-card > p { font-size: 14px; }
.viz-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; min-width: 0; }
.viz-card-text { min-width: 0; flex: 1; }
.viz-card-title { font-size: 16px; font-weight: 650; line-height: 1.3; color: var(--foreground); overflow-wrap: anywhere; }
.viz-card-caption { margin-top: 2px; font-size: 13px; line-height: 1.35; color: var(--muted-foreground); }
.viz-card-tools { flex: none; display: flex; margin: -12px -10px -12px 0; }
.viz-card-tools:empty { display: none; }
.viz-title { font-size: 14px; font-weight: 600; line-height: 1.3; color: var(--muted-foreground); overflow-wrap: anywhere; }

c-stat .viz-stat, c-meter .viz-meter { display: flex; flex-direction: column; gap: 8px; }
.viz-stat-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.viz-stat-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.viz-stat-line, .viz-meter-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; margin: 0; }
c-stat .metric-value, c-meter .metric-value { font-size: 36px; line-height: 1.05; font-weight: 650; letter-spacing: -0.02em; font-variant-numeric: normal; color: var(--foreground); }
c-stat.is-small .metric-value, c-meter.is-small .metric-value { font-size: 28px; }
c-stat .metric-of, c-meter .metric-of { font-size: 15px; line-height: 1.3; color: var(--muted-foreground); }
.viz-delta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 0; font-size: 13px; color: var(--muted-foreground); }
.viz-delta b { font-weight: 650; }
.viz-delta.is-good b, .viz-delta.is-good .viz-glyph { color: var(--success); }
.viz-delta.is-bad b, .viz-delta.is-bad .viz-glyph { color: var(--destructive); }
.viz-glyph { flex: none; }
c-spark.viz-stat-spark { flex: none; width: 96px; }
.viz-spark svg { display: block; overflow: visible; }

.viz-track { display: flex; gap: 2px; height: 8px; border-radius: 4px; background: var(--viz-track); overflow: hidden; }
.viz-fill { display: block; height: 100%; flex: none; max-width: 100%; background: var(--c, var(--chart-1)); transition: width 0.25s; }
.viz-fill.s0 { --c: var(--chart-1); }
.viz-fill.is-last { border-radius: 0 4px 4px 0; }
.viz-fill:first-child { border-radius: 4px 0 0 4px; }
.viz-fill:only-child { border-radius: 4px; }
.viz-fill.is-warning { background: var(--viz-warning); }
.viz-fill.is-critical { background: var(--viz-critical); }
.viz-meter-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; color: var(--muted-foreground); }
.viz-pct { font-weight: 650; color: var(--foreground); }
.viz-status { display: inline-flex; align-items: center; gap: 4px; }
.viz-status.is-good .viz-glyph { color: var(--viz-good); }
.viz-status.is-warning .viz-glyph { color: var(--viz-warning); }
.viz-status.is-critical .viz-glyph { color: var(--viz-critical); }

.viz-chart { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.viz-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.viz-head:empty { display: none; }
.viz-toggle { flex: none; min-width: 44px; min-height: 44px; margin: -8px -10px -8px auto; padding: 0 10px; border: 0; background: transparent; color: var(--muted-foreground); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.viz-toggle-pill { padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; font: 600 13px/1.2 var(--font-sans); }
.viz-toggle[aria-pressed="true"] .viz-toggle-pill { background: var(--accent); color: var(--accent-foreground); border-color: transparent; }
.viz-toggle:focus-visible, .viz-plot:focus-visible, .viz-table-wrap:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.viz-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; color: var(--muted-foreground); }
.viz-legend-item { display: inline-flex; align-items: center; gap: 6px; }
.viz-key { flex: none; display: inline-block; width: 10px; height: 10px; border-radius: 3px; background: var(--c, var(--chart-1)); }
.viz-key.is-line { width: 14px; height: 3px; border-radius: 2px; }
.s0 { --c: var(--chart-1); } .s1 { --c: var(--chart-2); } .s2 { --c: var(--chart-3); } .s3 { --c: var(--chart-4); } .s4 { --c: var(--chart-5); } .s5 { --c: var(--chart-6); } .s6 { --c: var(--viz-other); }

.viz-plot { position: relative; width: 100%; touch-action: pan-y; border-radius: 6px; -webkit-user-select: none; user-select: none; }
.viz-plot[hidden], .viz-table-wrap[hidden] { display: none; }
.viz-plot svg { display: block; overflow: visible; }
.viz-plot text, .viz-spark text { font: 12px/1 var(--font-sans); fill: var(--viz-label); }
.viz-grid line { stroke: var(--viz-grid); stroke-width: 1; shape-rendering: crispEdges; }
.viz-axis line { stroke: var(--viz-axis); stroke-width: 1; shape-rendering: crispEdges; }
.viz-mark { fill: var(--c); transition: filter 0.1s; }
.viz-col.is-hover .viz-mark { filter: brightness(1.14); }
.viz-line { fill: none; stroke: var(--c); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.viz-line.is-quiet { stroke: var(--viz-other); }
.viz-area { fill: var(--c); fill-opacity: 0.1; stroke: none; }
.viz-dot { fill: var(--c); stroke: var(--viz-surface); stroke-width: 2px; }
.viz-crosshair { stroke: var(--viz-axis); stroke-width: 1; shape-rendering: crispEdges; }
.viz-goal line { stroke: var(--viz-goal); stroke-width: 1.5; }
.viz-plot text.viz-value-label, .viz-plot text.viz-goal-label, .viz-plot text.viz-end-label { fill: var(--foreground); paint-order: stroke; stroke: var(--viz-surface); stroke-width: 3px; stroke-linejoin: round; }
.viz-plot text.viz-value-label { font-weight: 650; }
.viz-plot text.viz-goal-label, .viz-plot text.viz-end-label { fill: var(--muted-foreground); }
.viz-cell { fill: var(--viz-seq-0); }
.viz-cell.l1, .viz-swatch.l1 { fill: var(--viz-seq-1); background: var(--viz-seq-1); }
.viz-cell.l2, .viz-swatch.l2 { fill: var(--viz-seq-2); background: var(--viz-seq-2); }
.viz-cell.l3, .viz-swatch.l3 { fill: var(--viz-seq-3); background: var(--viz-seq-3); }
.viz-cell.l4, .viz-swatch.l4 { fill: var(--viz-seq-4); background: var(--viz-seq-4); }
.viz-cell.l5, .viz-swatch.l5 { fill: var(--viz-seq-5); background: var(--viz-seq-5); }
.viz-cell-ring { fill: none; stroke: var(--foreground); stroke-width: 2px; pointer-events: none; }
.viz-scale { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted-foreground); }
.viz-swatch { width: 12px; height: 12px; border-radius: 3px; background: var(--viz-seq-0); }
.viz-swatch.l0 { background: var(--viz-seq-0); }

.viz-tip { position: absolute; z-index: 3; min-width: 120px; max-width: 240px; padding: 8px 10px; border-radius: 10px; background: var(--card); color: var(--card-foreground); border: 1px solid var(--border); box-shadow: 0 6px 18px rgb(0 0 0 / 14%); font-size: 13px; line-height: 1.35; pointer-events: none; }
.viz-tip[hidden] { display: none; }
.viz-tip-title { margin-bottom: 4px; color: var(--muted-foreground); }
.viz-tip-row { display: flex; align-items: center; gap: 8px; }
.viz-tip-value { font-weight: 650; color: var(--foreground); }
.viz-tip-name { color: var(--muted-foreground); }

.viz-table-wrap { max-height: 360px; overflow: auto; border: 1px solid var(--border); border-radius: 10px; }
.viz-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.viz-table thead th:first-child { min-width: 80px; }
.viz-table th, .viz-table td { padding: 0 8px; height: 36px; text-align: left; font-weight: 400; border-bottom: 1px solid var(--border); white-space: nowrap; }
.viz-table thead th { position: sticky; top: 0; z-index: 1; height: 40px; background: var(--card); font-size: 13px; font-weight: 600; line-height: 1.2; white-space: normal; color: var(--muted-foreground); }
.viz-table tbody th { font-weight: 500; color: var(--foreground); max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
.viz-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.viz-table tbody td { color: var(--foreground); }
.viz-table tbody tr:last-child > * { border-bottom: 0; }
.viz-link { display: flex; min-width: 44px; align-items: center; min-height: 44px; color: var(--foreground); font-weight: 600; text-decoration: none; }
c-table .viz-table tbody th, c-table .viz-table td { height: 44px; }
.viz-sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.viz-rows { display: flex; flex-direction: column; gap: 8px; }
.viz-more { margin: 0; font-size: 13px; color: var(--muted-foreground); }

.viz-list { display: flex; flex-direction: column; }
.viz-row { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 8px 0; border-bottom: 1px solid var(--border); color: var(--foreground); text-decoration: none; }
.viz-list > .viz-row:last-child { border-bottom: 0; }
.viz-row-icon { flex: none; width: 28px; text-align: center; font-size: 20px; }
.viz-row-icon:empty { display: none; }
.viz-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.viz-row-title { font-size: 16px; font-weight: 560; overflow-wrap: anywhere; }
.viz-row-sub { font-size: 14px; color: var(--muted-foreground); overflow-wrap: anywhere; }

.viz-empty { display: flex; align-items: center; gap: 10px; min-height: 64px; padding: 12px 14px; border-radius: 10px; background: var(--muted); color: var(--muted-foreground); font-size: 14px; line-height: 1.4; }
.viz-empty.is-error { color: var(--destructive); }
.viz-empty-text { min-width: 0; overflow-wrap: anywhere; }
c-empty { padding: 0; }
:is(c-dashboard, c-grid, section) > c-empty { padding: 0; background: transparent; border: 0; }
c-quick, c-form, c-marks, c-streak, c-embed { display: block; min-width: 0; font-family: var(--font-sans); color: var(--card-foreground); -webkit-text-size-adjust: 100%; }
.kit-row { display: flex; flex-wrap: wrap; gap: 8px; }
.kit-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 44px; min-height: 44px; padding: 0 16px; border: 1px solid var(--input); border-radius: 12px; background: var(--card); color: var(--foreground); font: 600 16px/1.2 var(--font-sans); text-align: center; cursor: pointer; touch-action: manipulation; }
.kit-btn.is-primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
.kit-btn.is-quiet { border-color: transparent; background: transparent; color: var(--accent-foreground); }
.kit-btn[aria-pressed="true"] { background: var(--accent); border-color: var(--primary); color: var(--accent-foreground); }
.kit-btn:disabled { opacity: 0.45; cursor: default; }
.kit-btn:focus-visible, .kit-input:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.kit-buttons, .kit-picker { display: flex; flex-wrap: wrap; gap: 8px; }
.kit-buttons > .kit-btn:not(.is-quiet) { flex: 1 1 96px; }
.kit-input { box-sizing: border-box; width: 100%; min-width: 64px; min-height: 44px; padding: 10px 12px; border: 1px solid var(--input); border-radius: 10px; background: var(--card); color: var(--foreground); font: 16px/1.3 var(--font-sans); }
.kit-with-unit { display: flex; align-items: center; gap: 8px; }
.kit-unit { flex: none; font-size: 15px; color: var(--muted-foreground); white-space: nowrap; }
.kit-form, .kit-fields, .kit-stack, .kit-more { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.kit-stack, .kit-more { gap: 8px; align-items: flex-start; }
.kit-stack { align-items: stretch; }
.kit-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.kit-label { font-size: 14px; font-weight: 600; color: var(--muted-foreground); }
.kit-hint, .kit-caption { margin: 0; font-size: 13px; line-height: 1.35; color: var(--muted-foreground); }
.kit-caption:empty { display: none; }
.kit-error { margin: 0; font-size: 14px; line-height: 1.35; color: var(--destructive); }
.kit-marks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.kit-mark { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-top: 1px solid var(--border); min-width: 0; }
.kit-mark:first-child { padding-top: 0; border-top: 0; }
.kit-mark:last-child { padding-bottom: 0; }
.kit-mark-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.kit-mark-name { font-size: 16px; font-weight: 600; color: var(--foreground); overflow-wrap: anywhere; }
.kit-mark-sub { flex: none; font-size: 14px; color: var(--muted-foreground); }
.kit-ask { padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--muted); }
.kit-add { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.kit-add > .kit-input, .kit-add.kit-form { align-items: stretch; }
.kit-streak { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 20px; }
.kit-streak-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.kit-streak-value { white-space: nowrap; }
.kit-streak-value { font-size: 28px; line-height: 1.1; font-weight: 650; letter-spacing: -0.02em; color: var(--foreground); }
.kit-streak-cell.is-main .kit-streak-value { font-size: 36px; }
.kit-streak-caption { font-size: 13px; line-height: 1.3; color: var(--muted-foreground); }
.kit-embed { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
@media (prefers-reduced-motion: reduce) { .viz-fill, .viz-mark { transition: none; } }
`;

export function injectStyles(doc = typeof document !== "undefined" ? document : null) {
  if (!doc || doc.querySelector("style[data-viz]")) return;
  const style = doc.createElement("style");
  style.setAttribute("data-viz", "");
  style.textContent = CSS;
  doc.head.append(style);
}
