import { createFullCore } from "../core/full-core.js";
import { createServices } from "../services/index.js";
import { TransportError, errorPayload, unwrapResponse } from "./protocol.js";

// The in-process transport: until there is a server, the Services run in the
// app. The request, every streamed event and the response each go through
// structuredClone, as through a network, so functions, DOM objects and shared
// references to the state never cross the boundary. `reachable()` false
// makes every request fail as without a network: a developer flag for
// offline checks (ADR-0002).
export function createLocalTransport(handlers, { clone = structuredClone, reachable = () => true } = {}) {
  async function respond(service, method, payload, onEvent) {
    const target = Object.hasOwn(handlers, service) ? handlers[service] : null;
    const handler = target && Object.hasOwn(target, method) ? target[method] : null;
    if (typeof handler !== "function") return { ok: false, error: errorPayload(new TransportError("not_found")) };
    // The payload is copied when it is sent; the Service handles it later.
    let input;
    try {
      input = clone(payload);
    } catch {
      return { ok: false, error: errorPayload(new TransportError("not_serializable")) };
    }
    await null;
    const emit = (event) => onEvent(clone(event));
    try {
      return { ok: true, result: await handler.call(target, input, { emit }) };
    } catch (error) {
      return { ok: false, error: errorPayload(error) };
    }
  }

  async function call(service, method, payload, onEvent) {
    if (!reachable()) throw new TransportError("network");
    const response = await respond(String(service), String(method), payload, onEvent);
    let delivered;
    try {
      delivered = clone(response);
    } catch {
      throw new TransportError("not_serializable");
    }
    return unwrapResponse(delivered);
  }

  return {
    request(service, method, payload = {}) {
      return call(service, method, payload, () => {});
    },
    // A long request with progress: the Service calls `emit(event)`, the
    // client gets each event in `onEvent` before the answer.
    stream(service, method, payload = {}, { onEvent = () => {} } = {}) {
      return call(service, method, payload, onEvent);
    },
  };
}

// The local «server»: the full Core over `core.storage` and every Service
// with the platform's adapters behind the local transport (see
// services/index.js for the options). The Services read the full Core.
// Moving to a server replaces it with an HTTP transport.
export function openLocalServices({ core, reachable, ...options }) {
  const fullCore = core ? createFullCore(core) : null;
  const dataPort = options.dataPort || (fullCore ? { read: async () => fullCore.read() } : undefined);
  const handlers = createServices({ ...options, dataPort });
  if (fullCore) handlers.core = fullCore.endpoint;
  return createLocalTransport(handlers, { reachable });
}
