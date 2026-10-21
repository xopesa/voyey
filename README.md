# STENZO Cloudflare Free

Independent Workers + D1 adaptation of STENZO Wear. No Docker or Containers.
Live preview: https://cf.stenzo.uz. See [deployment status](docs/DEPLOYMENT_STATUS.md)
for the verified Access Admin login, disabled commerce and remaining prerequisites.
The original Desktop/Stenzo checkout and Turon production are separate and are
never deployment targets of this repository.

[Stage 0 stabilization](docs/TECHNICAL_STABILIZATION.md) separates Telegram auth
from disabled commerce. The checked code is deployed to the isolated preview;
the owner confirmed an active session after launching the Mini App in Telegram.
The bot token is stored only as a Worker secret, never in this repository.

[B1 client bot and language sync](docs/TELEGRAM_B1.md) adds a separate D1
`preferredLocale` (UZ by default), bot language selection and authenticated Mini
App preference sync. Its Worker/migration and preview webhook are deployed; the
owner confirmed the live bot → Mini App → bot RU/UZ round trip. Commerce remains disabled.

[B2 channel publishing](docs/TELEGRAM_B2.md) adds idempotent UZ photo posts after
product activation, Admin publication status/retry and safe product deep links.
Live posting remains blocked until Main Mini App and channel settings are ready
and the target channel is explicitly confirmed. No real channel post is made by tests.

The existing Mini App and Admin React interfaces build into static assets. A
Worker runs the Fastify API using Cloudflare's Node HTTP bridge. Commerce uses
D1 atomic batches and durable sessions. Product images and private payment proofs
use separate namespaces in chunked D1 storage. Admin uses Cloudflare Access email
login on its own hostname; no native password module runs in Workers.

Use Node 24 and pnpm 10.17.1:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
corepack pnpm build
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm --filter @stenzo/worker exec wrangler d1 migrations apply DB --local
corepack pnpm --filter @stenzo/worker dev
```

Read [Workers deployment guide](docs/DEPLOY_WORKERS_FREE.md) and
[source provenance](SOURCE_COPY.md). The default configuration is an empty,
commerce-disabled preview. No production data or secret values are included.
Configure a new D1 database and secure Admin integration before deployment.
Actual free-tier CPU consumption must be verified after deployment.

`deploy/turon`, `deploy/cloudflare`, PostgreSQL migrations, Docker files and older
deployment documents are historical references. The old Container workspace is
excluded from the active pnpm workspace. Do not execute its deployment commands.
Do not use PostgreSQL migrations or seed commands for this Worker.
