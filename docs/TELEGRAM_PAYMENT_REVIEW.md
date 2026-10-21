# B3.2 Telegram payment review

The preview Worker uses the existing bot and active numeric D1 `TelegramAdmin`
allowlist. No schema migration, additional bot, credential, or commerce toggle
is needed. External Cloudflare Access settings are outside this feature.

Payment submission commits first. The notification lazily reads bytes from the
saved private proof and uploads multipart `sendPhoto` to each eligible admin.
The proof has no public URL; public media routing continues to deny it.
Admin captions/buttons follow the linked User's `preferredLocale`, defaulting
to UZ. Customer messages retain the existing durable RU/UZ delivery logic.

The first Approve/Reject button only edits the photo caption to a confirmation.
Only its confirmation calls the same `PaymentService.approve/reject` instance
used by the Admin API. Each callback rereads the active numeric role; confirmed
reviews recheck it immediately before calling the service. The actor is the
sender's real `context.state.user.id`. The existing repository owns accounting,
reviewer references, state transitions and audit. Reject passes a null reason.

Callback data contains only an action and payment ID, is strict ASCII and at
most 59 bytes. Confirmation must also exist in the message's current keyboard.
Telegram callbacks are acknowledged before slow work, without claiming success.
Processed cards show the committed outcome with only an Open Order URL button.
Stale/competing actions reread the result; opposite decisions cannot overwrite
it. Same-decision replays may recover a failed existing customer notification.

Admin dedupe keys remain `payment.submitted:<paymentId>` per recipient:

- `SENT` / `PENDING`: no second upload.
- `FAILED + TELEGRAM_REJECTED`: safe replay may retry the saved image.
- `FAILED + DELIVERY_UNCONFIRMED`: no automatic retry.
- `FAILED + PROOF_UNAVAILABLE`: no Telegram send occurred; safe replay can read
  the private proof again and retry. This uses the existing unconstrained error
  column and does not require a migration.

Photo/storage/receipt failures do not undo Payment, Order or private proof.
No text-only substitute is sent when the image cannot be read.

Automated tests use disposable D1, fixtures and mock Telegram exclusively.
After deployment, the user manually submits a proof, checks its photo/caption,
opens the confirmation, confirms, and checks Admin accounting and the single
customer notification. A separate manual attempt can exercise rejection.
