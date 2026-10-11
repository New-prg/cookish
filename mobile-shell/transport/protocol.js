// The wire format between the client and the Services, shared by the local
// transport and, later, HTTP. A request is (service, method, payload); a
// response is { ok: true, result } or { ok: false, error: { kind, message } }.

export const TRANSPORT_ERROR_TEXTS = Object.freeze({
  network: "Нет связи с сервером. Проверьте интернет.",
  not_found: "Сервис не знает такого запроса.",
  not_serializable: "Данные нельзя передать сервису.",
  internal: "Сервис не смог выполнить запрос. Попробуйте ещё раз.",
});

// What the client sees when a request fails: `kind` for code, `message` for
// the person.
export class TransportError extends Error {
  constructor(kind, message = "") {
    super(message || TRANSPORT_ERROR_TEXTS[kind] || TRANSPORT_ERROR_TEXTS.internal);
    this.name = "TransportError";
    this.kind = kind;
  }
}

// A thrown value as the error part of a response. A Service error carries a
// string `kind` and a message for the person; anything else is internal, and
// its text stays inside the Service.
export function errorPayload(error) {
  if (error && typeof error.kind === "string" && error.kind && typeof error.message === "string") {
    return { kind: error.kind, message: error.message };
  }
  return { kind: "internal", message: TRANSPORT_ERROR_TEXTS.internal };
}

export function unwrapResponse(response) {
  if (response?.ok === true) return response.result;
  const error = response?.error || {};
  throw new TransportError(String(error.kind || "internal"), String(error.message || ""));
}
