import { isCheckoutOrder, type CheckoutOrder } from "./checkout";

export const orderStatuses = [
  "AWAITING_PREPAYMENT",
  "PREPAYMENT_SUBMITTED",
  "AWAITING_PURCHASE",
  "PURCHASED",
  "IN_TRANSIT",
  "ARRIVED",
  "WEIGHING",
  "AWAITING_FINAL_PAYMENT",
  "FINAL_PAYMENT_SUBMITTED",
  "PAID_FULL",
  "READY_TO_SHIP",
  "SHIPPED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof orderStatuses)[number];
export type PaymentPhase = "PREPAYMENT" | "FINAL";
export type PaymentStatus = "SUBMITTED" | "APPROVED" | "REJECTED";
export interface PaymentAttempt {
  id: string;
  orderPublicId: string;
  type: PaymentPhase;
  status: PaymentStatus;
  expectedAmount: number;
  rejectionReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
}
export interface PaymentOrder extends CheckoutOrder {
  estimatedWarehouseArrival?: string | null;
  paymentConfirmations?: { prepayment: string | null; final: string | null };
  status: OrderStatus;
  createdAt: string;
  paidAmount: number;
  cargoAmount: number | null;
  cargoPaidAmount: number;
  items: Array<CheckoutOrder["items"][number] & { imageUrl: string | null }>;
  payment: {
    phase: PaymentPhase | null;
    amountDue: number;
    latestStatus: PaymentStatus | null;
  };
}
export interface PaymentInstructions {
  orderPublicId: string;
  phase: PaymentPhase | null;
  amount: number;
  canSubmit: boolean;
  latestPaymentStatus: PaymentStatus | null;
  latestPayment: PaymentAttempt | null;
  maxProofUploadSize: number;
  currency: "UZS";
  cardNumber: string;
  cardHolder: string;
  instructionsRu: string;
  instructionsUz: string;
}
export interface PaymentData {
  order: PaymentOrder;
  instructions: PaymentInstructions;
}
type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue =>
  typeof v === "object" && v !== null;
const money = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const date = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const phase = (v: unknown): v is PaymentPhase | null =>
  v === null || v === "PREPAYMENT" || v === "FINAL";
const status = (v: unknown): v is PaymentStatus | null =>
  v === null || v === "SUBMITTED" || v === "APPROVED" || v === "REJECTED";
export function isPaymentAttempt(v: unknown): v is PaymentAttempt {
  return (
    record(v) &&
    typeof v.id === "string" &&
    !!v.id &&
    typeof v.orderPublicId === "string" &&
    phase(v.type) &&
    v.type !== null &&
    status(v.status) &&
    v.status !== null &&
    money(v.expectedAmount) &&
    (v.rejectionReason === null || typeof v.rejectionReason === "string") &&
    date(v.submittedAt) &&
    (v.reviewedAt === null || date(v.reviewedAt))
  );
}
export function isPaymentOrder(v: unknown): v is PaymentOrder {
  return (
    isCheckoutOrder(v) &&
    record(v) &&
    (v.estimatedWarehouseArrival === undefined ||
      v.estimatedWarehouseArrival === null ||
      (typeof v.estimatedWarehouseArrival === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(v.estimatedWarehouseArrival) &&
        Number.isFinite(Date.parse(v.estimatedWarehouseArrival)) &&
        new Date(v.estimatedWarehouseArrival).toISOString().slice(0, 10) ===
          v.estimatedWarehouseArrival)) &&
    (v.paymentConfirmations === undefined ||
      (record(v.paymentConfirmations) &&
        Object.keys(v.paymentConfirmations).every(
          (key) => key === "prepayment" || key === "final",
        ) &&
        (v.paymentConfirmations.prepayment === null ||
          date(v.paymentConfirmations.prepayment)) &&
        (v.paymentConfirmations.final === null ||
          date(v.paymentConfirmations.final)))) &&
    orderStatuses.includes(v.status as OrderStatus) &&
    date(v.createdAt) &&
    money(v.paidAmount) &&
    money(v.cargoPaidAmount) &&
    (v.cargoAmount === null || money(v.cargoAmount)) &&
    (v.items as unknown[]).every(
      (item) =>
        record(item) &&
        (item.imageUrl === null || typeof item.imageUrl === "string"),
    ) &&
    record(v.payment) &&
    phase(v.payment.phase) &&
    money(v.payment.amountDue) &&
    status(v.payment.latestStatus)
  );
}
export function isPaymentInstructions(v: unknown): v is PaymentInstructions {
  return (
    record(v) &&
    typeof v.orderPublicId === "string" &&
    phase(v.phase) &&
    money(v.amount) &&
    typeof v.canSubmit === "boolean" &&
    status(v.latestPaymentStatus) &&
    ((v.latestPayment === null && v.latestPaymentStatus === null) ||
      (isPaymentAttempt(v.latestPayment) &&
        v.latestPayment.orderPublicId === v.orderPublicId &&
        v.latestPayment.status === v.latestPaymentStatus)) &&
    money(v.maxProofUploadSize) &&
    v.maxProofUploadSize > 0 &&
    v.currency === "UZS" &&
    [v.cardNumber, v.cardHolder, v.instructionsRu, v.instructionsUz].every(
      (s) => typeof s === "string",
    )
  );
}
// Two independently fetched responses must agree before showing transfer details.
export function coherentPayment(data: PaymentData): boolean {
  const { order: o, instructions: i } = data;
  return (
    o.publicId === i.orderPublicId &&
    o.payment.phase === i.phase &&
    o.payment.amountDue === i.amount &&
    o.payment.latestStatus === i.latestPaymentStatus &&
    i.canSubmit ===
      (o.status === "AWAITING_PREPAYMENT" ||
        o.status === "AWAITING_FINAL_PAYMENT")
  );
}
export function paymentState({
  order,
  instructions,
}: PaymentData):
  | "waiting"
  | "pending"
  | "approvedPrepayment"
  | "approvedFinal"
  | "rejected"
  | "unavailable" {
  if (order.status === "CANCELLED") return "unavailable";
  const attempt = instructions.latestPayment;
  if (
    attempt &&
    (instructions.phase === null || instructions.phase === attempt.type)
  ) {
    if (attempt.status === "SUBMITTED") return "pending";
    if (attempt.status === "REJECTED") return "rejected";
    if (attempt.status === "APPROVED" && instructions.phase === null)
      return attempt.type === "FINAL" ? "approvedFinal" : "approvedPrepayment";
  }
  return instructions.canSubmit ? "waiting" : "unavailable";
}
export function proofError(
  file: Pick<File, "type" | "size">,
  max: number,
): "fileType" | "fileSize" | "fileEmpty" | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return "fileType";
  if (file.size > max) return "fileSize";
  return file.size > 0 ? null : "fileEmpty";
}
export type PaymentError =
  | "auth"
  | "missing"
  | "changed"
  | "alreadySubmitted"
  | "invalidStatus"
  | "fileType"
  | "fileSize"
  | "fileEmpty"
  | "upload"
  | "network";
export function paymentError(error: unknown): PaymentError {
  const code = record(error) ? error.status : undefined;
  if (code === 401 || code === 403) return "auth";
  if (code === 404) return "missing";
  if (code === 413) return "fileSize";
  if (code === 415) return "fileType";
  if (code === 409) return "invalidStatus";
  if (typeof code === "number" && code >= 500) return "upload";
  return "network";
}
