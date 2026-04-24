# syntax=docker/dockerfile:1.7
#
# Aegis Vault Frontend — Vite build → nginx static.
#
# Build-time args are baked into the bundle via `VITE_*` envs. For runtime
# configuration (e.g. swapping orchestrator URL per environment), rebuild
# with different --build-arg values rather than runtime substitution.
#
# Build:   docker build -t aegis-frontend:latest --build-arg VITE_ORCHESTRATOR_URL=https://orch.aegis.xyz .
# Run:     docker run -p 8080:80 aegis-frontend:latest

FROM node:20-bookworm-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

ARG VITE_ORCHESTRATOR_URL
ARG VITE_CHAIN_ID
ENV VITE_ORCHESTRATOR_URL=${VITE_ORCHESTRATOR_URL}
ENV VITE_CHAIN_ID=${VITE_CHAIN_ID}

COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime

# SPA fallback: unknown paths → index.html so React Router owns routing.
RUN printf '%s\n' \
    'server {' \
    '  listen 80 default_server;' \
    '  root /usr/share/nginx/html;' \
    '  index index.html;' \
    '  location / { try_files $uri $uri/ /index.html; }' \
    '  location ~* \.(js|css|woff2?|png|jpg|svg)$ { expires 30d; add_header Cache-Control "public, immutable"; }' \
    '  location = /index.html { add_header Cache-Control "no-cache"; }' \
    '}' > /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
