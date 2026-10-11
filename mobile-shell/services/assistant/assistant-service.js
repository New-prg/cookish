import { todayDateKey } from "../../core/ration-domain.js";
import { assistantContext, createAssistant } from "./ai-tools.js";
import { decideNudges } from "./nudges.js";

// The assistant Service, as it will run on a server. It reads the full Core
// through `dataPort.read()` and answers only with data: the thread with its
// Предложения, the decision on Тычки, the key check. The Core applies
// Предложения itself. Until #31 the key comes from Profile with each request;
// `providerFor(key)` builds the provider for it.
//
//   run({ thread, text, page, mode, key, today })  streams thread events
//                                                  → { ok, reply | reason, thread }
//   decideNudges({ nudges, page, mode, key, today }) → { ok, notify, text } | { ok: false, kind, reason }
//   checkKey({ key })                              → { ok, label, usage, limit } | { ok: false, kind, reason }
export function createAssistantService({ dataPort, providerFor, catalog, today = todayDateKey }) {
  const dayOf = (payload) => (/^\d{4}-\d{2}-\d{2}$/.test(payload?.today || "") ? payload.today : today());

  return {
    async run({ thread, text, page, mode, key, ...payload }, { emit } = {}) {
      const assistant = createAssistant({
        provider: providerFor(key),
        getState: () => dataPort.read(),
        catalog,
        today: () => dayOf(payload),
      });
      const result = await assistant.run(thread, text, { page: page ?? thread.page, mode: mode ?? thread.mode, onEvent: emit });
      return { ...result, thread };
    },

    async decideNudges({ nudges, page = "ration", mode = "", key, ...payload }) {
      const state = await dataPort.read();
      return decideNudges(providerFor(key), {
        nudges: nudges || [],
        settings: state.assistant?.settings || {},
        context: assistantContext(state, { page, mode, today: dayOf(payload) }),
      });
    },

    async checkKey({ key }) {
      return providerFor(key).checkKey();
    },
  };
}
