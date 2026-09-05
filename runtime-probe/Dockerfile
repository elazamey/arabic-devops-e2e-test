# Build with Bun by default. Use --build-arg RUNTIME=node for Node.js.
ARG RUNTIME=bun

FROM oven/bun:1.2.20-slim AS bun-runtime
FROM node:22.14.0-bookworm-slim AS node-runtime
FROM ${RUNTIME}-runtime AS runtime

WORKDIR /app

RUN groupadd --system runtime \
  && useradd --system --gid runtime --create-home runtime

COPY --chown=runtime:runtime package.json index.js ./

ENV NODE_ENV=production
ENV PORT=8080

USER runtime
EXPOSE 8080

CMD ["sh", "-c", "if command -v bun >/dev/null 2>&1; then exec bun index.js; else exec node index.js; fi"]

