# Deployment status — 2026-10-17

## Deployed isolated preview

- Mini App/API: https://cf.stenzo.uz
- Admin shell: https://cf-admin.stenzo.uz/admin/
- Worker fallback: https://stenzo-free-preview.odilbek8555.workers.dev
- Worker: `stenzo-free-preview`, version `1a78b376-8a59-44c3-ba18-068bc5c2293f`
  (B2 channel publisher, retaining B1 language preferences/client bot).
- Cloudflare account: `21451653d8243b3dcfab6c23b8f9cc04`.
- New D1 database: `stenzo-free-preview`, ID `ed46a2ff-cff3-4b00-9853-d2438a57e806`.
  All five migrations, including additive `0005_telegram_product_posts.sql`, applied
  to this independent database only. No production
  rows, users, orders, images or proofs were copied. Catalog starts empty.
- Only `cf.stenzo.uz` and `cf-admin.stenzo.uz` were added as Worker Custom Domains.
  Both names were absent from public DNS and the Cloudflare zone before creation.
  The zone already used Cloudflare nameservers; nameservers were not changed.
- Pre-existing DNS discrepancy: before attaching the preview hosts, the dashboard
  showed only the existing `test-api` Worker record, with no apex/www/api/admin
  records. Read-only public DNS recheck found no A answer for the apex (SOA only)
  and no answer for www/api/admin. This task did not restore or modify those
  protected records. Any production DNS repair needs a separate deliberate action
  with verified Turon origin details; never guess an origin IP.
- Existing `test-api.stenzo.uz` / `quiet-sun-ae8c` Worker was left untouched.
- Original `Desktop/Stenzo` stayed at `4ec48c1` with its pre-existing local changes.
  Turon, original database/bot and existing production hostname records were not edited.

## Verification

- Cloudflare Workers plans page confirmed Free as the current plan; no upgrade made.
- HTTPS validation passed for both new hosts.
- UI, `/health`, `/api/health`, `/api/ready` and empty catalog returned 200.
- Commerce returns 503 while `COMMERCE_ENABLED=0`.
- Without an Access session, Admin and its API redirect to the existing Access
  login (302). Mini App/workers.dev requests to Admin APIs are denied (403).
- Real email OTP login completed manually by the owner. The Admin sign-in button
  successfully bootstrapped an identity-bound web session and loaded Categories.
  One session was confirmed with a read-only D1 COUNT query; no session tokens,
  cookie values, JWTs or hashes were read. The UI showed the expected empty category
  list, confirming authenticated session and catalog API operation.
- The real signed Access assertion passed signature, issuer, audience, expiry and
  exact email checks before the API session could be issued.
- Private proof paths return 404 publicly.
- Browser render confirmed the original STENZO interface and expected empty states.
- API/Bot/Mini App/Admin builds and Worker dry-run passed; lint/typechecks passed.
- 315 tests passed, zero failed; five historical PostgreSQL-only tests skipped.
- Worker typecheck, dry-run build and all 40 SQLite/Workers tests passed for B2.
  These cover bot/Mini App language sync, auth with commerce disabled, User upsert,
  atomic rollback, concurrent idempotency,
  finance transitions, D1 parameter limits, private media, Access JWT validation,
  identity-bound sessions, CSRF and replay resistance.
- Staged source secret-pattern scan passed before the first push.
- Latest B2 upload reported Worker startup 56 ms. This is module startup time, not per-request
  CPU usage. Full commerce/free-tier CPU under real traffic has not been established.

## B2 channel publishing — deployed, live post blocked

Additive migration 0005 was applied only to `stenzo-free-preview`; a subsequent
remote migration check found nothing pending. Read-only aggregates after deploy
showed zero products, zero Telegram publication records, two users and two
distinct Telegram user IDs. No fake remote fixtures or channel posts were made.

The publisher, activation integration, Admin status/retry, safe product launch
parameters, receipt persistence and concurrency protection are implemented.
Automated Workerd tests exercise fake Telegram responses and real isolated D1.
Their successful message IDs/timestamps are test receipts, not live receipts.
Local browser checks opened an exact local-only product in UZ and persisted RU.

After this deployment, public UI, health, API health, D1 readiness and catalog
returned 200. Anonymous Admin shell/API returned Access 302; browser navigation
displayed the existing Access login. Mini App/workers.dev Admin APIs returned 403. Invalid Telegram auth returned 401, webhook without its secret returned
403, and cart/checkout/orders/payments/proofs remained 503. No new authenticated
live Admin session was established in B2; session/CSRF regression is tested in
Workerd. Existing Access settings were not changed.

At initial B2 deployment, `TELEGRAM_CHANNEL_ID` and `TELEGRAM_SALES_USERNAME` were not configured. Read-only
inspection also found `getMe.has_main_web_app=false`, despite the existing menu
pointing to the preview. **Configure Main Mini App in BotFather for the preview
bot.** It must use `https://cf.stenzo.uz`; BotFather was not modified. The owner
must enter the channel/sales settings through Wrangler prompts and explicitly
confirm the target before one deliberate live product post. See
[B2 setup, safety and verification](TELEGRAM_B2.md). No actual channel setting
values are stored in source or documentation. Commerce remains disabled.

### Subsequent live preparation

Both channel/sales settings are now configured as Worker secrets. The mistaken
`__` secret was removed. A read-only Telegram check verified the preview bot's
identity, enabled Main Mini App, correct preview menu/webhook, zero pending
updates and no delivery error. The selected channel is visible, and the bot is
an administrator with posting permission. No permissions were changed and no
actual channel/sales values were committed or logged.

The owner completed Access login again. One selected product was saved as DRAFT
through the real Admin session/CSRF flow, with two uploaded photos and ten active
variants. No activation or channel post has been performed. The caption preserves
authored delivery terms instead of adding a fixed delivery time/prepayment claim;
price remains the product's integer UZS value, with kargo charged separately.
Mini App product delivery guidance refers to the description. Existing checkout,
payment calculations and `COMMERCE_ENABLED=0` are unchanged.

### Confirmed live publication

After the owner's explicit one-post approval, the selected product was activated
through Admin and published once. D1 contains one PUBLISHED receipt with message
ID 220 and a persisted publication timestamp. The public Telegram post displays
the correct primary photo, UZ caption, integer UZS price plus kargo, sizes/colors
and authored delivery terms. Both URL button destinations were verified.

A deactivate/reactivate duplicate check left one receipt, the same message ID
and timestamp, and exactly one publish-start/success audit pair. The product is
ACTIVE. No existing channel posts were edited or removed. The official query
fallback opens the exact live Mini App product, with both catalog photos and all
ten variants. The manager's public Telegram landing is correct.

The owner manually tested the new post and confirmed both buttons work,
including opening the exact product inside Telegram and the expected manager.
Desktop accessibility reached the channel/post, but automated native clicks
could not be completed because pointer geometry is unavailable and capture
times out. The owner confirmation establishes the final native app launch;
browser tests and the durable publication receipt are independent evidence.

## Admin Access: configured and verified

Owner approved Access email login for `admin@example.invalid`.
The owner completed enrollment personally; the Access applications UI is available.
No billing values were read or entered by this task.

After explicit approval, the following were created:

- One-time PIN email identity provider.
- Self-hosted app `STENZO Preview Admin`, ID
  `0681e053-bac6-4d36-84aa-57c8b1e183d3`, protecting only the entire
  `cf-admin.stenzo.uz` hostname, with a six-hour Access session.
- Allow policy `STENZO Preview owner only`, ID
  `69e5e93e-fbf4-447c-8a5d-98471fb7dc6a`, with one exact email include rule:
  `admin@example.invalid`. No Everyone/Bypass rule. Only One-time PIN is selected
  for this application's login; other identity providers are not enabled for it.
- Independent `JWT_SECRET` and `ADMIN_PROXY_SECRET` on the preview Worker, generated
  securely and supplied through Wrangler stdin. Values were never logged, stored
  in local files, committed or copied from production. No existing keys were rotated.

The owner manually supplied the existing application's public identifiers:

- Issuer: `https://cool-bush-5c50.cloudflareaccess.com`.
- Audience: `b8e4a1545e95be70497d182d85814439456c09534a20f36dd20c99dad70fffc0`.

These are non-secret identity configuration values, not credentials. They were
added to Wrangler vars, retaining the approved email allowlist and existing
independent preview secrets. No application/policy was created or changed in
this deployment. No dashboard permission gate was bypassed; the supplied values
were used directly. The owner received the OTP and completed browser login, then
the Admin API issued its opaque session and loaded Categories successfully.

Wrong-email, wrong-issuer, wrong-audience, expired and forged assertions are
rejected in the actual-Workers integration test using generated synthetic keys.
A real unauthorized third-party mailbox/account was not used for live sign-in;
that is the limit of the negative-email verification. The existing exact-email
Access policy was preserved. Session expiry/logout/replay are covered by local
integration tests, not repeated against the owner's live browser session here.
The workers.dev/Mini host cannot bypass the Admin origin + signed Access checks.
No DNS, nameservers, provider configurations or plans were changed in this step.
All three existing D1 migrations were already applied; no migration was run again.

## Commerce blocker

A preview Telegram bot token is now stored as a Worker secret; the owner confirmed
an active session from Telegram after Stage 0 deployment. Read-only D1 aggregates
confirmed one User with a stored language. Live anonymous `/api/me` and invalid
Telegram input return 401; health/catalog return 200. See
[technical stabilization](TECHNICAL_STABILIZATION.md) for test scope and limits.

The B1 client bot now runs independently of commerce. The supplied preview webhook
secret was stored via a masked prompt; the previous overly strict length check
was corrected to Telegram's documented format. The current preview bot webhook
was registered at `https://cf.stenzo.uz/telegram/webhook` with pending updates
preserved. Telegram confirmed the exact target, zero pending updates and no
delivery error. Requests without the secret now return 403. The owner confirmed
the complete bot → Mini App → bot language round trip, including reopening UZ.

Separate preview payment instructions/configuration are still required for
commerce. Production bot/webhook/payment values were not read or copied. Keep
commerce disabled until separately configured and tested. Never commit secrets.
See [B1 setup and verification](TELEGRAM_B1.md). Migration aggregates found two
distinct Users, both defaulted to UZ. No remote fake data was added.

Private source repository: https://github.com/xopesa/stenzo-cloudflare-free
Local source: `C:/Users/USER/Desktop/STNZ/stenzo-cloudflare-free`.

Rollback changes only this new Worker's deployment; it does not deploy or restore
anything to Turon or alter existing STENZO hostname records.
