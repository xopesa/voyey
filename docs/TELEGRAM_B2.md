# B2 — product channel publishing

This stage adds only Admin product → Telegram channel → Mini App product on the
independent `stenzo-free-preview` Worker/D1. `COMMERCE_ENABLED=0` is unchanged:
cart mutations, checkout, orders, payments and private proofs remain closed.
Turon, original checkout, production domains, DNS, Access policies and plans are
outside this stage.

## Live setup and blockers

The existing preview bot token is reused without rotation. From the repository
root, enter the two new settings only in Wrangler's prompt, never in chat,
source, docs or command arguments:

```powershell
corepack pnpm --filter @stenzo/worker exec wrangler secret put TELEGRAM_CHANNEL_ID
corepack pnpm --filter @stenzo/worker exec wrangler secret put TELEGRAM_SALES_USERNAME
```

The channel accepts a numeric ID or `@username`; the sales setting is a username
without `@`. Actual values never belong in Git. Missing configuration gives a
safe Admin status and does not roll back activation.

Initial read-only bot inspection on 2026-10-17 confirmed the existing preview webhook
and menu target, zero pending updates and no delivery error. However,
`getMe.has_main_web_app` was **false**:

**Configure Main Mini App in BotFather for the preview bot.**

Its URL must be `https://cf.stenzo.uz`. A menu button alone is insufficient for
the Main Mini App `startapp` link. The Bot API flag confirms availability, but
does not reveal its URL; the owner must verify that URL in BotFather. No
BotFather or channel permission setting was changed.

At the initial B2 deployment the channel/sales settings were absent, and the target channel
has not been explicitly confirmed. No live channel post or Telegram deep-link
test is performed. After configuration, explicitly confirm the intended channel
and select one deliberate preview product before posting. The bot must be a
channel administrator with `can_post_messages`. Test one photo post, both
buttons, the exact product, persisted receipt and repeat-publish protection.
This live test is pending; fake Telegram responses are not live delivery proof.

Subsequent live preparation on 2026-10-17 confirmed Main Mini App is enabled,
the existing webhook/menu still target the preview, and there are no pending
updates or delivery errors. Both channel/sales settings were saved through
Wrangler stdin; the mistaken `__` secret was removed. Read-only Telegram checks
confirmed the selected channel is visible and the preview bot has channel
administrator posting permission. No actual configuration values are in Git.
The owner completed Access login, and one deliberate product draft with two
photos and ten active variants was saved through the protected Admin UI.
Publication/activation waited for explicit one-post confirmation, which the owner
subsequently gave. See the live verification below.

## Application contract

`AdminCatalogService` attempts publication after committing DRAFT/INACTIVE →
ACTIVE. An ordinary metadata save does not publish. Repeated activation/manual
publish is idempotent. Telegram failure returns a safe status alongside the
active product rather than rolling back activation or causing a provider 500.

The existing Access assertion, Admin session, Origin and CSRF protection cover
internal API paths `GET /admin/catalog/products/:id/telegram` and
`POST /admin/catalog/products/:id/telegram/publish`. The browser uses its existing
Admin proxy; the Mini App host cannot publish. Manual POST also requires a web
Admin actor, so Bearer-only authentication cannot bypass CSRF.

The publisher checks trusted bot identity, Main Mini App availability, menu
origin when present, channel type and bot posting permission. It never changes
permissions. Metadata calls time out after four seconds; `sendPhoto` after ten.
Only mapped errors reach Admin; no raw provider response, token-bearing URL or
exception is logged or returned.

An eligible product is ACTIVE, has a nonempty Latin UZ name, positive integer
UZS price, an active variant and a managed public product image. Primary image
wins, otherwise first sort order/ID. Only trusted-origin `/media/products/…`
images are allowed, excluding private proofs and arbitrary external URLs.
No Russian name/description fallback is used. Captions have stable unique active
sizes/colors, grouped price plus separately charged kargo and optional UZ
description, without technical IDs, SKU or source URL. Delivery/prepayment claims
come from the authored product description; the formatter does not append fixed
delivery days or a prepayment percentage. Mini App product delivery guidance also
refers to the product description. This does not change checkout/payment rules.
Grapheme-aware truncation caps 1024 UTF-16 units.

`sendPhoto` uses two ordinary URL buttons: `Sotib olish` links to the trusted
bot's Main Mini App with `?startapp=product_<slug>`; `Administratorga yozish` uses
only the trusted sales setting. No channel `web_app` button is used.

Mini App navigation reads Telegram data `start_param`, then SDK field, then
official `tgWebAppStartParam` fallback. Only a bounded valid product slug opens
`/catalog/<slug>` from Home once. Malformed/duplicate parameters are ignored.
It cannot redirect to an arbitrary URL/path. Navigation is public, independent
of auth/locale, and never substitutes for authentication.

## Persistence and retry safety

Additive `0005_telegram_product_posts.sql` creates `TelegramProductPost`; applied
migrations 0001–0004 are unchanged. Unique `(productId, channelChatId)` uses the
canonical ID from Telegram, so channel username/ID aliases share one receipt.
D1 atomic claims, attempt IDs and revision CAS allow one concurrent sender.
PUBLISHED persists `messageId`/`publishedAt` and returns `alreadyPublished=true`
without resending, even after product metadata changes. Explicit rejection
becomes FAILED and allows a safe retry.

Telegram has no application idempotency key for `sendPhoto`. Timeout, lost or
ambiguous response, invalid receipt, or failure to persist after sending leaves
PENDING with delivery unconfirmed. A process crash can also leave PENDING.
**PENDING never expires or retries automatically.** This prevents duplicates at
the cost of manual channel reconciliation. A reconciliation UI/override is
outside B2; do not delete a claim or resend blindly. Exactly-once delivery across
the Telegram/D1 boundary cannot be guaranteed.

Audit events: `telegram.product_publish_started`, `telegram.product_published`,
`telegram.product_publish_failed`. Metadata contains product identity, channel
fingerprint and safe receipt/error fields. No secret or actual channel setting
is logged. The canonical channel ID is stored only in the publication record
where needed.

## Verification — 2026-10-17

Builds, Worker dry-run, lint and typecheck pass. **315 tests pass, zero fail**:
API 122, Mini App 112, Admin 28, Bot 13, Worker 40. Five pre-existing PostgreSQL
tests remain skipped; no new B2 test is skipped.

Workerd/SQLite tests use generated Access keys and fake Telegram responses.
They exercise durable receipts/timestamps, atomic concurrency, repeated saves
and activation, definite-failure retry, uncertain-delivery locks, post-send DB
failure, audits, CSRF and commerce isolation. Caption/photo/button rules, Unicode
limits, active variants, permissions, missing configuration, Main Mini App
checks and safe parameters are tested. No automated test calls a real channel.

Browser verification against local Wrangler/D1 opened an exact local-only
product through the query fallback in both UZ and persisted RU. That fixture was
not copied to remote D1. Cached-session routing is covered by component tests.
B1 bot/Mini App regressions pass; the owner's earlier live language round trip
is historical evidence, not a new B2 live test. No authenticated live Admin
publish click or actual manager/chat destination was verified in B2.

## Live verification — 2026-10-17

After explicit owner confirmation, activation of the selected product sent one
photo post. Remote D1 confirms product ACTIVE, publication PUBLISHED, message ID
220, persisted `publishedAt` and no last error. The public Telegram preview
shows the intended primary photo, UZ-only caption, correct price plus kargo,
five sizes, two colors, preorder and authored delivery terms. Both URL buttons
are present and point to the trusted bot/product parameter and expected manager.

A deliberate deactivate/reactivate cycle preserved the original receipt and
timestamp. D1 still has one publication row; AuditLog has exactly one publish
start and one successful publication event for this product. No second post was
sent, and no existing channel post was edited/deleted. Admin displays Published
and disables ordinary publication. Two product photos and ten active variants
remain in the catalog.

The deployed public Mini App's official query fallback opens the exact product
route and renders its photos, price, variants and description at commerce=0.
Telegram's public landing resolves the Main Mini App URL to the expected
`tg://resolve` product parameter; the manager landing resolves the expected
contact. Telegram Desktop was navigated to the new channel post. Native button
click/capture could not be completed: coordinate geometry is unavailable and
window capture times out. The owner then manually tested both buttons and
confirmed that the exact product opens inside Telegram and the manager button
works. The final native click-through is owner-confirmed; browser verification
is separate evidence, not a substitute for that confirmation.

See [deployment status](DEPLOYMENT_STATUS.md) for remote migration/version and
smoke results. Commerce stays disabled; Turon and production services are untouched.

Official contracts: [Main Mini App](https://core.telegram.org/bots/webapps#launching-the-main-mini-app),
[sendPhoto](https://core.telegram.org/bots/api#sendphoto),
[chat member permissions](https://core.telegram.org/bots/api#getchatmember).
