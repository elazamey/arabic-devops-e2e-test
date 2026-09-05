export class ExecutionContext {
  constructor({ executionId, actor = "runtime", requestHash = null, approved = false, repository = null, ...metadata } = {}) {
    this.executionId = executionId;
    this.actor = actor;
    this.requestHash = requestHash;
    this.approved = approved;
    this.repository = repository;
    this.metadata = Object.freeze({ ...metadata });
    Object.freeze(this);
  }
}

export class ToolResult {
  constructor({ executionId, tool, connector, risk, output, evidence, replayed = false }) {
    this.executionId = executionId;
    this.tool = tool;
    this.connector = connector;
    this.risk = risk;
    this.output = output;
    this.evidence = evidence;
    this.replayed = replayed;
    Object.freeze(this);
  }
}
