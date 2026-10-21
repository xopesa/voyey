# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd
FROM ${NODE_IMAGE} AS base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl tini && rm -rf /var/lib/apt/lists/*
FROM base AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1
RUN npm install --global corepack@0.36.0 && corepack enable && corepack prepare pnpm@10.17.1 --activate
WORKDIR /source
COPY . .
RUN pnpm install --frozen-lockfile
ARG API_URL=https://api.preview.invalid
ENV API_URL=$API_URL STENZO_CONTAINER_BUILD=1
RUN pnpm --filter @stenzo/miniapp build
RUN mkdir -p apps/miniapp/public

FROM base AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=8080 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /source/apps/miniapp/.next/standalone/ ./
COPY --from=build --chown=node:node /source/apps/miniapp/.next/static/ ./apps/miniapp/.next/static/
COPY --from=build --chown=node:node /source/apps/miniapp/public/ ./apps/miniapp/public/
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/miniapp/server.js"]
