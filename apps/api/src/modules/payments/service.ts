import {
  MediaStorageError,
  MediaStorageUnavailableError,
  type PrivateImageStorageService,
} from "../media/index.js";
import { OrderNotFoundError } from "../orders/errors.js";
import {
  currentPaymentPhase,
  submissionPhase,
} from "../orders/status-policy.js";
import { toAdminOrderDto } from "../orders/service.js";
import type {
  AdminOrderDto,
  OrderStatusValue,
  OrderPaymentRecord,
} from "../orders/types.js";
import type { NotificationService } from "../notifications/index.js";
import type { PaymentRepository } from "./repository.js";
import {
  PaymentNotFoundError,
  PaymentSubmissionNotAllowedError,
} from "./errors.js";
import type {
  AdminPaymentRecord,
  PaymentDto,
  PaymentInstructionsDto,
  PaymentListQuery,
  PaymentProof,
  PaymentRecord,
} from "./types.js";

export interface ManualPaymentConfig {
  cardNumber: string;
  cardHolder: string;
  instructionsRu: string;
  instructionsUz: string;
  maxProofUploadSize?: number;
}

export interface SubmitProofInput {
  data: Buffer;
  declaredMimeType: string;
}

function toPaymentDto(
  payment: OrderPaymentRecord,
  orderPublicId: string,
): PaymentDto {
  return {
    id: payment.id,
    orderPublicId,
    type: payment.type,
    status: payment.status,
    expectedAmount: payment.expectedAmount,
    rejectionReason: payment.rejectionReason,
    submittedAt: payment.submittedAt,
    reviewedAt: payment.reviewedAt,
  };
}

function toAdminPaymentDto(payment: AdminPaymentRecord) {
  return {
    ...toPaymentDto(payment, payment.order.publicId),
    reviewer: payment.reviewedBy
      ? {
          id: payment.reviewedBy.id,
          telegramId: payment.reviewedBy.telegramId.toString(),
          username: payment.reviewedBy.username,
        }
      : null,
    order: toAdminOrderDto(payment.order),
  };
}

export class PaymentService {
  public constructor(
    private readonly repository: PaymentRepository,
    private readonly storage: PrivateImageStorageService | undefined,
    private readonly paymentConfig: ManualPaymentConfig,
    private readonly notifications?: NotificationService,
  ) {}

  public async getInstructions(
    userId: string,
    publicId: string,
  ): Promise<PaymentInstructionsDto> {
    const order = await this.repository.getOrderForUser(userId, publicId);
    if (!order) throw new OrderNotFoundError();
    const phase = currentPaymentPhase(order.status);
    const amount =
      phase === "PREPAYMENT"
        ? order.requiredPrepayment
        : phase === "FINAL"
          ? order.remainingAmount + (order.cargoAmount ?? 0)
          : 0;
    return {
      orderPublicId: order.publicId,
      phase,
      amount,
      canSubmit: submissionPhase(order.status) !== null,
      latestPaymentStatus: order.payments[0]?.status ?? null,
      latestPayment: order.payments[0]
        ? toPaymentDto(order.payments[0], order.publicId)
        : null,
      maxProofUploadSize:
        this.paymentConfig.maxProofUploadSize ?? 5 * 1024 * 1024,
      currency: "UZS",
      cardNumber: this.paymentConfig.cardNumber,
      cardHolder: this.paymentConfig.cardHolder,
      instructionsRu: this.paymentConfig.instructionsRu,
      instructionsUz: this.paymentConfig.instructionsUz,
    };
  }

  public async submit(
    userId: string,
    orderPublicId: string,
    idempotencyKey: string,
    proof: SubmitProofInput,
  ): Promise<PaymentDto> {
    const existing = await this.repository.findOwnerSubmission(
      userId,
      orderPublicId,
      idempotencyKey,
    );
    if (existing) {
      await this.notifySubmitted(userId, orderPublicId, existing, true);
      return toPaymentDto(existing, orderPublicId);
    }
    const order = await this.repository.getOrderForUser(userId, orderPublicId);
    if (!order) throw new OrderNotFoundError();
    if (!submissionPhase(order.status)) {
      throw new PaymentSubmissionNotAllowedError();
    }
    if (!this.storage) throw new MediaStorageUnavailableError();
    const stored = await this.storage.upload({
      data: proof.data,
      declaredMimeType: proof.declaredMimeType,
    });
    try {
      const result = await this.repository.submit({
        userId,
        orderPublicId,
        idempotencyKey,
        proofStorageKey: stored.key,
        proofMimeType: stored.mimeType,
      });
      if (!result.created) await this.storage.delete(stored.key);
      await this.notifySubmitted(
        userId,
        orderPublicId,
        result.payment,
        !result.created,
      );
      return toPaymentDto(result.payment, orderPublicId);
    } catch (databaseError) {
      try {
        await this.storage.delete(stored.key);
      } catch (cleanupError) {
        throw new MediaStorageError(
          "Payment submission and proof cleanup both failed",
          { cause: new AggregateError([databaseError, cleanupError]) },
        );
      }
      throw databaseError;
    }
  }

  private async notify(
    operation: (notifications: NotificationService) => Promise<void>,
  ) {
    try {
      if (this.notifications) await operation(this.notifications);
    } catch {
      /* Delivery/storage failure must never undo a committed payment or proof. */
    }
  }

  private notifySubmitted(
    userId: string,
    publicId: string,
    payment: PaymentRecord,
    retryOnly: boolean,
  ) {
    return this.notify(async (notifications) => {
      const order = await this.repository.getOrderForUser(userId, publicId);
      if (!order) return;
      await notifications.paymentSubmitted(
        {
          order,
          payment,
          readProof: async () => {
            if (!this.storage) throw new MediaStorageUnavailableError();
            return {
              data: await this.storage.read(payment.proofStorageKey),
              mimeType: payment.proofMimeType,
            };
          },
          isRetry: order.payments.some(
            (previous) =>
              previous.id !== payment.id &&
              previous.type === payment.type &&
              previous.status === "REJECTED" &&
              previous.submittedAt <= payment.submittedAt,
          ),
        },
        retryOnly,
      );
    });
  }

  public async listForAdmin(query: PaymentListQuery) {
    const result = await this.repository.listForAdmin(query);
    return {
      payments: result.payments.map(toAdminPaymentDto),
      nextCursor: result.nextCursor,
    };
  }

  public async getForAdmin(id: string) {
    const payment = await this.repository.getForAdmin(id);
    if (!payment) throw new PaymentNotFoundError();
    return toAdminPaymentDto(payment);
  }

  public async getProofForAdmin(id: string): Promise<PaymentProof> {
    const payment = await this.repository.getForAdmin(id);
    if (!payment) throw new PaymentNotFoundError();
    if (!this.storage) throw new MediaStorageUnavailableError();
    return {
      data: await this.storage.read(payment.proofStorageKey),
      mimeType: payment.proofMimeType,
    };
  }

  public async approve(id: string, adminUserId: string) {
    const result = await this.repository.approve(id, adminUserId);
    await this.notify((notifications) =>
      notifications.paymentReviewed(
        {
          payment: result.payment,
          decision: "APPROVED",
        },
        !result.changed,
      ),
    );
    return toAdminPaymentDto(result.payment);
  }

  public async reject(id: string, adminUserId: string, reason: string | null) {
    const result = await this.repository.reject(id, adminUserId, reason);
    await this.notify((notifications) =>
      notifications.paymentReviewed(
        {
          payment: result.payment,
          decision: "REJECTED",
        },
        !result.changed,
      ),
    );
    return toAdminPaymentDto(result.payment);
  }

  public async transitionOrder(
    publicId: string,
    targetStatus: OrderStatusValue,
    adminUserId: string,
  ): Promise<AdminOrderDto> {
    const result = await this.repository.transitionOrder(
      publicId,
      targetStatus,
      adminUserId,
    );
    await this.notify((notifications) =>
      notifications.orderStatusChanged(
        {
          order: result.order,
          status: targetStatus,
        },
        !result.changed,
      ),
    );
    return toAdminOrderDto(result.order);
  }

  public async requestFinalPayment(
    publicId: string,
    cargoAmount: number,
    adminUserId: string,
  ): Promise<AdminOrderDto> {
    const result = await this.repository.requestFinalPayment(
      publicId,
      cargoAmount,
      adminUserId,
    );
    await this.notify((notifications) =>
      notifications.finalPaymentRequested(result.order, !result.changed),
    );
    return toAdminOrderDto(result.order);
  }
}
