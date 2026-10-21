# Stage 0 — technical stabilization

Scope: `stenzo-cloudflare-free` only. No product features, production changes,
remote D1 migrations/imports, bot-menu changes, secret rotation or new Access applications.

## Confirmed cause and fix

Before changes, an actual-Workers Miniflare regression test sent correctly signed
synthetic Telegram initData with `COMMERCE_ENABLED=0`. Expected 200, actual 503.
The Worker commerce gate blocked `/api/auth/telegram` and `/api/me` before routing.
The Mini App converted every bootstrap rejection, including 503/network outages,
to the same invalid-session message.

The Worker now allows the auth module independently of commerce, using only an
independent preview JWT secret and Telegram bot token. Its auth-only Fastify mode
registers health, catalog, Telegram auth and JWT-protected `/me`; payment details,
Admin HMAC settings and other commerce services are not prerequisites. Missing
preview credentials fail closed with 503 and no credential values in responses.

Cart mutations, checkout, orders, payments, proofs and the unconfigured webhook
remain closed. `/me` still requires a verified JWT and active stored User.
The Telegram verifier and 600-second TTL are unchanged: WebAppData HMAC-SHA256,
constant-time hash comparison, timestamp, JSON/profile validation and exact
Telegram ID handling remain in force.
Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

Bootstrap now distinguishes ordinary-browser outside-Telegram, invalid/expired
authentication and temporarily unavailable API states, with RU/UZ messages and
no technical details. It does not auth-loop or create a token outside Telegram;
a temporary `/me` outage preserves the cached token, while 401/403 allows one
reauthentication. Aborted bootstrap cannot store a late token. Storage exceptions
are tolerated. UZ is the default for new users; explicit saved RU/UZ choices and
Telegram RU preferences are preserved. Theme behavior stays light/dark/system.
User `languageCode` is persisted from verified Telegram data, while the existing
UI preference flow remains locally persisted.

## Verification

- Lint and typecheck: all active workspaces passed.
- Full build: database/shared/API/Bot/Mini App/Admin passed; Worker dry-run passed.
- Full test suite: 251 passed, 0 failed; five historical PostgreSQL tests skipped.
- Worker: 23 tests, including 14 new auth/gating cases and a new Admin regression.
- Mini App: 100 tests, including 14 new bootstrap/storage/message tests.
- D1 tests use isolated local databases and explicitly synthetic identities only.
  Repeated logins retain one User, exact Telegram ID and updated language/profile.
- Admin actual-Workers regression at commerce=0 covers Access JWT, Categories,
  Products, opaque session, missing-CSRF rejection, logout and replay rejection.
- The unchanged live preview Admin also passed Access sign-in, Categories, Products
  and logout in the browser. Logout returned the Cloudflare Access login page.
  Only normal preview Admin session creation/revocation occurred; no catalog
  records or production data were changed.
- Local browser on 127.0.0.1:8793 confirmed UZ default, normal outside-Telegram
  message, Home/Catalog/Profile navigation, RU/UZ changes, reload persistence and
  light/dark/system. No production data was imported.

## Live deployment — 2026-10-17

The owner confirmed that Telegram currently opens `cf.stenzo.uz` (domain only;
no initData was requested or inspected). Bot identity/menu ownership cannot be
verified without the dedicated preview bot setup. Production BotFather/menu was
not modified.

At the owner's instruction, the supplied preview bot credential was entered into
Wrangler's masked secret prompt as `TELEGRAM_BOT_TOKEN`. It was not saved in local
files, command arguments or Git. The independent preview JWT/Admin secrets were
retained. No production secret was read or copied.

Checked source commit `99f0086b2d16845b657af93bd48eb4f1eff58079` was deployed to
`stenzo-free-preview`, version `45b31978-642d-4e8e-9430-315f734d4d8e`.
Only the existing `cf.stenzo.uz` and `cf-admin.stenzo.uz` targets were used.
All three D1 migrations were already applied; none were run again.

Live anonymous checks passed:

- Public HTML, `/health`, `/api/health`, `/api/ready` and catalog: 200.
- `/api/me` without JWT: 401; malformed Telegram initData: 401 (previously 503).
- Checkout, orders, payments, proofs and webhook: 503, still disabled.
- Admin shell/API without Access: 302 to the existing Access team login.
- Admin API through the Mini App and workers.dev hosts: 403.
- Ordinary-browser rendering shows the normal outside-Telegram message in UZ.

The owner reopened the Mini App in Telegram and confirmed that an active session
appeared. A read-only aggregate query found one User, one distinct Telegram ID
and one stored language value, without reading personal fields. A valid-token
`/me`, repeat-login idempotency and full Admin session/CSRF/logout behavior are
covered by the local actual-Workers tests above. A fresh authenticated live `/me`
request and post-deployment Admin OTP login were not separately observed.

The empty catalog remains intentional. `COMMERCE_ENABLED=0`; no webhook was
registered, payment configuration enabled, Access application changed, paid plan
purchased, production hostname edited or Turon deployment performed.
