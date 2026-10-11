// The error a Service answers with: a `kind` for code and a message for the
// person. Only these two fields cross the transport.
export class ServiceError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "ServiceError";
    this.kind = kind;
  }
}
