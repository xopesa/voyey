# Independent Cloudflare Workers Free preview

This is a new repository and independent data store. The original Desktop/Stenzo
checkout, its Git remotes, Turon sites, PostgreSQL, production bot and existing DNS
are not deployment targets of this project. Source provenance is in SOURCE_COPY.md.

Current preview: https://cf.stenzo.uz; Admin shell:
https://cf-admin.stenzo.uz/admin/. See `DEPLOYMENT_STATUS.md` for remote resources,
verification and blockers. Workers Free was confirmed as the account's current
plan. The existing Access app/policy and supplied issuer/audience are configured;
real OTP sign-in and authenticated Admin catalog access were verified on 2026-10-17.
Commerce remains disabled until its separate preview configuration is ready.

## Runtime

- Mini App: existing React components built as static assets with Vite. Dynamic
  catalog/order URLs are resolved in the browser; no Next server/SSR is required.
- Admin: static shell under `/admin`, served on a separate Access-protected host.
  Cloudflare Access email login was approved for `admin@example.invalid`. Native
  Argon2 password verification is deliberately unavailable in the Worker build;
  the original Turon password flow is unchanged in the original checkout.
- API: existing Fastify routes, Zod validation, services and DTOs, running through
  Cloudflare's Node HTTP bridge. `listen()` is an internal Worker routing key,
  not a VM/container/TCP daemon. `app.inject()` is only for Node tests.
- D1: explicit SQL writes, bounded atomic batches and typed reads. The PostgreSQL
  Prisma schema is retained for model/type provenance; its migration and transaction
  execution paths are not used by this Worker. No native Prisma engine is bundled.
- Telegram bot: separate `/telegram/webhook` endpoint. No polling process, BotFather
  change or webhook registration is executed by deployment.
- Files: D1-backed 256 KiB chunks, maximum 5 MiB per upload, with separate public
  product/private-proof namespaces. R2 bindings are optional, not provisioned.

## Data correctness and security

The D1 migration preserves 16 handwritten CHECK constraints, enums, foreign keys,
unique idempotency keys and the one-primary-image partial unique index. Telegram
IDs are decimal text in D1 and BigInt in domain records. Dates retain milliseconds;
search uses normalized Unicode lowercase shadow columns for RU/UZ matching.

Every commerce/security write increments a revision in database triggers. A write
operation reads its starting revision, reads the records needed for validation,
and queues its writes. A failing CHECK guard, all writes and audit rows execute in
one D1 batch. If another writer changed the revision, the batch rolls back and the
operation retries against fresh records. Exhausted retries fail closed with 409;
login throttling fails closed. Callbacks must not perform external side effects.
This favors correctness at low preview traffic over throughput; contention and
query counts must be measured before treating it as a production replacement.

Sessions, expiry, revocation, caps, CSRF and origin checking remain in API services.
Client forwarding headers and internal HMAC headers are not accepted from callers.
The Worker derives the IP from Cloudflare's edge-provided CF-Connecting-IP and
generates the internal signature. IP headers never grant Admin access. Admin APIs,
orders, authentication and private proofs are never cached. Only product images
and hashed static assets are public/cacheable.

Two pinned pnpm patches are required and included in `patches/`: find-my-way uses
ordinary closures instead of runtime `new Function`; Avvio debug output is disabled
to avoid Worker runtime logging differences. Regenerate/review patches deliberately
when upgrading these dependencies. No broad dependency upgrade was performed.

## Local setup and checks

Use Node 24 and the pinned pnpm 10.17.1:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
corepack pnpm build
corepack pnpm --filter @stenzo/worker exec wrangler d1 migrations apply DB --local
corepack pnpm --filter @stenzo/worker dev
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
```

Local frontend/API paths: `/`, `/admin`, `/api/health`, `/api/ready`, `/api/catalog/*`.
An empty catalog is expected: no production records, users, images or receipts are
copied or seeded into the new database. The original PostgreSQL-only integration
tests remain historical, skipped by default and excluded from this target's typecheck;
the new D1/Workers tests exercise actual SQLite/D1 behavior instead.

The Miniflare test uses generated in-memory test credentials and intercepts all
external requests. It exercises Telegram auth, catalog, cart, checkout, multipart
proof storage and public/private isolation in the actual Workers runtime. Separate
SQLite tests cover concurrent idempotency, failed-batch rollback, payment review,
finance transitions, primary images and durable session/throttle limits.

## Deployment boundary and exact prerequisites

The committed Wrangler target is `stenzo-free-preview` with `PREVIEW_ONLY=1` and
`COMMERCE_ENABLED=0`. It exposes only the static UI, health and public
catalog. Cart/auth/orders/payments, Admin and bot stay closed until configured.
No real secret value is stored in Git or copied from production.

1. Finish Wrangler browser consent for user/account read, Workers write/scripts,
   D1 write and (only for later isolated Custom Domain work) zone read/routes write.
   No Containers entitlement or paid subscription is needed.
2. Inventory existing Worker names/databases before creating anything. Refuse to
   overwrite an existing unrelated `stenzo-free-preview` resource. Create only a
   new D1 database with that name and record its returned ID in Wrangler config.
3. Apply ONLY `apps/worker/migrations` to that new database. Build, then deploy
   the isolated Worker. Never use the old `deploy/cloudflare` Container template.
4. Verify workers.dev health, readiness, catalog and asset pages. Free-tier CPU
   limits must be measured on real traffic; passing local tests does not prove them.
5. For full commerce, set only new preview runtime values securely in Cloudflare:
   `PUBLIC_ORIGIN`, `JWT_SECRET`, `ADMIN_PROXY_SECRET`, `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_TELEGRAM_IDS`, `MANUAL_PAYMENT_CARD_HOLDER`,
   `MANUAL_PAYMENT_CARD_NUMBER`, `MANUAL_PAYMENT_INSTRUCTIONS_RU`,
   `MANUAL_PAYMENT_INSTRUCTIONS_UZ`. Reuse no production bot/webhook. JWT/HMAC/webhook
   values must have independent strong randomness; never send them in chat/logs.
6. Configure a new Cloudflare Access self-hosted application protecting the entire
   isolated Admin hostname. Allow only `admin@example.invalid` using email OTP.
   Set `ADMIN_ORIGIN`, `ACCESS_TEAM_DOMAIN` (HTTPS team URL), `ACCESS_AUD` and
   `ADMIN_ACCESS_EMAILS`. These identifiers/allowlist are configuration, not secrets.
   JWT and HMAC secrets must be new independent values stored with Wrangler secrets.
   The Worker verifies signed Access JWTs against the team's JWKS, exact issuer,
   application audience, expiry and email allowlist. The opaque API session is
   bound to that verified identity; CSRF, origin validation and HMAC remain enforced.
   Tests reject forged/expired/wrong-audience/wrong-email assertions, cookie replay
   under a different principal, unauthenticated bearer access and wrong origins.
   This code is implemented and tested locally; the real Access application and
   email OTP sign-in must still be configured and tested before opening Admin.
7. Add only unused isolated hosts such as `cf.stenzo.uz` (Mini App/API) and
   `cf-admin.stenzo.uz` (Admin), after checking the actual
   Cloudflare zone and existing Custom Domains. Never attach stenzo.uz, www, api or
   admin.stenzo.uz and never use wildcard production routes. The current config
   allows only the two verified preview custom domains. Do not alter nameservers
   or other existing records.

Legacy Turon/Next/Container files and documentation are source-history references,
not the commands/architecture for this independent target.

## Free-tier constraints

Workers Free: 100,000 dynamic requests/day and 10 ms CPU/request. Static asset
requests are free/unlimited. D1 Free: 500 MB per database, 5 GB total account
storage, 5 million rows read/day, 100,000 rows written/day, 50 queries per Worker
request and 100 bound parameters per statement. Media counts toward D1 storage
and row budgets; uploaded images should be reasonably sized. Revision triggers,
audits, indexes, contention retries and chunk writes consume additional capacity.
Do not claim unlimited storage or guaranteed zero cost at arbitrary traffic.

No plan purchase, R2 billing activation, production migration or live-domain cutover
is authorized by a local build. Keep commerce closed if any configuration or safety
test is incomplete. Rollback is another version of this new Worker only; Turon
continues serving the established production domains throughout.

Primary references:

- https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
