# STENZO: preparation for a full Cloudflare migration

> **Latest target: D1 on isolated subdomains.** See [CLOUDFLARE_READINESS.md](./CLOUDFLARE_READINESS.md).
> The PostgreSQL implementation described below is historical preparation, not a ready D1 deployment.
> Existing production domains must not be changed. Do not execute its live cutover sequence.

Prepared 2026-10-15 on branch `cloudflare-migration`, based on `c8ea67f`.
This is a preparation branch, not a production deployment. Turon, DNS, Telegram registration,
production environment, database and stored files were not changed. Older local DNS-proxy
planning documents describe a different option; this document describes the full application move.

## Current

The shared Turon monorepo runs three Node sites behind provider Nginx: API `10009`,
Admin `10010`, Mini App `10011`. Site launchers and templates remain in `deploy/turon/`.
The API uses Prisma/PostgreSQL, private Admin sessions, Telegram authentication and the
existing notification service. The Bot normally uses polling. Local storage remains supported;
the Vercel Blob provider also remains supported. No production settings were inspected for this work.

## Target

```text
Client / Telegram WebView
  -> Cloudflare HTTPS Worker (hostname routing, trusted IP normalization)
     -> private Durable Object -> existing Next Mini App, port 8080
     -> private Durable Object -> existing Next Admin, port 8080
     -> private Durable Object -> existing Fastify API, port 8080
     -> private Durable Object -> existing grammY Bot webhook, port 8080
API -> managed PostgreSQL via verified TCP/TLS
API -> R2 public products bucket / separate private proofs bucket
API and Bot -> Telegram HTTPS
```

No Turon Nginx in this target request chain. No Pages, D1, new backend, framework conversion,
UI redesign, Prisma schema change or business-service rewrite. Durable Object SQLite metadata
belongs to container lifecycle only: shop data stays in PostgreSQL.

### Availability and cost gate

The existing Cloudflare session for the account containing `stenzo.uz` showed **Enable Containers**
and **Purchase Workers Paid**, with an explicit upgrade requirement. Containers are not enabled
on that account's current plan. No purchase/subscription change was made.

[Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)
requires Workers Paid (base $5/month), with metered compute, memory, disk and egress in addition
to Workers/Durable Objects and storage/database costs. Four applications are not a $5 flat-rate
hosting package. The template starts conservatively with one `basic` instance per web app and
one `lite` Bot instance; measure memory, CPU, cold starts, latency and cost before choosing sizes.
Container image size must fit instance disk and account limits. See
[instance limits](https://developers.cloudflare.com/containers/platform/limits/).

## Components

| Component                | Preparation                                                                                      | Code impact                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Mini App                 | Existing Next 15 server; conditional standalone build; `/health`                                 | MINOR: config/health only; UI, RU/UZ, themes, safe-area, routes and client API calls unchanged       |
| Admin                    | Same Next server and API proxy; conditional standalone build; `/health`                          | MINOR: config/health; existing client IP helper behavior, cookies, CSRF, sessions and HMAC unchanged |
| API                      | Same Fastify/Prisma server; R2 provider behind existing interfaces; `/health`, `/ready` retained | MINOR: storage/config infrastructure; commerce/auth contracts unchanged                              |
| Bot                      | Same grammY `/start` handler; opt-in authenticated webhook HTTP runtime                          | MINOR: transport/config only; polling remains default for Turon/local                                |
| Shared/database packages | Existing builds and Prisma client                                                                | NONE: schema, migrations, money/status logic untouched                                               |
| R2                       | Separate buckets and prefix-restricted providers                                                 | Cloudflare-specific durable storage; no buckets or keys created                                      |
| PostgreSQL               | Existing Prisma engine, managed database selected later                                          | No connection/copy/migration performed                                                               |

### Why Containers, not OpenNext/vinext

Cloudflare's current [Next.js Workers guidance](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
now recommends vinext for Workers and documents OpenNext as another path. This shop is an
existing Next 15 application. Keeping its own Node/Next server in a container avoids an adapter,
framework upgrade and edge-runtime compatibility changes. Neither adapter was installed.
The [Containers getting-started guide](https://developers.cloudflare.com/containers/get-started/)
documents Linux/amd64 images, private Worker/DO routing and the Container class.

### PostgreSQL and Hyperdrive decision

**Hyperdrive runtime support: NOT ENABLED.** This is deliberate, not an untested connection-string
placeholder. The official [Prisma/Hyperdrive example](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/prisma-orm/)
runs Prisma with `pg`/`@prisma/adapter-pg` inside a Worker using a Workers binding. The existing
Prisma engine runs inside Node here. [Container bindings access](https://developers.cloudflare.com/containers/configuration/workers-connections/)
is through HTTP outbound handlers; [non-HTTP networking](https://developers.cloudflare.com/containers/configuration/outbound-traffic/)
does not route PostgreSQL TCP through those handlers. Passing a Workers Hyperdrive URL into
Node is not a supported connection bridge established by these documents.

The deployable first path is Container -> managed PostgreSQL directly over verified TLS.
`CLOUDFLARE_CONTAINER=1` requires `STORAGE_DRIVER=r2` and a PostgreSQL `DATABASE_URL` with
`sslmode=require` and `sslaccept=strict`. Use a publicly trusted server certificate or mount/configure
the managed provider's trusted CA explicitly; do not disable certificate validation. Set bounded
Prisma pool size/timeouts in the runtime connection configuration and budget total connections
for rollout overlap. Keep the database near the application placement where possible and measure latency.

Re-evaluate Hyperdrive only if an officially supported container TCP integration becomes available,
or separately authorize a database-access Worker/adapter design. Such a bridge would be a larger
change and is not hidden in this preparation. Do not enable query caching for transactional shop data
without checking its consistency semantics. No Hyperdrive resource was created.

### Storage contract

`STORAGE_DRIVER=local|vercel-blob|r2`. The API creates public/private providers through the existing
factory; upload validation, 5 MiB default limits, UUID keys, metadata and payment/order behavior stay
in the same services. R2 uses the documented [S3 SDK](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/),
region `auto`, TLS, explicit runtime credentials, and atomic `If-None-Match: *` writes to avoid overwrites.
[R2's S3 contract](https://developers.cloudflare.com/r2/api/s3/api/) documents these conditional writes.

Public provider: only `products/<id>.jpg|png|webp` in `R2_PUBLIC_BUCKET`.
Private provider: only `payment-proofs/<id>.jpg|png|webp` in `R2_PRIVATE_BUCKET`.
The private provider has no public-URL method. SDK errors are sanitized before leaving the provider.
Bucket names must differ. Runtime credential access should be scoped to these two buckets, not account-wide.

Keep `STORAGE_PUBLIC_BASE_URL=https://api.stenzo.uz/media` at final cutover to preserve stored image
URLs. In R2 mode that API route serves only product keys from the public provider; a proof key returns
404 there without reading the private bucket. Existing proof access remains behind Admin session/CSRF
and the binary `private, no-store` API proxy. Never add a public custom domain or `r2.dev` URL to the
private bucket. If the public bucket is exposed later, follow [public bucket controls](https://developers.cloudflare.com/r2/buckets/public-buckets/)
and expose only product objects. Do not use a filesystem/FUSE mount for correctness-critical uploads.

### Client IP, auth and cache contract

The public Worker accepts only configured hostnames and HTTPS. It validates Cloudflare-provided
`CF-Connecting-IP`, removes client-supplied forwarding/Vercel headers and writes a single trusted
`X-Real-IP`, `X-Forwarded-For`, forwarded host and HTTPS scheme before private DO/container ingress.
It fails closed with 503 if the platform IP is missing/invalid. Never expose container TCP ports
through another public path or trust arbitrary client `X-Real-IP` at a directly reachable Node server.

Admin's existing helper prefers the normalized `X-Real-IP`. Next signs that address and timestamp
with `ADMIN_PROXY_SECRET`; the API retains its IP validation, HMAC comparison and 30-second replay
window. The Worker preserves these signed headers on Next -> API requests and does not synthesize
an Admin signature itself. Signed headers do not replace session, CSRF or password verification.
No `TRUST_PROXY=true` or guessed container-network CIDRs: the API template keeps `TRUST_PROXY` empty.
Thus Fastify's generic `request.ip`/access log can identify the internal peer; production Admin login
throttling uses the separately authenticated original client IP, as before.

[Cloudflare header behavior](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
has special same-zone/cross-zone Worker subrequest behavior. Keep all STENZO routes in this controlled
Worker/account, disable Pseudo IPv4 header overwriting and do not remove visitor-IP headers. Validate
IPv4/IPv6 login signatures and spoofed-header rejection on preview before cutover. Do not add an
untrusted intermediate Worker. Admin -> API transport IP may be container egress; the Admin HMAC
is the authoritative user-IP channel for login.

The template uses one named API container (`primary`, `max_instances=1`) as a conservative capacity
setting. Current production-mode Admin sessions and login rate limits are persisted in PostgreSQL,
with PostgreSQL advisory locking; they are not merely in-process counters. A D1 implementation
must preserve durable, atomic rate limits/session caps across container restarts and multiple instances.
No WAF/Bot Fight/challenge/rate-limiting rules were created. Avoid browser challenges on Mini App,
API and webhook, and validate real Telegram WebViews on iOS and Android before any deployment.

No Worker Cache API or cache-everything rule. Dynamic API, Admin, orders, auth, payments, proofs and
Bot responses are explicitly private/no-store. Immutable Mini App `/_next/static/` chunks retain their
Next build cache headers. Do not override private/no-store with later zone cache rules. R2 object metadata
keeps public products distinct from private proofs. A dedicated public-media CDN rule is a later optimization.

### Bot transport

`BOT_MODE` defaults to `polling`; Turon/local startup behavior stays available. Container config selects
`webhook`, starts a bounded Node HTTP server on `8080`, and uses grammY's existing update handling.
`POST /telegram/webhook` requires `X-Telegram-Bot-Api-Secret-Token`, checked before parsing the body.
Invalid secret 401, wrong method 405, oversized body 413, malformed JSON 400, handler failure 500.
No request payload/token is logged. `/health` is liveness only. Shutdown closes the HTTP server and drains
active requests. Neither startup nor scripts call `setWebhook`/`deleteWebhook`.

Future webhook hostname is **undecided**: `BOT_HOST` is a non-live placeholder, separate from the three
shop domains. Select a dedicated hostname later. Telegram delivers at least once; `/start` uses existing
behavior, and no new durable update-deduplication guarantee is claimed. API order/payment notifications
remain in the existing notification service; existing lack of a persistent retry/outbox remains a known limit.
Test with a separate test bot during preview; never poll the real token in parallel with its webhook.

## Deployment

**Later, after separate authorization and successful preview; none of these remote steps ran here.**

1. Enable Workers Paid manually with budget approval; confirm Containers entitlement/limits and R2
   availability. Select an isolated preview setup, managed PostgreSQL provider and bot test identity.
2. On a Docker-capable Linux/amd64 builder (or Windows Docker with Linux containers), clone this branch,
   use Node 24 and project-pinned pnpm 10.17.1; install with `pnpm install --frozen-lockfile`.
   Generate Prisma; never run migrations during image build/startup. The default `NODE_IMAGE` is the official
   `node:24.21.0-bookworm-slim` pinned to its verified linux/amd64 digest. Refresh that pin deliberately
   for future security updates, with a rebuild and native-runtime smoke tests.
3. Build each image from repository-root context (these commands build locally only):

   ```sh
   docker build --platform linux/amd64 -f deploy/cloudflare/api/Dockerfile -t stenzo-api:preview .
   docker build --platform linux/amd64 -f deploy/cloudflare/admin/Dockerfile --build-arg API_URL=https://YOUR-PREVIEW-API -t stenzo-admin:preview .
   docker build --platform linux/amd64 -f deploy/cloudflare/miniapp/Dockerfile --build-arg API_URL=https://YOUR-PREVIEW-API -t stenzo-miniapp:preview .
   docker build --platform linux/amd64 -f deploy/cloudflare/bot/Dockerfile -t stenzo-bot:preview .
   ```

   Multi-stage runtime images contain selected app dependencies only; Next uses standalone tracing.
   All use non-root `node`, port 8080, `tini` signal forwarding and HTTP health checks. API includes its
   generated Linux Prisma engine, OpenSSL and native production packages. `pnpm deploy --legacy --offline`
   is followed by a dependency-version comparison against the frozen builder installation: any drift fails
   the image build. Final images do not contain the whole monorepo or build dependencies. The Docker
   context excludes `.env`, credentials, local storage/proofs, caches and build outputs.

4. Copy/adapt Wrangler configuration locally for preview. It intentionally has no account ID, routes,
   live hostnames, database binding or enabled workers.dev/preview endpoint. Replace `.invalid` vars,
   choose four matching preview hostnames, and set the Mini App container's `image_vars.API_URL` to the
   same preview API URL. Runtime `API_URL` alone does **not** replace Mini App's build-time Next rewrite.
   Admin runtime API_URL must also point to that API. No application secrets belong in `image_vars`.
5. Create preview buckets/database and populate approved test data only. Supply the listed runtime
   secrets through Worker secrets; the Container class passes the minimum per-app subset at startup.
   [Environment/secrets documentation](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/)
   describes this boundary. Updating runtime secrets may require a container restart/rollout to take effect.
6. Validate images locally: API `/health` and `/ready` against **preview database**, Next `/health`,
   Bot authentication/health, R2 public/private isolation, native Argon2/Prisma, non-root permissions,
   graceful stop, upload limits and TLS. Docker health checks do not replace an external readiness gate.
7. Only then explicitly authorize a preview Worker/container deployment and preview host bindings.
   `pnpm --filter @stenzo/cloudflare exec wrangler deploy` is a real remote deployment/image rollout,
   not a validation command. No such command ran in this preparation. Do not connect GitHub automatic
   builds to this branch in a way that deploys production on push.
8. Test Telegram login/WebView, catalog/cart/checkout, RU/UZ, 50%/final payment, cargo, private proof
   upload/review, Admin cookies/CSRF/HMAC/login throttles, `/start` button and notifications. Use a test
   bot and preview database; measure cold-start latency and errors. Retest after container sleep/restart.
9. Complete separately approved database/storage synchronization and DNS/bot cutover below. Preserve
   Turon deployment and rollback artifacts until reconciliation and the rollback window are complete.

### Local validation

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm lint --cache=local:w
pnpm typecheck --cache=local:w
pnpm --filter @stenzo/cloudflare test:workspace
node --test scripts/turon-launchers.test.mjs
pnpm build --cache=local:w
pnpm --filter @stenzo/cloudflare config:check
pnpm --filter @stenzo/cloudflare build:worker
pnpm --filter @stenzo/cloudflare containers:check
```

`test:workspace` runs the existing tests with synthetic process-only fixtures, a loopback port-1 database
URL and PostgreSQL/browser integration switches disabled. It refuses a checkout containing `.env`, never creates that file and passes only allowlisted
OS variables plus test fixtures to the subprocess. It does not use production credentials. Database integration tests require a separately provisioned disposable test DB and were
not enabled here. `config:check` validates against pinned Wrangler's JSON schema. Worker bundling uses
Wrangler's pinned local esbuild, not a remote deployment. Containers checks are static if Docker is absent;
this is **not** evidence that Linux image builds or Cloudflare runtime smoke tests have passed.

## Secrets

Names only. Supply existing approved application values through a secure operator process later;
do not print/copy production `.env`, commit values, put secrets into build arguments or create them in this phase.

| App      | Runtime secret/config names                                                                                                                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API      | `DATABASE_URL`, `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `ADMIN_PROXY_SECRET`, `ADMIN_PASSWORD_HASH`, `MANUAL_PAYMENT_CARD_HOLDER`, `MANUAL_PAYMENT_CARD_NUMBER`, `MANUAL_PAYMENT_INSTRUCTIONS_RU`, `MANUAL_PAYMENT_INSTRUCTIONS_UZ`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |
| Admin    | `ADMIN_PROXY_SECRET` shared with API; `API_URL`                                                                                                                                                                                                                             |
| Bot      | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`; `MINI_APP_URL`                                                                                                                                                                                                             |
| Mini App | No application secret; `API_URL` (also build-time rewrite target)                                                                                                                                                                                                           |

Non-secret runtime configuration: `R2_ACCOUNT_ID`, `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET`,
`STORAGE_PUBLIC_BASE_URL`, `ADMIN_ORIGIN`, `ADMIN_TELEGRAM_IDS`, routing `*_HOST` values.
Account ID identifies an R2 endpoint and is deliberately absent from Git configuration.
`TELEGRAM_WEBHOOK_SECRET` is a future webhook transport secret; none was generated here.
Never expose any of these secrets through `NEXT_PUBLIC_*`, logs, screenshots or client responses.

## Database migration

Later only: choose managed PostgreSQL with verified TLS, sufficient version/extensions, region and
connection limits. Inventory schema/migration history without modifying it. Create encrypted verified
backups and a restore rehearsal into an isolated database with separately approved access. Compare
counts, constraints, sequences, money/status snapshots, idempotency records and Admin sessions.
No automatic `migrate deploy`, `db push`, seed or reset belongs in containers or this preparation.

Plan a final write freeze/maintenance window or a tested replication/catch-up procedure, with a known
last-write watermark. Cut over **one authoritative writable database**; do not let Turon and Cloudflare
accept independent orders/payments on diverging copies. Set up ongoing backups and rehearse restoration.
Never move DNS to an empty, stale or unverified DB. Schema/migrations remain unchanged in this branch.

## Storage migration

Later only: inventory public products and private proof keys separately; transfer bytes to the correct
buckets preserving keys/MIME. Verify object counts, sizes/checksums and each DB reference without
publishing private files. Do not overwrite objects silently. Run a rehearsal and final delta sync under
the same write/cutover plan as DB. Existing API media URLs can remain unchanged when their object keys
are preserved. Do not rewrite proof keys into public URLs.

Disable public access on the private bucket and verify unauthenticated denial using actual deployed
configuration; a class name alone cannot enforce a bucket's control-plane visibility. Validate product
images, authenticated Admin proof streaming and new uploads after container restart/sleep. Keep Turon
files intact throughout the rollback window. Container disk is ephemeral per the
[Containers FAQ](https://developers.cloudflare.com/containers/faq/), so it cannot be the upload source of truth.

## DNS cutover

Only after image/runtime, DB, storage and security gates pass, and after a separate explicit approval.
Final host mapping: `stenzo.uz` -> Mini App, `api.stenzo.uz` -> API, `admin.stenzo.uz` -> Admin.
`deploy/cloudflare/routes.example.json` contains inert future Custom Domain entries; it is not referenced
by Wrangler. Bot hostname remains a separate decision. Confirm `www` behavior independently.

Follow the current [Custom Domains contract](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
and take a fresh DNS inventory/DS check. Attaching Custom Domains provisions DNS/certificates and is a
change, not a harmless test. Preserve all MX/mail/SPF/TXT/CAA/NS/DNSSEC records and do not orange-cloud
mail services. Coordinate registrar delegation/DNSSEC only if still required; old preflight is historical,
not proof of today's state. Verify HTTPS certificates, SNI and all application hosts before releasing traffic.

Keep Mini App URL/API/Admin origins consistent with final domains; rebuild Mini App with final API_URL.
Only in the approved Bot cutover stop conflicting polling, register the webhook with its secret using a
secure operator process, inspect delivery status without printing the token, and resume update handling.
Choose pending-update handling intentionally; do not silently drop pending updates during migration.

## Rollback

Keep Turon apps, launchers, certificates, settings and source/files intact. Save pre-cutover DNS and
release/image references through an approved operator procedure. If preview fails, do not cut over.
If live Cloudflare fails, freeze writes first, identify the authoritative DB/file state and reconcile any
orders/payments/uploads accepted since cutover. Repoint Turon to that authoritative dataset or transfer
the verified delta **under separate approval**, then restore the saved DNS/routing and Bot transport.
Do not restore a stale pre-migration database over newer commerce data. Returning DNS alone does not
reconcile a split database or lost proof uploads. Keep only one real Bot update consumer active.

## Release gates and known limits

- Workers Paid is required and was not enabled. No Cloudflare resources were created in this work.
- Docker image builds/Linux native dependencies and live Cloudflare cold starts still require validation;
  static checks and Windows runtime packages cannot certify Linux image correctness.
- Managed PostgreSQL selection, secure runtime values, storage provisioning/copy and final write
  synchronization remain future work. No production data was accessed.
- Hyperdrive is not claimed compatible with this Node container setup; direct PostgreSQL/TLS is prepared.
- Container placement/cold starts, rollout overlap and per-process throttle reset require measurement.
- Existing notification retry/outbox and webhook delivery deduplication guarantees were not expanded.
- No production deployment, DNS/route attachment, Telegram webhook registration or main merge occurred.

### Validation recorded on this PC

- Frozen install and Prisma generate: passed; no database connection or migration.
- Normal API/Mini App/Admin/Bot builds: passed.
- Workspace lint/typecheck and offline unit/contract tests: passed with test-only process ENV;
  five PostgreSQL integration tests deliberately skipped.
- Wrangler schema, local Worker bundle and four Dockerfile static contracts: passed.
- Isolated API/Bot production dependency packaging: version comparison against frozen install passed.
- Docker engine: unavailable; no Linux image build or Cloudflare runtime test was run.
- Additional Windows Next standalone packaging hit OS `EPERM` while creating symlinks. Do not change
  Windows security/developer settings for this task; repeat standalone/image builds on the Linux builder.
  This does not affect the normal Turon Next build path.
