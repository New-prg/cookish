// The page's one way to the AI provider. Key and consent are the current
// app's own stores, so both apps share them. There is one provider because
// the Android bridge has one answer callback: a second nativeAiTransport would
// take the answers of the first.
import { AI_CONSENT_TEXT, aiConsentStore, aiKeyStore } from "../../ui/ai-key.js";
import { createRouterAiProvider, fetchTransport } from "../../services/assistant/ai-provider.js";
import { nativeAiTransport } from "../../ui/platform.js";
import { h, openSheet } from "./dom.js";

export const aiKey = aiKeyStore(window.localStorage);
export const aiConsent = aiConsentStore(window.localStorage);
export const aiProvider = createRouterAiProvider({
  getKey: () => aiKey.read(),
  transport: nativeAiTransport(window) || fetchTransport((...args) => window.fetch(...args)),
});

export const NO_AI_KEY = "Нужен ключ ИИ. Его задают в Профиле, в разделе «Ассистент».";

// Before the first request with the person's data, they see once where it goes.
export function withAiConsent(proceed) {
  if (aiConsent.accepted()) return proceed();
  openSheet("Данные уходят провайдеру", (close) => [
    h("p", { class: "sheet-text", text: AI_CONSENT_TEXT }),
    h("div", { class: "actions" },
      h("button", { class: "btn btn-primary", onclick: () => { aiConsent.accept(); close(); proceed(); } }, "Понятно, продолжить"),
      h("button", { class: "btn btn-quiet", onclick: close }, "Отмена"),
    ),
  ]);
  return undefined;
}
