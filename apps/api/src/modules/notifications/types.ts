import type { OrderRecord, OrderStatusValue } from "../orders/types.js";
import type { AdminPaymentRecord, PaymentRecord } from "../payments/types.js";
import type { PaymentProof } from "../payments/types.js";
import type { PaymentReviewKeyboard } from "@stenzo/shared";

export interface NotificationProvider {
  sendPhoto?(
    chatId: string,
    bytes: Buffer,
    mimeType: string,
    caption: string,
    keyboard: PaymentReviewKeyboard,
  ): Promise<{ messageId: number } | void>;
  sendText(
    chatId: string,
    text: string,
    options?: NotificationOptions,
  ): Promise<{ messageId: number } | void>;
}

export interface NotificationOptions {
  button?: { text: string; url: string };
}
export type AdminNotificationEvent = "order.created" | "payment.submitted";
export type CustomerNotificationEvent =
  | "payment.approved"
  | "payment.rejected"
  | "order.status_changed"
  | "order.final_payment_requested";
export type RefundNotificationEvent = "refund.completed";
export type NotificationEvent =
  AdminNotificationEvent | CustomerNotificationEvent | RefundNotificationEvent;
export type NotificationFailureCode =
  "TELEGRAM_REJECTED" | "DELIVERY_UNCONFIRMED" | "PROOF_UNAVAILABLE";
export interface AdminRecipientSource {
  recipients(
    event: AdminNotificationEvent,
  ): Promise<{ telegramId: string; preferredLocale: "uz" | "ru" }[]>;
}
export interface NotificationDeliveryStore<
  Event extends NotificationEvent = AdminNotificationEvent,
> {
  claim(
    eventKey: string,
    telegramId: string,
    eventType: Event,
  ): Promise<{ id: string; attemptId: string } | null>;
  finish(
    claim: { id: string; attemptId: string },
    result: { messageId: number } | { code: NotificationFailureCode },
  ): Promise<void>;
}

export interface NotificationLogger {
  error(
    message: string,
    context: { event: string; recipient: string; error: string },
  ): void;
}

export interface PaymentSubmittedNotification {
  order: OrderRecord;
  payment: PaymentRecord;
  isRetry: boolean;
  readProof: () => Promise<PaymentProof>;
}

export interface PaymentReviewedNotification {
  payment: AdminPaymentRecord;
  decision: "APPROVED" | "REJECTED";
}

export interface OrderStatusNotification {
  order: OrderRecord;
  status: OrderStatusValue;
}
