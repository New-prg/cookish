// The one data source of the page. The app registers it once with
// setDataSource(fn); a bound element (<c-bars set="..." value="...">) calls
// fn(spec) with its attributes, { tag, set, value, fn, range, by, category, goal, ... },
// and draws what comes back. fn may return the data or a promise of it.
let source = null;
const listeners = new Set();

export function setDataSource(fn) {
  source = typeof fn === "function" ? fn : null;
  for (const listener of listeners) listener();
}

export const getDataSource = () => source;

// The kit listens here to redraw bound elements when the source changes.
export function onDataSource(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
