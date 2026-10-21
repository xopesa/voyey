# Finance V1

Internal Admin management reporting in integer UZS. This stage does not introduce
refunds, cancellation accounting, suppliers, payroll, taxes, FX, bank integrations
or fiscal bookkeeping. All mutations require the existing Admin guard and CSRF.

## Procurement and order economics

Procurement belongs to the historical **OrderItem**, not the current Product.
`procurementUnitCost` is NULL (unknown) or a positive Int32; zero is rejected.
Saving or explicitly clearing it records the Admin principal and timestamp, with
`order_item.procurement_cost_updated` audit metadata containing order/item IDs,
previousCost and newCost. Clearing requires a UI confirmation. Nothing autosaves.
Product edits never propagate into historical costs.

Admin Order Detail loads a separate protected finance DTO, including item IDs,
costs and profitability. The existing customer Order DTO remains an explicit
allowlist and does not expose internal cost fields, expenses, profit or margins.
Telegram templates and customer notifications remain unchanged.

- Goods revenue = Order.total, already after promo discount.
- Customer cargo charged = cargoAmount or zero, a revenue component.
- Procurement = SUM(unit procurement cost × quantity); not stored twice.
- Linked expenses = SUM(non-void Expense.amount for this order), regardless of
  expense date. Global expenses are not allocated to individual orders.
- Revenue = goods revenue + customer cargo.
- Direct cost = procurement + linked expenses.
- Profit = revenue − direct cost, **only** when every item has a known cost and
  the order has at least one item. Otherwise profit and margin are NULL.
- Margin = profit / revenue × 100, if revenue > 0; presentation rounds to 1 decimal.

Negative profit is valid. Row margin is explicitly labelled **before promo code**:
the order-wide discount is not arbitrarily allocated to individual items. Cash
received and outstanding amounts are displayed separately from economic profit.

## Expenses

`/admin/finance/expenses` provides cursor pagination (20 default, 50 maximum),
category/state/date/order filters, explicit create/edit and confirmed void.
Categories: CARGO, PACKAGING, DELIVERY, ADVERTISING, BANK_FEE, OTHER. PROCUREMENT
is deliberately excluded. Positive Int32 UZS only; description is optional,
trimmed and at most 500 characters. An optional order public ID must resolve to
an existing order. No sensitive data should be placed in descriptions.

The UI and API interpret `YYYY-MM-DDTHH:mm` explicitly as Asia/Tashkent (UTC+5),
independently of the browser/system timezone. Storage and returned DTOs use normal
UTC timestamps. Impossible dates and timezone suffixes in this local-time input
are rejected. Date filters use inclusive local start / exclusive following day.

Voiding retains the row, records voidedAt/voidedBy and excludes it from totals.
Repeated void is safe and does not duplicate audit; no delete/unvoid route exists.
Voided rows cannot be edited. UI edits include expectedUpdatedAt; stale edits
return 409, with strictly increasing update timestamps even within a millisecond.
Create/update/void and their audits share the D1 atomic revision guard. Audits
store category/amount/occurredAt/orderId, without copying descriptions.

## Finance dashboard

`/admin/finance`: today, 7/30/90 days, or up to 366 inclusive custom calendar days;
default 30 days. Every boundary and chart bucket uses Asia/Tashkent. Missing days
are zero-filled. Queries use SQL aggregates, with at most 10 table rows and 366
daily buckets, rather than loading all payments/orders into memory.

Cash received sums **APPROVED Payment.expectedAmount** by reviewedAt, falling
back to submittedAt only for legacy reviewedAt=NULL. Submitted/rejected payments
are excluded. Order.paidAmount is never added to this cash aggregate.

For historical FINAL split, existing immutable order accounting is sufficient
only when all checks reconcile: exactly one approved PREPAYMENT and FINAL,
prepayment matches original requiredPrepayment, FINAL equals
`total − requiredPrepayment + cargoAmount`, cargo is assigned and fully paid,
goods are fully paid and remainingAmount is zero. Then FINAL goods cash is
`total − requiredPrepayment`, cargo cash is cargoAmount. This uses the original
goods split, not the now-zero remainingAmount. PREPAYMENT is entirely goods cash.
Phase checks include historical payments outside the selected cash period, but
only payments within the period contribute cash.

If a historical FINAL does not reconcile, total cash remains exact; the dashboard
reports its unallocated amount/count and hides goods/cargo split KPIs as unknown.
No amount or snapshot is fabricated, and legacy Payment rows are not rewritten.
Future accounting features that change immutable order amounts would need their
own payment-component snapshot design.

Expenses use non-void rows by occurredAt. **Cash flow without procurement** is
cash received minus expenses; procurement has no cash-payment date and is not
presented as cash outflow or net profit.

The separate realized block selects status COMPLETED and completedAt in period.
It reports completed/complete/incomplete counts, but includes only cost-complete
orders in revenue, procurement, linked expenses, profit and margin aggregates.
Global expenses remain in the cash/expense block. Expense breakdown uses actual
non-void period records. The operational missing-cost list is current, independent
of period, and limited to 10 orders in the specified post-prepayment statuses.

completedAt is assigned only by the existing successful transition to COMPLETED;
idempotent replay leaves it unchanged. No existing completion audit is duplicated.
Historical completed orders with no timestamp stay NULL and are reported as
undated/excluded from period profitability; no fake backfill occurs.

## Migration, validation and preview

Only `0012_finance.sql` is added. It adds procurement fields, completedAt, Expense,
indexes and Expense revision triggers; migrations 0001–0011 remain unchanged.
No seeds or business-record updates are part of the migration. Existing nullable
finance fields remain NULL. Derived totals use exact safe integers or fail closed
instead of returning rounded financial amounts.

Tests use disposable SQLite/D1, isolated Workers, fixtures and mocks. No live
procurement/expense/order/payment/customer record is created or changed for QA.
After checks, apply only 0012 to `stenzo-free-preview`, deploy preserving all
existing secrets and COMMERCE_ENABLED=1, then perform read-only health/page/API
checks. Turon and the original domains are outside this stage.

The owner performs the first manual Finance check: open an existing order, save
its actual costs, create a real expense, verify its order economics and period
analytics, then optionally edit/void their own expense and inspect history.
Manual live Finance check by Codex: **NOT RUN**.
