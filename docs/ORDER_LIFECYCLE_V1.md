# Order lifecycle safety

Cancellation is an authenticated, CSRF-protected Admin action. It requires an enumerated reason and an explicit confirmation. Submitted proofs must be reviewed first; shipped/completed orders cannot be cancelled. Replays preserve the original actor, reason, timestamp, audit rows and refund obligation.

## Inventory and promotions

New checkout and manual orders snapshot `inventoryReservedQuantity`: finite quantity or zero for unlimited inventory. Cancellation aggregates reservations per variant and restores known finite stock once, atomically with the cancellation and promo release. A variant currently unlimited stays unlimited. Missing variants, integer overflow and historical NULL snapshots require manual review; quantities are never guessed. Acknowledging review records an audit and timestamp, and does not write stock. Legacy orders are not backfilled.

Promo redemptions remain historical records. Released redemptions have `releasedAt` and `ORDER_CANCELLED`; global/per-user limits and Admin usage count consider only unreleased records. Cancellation and concurrent checkout use the same D1 revision guard.

## Refunds and finance

APPROVED payments are immutable incoming cash history. Cancellation creates at most one pending full refund, equal to the sum of APPROVED payment amounts, including any paid cargo; submitted/rejected payments do not contribute. No payments means no refund. Totals above the supported signed 32-bit amount limit fail safely before any cancellation mutations.

An administrator transfers money outside STENZO first, then explicitly acknowledges completion with optional reference/note. Completion cannot be undone, deleted or edited and cannot change the amount. This is tracking, not a banking integration. Notifications use durable receipts; ambiguous deliveries are never automatically duplicated.

Finance cash flow (excluding procurement) is gross APPROVED payments minus COMPLETED refunds by completion date minus non-void expenses. Pending refunds are a separate current obligation, not an outgoing cash transaction. Customer summaries show gross payments and refunds separately. Cancelled orders never contribute to completed-order realized profit. This extends the original Finance V1 formula.

## Catalog archive

Products and categories have separate Current/Archive views. Archive is reversible and distinct from temporary deactivation. Product archive atomically sets INACTIVE and clears featured placement while preserving images, variants, order snapshots and publication history. Public lists/direct links, existing-cart checkout, add-to-cart, manual orders, activation and Telegram publication reject archived products. Product/category banner targets resolve to a null link without deleting the banner. Restoring does not activate or republish anything.

A category can be archived only when every remaining product is archived. Current products may instead be moved to another current category. Restore the category first before restoring any contained product; both remain inactive until separately activated. Archive/restore are Admin actions with CSRF, confirmation, duplicate-click protection, transactional race guards and deduplicated audit events. There is no product/category hard-delete action.

## Owner manual check after deployment

Use a dedicated order yourself: cancel an unpaid order with a reason, repeat cancellation and check stock/audit stability; then cancel a paid unshipped order and check the pending refund. Verify the actual external transfer before acknowledging completion. Check customer RU/UZ messages and the separate Finance refund totals. Review legacy inventory manually before marking it reviewed. Codex does not perform these operations on live data.

No secret values, payment credentials or customer data belong in Git. Automated coverage uses disposable databases and mocked Telegram delivery exclusively.
