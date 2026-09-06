'use strict';

const http = require('node:http');
const { URL } = require('node:url');

const port = Number.parseInt(process.env.PORT || '3000', 10);
const probeUrl = process.env.PROBE_URL || 'https://example.com/';
const timeoutMs = Number.parseInt(process.env.PROBE_TIMEOUT_MS || '5000', 10);

function runtimeInfo() {
  return {
    runtime: process.versions && process.versions.bun ? 'bun' : 'node',
    nodeVersion: process.version,
    bunVersion: process.versions && process.versions.bun ? process.versions.bun : null,
    platform: process.platform,
    architecture: process.arch,
  };
}

function safeTarget(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '[invalid PROBE_URL]';
  }
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(payload);
}

async function runOutboundProbe() {
  const startedAt = Date.now();

  if (typeof fetch !== 'function') {
    return {
      ok: false,
      error: 'global fetch is unavailable; use Node 18+ or Bun',
      durationMs: Date.now() - startedAt,
    };
  }

  let target;
  try {
    target = new URL(probeUrl);
    if (!['http:', 'https:'].includes(target.protocol)) {
      throw new Error('PROBE_URL must use http or https');
    }
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      target: safeTarget(probeUrl),
      durationMs: Date.now() - startedAt,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });

    return {
      ok: response.ok,
      target: safeTarget(probeUrl),
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      target: safeTarget(probeUrl),
      error: error.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : error.message,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (requestUrl.pathname === '/healthz') {
    sendJson(response, 200, { ok: true, check: 'runtime', ...runtimeInfo() });
    return;
  }

  if (requestUrl.pathname === '/probe') {
    const result = await runOutboundProbe();
    sendJson(response, result.ok ? 200 : 502, {
      ok: result.ok,
      check: 'outbound-network',
      ...runtimeInfo(),
      ...result,
    });
    return;
  }

  sendJson(response, 200, {
    ok: true,
    service: 'runtime-probe',
    endpoints: ['/healthz', '/probe'],
    target: safeTarget(probeUrl),
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({
    event: 'server-ready',
    port,
    ...runtimeInfo(),
    target: safeTarget(probeUrl),
  }));
});

