import { realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, sep } from "node:path";
import { ConnectorError } from "../contracts.mjs";

export class LocalConnector {
  constructor({ workspaceRoot, maxOutputBytes = 64 * 1024, commandTimeoutMs = 30_000 }) {
    this.id = "local";
    this.name = "Local Workspace";
    this.version = "1.0.0";
    this.capabilities = Object.freeze(["workspace:read", "command:allowlisted"]);
    this.workspaceRoot = resolve(workspaceRoot);
    this.maxOutputBytes = maxOutputBytes;
    this.commandTimeoutMs = commandTimeoutMs;
  }

  async authenticate() {
    return { authenticated: true, credential: "local-runtime" };
  }

  async health() {
    return { ok: true, connector: this.id };
  }

  async execute(operation, input, context, tool) {
    if (operation !== "run_allowlisted") throw new ConnectorError(`Local operation غير معروفة: ${operation}`, { status: 400, code: "UNKNOWN_OPERATION" });
    const configuredRoot = await realpath(this.workspaceRoot).catch(() => { throw new ConnectorError("WORKSPACE_ROOT غير موجود أو غير قابل للقراءة", { status: 500, code: "WORKSPACE_UNAVAILABLE" }); });
    const cwdInput = String(input.cwd || configuredRoot);
    if (cwdInput.length > 512) throw new ConnectorError("مسار التنفيذ طويل أكثر من اللازم", { status: 400, code: "PATH_TOO_LONG" });
    const cwd = await realpath(resolve(cwdInput)).catch(() => { throw new ConnectorError("مسار التنفيذ غير موجود", { status: 400, code: "PATH_NOT_FOUND" }); });
    if (cwd !== configuredRoot && !cwd.startsWith(`${configuredRoot}${sep}`)) throw new ConnectorError("مسار التنفيذ خارج مساحة العمل المسموحة", { status: 403, code: "PATH_BOUNDARY" });
    return runCommand(tool.metadata.command, cwd, this.maxOutputBytes, this.commandTimeoutMs);
  }

  async close() {}
}

function runCommand(spec, cwd, maxOutputBytes, commandTimeoutMs) {
  return new Promise(resolveRun => {
    const child = spawn(spec.bin, spec.args, { cwd, shell: false, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let stdout = "", stderr = "";
    let timedOut = false, stdoutTruncated = false, stderrTruncated = false, settled = false;
    const finish = result => { if (settled) return; settled = true; clearTimeout(timer); resolveRun({ stdout, stderr, timedOut, stdoutTruncated, stderrTruncated, ...result }); };
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, commandTimeoutMs);
    child.stdout.on("data", data => { const result = appendLimited(stdout, data, maxOutputBytes); stdout = result.value; stdoutTruncated ||= result.truncated; });
    child.stderr.on("data", data => { const result = appendLimited(stderr, data, maxOutputBytes); stderr = result.value; stderrTruncated ||= result.truncated; });
    child.on("close", exitCode => finish({ exitCode: exitCode ?? 1 }));
    child.on("error", error => finish({ stderr: `${stderr}${error.message}`, exitCode: 1 }));
  });
}

function appendLimited(value, chunk, maxOutputBytes) {
  const combined = `${value}${chunk}`;
  if (Buffer.byteLength(combined) <= maxOutputBytes) return { value: combined, truncated: false };
  return { value: Buffer.from(combined).subarray(0, maxOutputBytes).toString("utf8"), truncated: true };
}
