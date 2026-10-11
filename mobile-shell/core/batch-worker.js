// A queue sent in batches (Тычки, the Заполнитель): items wait `burstMs`
// so a burst goes as one call. Without a key, the provider warning or a
// network the queue waits; a call that failed on the way is retried after
// `retryMs`; a call the Service could not understand drops the batch.
//
//   decide(items) → { ok: true, ... } | { ok: false, kind, reason }
//   finish(items, result) → extra fields of the run result
//   drop(items, result)

export const RETRY_KINDS = Object.freeze(["network", "timeout", "server", "rate"]);

export function createBatchWorker({
  decide,
  pending,
  finish,
  drop = () => {},
  hasKey = () => true,
  isOnline = () => true,
  allowed = () => true,
  // Wrapped: a browser rejects setTimeout called on another object.
  timers = { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (id) => clearTimeout(id) },
  burstMs,
  retryMs,
}) {
  let timer = null;
  let running = false;

  function schedule(delay = burstMs) {
    if (timer || running || !pending().length) return;
    timer = timers.setTimeout(() => {
      timer = null;
      run();
    }, delay);
  }

  async function run() {
    const items = pending();
    if (!items.length || running) return { ok: true, sent: 0 };
    if (!hasKey() || !allowed() || !isOnline()) return { ok: false, waiting: true };
    running = true;
    let result;
    try {
      result = await decide(items);
    } catch (error) {
      // The transport failed: the Service is unreachable, the queue waits.
      result = { ok: false, kind: typeof error?.kind === "string" ? error.kind : "network", reason: String(error?.message || "") };
    } finally {
      running = false;
    }
    if (!result.ok) {
      if (RETRY_KINDS.includes(result.kind)) schedule(retryMs);
      else if (result.kind === "bad_response") drop(items, result);
      return result;
    }
    const extra = finish(items, result) || {};
    schedule();
    return { ok: true, sent: items.length, ...extra };
  }

  return {
    schedule,
    run,
    cancel() {
      if (timer) timers.clearTimeout(timer);
      timer = null;
    },
    get scheduled() {
      return Boolean(timer);
    },
  };
}
