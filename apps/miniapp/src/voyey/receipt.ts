import { DemoError, type DemoOrder, type DemoConfirmedPayment } from "./domain";
import type { Locale, Translator, UiKey } from "./messages";
export type ReceiptKind = "FIRST" | "SETTLEMENT";
export type ReceiptData = {
  orderId: string;
  kind: ReceiptKind;
  saleMode: DemoOrder["saleMode"];
  confirmedAt: number;
  status: "receiptPaid" | "receiptPrepaid" | "receiptSettled";
  lines: DemoOrder["lines"];
  subtotal: number;
  discount: number;
  goodsTotal: number;
  promoCode: string | null;
  payments: DemoConfirmedPayment[];
  paidAmount: number;
  remaining: number;
  cargo: number | null;
  total: number | null;
};
const money = (v: number) => Number.isSafeInteger(v) && v >= 0;
function firstPayment(order: DemoOrder) {
  const first = (order.payments ?? []).filter((p) => p.phase === "FIRST"),
    claim = order.claims.find((c) => c.status === "APPROVED");
  if (
    first.length !== 1 ||
    !claim ||
    order.claims.filter((c) => c.status === "APPROVED").length !== 1 ||
    ![50, 100].includes(order.percent) ||
    (order.saleMode === "IN_STOCK" && order.percent !== 100)
  )
    return null;
  const p = first[0]!;
  const subtotal = order.lines.reduce(
    (n, r) => n + r.unitPrice * r.quantity,
    0,
  );
  if (
    !order.lines.length ||
    order.lines.some(
      (r) =>
        !Number.isInteger(r.quantity) ||
        r.quantity < 1 ||
        r.quantity > 99 ||
        !money(r.unitPrice) ||
        r.unitPrice === 0,
    ) ||
    !money(subtotal) ||
    subtotal !== order.subtotal ||
    !money(order.discount) ||
    order.discount >= subtotal ||
    order.discount > Number((BigInt(subtotal) * 99n) / 100n) ||
    order.goodsTotal !== subtotal - order.discount ||
    !money(order.goodsTotal) ||
    !money(p.amount) ||
    p.amount <= 0 ||
    p.amount !== order.firstAmount ||
    p.id !== claim.key ||
    claim.amount !== p.amount ||
    claim.decisionAt !== p.confirmedAt ||
    p.submittedAt !== claim.submittedAt ||
    !money(p.confirmedAt) ||
    !money(p.submittedAt) ||
    !money(order.createdAt) ||
    p.confirmedAt < p.submittedAt ||
    p.submittedAt < order.createdAt
  )
    return null;
  const expected =
    order.saleMode === "IN_STOCK" || order.percent === 100
      ? order.goodsTotal
      : Math.ceil(order.goodsTotal / 2);
  return p.amount === expected &&
    order.remaining === order.goodsTotal - p.amount
    ? p
    : null;
}
// Reconstruct from immutable checkout and confirmed-payment snapshots only.
// FIRST remains a historical document even after a later arrival/FINAL.
export function receiptFor(
  order: DemoOrder,
  kind: ReceiptKind = "FIRST",
): ReceiptData | null {
  const first = firstPayment(order);
  if (!first) return null;
  let payments = [first],
    cargo: number | null = order.saleMode === "PREORDER" ? null : 0,
    total: number | null =
      order.saleMode === "PREORDER" ? null : order.goodsTotal,
    confirmedAt = first.confirmedAt,
    remaining = order.goodsTotal - first.amount;
  if (kind === "SETTLEMENT") {
    const s = order.settlement;
    if (
      order.saleMode !== "PREORDER" ||
      !s ||
      s.completedAt === null ||
      !money(s.cargo) ||
      !money(s.completedAt) ||
      !money(s.arrivedAt) ||
      s.completedAt < s.arrivedAt ||
      s.arrivedAt < first.confirmedAt
    )
      return null;
    cargo = s.cargo;
    total = order.goodsTotal + cargo;
    if (!money(total)) return null;
    payments = order.payments ?? [];
    const finals = payments.filter((p) => p.phase === "FINAL"),
      balance = total - first.amount;
    if (
      balance < 0 ||
      (balance === 0
        ? finals.length !== 0
        : finals.length !== 1 ||
          finals[0]!.amount !== balance ||
          finals[0]!.confirmedAt !== s.completedAt ||
          finals[0]!.submittedAt < s.arrivedAt)
    )
      return null;
    if (
      payments.some(
        (p) =>
          !money(p.amount) ||
          p.amount <= 0 ||
          !money(p.confirmedAt) ||
          !money(p.submittedAt) ||
          p.confirmedAt < p.submittedAt,
      ) ||
      payments.reduce((n, p) => n + p.amount, 0) !== total
    )
      return null;
    remaining = 0;
    confirmedAt = s.completedAt;
  }
  return {
    orderId: order.id,
    kind,
    saleMode: order.saleMode,
    confirmedAt,
    status:
      kind === "SETTLEMENT"
        ? "receiptSettled"
        : order.saleMode === "IN_STOCK"
          ? "receiptPaid"
          : "receiptPrepaid",
    lines: order.lines.map((l) => ({ ...l, attributes: { ...l.attributes } })),
    subtotal: order.subtotal,
    discount: order.discount,
    goodsTotal: order.goodsTotal,
    promoCode: order.promoCode,
    payments: payments.map((p) => ({ ...p })),
    paidAmount: payments.reduce((n, p) => n + p.amount, 0),
    remaining,
    cargo,
    total,
  };
}
// Explicit local simulator only. No server ledger, stock or FIRST rules change.
export function recordDemoArrival(
  order: DemoOrder,
  cargo: number,
  now: number,
): DemoOrder {
  const first = firstPayment(order);
  if (
    !money(now) ||
    order.saleMode !== "PREORDER" ||
    !first ||
    !money(cargo) ||
    !money(order.goodsTotal + cargo) ||
    now < first.confirmedAt
  )
    throw new DemoError("settlement");
  if (order.settlement) {
    if (order.settlement.cargo === cargo) return order;
    throw new DemoError("settlement");
  }
  return { ...order, settlement: { cargo, arrivedAt: now, completedAt: null } };
}
export function confirmDemoFinal(order: DemoOrder, now: number): DemoOrder {
  const first = firstPayment(order),
    s = order.settlement;
  if (!first || !s || !money(now) || now < s.arrivedAt || !money(s.cargo))
    throw new DemoError("settlement");
  if (s.completedAt !== null) return order;
  const balance = order.goodsTotal + s.cargo - first.amount;
  if (
    !money(balance) ||
    (order.payments ?? []).some((p) => p.phase === "FINAL")
  )
    throw new DemoError("settlement");
  return {
    ...order,
    payments:
      balance === 0
        ? order.payments
        : [
            ...(order.payments ?? []),
            {
              id: `${order.id}:DEMO-FINAL`,
              phase: "FINAL",
              amount: balance,
              submittedAt: now,
              confirmedAt: now,
            },
          ],
    settlement: { ...s, completedAt: now },
  };
}
export function receiptDate(value: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "uz-UZ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  }).format(value);
}
export function receiptMoney(amount: number, locale: Locale, t: Translator) {
  return `${new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "uz-UZ").format(amount)} ${t("unit")}`;
}
export type ReceiptAmountRow = {
  id: string;
  label: string;
  amount?: number;
  text?: string;
  negative?: boolean;
  strong?: boolean;
};
export function receiptAmounts(
  r: ReceiptData,
  t: Translator,
): ReceiptAmountRow[] {
  const rows: ReceiptAmountRow[] = [
    { id: "subtotal", label: t("receiptSubtotal"), amount: r.subtotal },
  ];
  if (r.promoCode)
    rows.push({ id: "code", label: t("promo"), text: r.promoCode });
  rows.push(
    {
      id: "discount",
      label: t("discount"),
      amount: r.discount,
      negative: r.discount > 0,
    },
    {
      id: "goods",
      label: t("receiptNetGoods"),
      amount: r.goodsTotal,
      strong: true,
    },
  );
  if (r.saleMode === "PREORDER")
    rows.push({
      id: "cargo",
      label: t("cargo"),
      ...(r.cargo === null ? { text: t("cargoLater") } : { amount: r.cargo }),
    });
  if (r.kind === "SETTLEMENT") {
    rows.push({
      id: "total",
      label: t("receiptGrandTotal"),
      amount: r.total!,
      strong: true,
    });
    for (const p of r.payments)
      rows.push({
        id: p.id,
        label: t(
          p.phase === "FIRST" ? "receiptFirstPayment" : "receiptFinalPayment",
        ),
        amount: p.amount,
      });
  }
  rows.push(
    {
      id: "paid",
      label: t("receiptConfirmedAmount"),
      amount: r.paidAmount,
      strong: true,
    },
    {
      id: "remaining",
      label: t(
        r.kind === "FIRST" && r.saleMode === "PREORDER"
          ? "remainder"
          : "receiptOutstanding",
      ),
      amount: r.remaining,
    },
  );
  return rows;
}
export const receiptTitle = (kind: ReceiptKind): UiKey =>
  kind === "FIRST" ? "receiptConfirmation" : "receiptFinalTitle";
