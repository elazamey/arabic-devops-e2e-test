export class ConnectorError extends Error {
  constructor(message, { status = 502, code = "CONNECTOR_ERROR", retryable = false, cause } = {}) {
    super(message, { cause });
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export class ConnectorContract {
  constructor({ id, name = id, version = "1.0.0", capabilities = [] }) {
    if (!id || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)) throw new TypeError("Connector id غير صالح");
    this.id = id;
    this.name = name;
    this.version = version;
    this.capabilities = Object.freeze([...capabilities]);
  }
}

export function assertConnector(connector) {
  if (!connector?.id || typeof connector.execute !== "function") throw new TypeError("Connector يجب أن يملك id وexecute()");
  for (const method of ["authenticate", "health", "close"]) {
    if (typeof connector[method] !== "function") throw new TypeError(`Connector ${connector.id} يحتاج ${method}()`);
  }
  return connector;
}
