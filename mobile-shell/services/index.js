import { createRouterAiProvider, fetchTransport } from "./assistant/ai-provider.js";
import { createAssistantService } from "./assistant/assistant-service.js";
import { createCatalogService } from "./catalog/catalog.js";
import { createFillerService } from "./filler/filler-service.js";

// Every Service by the name the transport knows it under. The platform passes
// the adapters: `fetchImpl` performs HTTP requests, `aiTransport` (optional)
// performs the provider's requests where fetch cannot, `dataPort.read()`
// returns the full Core. Tests pass `providerFor` and `today`.
export function createServices({
  fetchImpl,
  aiTransport = fetchTransport(fetchImpl),
  dataPort,
  providerFor = (key) => createRouterAiProvider({ getKey: () => key, transport: aiTransport }),
  today,
}) {
  const catalog = createCatalogService({ fetchImpl });
  return {
    assistant: createAssistantService({ dataPort, providerFor, catalog, ...(today ? { today } : {}) }),
    catalog,
    filler: createFillerService({ providerFor, catalog }),
  };
}
