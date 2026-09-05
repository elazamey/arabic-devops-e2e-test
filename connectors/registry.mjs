import { assertConnector } from "./contracts.mjs";

export class ConnectorRegistry {
  constructor() {
    this.connectors = new Map();
  }

  register(connector) {
    assertConnector(connector);
    if (this.connectors.has(connector.id)) throw new Error(`Connector مسجل مسبقًا: ${connector.id}`);
    this.connectors.set(connector.id, connector);
    return connector;
  }

  unregister(id) {
    return this.connectors.delete(id);
  }

  get(id) {
    return this.connectors.get(id) || null;
  }

  list() {
    return [...this.connectors.values()].map(connector => ({ id: connector.id, name: connector.name, capabilities: connector.capabilities }));
  }

  async health(id) {
    const connector = this.get(id);
    if (!connector) throw new Error(`Connector غير موجود: ${id}`);
    return connector.health();
  }
}
