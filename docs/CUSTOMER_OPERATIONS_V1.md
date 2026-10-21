# Customer Operations V1

V1 customer is an existing Telegram `User`. There is no separate customer table,
guest creation or synthetic Telegram identity. All customer endpoints require the
existing Admin guard; mutations also require CSRF. No customer status editor is
provided.

## Directory and customer card

`/admin/customers` supports literal search by Telegram ID, username, first/last
name and recipient phone from an order. Filters: all, active, blocked, with orders,
without orders. SQL aggregates operate on the bounded user page; cursor ordering
is `createdAt DESC, id DESC`, default limit 20, maximum 50. SQLite `lower()` folds
ASCII; non-ASCII names can be searched using their recorded spelling.

`/admin/customers/:id` displays the identity, latest order recipient, paginated
order history and payment summary. Received payments are summed exclusively from
`APPROVED Payment.expectedAmount`, including separate prepayment/final totals.
`Order.paidAmount` is not added again. Latest recipient data never overwrites User.
Telegram profile links accept validated usernames only.

Notes are Admin-only and append-only, trimmed to 1–2000 characters. The stored
author uses the existing Admin principal architecture, without a web-Admin User
foreign key. `customer.note.created` audit metadata stores user/note IDs, not the
note body. Public/User APIs do not expose notes or Admin session details.

## Manual orders

`/admin/orders/new` searches existing ACTIVE customers. The customer card opens
`/admin/customers/:id/orders/new` with that customer selected and the latest
recipient prefilled in the form only. BLOCKED/DELETED/missing users are rejected
again by the server.

Up to 20 distinct active variants are allowed, with quantity 1–99, height 100–250
cm and weight 30–300 kg. The request contains product/variant IDs and measurements,
not authoritative prices or snapshots. The server reads current products,
variants and images. Preview uses a read-only POST and does not reserve stock or
promo usage; creation revalidates everything.

Manual and Mini App orders share `prepareOrderItems`, `priceD1Order`,
`writeD1Order` and the existing promotion/promo engine. Sale pricing precedes the
promo discount. Prepayment remains `ceil(total / 2)`; cargo is separate. D1 atomic
revision guards cover stock, promo limits, order/items, redemption and audit.
Finite stock and promo usage are shared with concurrent Mini App checkout.

Creation requires `Idempotency-Key`. A replay returns the historical ADMIN order
before current availability checks, without repeating stock/redemption writes.
Cross-source key reuse is rejected. The form retains only the key and uncertain
response flag in session storage, never recipient data or tokens. After an
uncertain response, retry retains that key, including after reload; check the
existing order before starting a separate order.

Manual creation never touches Cart/CartItems, creates Payment, or sends an
order-created Telegram message. `source=ADMIN`, status `AWAITING_PREPAYMENT`.
The normal User Orders API exposes the order to its owner. Existing proof upload,
PREPAYMENT/FINAL review, cargo and lifecycle remain the payment workflow. Mini App
checkout keeps its existing order notification.

## Migration and preview release

Only `0011_customer_notes_and_order_source.sql` is new: CustomerNote, additive
Order.source default MINIAPP, indexes and revision triggers. Migrations 0001–0010
are unchanged. Legacy orders retain MINIAPP as a neutral default. The physical
legacy `Order.subtotal=total` constraint remains intact; `itemsSubtotal` retains
the gross goods subtotal and the existing D1 adapter exposes canonical totals.

Deploy only `stenzo-free-preview`, preserving its existing secrets and
`COMMERCE_ENABLED=1`. The checked-in conservative commerce default remains zero;
preview deployment explicitly overrides it. No seed command or Telegram test
message is part of deployment. Turon and original domains are outside this stage.

## Owner's manual check after deployment

1. Open Customers, search your existing Telegram user and inspect the card,
   latest recipient, payment totals and order history.
2. Add one internal note yourself; verify it stays internal and has its author/date.
3. Open Create order, choose active items and variants, enter measurements and
   recipient details, optionally add a promo code and inspect the server quote.
4. Create the order once. Check ADMIN source, AWAITING_PREPAYMENT, snapshots,
   prepayment and remaining amount. The customer's cart should be unchanged.
5. Refresh that customer's Mini App Orders. Use the normal payment flow manually
   if desired; no automatic payment or new-order Admin message should appear.

Automated checks use disposable SQLite/D1, isolated Workers, local UI fixtures and
mock notification providers only. No live customer, order, note or other business
record was created for verification. Manual live Customer Operations check is NOT RUN.
