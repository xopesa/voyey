# Vercel Preview preparation

No deployment is performed by these changes. Do not connect production data or run migrations automatically from a Vercel build. The Bot is not a Vercel project.

## Three projects from the same GitHub repository

Use Node **24.x**, the pinned **pnpm 10.17.1**, and enable **Include source files outside of the Root Directory in the Build Step** on all three projects. Each project reads its own `vercel.json`; do not select a static output directory or merge applications.

| Project | Root Directory | Framework / output | Install Command | Build Command |
| --- | --- | --- | --- | --- |
| Client | `apps/miniapp` | Next.js, automatic `.next` adapter | `cd ../.. && pnpm install --frozen-lockfile` | `cd ../.. && pnpm --filter @stenzo/miniapp... build` |
| Admin | `apps/admin` | Next.js, automatic `.next` adapter | same | `cd ../.. && pnpm --filter @stenzo/admin... build` |
| API | `apps/api` | Fastify, one native Node Function | same | `cd ../.. && pnpm db:generate && pnpm --filter @stenzo/api... build` |

API `src/app.ts` exports a reusable Fastify instance. `src/application.ts` is the shared factory; `src/server.ts` retains local TCP listen/shutdown behavior. The deployed entrypoint never starts a Bot or disconnects Prisma per request. No `dist` output override or catch-all rewrite is necessary for native Fastify.

## Environment variable names, by project

Set these in the **Preview** environment, separately from Production. Never prefix server secrets with `NEXT_PUBLIC_`.

- Client: `API_URL` (HTTPS API origin).
- Admin: `API_URL`, `ADMIN_PROXY_SECRET`, `MAX_IMAGE_UPLOAD_SIZE`.
- API: `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_INIT_DATA_TTL_SECONDS`, `ADMIN_TELEGRAM_IDS`, `ADMIN_PASSWORD_HASH`, `ADMIN_ORIGIN`, `ADMIN_SESSION_DRIVER`, `ADMIN_PROXY_SECRET`, `STORAGE_DRIVER`, `BLOB_PUBLIC_READ_WRITE_TOKEN`, `BLOB_PRIVATE_READ_WRITE_TOKEN`, `BLOB_PUBLIC_BASE_URL`, `MAX_IMAGE_UPLOAD_SIZE`, `MAX_PAYMENT_PROOF_UPLOAD_SIZE`, `MANUAL_PAYMENT_CARD_NUMBER`, `MANUAL_PAYMENT_CARD_HOLDER`, `MANUAL_PAYMENT_INSTRUCTIONS_RU`, `MANUAL_PAYMENT_INSTRUCTIONS_UZ`.
- Operator migration environment only: `DIRECT_DATABASE_URL`. It must never be exposed to the client or admin bundle.
- `MINI_APP_URL` is the future Mini App HTTPS URL used by the existing Bot configuration. The Bot is not started/deployed at this stage.
- `VERCEL` is platform-provided. Local-only variables remain documented in `.env.example`: `API_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `STORAGE_LOCAL_PATH`, `STORAGE_PRIVATE_PATH`, `STORAGE_PUBLIC_BASE_URL`.

On Vercel the API requires `NODE_ENV=production`, `ADMIN_SESSION_DRIVER=postgres`, `STORAGE_DRIVER=vercel-blob`, a configured Argon2id admin password hash and an HTTPS `ADMIN_ORIGIN`. Both Admin and API must use the same dedicated `ADMIN_PROXY_SECRET`. Generate fresh STENZO credentials; do not reuse another project's credentials.

The application traffic stays same-origin: Client calls its Next rewrite; Admin calls its existing restricted Next server proxy. Admin cookies remain HttpOnly, Secure, SameSite=Strict, host-only on the Admin domain; its proxy forwards the cookie to the API. Mutations retain exact Origin checks and CSRF. CORS is intentionally not opened for direct browser calls to the API, and no credentialed wildcard is configured. The Admin proxy signs Vercel's platform-provided client IP; login limits cannot be bypassed with arbitrary forwarded IP headers.

Use a stable Preview/branch alias for Admin and configure its exact origin in `ADMIN_ORIGIN`. A newly changing deployment URL needs its own exact origin configuration. Do not reflect arbitrary `*.vercel.app` origins or allow every preview with one shared session/database. Configure Deployment Protection so Client/Admin server requests can reach the API; if protection remains enabled, configure the approved platform bypass separately before testing. No bypass token is stored in code.

## Remote PostgreSQL / Neon

Local Docker PostgreSQL is retained for development. Vercel never connects to localhost; set a remote, TLS-enabled PostgreSQL URL. Prefer an isolated Preview database/branch. For Neon, use its pooled endpoint in `DATABASE_URL`, start with `connection_limit=1`, and set sensible `connect_timeout` / `pool_timeout` for cold-start traffic. Use the direct endpoint in `DIRECT_DATABASE_URL` for Prisma migration commands. Reuse the exported Prisma singleton for warm invocations, never `$disconnect()` after each request. Tune pool size/concurrency against the actual database limits after deployment.

Only two infrastructure tables were added: `AdminWebSession` and `AdminLoginRateLimit`. Existing customer commerce models and migrations are unchanged. Session tokens are stored as SHA-256 hashes, expire after eight hours and are revoked persistently. IP identifiers are hashed. Login attempts are reserved transactionally under a PostgreSQL advisory transaction lock before Argon2 verification: five/IP per 15 minutes, 30 globally/minute, the existing key/session capacity limits. This works across processes and with transaction pooling. Expired entries are pruned during login/session creation; GET authorizations enforce expiry without a background service. Database failure denies access; it does not silently fall back to memory.

After the remote database URL is supplied and migration execution is explicitly authorized:

1. Set `DATABASE_URL` and `DIRECT_DATABASE_URL` in the operator environment (do not print them).
2. Run `pnpm db:generate`, `pnpm --filter @stenzo/database db:validate`.
3. Run `pnpm db:migrate:deploy`. The CLI wrapper prefers `DIRECT_DATABASE_URL` for migrations and never runs a reset.
4. Inspect migration status and verify `/health`, catalog reads, admin login/logout/rate limits and user-owned order access.

No seed or migration runs as part of Vercel build/install. Development categories may be seeded in an explicitly chosen development/Preview database only; the seed blocks production. No production data or test commerce objects are imported.

## Two Vercel Blob stores

Create a **public** product image store and a separate **private** payment proof store. Configure their separate server-only tokens on API as `BLOB_PUBLIC_READ_WRITE_TOKEN` and `BLOB_PRIVATE_READ_WRITE_TOKEN`. Set `BLOB_PUBLIC_BASE_URL` to the exact public store origin. The provider uses UUID keys without overwrite/random suffix, preserving the existing `ProductImage.storageKey` and proof key contracts. Tokens must never be the same.

Product image responses expose public URLs. Payment proof storage accepts only `payment-proofs/` keys and always uploads/reads with private access. Proof bytes are served solely through the existing authenticated admin route with private/no-store headers; no public URL is returned. The Blob provider sanitizes SDK errors. Local files/providers are preserved; switching provider does not automatically migrate local images/proofs. Existing local references will need an explicitly authorized migration or upload before they work remotely.

Existing multipart server uploads are retained. Vercel Functions have a **4.5 MB request/response payload limit**; configure both upload limits and the Admin matching image limit at **4,000,000 bytes or lower**, reserving room for multipart overhead. API startup rejects larger Vercel limits. Larger uploads would require a separate authenticated direct-upload design; that UX/business change is outside this preparation.

## Checks and rollout boundaries

Run frozen install, Prisma generation/validation, workspace typecheck/lint/test/build on Node 24. The optional `RUN_POSTGRES_TESTS=1` admin persistence test creates and removes its own random schema, touching no commerce rows. The existing checkout integration test rolls back its fixtures. Isolated UI preview sources remain test code; captures, uploaded test proof files and build artifacts are ignored and not deployed.

Before a functional Preview, supply remote DB + two Blob stores + exact HTTPS URLs + credentials, authorize remote migration execution, then test real Telegram initData, both payment phases, admin proof review/session replacement and cross-instance rate limits. Platform packaging, native modules (Argon2/Prisma Linux binaries), HTTPS cookies and storage integration still need an actual Preview smoke test. This stage does not deploy, start Telegram Bot, connect a custom domain or create real orders.

Official references: [Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [native Fastify](https://vercel.com/docs/frameworks/backend/fastify), [Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk), [Function payload limits](https://vercel.com/docs/functions/limitations), [Prisma/Neon v6](https://docs.prisma.io/docs/orm/v6/overview/databases/neon).

## Verified locally on 2026-10-01

- Node 24.18.0, pnpm 10.17.1: frozen install, Prisma generation/validation, workspace typecheck, lint and production build passed.
- Tests: Mini App 85; Admin 18; API 88 unit/injection tests plus one separately enabled PostgreSQL persistence test; Bot one isolated handler test (the real Bot was never started). Three existing optional commerce PostgreSQL tests were not rerun for this infrastructure-only change.
- Native exported Fastify app: health/categories/products 200. TCP API and Client Next proxy: same three endpoints 200, eight real categories, empty product list. Admin proxy and user orders correctly reject anonymous requests with 401.
- PostgreSQL persistence test used two Prisma clients and a disposable schema; it confirmed session sharing/revocation/expiry, per-IP/global limits and session capacity, then dropped only that schema. No external migrations or commerce data writes were performed.
- Existing Next.js warning about its ESLint plugin and Prisma v6's deprecated `package.json#prisma` seed configuration remain non-blocking. Native Vercel packaging and remote Blob/HTTPS integration are awaiting the separately authorized deployment.
