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
RUN pnpm db:generate
RUN pnpm --filter @stenzo/api... run build
RUN pnpm --filter @stenzo/api deploy --legacy --prod --offline /out
RUN node deploy/cloudflare/scripts/runtime-deps.cjs /source/apps/api /out
RUN node deploy/cloudflare/scripts/copy-prisma.cjs /source/packages/database /out

FROM base AS runtime
ENV NODE_ENV=production INSTANCE_HOST=0.0.0.0 PORT=8080 CLOUDFLARE_CONTAINER=1
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
