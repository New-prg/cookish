// The builder: the person's words go to the model together with the manual of
// the kit, and what comes back is a bundle that the pipeline checks layer by
// layer. `buildProposal` is the call of the screen «Собрать с ИИ»; the authoring
// loop itself lives in kit/author.js. The model sees the structure of the
// space, never the text of objects, and nothing is written until the person
// applies the checked result as one change.
import { authorBundle } from "../kit/author.js";
import { printSpec, readSpec } from "../kit/spec.js";
import { homeOf } from "./values.js";

export function spaceOutline(state) {
  const visible = (t) => !t.hidden || ["meal_mark", "session_mark", "discrepancy", "portion", "request_item", "day_plan"].includes(t.key);
  const { sources: _, ...kit } = printSpec(readSpec(state), { summary: true });
  return {
    types: Object.values(state.types).filter(visible).map((t) => ({ key: t.key, name: t.name, fact: Boolean(t.fact), relations: t.relations })),
    relations: Object.values(state.relations).filter((r) => r.format !== "json").map((r) => ({
      key: r.key, name: r.name, format: r.format,
      ...(r.unit ? { unit: r.unit } : {}), ...(r.dimension ? { dimension: r.dimension } : {}),
      ...(r.options?.length ? { options: r.options.map((o) => o.id) } : {}),
      ...(r.types ? { types: r.types } : {}),
    })),
    sets: Object.values(state.objects).filter((o) => o.type === "set" && !o.archivedAt).map((o) => ({ id: o.id, name: o.name })),
    widgets: (homeOf(state)?.props?.widgets || []).map((w) => ({ title: w.title, kind: w.kind })),
    kit,
    counts: Object.fromEntries(Object.values(state.types).map((t) => [t.key, Object.values(state.objects).filter((o) => o.type === t.key && !o.archivedAt).length]).filter(([, n]) => n)),
  };
}

// → { ok, usage, attempts, answer, proposal: { reply, summary, checked } } for an
// answer; `checked` is null when the model only answered in words. A failure
// carries the reason and the problems of the last check.
export async function buildProposal({ provider, state, request, today, history = [], maxRepairs = 2, surface }) {
  const result = await authorBundle({ provider, state, request, today, history, maxRepairs, ...(surface ? { surface } : {}) });
  if (!result.ok) return { ok: false, reason: result.reason, problems: result.problems || [], usage: result.usage };
  return {
    ok: true,
    usage: result.usage,
    attempts: result.attempts,
    answer: result.answer,
    proposal: { reply: result.reply, summary: result.summary, checked: result.checked },
  };
}
