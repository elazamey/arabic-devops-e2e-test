# Runtime Probe

Minimal deployment test for Bun/Node availability and outbound HTTPS access.
It has no package dependencies and does not require a build step.

## Configuration

- `PORT`: supplied by the hosting platform; defaults to `3000`.
- `PROBE_URL`: outbound target; defaults to `https://example.com/`.
- `PROBE_TIMEOUT_MS`: fetch timeout; defaults to `5000`.

The probe never returns a response body from the target and strips query strings from the reported URL.

## Start

```bash
npm start
```

or:

```bash
bun run start:bun
```

## Docker

Bun is the default image:

```bash
docker build --build-arg RUNTIME=bun -t runtime-probe:bun .
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e PROBE_URL=https://example.com/ \
  runtime-probe:bun
```

The same Dockerfile can use Node.js:

```bash
docker build --build-arg RUNTIME=node -t runtime-probe:node .
docker run --rm -p 8080:8080 runtime-probe:node
```

The image runs as a non-root user and contains no application dependencies.

## Koyeb

Create a Web Service from the repository or Dockerfile, expose port `8080`, and set:

- `PORT=8080`
- `PROBE_URL=https://example.com/`
- optional `PROBE_TIMEOUT_MS=5000`

After deployment, query `/healthz` first, then `/probe`. Record the HTTP status and JSON response from both endpoints. Do not put tokens or credentials in environment values for this probe.

## Endpoints

- `/healthz`: confirms the runtime started and reports Node/Bun, OS, and architecture.
- `/probe`: performs one outbound HTTP(S) request and returns status, content type, and duration.

## Interpretation

- `GET /healthz` returns HTTP `200`: the process started.
- `GET /probe` returns HTTP `200` with `ok: true`: outbound access to `PROBE_URL` works.
- `GET /probe` returns HTTP `502`: the runtime started, but the outbound request failed, timed out, or returned a non-2xx response.

Do not place credentials or tokens in `PROBE_URL` or in logs. A successful probe is not authorization to install dependencies or connect to production services.

