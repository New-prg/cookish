// A command runs twice (ADR-0002): at once on the phone's Cache and again on
// the full Core when the Outbox delivers it. New ids and the clock come from
// here, so both runs create the same records with the same times: `record`
// notes what the first run took, `replay` hands the same values to the second.

let active = null;

function freshId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function localDay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function createId(prefix) {
  if (!active) return freshId(prefix);
  if (active.ids) {
    const next = active.ids[active.index];
    if (typeof next === "string" && next.startsWith(`${prefix}_`)) {
      active.index += 1;
      return next;
    }
    // The run went another way than on the Cache; its result will differ
    // anyway, and the full Core wins.
    return freshId(prefix);
  }
  const id = freshId(prefix);
  active.taken.push(id);
  return id;
}

export function currentTime() {
  return active?.now || new Date().toISOString();
}

export function currentDay() {
  return active?.today || localDay(new Date());
}

// Runs `run` and returns its value with the trace { now, today, ids }.
export function record(run, { now = new Date(), today = localDay(now) } = {}) {
  const previous = active;
  active = { now: now.toISOString(), today, taken: [] };
  const scope = active;
  try {
    const value = run();
    return { value, trace: { now: scope.now, today: scope.today, ids: scope.taken } };
  } finally {
    active = previous;
  }
}

// Runs `run` with the ids and the clock of a recorded trace.
export function replay(trace, run) {
  const previous = active;
  active = { now: String(trace?.now || new Date().toISOString()), today: String(trace?.today || localDay(new Date())), ids: Array.isArray(trace?.ids) ? trace.ids : [], index: 0 };
  try {
    return run();
  } finally {
    active = previous;
  }
}
