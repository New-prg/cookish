import { createServices } from "../services/index.js";
import { TransportError, errorPayload, unwrapResponse } from "./protocol.js";

// The in-process transport: until there is a server, the Services run in the
// app. The request and the response each go through structuredClone, as
// through a network, so functions, DOM objects and shared references to the
// state never cross the boundary.
export function createLocalTransport(handlers, { clone = structuredClone } = {}) {
  async function respond(service, method, payload) {
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
    try {
      return { ok: true, result: await handler.call(target, input) };
    } catch (error) {
      return { ok: false, error: errorPayload(error) };
    }
  }

  return {
    async request(service, method, payload = {}) {
      const response = await respond(String(service), String(method), payload);
      let delivered;
      try {
        delivered = clone(response);
      } catch {
        throw new TransportError("not_serializable");
      }
      return unwrapResponse(delivered);
    },
  };
}

// The local «server»: every Service with the platform's adapters behind the
// local transport. Moving to a server replaces it with an HTTP transport.
export function openLocalServices({ fetchImpl }) {
  return createLocalTransport(createServices({ fetchImpl }));
}
