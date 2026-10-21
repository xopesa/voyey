# B3.1 Telegram administration and notification foundation

This implementation targets only `stenzo-free-preview`. Commerce remains disabled.
It does not change Turon, the original repository, the production domains, Access
policies, the bot token or the existing channel publication.

## Access

`/admin/telegram` manages a D1 `TelegramAdmin` allowlist through the existing
Cloudflare Access boundary, web-admin session, exact Origin and CSRF checks.
Management endpoints also reject legacy bearer-only authentication. No public
endpoint can grant a Telegram role. Telegram IDs are canonical positive decimal
strings bounded by JavaScript's maximum safe integer; usernames grant nothing.
Unlinked IDs do not create placeholder Users. Only soft disable is supported so
audit history and notification receipts remain intact. Disabling requires a UI
confirmation. Creates, updates, enabling and disabling are audited atomically.
`createdBy` uses the existing hashed Access principal, not an email/JWT/secret.

The private bot checks the current D1 row using `context.from.id` on every
`/admin` command and `admin:*` callback. Disabled/unknown senders get no admin
information; failed role reads deny access. The menu contains only the protected
Web Admin URL and notification status. Access login remains necessary to open
Web Admin. Existing `/start`, `/language`, `/til` and Mini App behavior is retained.

Legacy Node/API code may still use `ADMIN_TELEGRAM_IDS`; the Cloudflare bot and
admin notification recipients use D1 instead, including when the Worker app is
cached. User linkage and role lists are read on each action/event.

## Notifications

Existing checkout `orderCreated` and payment `paymentSubmitted` call paths remain.
Recipients are active allowlist rows with the corresponding notification flag.
The delivery claim rechecks eligibility atomically. An already in-flight Telegram
request cannot be recalled by subsequently disabling a recipient.

Customer messages use `User.preferredLocale` (`ru` or `uz`, default `uz`), never
Telegram `languageCode`. Admin messages use the linked User preference, otherwise
Uzbek. B2 channel posts remain Uzbek. Admin order/payment notifications include
text and a single HTTPS Web Admin order link. No proof images, payment decision
callbacks or order mutations are added in Telegram.

Migration `0006_telegram_admins.sql` adds the allowlist, delivery table, uniqueness
constraints and revision triggers without changing earlier migrations or data.
`TelegramNotificationDelivery` has a unique `(eventKey, telegramId)`:

- `order.created:<order.id>`
- `payment.submitted:<payment.id>`

An atomic PENDING claim is stored before sending. A confirmed response stores
SENT, `telegramMessageId` and `sentAt`. A definite Telegram rejection stores FAILED
with `TELEGRAM_REJECTED`, which permits a later invocation to retry. Ambiguous
network/timeouts/server errors/malformed receipts store FAILED with
`DELIVERY_UNCONFIRMED`, which **does not permit automatic retry**. A failed receipt
write leaves PENDING locked. This avoids duplicate sends after a possible Telegram
acceptance; it cannot promise exactly-once delivery across Telegram and D1.
Manual reconciliation of uncertain receipts is deferred; there is no resend UI.

No background retry scheduler is introduced. Retryable failures need the same
notification event to be invoked again. Customer notifications retain their
existing best-effort behavior and are independent of the admin allowlist.

Provider calls have a timeout and return a validated message receipt. Logs and
delivery records contain fixed error codes, never raw provider text or token URLs.
Recipient lookup, claim, provider, persistence and logger failures are contained.
Additional domain guards prevent a thrown notification from failing a committed
checkout or deleting a committed payment proof.

## Verification and rollout

Run pinned pnpm lint, typecheck, API/Bot/Admin/Mini App tests, Worker integration
tests and the complete suite. Worker tests use the compiled bundle, so build it
first. Tests use synthetic identities and local databases/Telegram stubs; no live
checkout or payment is needed. Apply the additive migration locally before the
preview D1 migration, then deploy only the preview Worker.

Verify health, webhook authentication, Access isolation, commerce gates and the
existing B2 publication receipt without publishing another channel message.
The live test is limited to adding explicitly selected IDs through Web Admin,
testing `/admin`, disabling, checking denial, then enabling and checking access.
No live orders/payments, no commerce enablement, and no B3.2 features are included.
