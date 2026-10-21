# B1 — client Telegram bot and shared language

Only the isolated Workers + D1 preview is affected. Commerce remains disabled.
No Admin Bot, posting, promotions, SKU or payment functionality was added.

## Language contract

- `User.preferredLocale`: `uz` or `ru`, default `uz`; D1 is authoritative after
  authentication. Telegram `languageCode` remains profile metadata and never
  chooses the bot/Mini App interface language.
- Sequential D1 migration `0004_user_preferred_locale.sql` adds the non-null
  column and a CHECK constraint. Previously applied migrations are unchanged.
- Prisma types and the generated D1 runtime schema include the new field. To
  refresh runtime metadata, use `node scripts/prepare-d1.mjs --schema-only`;
  do not regenerate/rewrite `0001_initial.sql` on an existing database.
- Bot `/start` upserts the sender's Telegram profile, preserving the preferred
  locale. `/language`, `/til` and the language button offer Uzbek Latin/Russian.
  Callbacks derive the User only from the Telegram update sender. Group and
  blocked-user updates cannot change personal preferences.
- `GET /api/me` and Telegram auth return `user.preferredLocale`.
- `PATCH /api/me/preferences`, JSON `{ "locale": "uz" }` or `{ "locale": "ru" }`,
  requires the existing Bearer JWT. Unknown values/extra fields return 400;
  missing/invalid JWT returns 401 and blocked accounts return 403. No target
  User ID is accepted from the body.
- Successful Mini App bootstrap applies the server locale over local choices.
  Profile switches update UI immediately and serialize authenticated PATCHes.
  Failed saves roll back to the last confirmed server locale with a localized
  error. Outside Telegram the switch remains local and makes no API request.
  Theme preferences retain their existing behavior.

## Webhook and secure manual setup

`POST https://cf.stenzo.uz/telegram/webhook` no longer depends on commerce. It
requires the preview bot token, a valid HTTPS preview `PUBLIC_ORIGIN`, and a
separate 1–256 character webhook secret (`A-Z`, `a-z`, `0-9`, `_`, `-`), matching
Telegram's `secret_token` format. Prefer a long, unpredictable value.
The secret header is compared using byte lengths and `timingSafeEqual` before
parsing updates or calling Telegram. Wrong/missing secrets return 403 when
configured; missing configuration returns 503. Malformed authorized JSON returns 400. Handlers run inside the same request-local D1 context as auth/preferences.

The first B1 check incorrectly imposed a 32-character minimum, rejecting an
otherwise Telegram-compatible credential. A regression test reproduced the
failure using a newly generated synthetic credential shorter than 32; the Worker
and registration helper now accept Telegram's documented 1–256 character format.
Timing-safe comparison and the allowed character set are unchanged. Empty,
overlong and invalid-character credentials are rejected. No real secret values
appear in source, tests, docs, command arguments or Git.

The owner authorized storing the supplied preview webhook secret and registering
the current preview bot. This was completed through masked TTY prompts. The
following commands remain available for deliberate future setup:

```powershell
corepack pnpm --filter @stenzo/worker exec wrangler secret put TELEGRAM_WEBHOOK_SECRET
node scripts/register-preview-webhook.mjs PREVIEW_BOT_USERNAME
```

Replace `PREVIEW_BOT_USERNAME` with the dedicated preview bot's public username.
Wrangler prompts for the separate secret. The registration script prompts for
the preview bot token and the **same** webhook secret with input hidden; neither
value is passed as a command argument, saved to files or printed. Keep values in
your password manager, never in chat or Git. Do not enter production credentials.

The script verifies the expected bot username, refuses an existing non-preview
webhook or non-preview Web App menu, and probes the deployed secret with an update
without a sender/message (no User or chat message is created). Only then does it
register the fixed preview URL, `message` + `callback_query`, one connection and
`drop_pending_updates=false`. It never changes the bot menu or BotFather settings.
Reference: [Telegram setWebhook](https://core.telegram.org/bots/api#setwebhook).

The registered bot is `@stenzowear_bot`, whose existing Web App menu points to
`cf.stenzo.uz`. Registration used only `https://cf.stenzo.uz/telegram/webhook`,
preserved pending updates and did not change the menu. The prior pending update
was delivered; a read-only Telegram check then showed zero pending updates and no
delivery error. A correctly authenticated no-message probe returned 200 without
creating a User; requests without the header now return 403 instead of 503.

The historical Node bot entry point retains a Prisma-backed adapter for source
consistency; it is not started or deployed here. Workers inject the shared
D1-backed UserService. No PostgreSQL migration or Node polling process is used.

## Verification — 2026-10-17

- Lint, typecheck, full API/Bot/Mini App/Admin build and Worker dry-run passed.
- 276 tests passed, zero failed; five historical PostgreSQL tests skipped.
  API 102, Bot 13, Mini App 107, Admin 24, Worker 30.
- Actual Workerd + isolated D1 tests exercise webhook auth at commerce=0,
  bot-first User creation, idempotent starts, metadata/preference separation,
  bot-to-auth/`me` and PATCH-to-bot sync, strict JWT/body validation and isolation
  from another User. Migration tests cover existing RU-metadata users receiving
  UZ and database rejection of invalid/null locales.
- Mini App tests exercise the actual Bootstrap/Provider/API-client wiring,
  outside-Telegram behavior, rapid switches, retry/rollback and theme preservation.
  A stale authenticated context without Telegram initData still changes language
  locally without calling preferences API. All five existing isolated browser
  fixtures were updated for provider order/API mocks and verified to bundle/start;
  the cart fixture's RU switch also passed a browser regression check.
- Existing actual-Workers Admin tests passed (Access JWT, Categories, Products,
  session, CSRF, logout/replay). No Admin UI changes were necessary.
- Migration `0004` applied only to `stenzo-free-preview`
  (`ed46a2ff-cff3-4b00-9853-d2438a57e806`). Read-only aggregates then showed two
  Users, two distinct Telegram IDs and two UZ preferences; no personal fields
  were inspected and no synthetic remote Users were inserted.
- Worker version `c008cfff-cefc-447b-af67-95e1f454fcd6` deployed only to the
  existing preview hosts. Health/readiness/catalog/public HTML return 200;
  unauthenticated `me` and invalid Telegram auth return 401. Cart/checkout/orders/
  payments/proofs remain 503. Configured webhook rejects missing secrets with 403.
- Live anonymous Admin requests still redirect to the existing Access login;
  Mini App/workers.dev Admin API attempts remain 403. A fresh live Admin OTP
  login was not repeated for B1; authenticated behavior is integration-tested.
- Live browser confirmed outside-Telegram language switching, reload persistence
  and dark/system themes, restoring UZ/system after the test.

## Confirmed live round trip

The owner personally confirmed every transition in the real preview bot:
`/start` (UZ), choose Russian, open Mini App (RU), choose UZ in Profile, return to
`/start` (UZ), reopen Mini App (UZ). This is owner-observed UI evidence; desktop
automation could not capture the Telegram window and Telegram Web required a new
login, which was not performed. No signed initData, session token or secret was
requested for the live test. Aggregate D1 checks verify distinct Telegram IDs
without reading personal fields or inserting synthetic remote Users.
After the owner's live test, D1 still contained two Users and two distinct
Telegram IDs, with one UZ and one RU preference: no duplicate User was created.

Turon, original repository, production hostnames/bot/database, Access application
and policies, DNS and Cloudflare plans were not changed in B1. Reverting the app
does not require deleting the additive preference column or any User records.
