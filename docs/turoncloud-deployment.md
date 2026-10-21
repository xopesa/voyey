# STENZO Wear: TuronCloud Master / ISPmanager

Preparation only. These instructions do not deploy, change DNS, alter the existing
site, connect to the production database, or start the Telegram bot.

The current three-site launcher model, port mapping and IP-header contract are
recorded in [DEPLOY_TURON.md](DEPLOY_TURON.md), with parameterized templates in
`deploy/turon/`. Cloudflare is not part of that configuration.

## Runtime and provider prerequisites

Keep **Node 24.x LTS**, pinned by `.nvmrc` and all four applications' `engines`.
The repository accepts Node 24.0.0 and newer 24.x patches; the full verification
was run with **24.18.0**. Lower majors are not supported by this repository and
have not been validated. Use the latest available patched Node 24 LTS on Turon.
Use the pinned pnpm **10.17.1** through Corepack, including during builds.

Master advertises Node.js and SSH, but that does not establish permission for a
persistent grammY process or guarantee sufficient build memory. Before deployment
ask Turon to confirm Node 24, PostgreSQL 15, three concurrent web processes,
pnpm/Corepack, TCP `PORT` mode, available memory/disk, and durable private storage.
Ask specifically: **Does Master allow a constantly running background Node.js
process for grammY long polling, with restart supervision?** If not, leave the bot
code and long polling unchanged until a separate hosting decision.

Sources: [Turon Master](https://tcloud.uz/en),
[ISPmanager Node project settings](https://www.ispmanager.com/docs/ispmanager/managing-a-nodejs-project),
[Node LTS releases](https://nodejs.org/en/about/previous-releases).

## Production variables (names only)

API process:

```text
NODE_ENV
PORT
INSTANCE_HOST
TRUST_PROXY
DATABASE_URL
JWT_SECRET
TELEGRAM_BOT_TOKEN
TELEGRAM_INIT_DATA_TTL_SECONDS
ADMIN_TELEGRAM_IDS
ADMIN_PASSWORD_HASH
ADMIN_ORIGIN
ADMIN_SESSION_DRIVER
ADMIN_PROXY_SECRET
STORAGE_DRIVER
STORAGE_LOCAL_PATH
STORAGE_PRIVATE_PATH
STORAGE_PUBLIC_BASE_URL
MAX_IMAGE_UPLOAD_SIZE
MAX_PAYMENT_PROOF_UPLOAD_SIZE
MANUAL_PAYMENT_CARD_NUMBER
MANUAL_PAYMENT_CARD_HOLDER
MANUAL_PAYMENT_INSTRUCTIONS_RU
MANUAL_PAYMENT_INSTRUCTIONS_UZ
```

Mini App process **and build**:

```text
NODE_ENV
API_URL
PORT
INSTANCE_HOST
```

Admin process **and build**:

```text
NODE_ENV
API_URL
ADMIN_PROXY_SECRET
MAX_IMAGE_UPLOAD_SIZE
PORT
INSTANCE_HOST
```

Migration process: `DATABASE_URL`; optional `DIRECT_DATABASE_URL` only when a
separate direct connection is actually required. Direct PostgreSQL 15 does not
need a pooler or Neon. Runtime still uses `DATABASE_URL`.

Bot process: `NODE_ENV`, `TELEGRAM_BOT_TOKEN`, `MINI_APP_URL`.

`API_PORT` remains the local fallback. Platform `PORT` takes priority in API,
Mini App and Admin; give each process its own assigned port. No production secrets
belong in a `NEXT_PUBLIC_*` variable, Git, build logs, or shell command arguments.
Prefer ISPmanager process environments or a private, ignored root `.env` with
permissions `0600`. Never print it. Platform environment overrides root `.env`.

Set production mode, PostgreSQL session driver, and local storage driver for API.
Transfer the existing `ADMIN_PASSWORD_HASH`, JWT secret, Telegram token and payment
configuration privately. Keep the current Admin password; do not rerun the password
setup script. Admin and API need the **same** server-only proxy secret; preserve an
existing one, or provision it once if it was never configured. No Blob tokens or
Vercel environment variables are required for local storage. Vercel providers and
deployment files remain available separately.

## Commands and process directories

Keep one private checkout outside every domain's public web-root, for example
`/home/<ISP_USER>/apps/stenzo`. Substitute the actual ISPmanager account path.
Run the shared install once from that checkout:

```sh
corepack pnpm install --frozen-lockfile
```

Do not use the panel's `npm install` action for this pnpm workspace. Select Node 24
for both SSH/build commands and the supervised processes. Run builds from the
checkout root, with the corresponding production variables already set:

| Process                           | Build from checkout root                                                       | Working directory | Start in that directory |
| --------------------------------- | ------------------------------------------------------------------------------ | ----------------- | ----------------------- |
| Mini App                          | `corepack pnpm --filter @stenzo/miniapp... build`                              | `apps/miniapp`    | `npm run start`         |
| Admin                             | `corepack pnpm --filter @stenzo/admin... build`                                | `apps/admin`      | `npm run start`         |
| API                               | `corepack pnpm db:generate` then `corepack pnpm --filter @stenzo/api... build` | `apps/api`        | `node dist/server.js`   |
| Bot, only after provider approval | `corepack pnpm --filter @stenzo/bot... build`                                  | `apps/bot`        | `node dist/index.js`    |

`npm run start` only invokes the checked-in startup script; it does not install
packages. Next startup uses `PORT`, with local fallbacks 3000/3002. API uses `PORT`,
then local `API_PORT`/3001. Production binds to loopback by default; `INSTANCE_HOST`
can select the private listener supplied by ISPmanager. Choose **TCP PORT** mode:
these entry points do not implement ISPmanager's alternative `SOCKET` mode.
ISPmanager must supervise restarts; do not run `pnpm dev` or watchers in production.
API handles SIGTERM/SIGINT by closing Fastify and Prisma; Next startup forwards
these signals to Next. Allow time for graceful shutdown before force killing.

## Reverse proxy and storage

Public origins:

| Domain                        | Setting / purpose                          |
| ----------------------------- | ------------------------------------------ |
| `https://stenzo.uz`           | Mini App; production bot Mini App URL      |
| `https://admin.stenzo.uz`     | Exact Admin origin, without trailing slash |
| `https://api.stenzo.uz`       | API URL for both Next apps                 |
| `https://api.stenzo.uz/media` | Public product image base URL              |

Next Mini App's API rewrite is captured during **build**. Rebuild when its API URL
changes. Admin's proxy reads the server environment. Both use same-origin browser
requests, so no credentialed cross-origin CORS or wildcard origins are needed.
Telegram initData validation and JWT flow remain in the API; do not disable them
for domain testing. Only Telegram can provide valid Mini App initData.

For each domain use ISPmanager's reverse proxy to its private Node listener. Ask
the provider to verify these directives in the effective Nginx configuration:

```nginx
# Inside the HTTPS server's proxy location, with its actual assigned upstream:
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

Overwrite Host, X-Real-IP and X-Forwarded-Proto at the trusted ingress. Append
the real TCP peer to the end of X-Forwarded-For; do not forward that header
unchanged. Admin prefers X-Real-IP, falling back to the last XFF element only
when X-Real-IP is missing or empty. Bind Node privately and block external access
to the listener ports. Review this contract before adding any upstream proxy.
Configure `TRUST_PROXY` with only confirmed proxy IP addresses/CIDRs, normally
the loopback peers; never use all-address ranges, `true`, or a hop count. Admin
signs the selected IP using its shared proxy secret. API rejects unsigned
production logins, preserving per-client rate limits across restarts. Secure, HttpOnly, SameSite=Strict cookies
are issued through Admin's same-origin proxy; origin and CSRF checks stay enabled.
Do not rewrite cookie domains to the API domain or weaken cookie attributes.

All dynamic paths must reach Node. Do not expose the checkout, `.env`, Prisma,
or storage via a generic Nginx filesystem root/alias. In particular, no filesystem
alias to the private proof directory. Set the proxy request-body limit high enough
for the configured upload limits plus multipart overhead (API default 5 MiB per
file), while retaining application limits. Disable proxy caching for `/api/`,
authentication and protected proof responses. Private proof responses stay
`private, no-store`; do not turn them into public/CDN URLs.

Create two persistent directories **outside the checkout and all public roots**,
for example `/home/<ISP_USER>/stenzo-data/product-images` and
`/home/<ISP_USER>/stenzo-data/payment-proofs`. Set the corresponding storage path
variables to absolute paths. Owner: the API process account; directories `0700`,
files `0600`, no symlinks and no writes by unrelated accounts. Back up the database
and both directories together privately. Never clear them during a code update.
Existing media keys remain valid after process restart.

Public images are served through the API's existing `/media/` scheme, only JPEG,
PNG and WebP. Private proofs have no public route or public storage URL; access
remains through the authorized Admin API and proxy. Upload magic/MIME and size
checks, exclusive create (no overwrite), key traversal validation, and rejection
of linked directories/files are covered by storage tests. OS account permissions
must prevent external modification/races while files are in use.

## ISPmanager deployment sequence (operator executes later)

1. Add `stenzo.uz`, preserving the existing Master site and its configuration.
2. Add `admin.stenzo.uz`.
3. Add `api.stenzo.uz`.
4. Obtain Let's Encrypt certificates for all three; enable HTTPS.
5. Create a dedicated PostgreSQL 15 database/user through ISPmanager with access
   only to STENZO. Configure the real production connection privately, including
   the provider's verified SSL requirements and bounded connection timeout.
6. Clone the private repository into the private application directory via SSH.
7. Configure the production variables above; transfer existing secrets privately.
8. Create the two persistent storage directories and restrict their permissions.
9. Install dependencies, validate schema, verify DB connectivity and apply migrations
   **once**, from the checkout root:

   ```sh
   corepack pnpm --filter @stenzo/database db:validate
   corepack pnpm db:generate
   corepack pnpm --filter @stenzo/database exec node --input-type=module -e 'import { PrismaClient } from "@prisma/client"; const db = new PrismaClient(); try { await db.$queryRaw`SELECT 1`; console.log("DB connectivity OK"); } catch { console.error("DB connectivity failed"); process.exitCode = 1; } finally { await db.$disconnect(); }'
   corepack pnpm db:migrate:deploy
   ```

   Use exported process environment for the connectivity command; do not interpolate
   credentials into it. If migration fails, stop and diagnose. Never reset, run
   `db push`, edit old migrations, or automatically migrate on every restart.
   Development seed is not part of production deployment. Generate again only
   if the application schema/client version changed, then build the applications.

10. Create Mini App Node process with the table's directory/script and assigned port.
11. Create Admin Node process with its own assigned port and signed-IP proxy config.
12. Create API Node process after successful migration; configure private listener
    and reverse proxy. Check DB readiness before admitting client traffic.
13. Check `GET https://api.stenzo.uz/health`: **200**, independent of PostgreSQL.
14. Check `GET https://api.stenzo.uz/ready`: **200** for connected PostgreSQL,
    **503** if unavailable, without internal DB diagnostics. Do not accept traffic
    until this succeeds. This checks connectivity, not migration drift; also verify
    `corepack pnpm --filter @stenzo/database exec prisma migrate status` with the
    exported direct database environment if applicable.
15. Check existing Admin login, cookie attributes, CSRF rejection, logout and session
    continuity after API restart; ensure rate limits persist. Use the existing
    password, never print it or its hash.
16. Verify a legitimate existing product image URL and catalog through the Mini App
    proxy. Do not add demo products to production for smoke tests.
17. Verify anonymous proof access is rejected; authorized Admin can read an existing
    proof without any public proof URL. Do not upload a real proof just for testing.
18. Configure the existing bot's Mini App URL as `https://stenzo.uz`, including its
    existing BotFather/domain configuration as needed; preserve its token.
19. Only if Turon confirms background processes: supervise the existing single
    grammY long-polling process with its production environment. Do not run two
    polling instances. SIGINT/SIGTERM calls `bot.stop()`; restart via the supervisor.
20. Smoke test the public pages, proxies, real catalog, Telegram login and Admin
    authorization. Validate protected cart/orders/payment reads with an authorized
    session. Do not place an order, send a notification, or change payment status
    solely for a production smoke test.

## Repeatable local verification

`node scripts/check-pg15.mjs` runs a **separate** compose project on loopback port
55432, with fresh PostgreSQL 15 tmpfs data and throwaway credentials kept in memory.
It refuses to adopt an existing test container, applies all seven migrations,
validates/generates Prisma, seeds eight categories into the disposable database,
and enables all real database tests. Commerce fixtures roll back, notifications
are captured by isolated test providers, and no real bot runs. Only that test
container/network are stopped and removed afterwards; working database/volumes
remain untouched. Stop local API processes first on Windows to free Prisma's DLL.
An alternate test port or Docker executable can be supplied via
`STENZO_PG15_TEST_PORT` / `STENZO_TEST_DOCKER`.

`node scripts/validate-telegram.mjs` calls only `getMe`, using the existing private
environment. It emits validation result, bot ID and username, never token or URL.
It does not start polling or send notifications.

Final preparation checks: frozen install, typecheck, lint, production builds,
Mini App/Admin/API/Bot isolated tests, clean PostgreSQL 15 migrations/integration,
persistent admin session/rate-limit tests, storage tests, and staged secret scan.
Before committing/pushing run `node scripts/check-staged-secrets.mjs` again.
Use `node scripts/check-staged-secrets.mjs --tracked` to include all tracked files.

Verified on 2026-10-01 with Node 24.18.0: frozen install, typecheck, lint and all
production builds passed; Mini App 86 tests, Admin 19, API 97 (including every
enabled PostgreSQL integration), Bot 1 isolated test. All seven migrations applied
to fresh PostgreSQL 15. Local health/readiness/catalog returned 200 directly and
through Next, with eight categories and no products. Telegram `getMe` succeeded.
The disposable container was removed; no deployment or real bot startup occurred.
