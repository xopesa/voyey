# STENZO Admin

From the repository root, run `pnpm admin:password` in an interactive terminal.
The command asks for the password twice without displaying it and writes only an
Argon2id hash to the ignored local `.env`. Use at least 12 characters. The login
is `odilbek_admin`. Restart the API after setting or changing the hash.
No password is provided by default: web login stays disabled until configured.

Run the API with `pnpm --filter @stenzo/api dev`, and the panel with
`pnpm --filter @stenzo/admin dev`. Open `http://localhost:3002/login`.
`API_URL` is a server-only API base URL. `ADMIN_ORIGIN` must exactly match the
panel origin, including its port, without a trailing slash. In production use
HTTPS for `ADMIN_ORIGIN` and `NODE_ENV=production` for Secure cookies. Serve
the panel on its own host. The browser uses the panel's same-origin proxy.

Sessions are opaque, HttpOnly, SameSite=Strict, expire after 8 hours, and are
revoked on logout. Mutations require the configured Origin and session CSRF
token. Login allows 5 failed attempts per source IP per 15 minutes plus a global
30 attempts/minute ceiling. Forwarded IP headers are intentionally untrusted;
requests through the panel proxy share its source-IP limit.

This stage supports one API process: sessions and throttling are in memory;
API restart invalidates sessions and resets throttling. Use a shared session and
limiter store before running multiple API instances. Catalog changes use the
existing catalog service and audit log, with `adminPrincipal=odilbek_admin`.
Telegram/JWT admin access remains available through its existing guard; web
admin access is restricted to catalog management, orders and payment review. Category and product removal
are not exposed by the existing API; use deactivation.

The Products section supports names/descriptions in RU/UZ, category, status,
integer UZS prices, variants (manual size, optional color, unique SKU, optional
nonnegative stock), and a private optional HTTP(S) `sourceUrl`. Save a new product
as a draft before uploading photos and adding variants, then activate it.
The source link is never imported automatically or included in public Catalog DTOs.

Photos use the existing upload endpoint and StorageProvider. Multiple selected
files upload individually; previews, primary selection, order and deletion use
the existing image API. JPEG/PNG/WebP and the configured `MAX_IMAGE_UPLOAD_SIZE`
limit apply. Set the same upload limit for API and panel proxy. Failed uploads
remain queued for retry; successful files are not uploaded again. Unsaved basic
fields survive image/variant operations and preference changes. Leaving the
editor asks before discarding changes. All data uses the store's PostgreSQL;
catalog changes appear on the next public API request. Order snapshots are untouched.

Run `pnpm --filter @stenzo/admin test` and `pnpm --filter @stenzo/api test`.
For the real database workflow check in PowerShell:
`$env:STENZO_TEST_POSTGRES='1'; pnpm --filter @stenzo/api test tests/product-manager-postgres.test.ts`.
It uses existing categories, a web session with a temporary random test credential,
an always-rolled-back transaction and temporary storage. It never commits test
products or changes schema; the nullable `sourceUrl` migration is separate.

The Orders section lists orders with status/number filters and a submitted-payment
inbox. Details show recipient data and immutable per-item snapshots (including
height/weight). Procurement links come from the current product through admin-only
DTOs. Public Order/Catalog DTOs omit these links.

Status controls use `nextStatus` supplied by the existing backend policy. At
WEIGHING, manually enter integer UZS CARGO and confirm the final-payment request.
Financial amounts come from the API; the browser never calculates or applies
payment balances. Approve/reject requires an explicit confirmation. Approve only
after independently verifying that money arrived on the bank card.

Private proof images stream through the authenticated same-origin proxy, with
`private, no-store`, a MIME allowlist and `nosniff`. The preview uses a temporary
blob URL, revoked when closed. No public storage URL is created. If a mutation or
subsequent refresh fails, further mutations are disabled until a successful refresh,
because a timeout may follow an already committed transaction. Backend idempotency,
status policy and notifications remain authoritative.

Web-admin reviews keep nullable Telegram reviewer FKs empty and record the web
principal in the existing AuditLog. Telegram/JWT reviewers retain their current FKs.
For the isolated real database orders check, set `STENZO_TEST_POSTGRES=1` and run
`pnpm --filter @stenzo/api test tests/orders-manager-postgres.test.ts`.
It always rolls back its fixtures, uses temporary private storage and captures
notification calls in memory without contacting Telegram.
