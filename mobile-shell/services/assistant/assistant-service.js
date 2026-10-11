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
export const ATTACHMENT_LIMIT = 6_000_000;

// An attachment of the person (#35) as content parts the provider takes: text,
// an image or a PDF as a data URL. Anything else is dropped.
export function checkedAttachment(attachment) {
  if (!attachment || !Array.isArray(attachment.parts)) return null;
  const parts = attachment.parts.filter((part) => (part?.type === "text" && typeof part.text === "string")
    || (part?.type === "image_url" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(String(part.image_url?.url || "")))
    || (part?.type === "file" && /^data:application\/pdf;base64,/.test(String(part.file?.file_data || ""))));
  if (!parts.length || JSON.stringify(parts).length > ATTACHMENT_LIMIT) return null;
  return { kind: ["фото", "документ", "текст"].includes(attachment.kind) ? attachment.kind : "документ", name: String(attachment.name || "").slice(0, 120), parts };
}

export function createAssistantService({ dataPort, providerFor, catalog, today = todayDateKey }) {
  const dayOf = (payload) => (/^\d{4}-\d{2}-\d{2}$/.test(payload?.today || "") ? payload.today : today());

  return {
    async run({ thread, text, page, mode, key, attachment, ...payload }, { emit } = {}) {
      const assistant = createAssistant({
        provider: providerFor(key),
        getState: () => dataPort.read(),
        catalog,
        today: () => dayOf(payload),
      });
      const result = await assistant.run(thread, text, { page: page ?? thread.page, mode: mode ?? thread.mode, onEvent: emit, attachment: checkedAttachment(attachment) });
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
