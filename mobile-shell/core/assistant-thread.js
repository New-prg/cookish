import { createId } from "./ration-domain.js";

// A thread of the Ассистент as data: the model messages, the Предложения, the
// feed log and the size in tokens of the last request to the model. The assistant Service runs a turn on its copy and streams
// events; the UI applies the same events to its copy, and the copy returned at
// the end of the turn replaces it. A Закладка stores the thread as it is.

export function createThread({ page = "ration", mode = "" } = {}) {
  return { id: createId("thread"), page, mode, createdAt: new Date().toISOString(), messages: [], proposals: [], log: [], promptTokens: 0 };
}

// Events: { type: "user" | "progress" | "assistant" | "error", text } and
// { type: "proposal", proposal }. The log keeps a proposal by its id.
export function applyThreadEvent(thread, event) {
  if (event.type === "proposal") {
    if (!thread.proposals.some((proposal) => proposal.id === event.proposal.id)) thread.proposals.push(event.proposal);
    thread.log.push({ type: "proposal", proposalId: event.proposal.id });
  } else {
    thread.log.push(event);
  }
  return thread;
}
