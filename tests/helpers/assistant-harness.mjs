import { markProposals, recheckProposals } from "../../mobile-shell/core/proposals.js";
import { createServices } from "../../mobile-shell/services/index.js";
import { createLocalTransport } from "../../mobile-shell/transport/local.js";

// The assistant as the app uses it: the Service behind the local transport
// reads `data` through the data port, and the Core applies Предложения with
// its own command. `provider` answers on the Service side.
export function assistantHarness({ data, provider, today }) {
  const transport = createLocalTransport(createServices({
    fetchImpl: async () => {
      throw new Error("No network in tests.");
    },
    dataPort: { read: async () => data.snapshot() },
    providerFor: () => provider,
    today,
  }));

  return {
    transport,

    // Runs a turn and, like the UI, takes the thread the Service returns.
    async run(thread, text, { page = thread.page, mode = thread.mode, onEvent = () => {} } = {}) {
      const { thread: answered, ...result } = await transport.stream("assistant", "run", { thread, text, page, mode, key: "test-key" }, { onEvent });
      Object.assign(thread, answered);
      return result;
    },

    apply(proposals, options = {}) {
      const result = data.applyProposals(proposals, { ...(today ? { today: today() } : {}), ...options });
      markProposals(proposals, result.results);
      return result;
    },

    recheck(proposals) {
      return recheckProposals(data.snapshot(), proposals, today?.());
    },
  };
}
