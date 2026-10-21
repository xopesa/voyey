import {
  adminNewOrderTemplate,
  adminPaymentSubmittedTemplate,
  customerFinalPaymentTemplate,
  customerLanguage,
  customerPaymentReviewedTemplate,
  customerStatusTemplate,
} from "./templates.js";
import type {
  NotificationLogger,
  NotificationProvider,
  OrderStatusNotification,
  PaymentReviewedNotification,
  PaymentSubmittedNotification,
  CustomerNotificationEvent,
  NotificationEvent,
  NotificationOptions,
  NotificationFailureCode,
  RefundNotificationEvent,
} from "./types.js";
import type { OrderRecord } from "../orders/types.js";
import type {
  AdminRecipientSource,
  AdminNotificationEvent,
  NotificationDeliveryStore,
} from "./types.js";
import { TelegramDeliveryError } from "./telegram-provider.js";
import { paymentOrderUrl, paymentReviewKeyboard } from "@stenzo/shared";
import type { PaymentProof } from "../payments/types.js";

class ProofUnavailableError extends Error {}

const defaultLogger: NotificationLogger = {
  error(message, context) {
    console.error(message, context);
  },
};

export class NotificationService {
  public constructor(
    private readonly provider: NotificationProvider,
    private readonly adminTelegramIds:
      ReadonlySet<string> | AdminRecipientSource,
    private readonly logger: NotificationLogger = defaultLogger,
    private readonly options: {
      deliveryStore?: NotificationDeliveryStore;
      customerDeliveryStore?: NotificationDeliveryStore<CustomerNotificationEvent>;
      adminOrigin?: string;
      refundDeliveryStore?: NotificationDeliveryStore<RefundNotificationEvent>;
    } = {},
  ) {}

  public orderCreated(order: OrderRecord, retryOnly = false): Promise<void> {
    if (order.source === "ADMIN") return Promise.resolve();
    return this.sendAdmins(
      "order.created",
      order.id,
      order,
      (locale) => adminNewOrderTemplate(order, locale),
      retryOnly,
    );
  }

  public refundCompleted(
    order: OrderRecord,
    refund: { id: string; amount: number },
  ) {
    const store = this.options.refundDeliveryStore;
    // Refund receipts must never fall back to best-effort delivery.
    if (!store) return Promise.resolve();
    const locale = customerLanguage(order.user.preferredLocale);
    const amount =
      new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "uz-UZ").format(
        refund.amount,
      ) + " UZS";
    const text =
      locale === "ru"
        ? `Возврат по заказу ${order.publicId} выполнен.\nСумма: ${amount}.`
        : `${order.publicId} buyurtmasi bo‘yicha pul qaytarildi.\nSumma: ${amount}.`;
    return this.sendDurably(
      store,
      "refund.completed",
      `refund.completed:${refund.id}`,
      order.user.telegramId.toString(),
      text,
    );
  }

  public paymentSubmitted(
    input: PaymentSubmittedNotification,
    retryOnly = false,
  ): Promise<void> {
    // Load the saved image lazily once for this delivery operation, even with
    // multiple recipients. A later safe replay gets a fresh private-storage read.
    let proof: Promise<PaymentProof> | undefined;
    const readProof = () =>
      (proof ??= Promise.resolve().then(() => input.readProof()));
    return this.sendAdmins(
      "payment.submitted",
      input.payment.id,
      input.order,
      (locale) =>
        adminPaymentSubmittedTemplate(
          input.order,
          input.payment,
          input.isRetry,
          locale,
        ),
      retryOnly,
      readProof,
    );
  }

  public paymentReviewed(
    input: PaymentReviewedNotification,
    retryOnly = false,
  ): Promise<void> {
    const { payment } = input;
    const event =
      input.decision === "APPROVED" ? "payment.approved" : "payment.rejected";
    return this.sendCustomer(
      event,
      `${event}:${payment.id}`,
      payment.order.user.telegramId.toString(),
      customerPaymentReviewedTemplate(
        payment,
        customerLanguage(payment.order.user.preferredLocale),
      ),
      retryOnly,
    );
  }

  public orderStatusChanged(
    input: OrderStatusNotification,
    retryOnly = false,
  ): Promise<void> {
    const text = customerStatusTemplate(
      input.order,
      input.status,
      customerLanguage(input.order.user.preferredLocale),
    );
    if (!text) return Promise.resolve();
    return this.sendCustomer(
      "order.status_changed",
      `order.status:${input.order.id}:${input.status}`,
      input.order.user.telegramId.toString(),
      text,
      retryOnly,
    );
  }

  public finalPaymentRequested(
    order: OrderRecord,
    retryOnly = false,
  ): Promise<void> {
    return this.sendCustomer(
      "order.final_payment_requested",
      `order.final_payment_requested:${order.id}`,
      order.user.telegramId.toString(),
      customerFinalPaymentTemplate(
        order,
        customerLanguage(order.user.preferredLocale),
      ),
      retryOnly,
    );
  }

  private logFailure(event: string, recipient: string, code: string) {
    try {
      this.logger.error("Telegram notification delivery failed", {
        event,
        recipient,
        error: code,
      });
    } catch {
      /* Observability cannot fail a domain operation. */
    }
  }

  private async sendAdmins(
    event: AdminNotificationEvent,
    id: string,
    order: OrderRecord,
    template: (locale: "uz" | "ru") => string,
    retryOnly: boolean,
    readProof?: () => Promise<PaymentProof>,
  ) {
    try {
      if (
        !("recipients" in this.adminTelegramIds) &&
        !this.options.deliveryStore
      ) {
        // Standalone API compatibility: replays must never use best-effort sending.
        // The preview always supplies durable stores for admins and customers.
        if (retryOnly) return;
        await Promise.all(
          [...this.adminTelegramIds].map(async (recipient) => {
            if (!readProof)
              return this.sendOne(event, recipient, template("ru"));
            // Standalone compatibility still sends the actual private image, never a text substitute.
            try {
              const proof = await readProof();
              if (!this.provider.sendPhoto)
                throw new Error("Photo provider unavailable");
              await this.provider.sendPhoto(
                recipient,
                proof.data,
                proof.mimeType,
                template("ru"),
                paymentReviewKeyboard(
                  id,
                  paymentOrderUrl(this.options.adminOrigin!, order.publicId),
                  "ru",
                ),
              );
            } catch {
              this.logFailure(event, recipient, "PHOTO_DELIVERY_FAILED");
            }
          }),
        );
        return;
      }
      // Dynamic recipients must have durable storage; never silently send without dedupe.
      const store = this.options.deliveryStore;
      if (!store) throw new Error("Delivery store required");
      const origin = new URL(this.options.adminOrigin!);
      if (
        origin.protocol !== "https:" ||
        origin.username ||
        origin.password ||
        origin.pathname !== "/" ||
        origin.search ||
        origin.hash
      )
        throw new Error("Invalid admin origin");
      const recipients =
        "recipients" in this.adminTelegramIds
          ? await this.adminTelegramIds.recipients(event)
          : [...this.adminTelegramIds].map((telegramId) => ({
              telegramId,
              preferredLocale: "ru" as const,
            }));
      for (const recipient of recipients) {
        await this.sendDurably(
          store,
          event,
          `${event}:${id}`,
          recipient.telegramId,
          template(recipient.preferredLocale),
          {
            button: {
              text:
                recipient.preferredLocale === "ru"
                  ? "Открыть в Admin"
                  : "Admin panelda ochish",
              url: `${origin.origin}/admin/orders/${encodeURIComponent(order.publicId)}`,
            },
          },
          readProof
            ? async () => {
                let proof: PaymentProof;
                try {
                  proof = await readProof();
                } catch {
                  throw new ProofUnavailableError();
                }
                if (!this.provider.sendPhoto) throw new ProofUnavailableError();
                return this.provider.sendPhoto(
                  recipient.telegramId,
                  proof.data,
                  proof.mimeType,
                  template(recipient.preferredLocale),
                  paymentReviewKeyboard(
                    id,
                    paymentOrderUrl(origin.origin, order.publicId),
                    recipient.preferredLocale,
                  ),
                );
              }
            : undefined,
        );
      }
    } catch {
      this.logFailure(event, "admin-recipients", "RECIPIENTS_UNAVAILABLE");
    }
  }

  private async sendCustomer(
    event: CustomerNotificationEvent,
    eventKey: string,
    recipient: string,
    text: string,
    retryOnly: boolean,
  ) {
    const store = this.options.customerDeliveryStore;
    if (store) return this.sendDurably(store, event, eventKey, recipient, text);
    if (!retryOnly) await this.sendOne(event, recipient, text);
  }

  private async sendDurably<Event extends NotificationEvent>(
    store: NotificationDeliveryStore<Event>,
    event: Event,
    eventKey: string,
    recipient: string,
    text: string,
    options?: NotificationOptions,
    deliver?: () => Promise<{ messageId: number } | void>,
  ) {
    try {
      const claim = await store.claim(eventKey, recipient, event);
      if (!claim) return;
      let result: { messageId: number } | { code: NotificationFailureCode };
      try {
        const receipt = deliver
          ? await deliver()
          : await this.provider.sendText(recipient, text, options);
        result =
          receipt &&
          Number.isSafeInteger(receipt.messageId) &&
          receipt.messageId > 0
            ? receipt
            : { code: "DELIVERY_UNCONFIRMED" };
      } catch (error) {
        result = {
          code:
            error instanceof ProofUnavailableError
              ? "PROOF_UNAVAILABLE"
              : error instanceof TelegramDeliveryError
                ? error.code
                : "DELIVERY_UNCONFIRMED",
        };
      }
      // A failed receipt write leaves PENDING, blocking unsafe duplicate sends.
      await store.finish(claim, result);
      if ("code" in result) this.logFailure(event, recipient, result.code);
    } catch {
      this.logFailure(event, recipient, "DELIVERY_STORAGE_FAILED");
    }
  }

  private async sendOne(
    event: string,
    recipient: string,
    text: string,
  ): Promise<void> {
    try {
      await this.provider.sendText(recipient, text);
    } catch {
      this.logFailure(event, recipient, "DELIVERY_FAILED");
    }
  }
}
