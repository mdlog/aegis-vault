# syntax=docker/dockerfile:1.7
#
# Aegis Vault Orchestrator — production image.
#
# Two-stage build keeps the runtime layer small: stage 1 installs all deps
# with dev tooling, stage 2 copies only prod node_modules + source. No build
# step (pure ESM), so we just run node against src/index.js.
#
# Build:   docker build -t aegis-orchestrator:latest .
# Run:     docker run --env-file .env -p 4002:4002 aegis-orchestrator:latest

FROM node:20-bookworm-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
# --legacy-peer-deps because @0glabs/0g-ts-sdk pins ethers@6.13.1 while we
# use ^6.16.0. The override in package.json resolves the actual install tree;
# npm's strict peer check fails otherwise.
RUN npm ci --omit=dev --legacy-peer-deps

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=4002
# Running as non-root limits blast radius if a downstream dep gets RCE'd.
RUN groupadd --system --gid 1001 aegis && \
    useradd  --system --uid 1001 --gid aegis --home-dir /app --shell /bin/false aegis

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=aegis:aegis package.json ./
COPY --chown=aegis:aegis src ./src

USER aegis

EXPOSE 4002
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
