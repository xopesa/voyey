import { Prisma, prisma } from "@stenzo/database";
import { adminAuditActor } from "../admin/audit-actor.js";

import {
  OrderNotFoundError,
  OrderTransitionConflictError,
} from "../orders/errors.js";
import { orderInclude, adminOrderInclude } from "../orders/repository.js";
import {
  assertAdminStatusTransition,
  submissionPhase,
} from "../orders/status-policy.js";
import type { OrderRecord, OrderStatusValue } from "../orders/types.js";
import {
  FinalPaymentRequestNotAllowedError,
  FinalPaymentAmountTooLargeError,
  PaymentAmountMismatchError,
  PaymentConflictError,
  PaymentInvalidCursorError,
  PaymentNotFoundError,
  PaymentReviewNotAllowedError,
  PaymentSubmissionNotAllowedError,
} from "./errors.js";
import type {
  AdminPaymentRecord,
  PaymentListQuery,
  PaymentListResult,
  PaymentRecord,
  SubmitPaymentInput,
} from "./types.js";

const adminPaymentInclude = {
  order: { include: adminOrderInclude },
  reviewedBy: {
    select: { id: true, telegramId: true, username: true },
  },
};

export interface SubmitPaymentResult {
  payment: PaymentRecord;
  created: boolean;
}

export interface ReviewPaymentResult {
  payment: AdminPaymentRecord;
  changed: boolean;
}

export interface OrderMutationResult {
  order: OrderRecord;
  changed: boolean;
}

export interface PaymentRepository {
  getOrderForUser(
    userId: string,
    publicId: string,
  ): Promise<OrderRecord | null>;
  findOwnerSubmission(
    userId: string,
    publicId: string,
    idempotencyKey: string,
  ): Promise<PaymentRecord | null>;
  submit(input: SubmitPaymentInput): Promise<SubmitPaymentResult>;
  listForAdmin(query: PaymentListQuery): Promise<PaymentListResult>;
  getForAdmin(id: string): Promise<AdminPaymentRecord | null>;
  approve(id: string, adminUserId: string): Promise<ReviewPaymentResult>;
  reject(
    id: string,
    adminUserId: string,
    reason: string | null,
  ): Promise<ReviewPaymentResult>;
  transitionOrder(
    publicId: string,
    targetStatus: OrderStatusValue,
    adminUserId: string,
  ): Promise<OrderMutationResult>;
  requestFinalPayment(
    publicId: string,
    cargoAmount: number,
    adminUserId: string,
  ): Promise<OrderMutationResult>;
}

function prismaCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return typeof error.code === "string" ? error.code : undefined;
  }
  return undefined;
}

function expectedAmount(
  order: OrderRecord,
  type: "PREPAYMENT" | "FINAL",
): number {
  return type === "PREPAYMENT"
    ? order.requiredPrepayment
    : order.remainingAmount + (order.cargoAmount ?? 0);
}

export class PrismaPaymentRepository implements PaymentRepository {
  public getOrderForUser(
    userId: string,
    publicId: string,
  ): Promise<OrderRecord | null> {
    return prisma.order.findFirst({
      where: { userId, publicId },
      include: orderInclude,
    });
  }

  public findOwnerSubmission(
    userId: string,
    publicId: string,
    idempotencyKey: string,
  ): Promise<PaymentRecord | null> {
    return prisma.payment.findFirst({
      where: { idempotencyKey, order: { userId, publicId } },
    });
  }

  public async submit(input: SubmitPaymentInput): Promise<SubmitPaymentResult> {
    try {
      const payment = await prisma.$transaction(
        async (tx) => {
          const existing = await tx.payment.findFirst({
            where: {
              idempotencyKey: input.idempotencyKey,
              order: { userId: input.userId, publicId: input.orderPublicId },
            },
          });
          if (existing) return existing;
          const order = await tx.order.findFirst({
            where: { userId: input.userId, publicId: input.orderPublicId },
            include: orderInclude,
          });
          if (!order) throw new OrderNotFoundError();
          const type = submissionPhase(order.status);
          if (!type) throw new PaymentSubmissionNotAllowedError();
          const payment = await tx.payment.create({
            data: {
              orderId: order.id,
              type,
              expectedAmount: expectedAmount(order, type),
              idempotencyKey: input.idempotencyKey,
              proofStorageKey: input.proofStorageKey,
              proofMimeType: input.proofMimeType,
            },
          });
          const nextStatus =
            type === "PREPAYMENT"
              ? "PREPAYMENT_SUBMITTED"
              : "FINAL_PAYMENT_SUBMITTED";
          const changed = await tx.order.updateMany({
            where: { id: order.id, status: order.status },
            data: { status: nextStatus },
          });
          if (changed.count !== 1) throw new PaymentConflictError();
          await tx.auditLog.create({
            data: {
              actorId: input.userId,
              action: "payment.submitted",
              entityType: "Payment",
              entityId: payment.id,
              metadata: {
                orderPublicId: order.publicId,
                type,
                expectedAmount: payment.expectedAmount,
              },
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: input.userId,
              action: "order.status_changed",
              entityType: "Order",
              entityId: order.id,
              metadata: {
                publicId: order.publicId,
                from: order.status,
                to: nextStatus,
              },
            },
          });
          return payment;
        },
        { isolationLevel: "Serializable" },
      );
      return {
        payment,
        created: payment.proofStorageKey === input.proofStorageKey,
      };
    } catch (error) {
      if (prismaCode(error) === "P2002" || prismaCode(error) === "P2034") {
        const existing = await this.findOwnerSubmission(
          input.userId,
          input.orderPublicId,
          input.idempotencyKey,
        );
        if (existing) return { payment: existing, created: false };
        throw new PaymentConflictError();
      }
      throw error;
    }
  }

  public async listForAdmin(
    query: PaymentListQuery,
  ): Promise<PaymentListResult> {
    const where: Prisma.PaymentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    if (query.cursor) {
      const cursor = await prisma.payment.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      });
      if (!cursor) throw new PaymentInvalidCursorError();
    }
    const payments = await prisma.payment.findMany({
      where,
      include: adminPaymentInclude,
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
    });
    const hasNextPage = payments.length > query.limit;
    const visible = hasNextPage ? payments.slice(0, query.limit) : payments;
    return {
      payments: visible,
      nextCursor: hasNextPage ? (visible.at(-1)?.id ?? null) : null,
    };
  }

  public getForAdmin(id: string): Promise<AdminPaymentRecord | null> {
    return prisma.payment.findUnique({
      where: { id },
      include: adminPaymentInclude,
    });
  }

  public approve(
    id: string,
    adminUserId: string,
  ): Promise<ReviewPaymentResult> {
    return this.review(id, adminUserId, "APPROVED", null);
  }

  public reject(
    id: string,
    adminUserId: string,
    reason: string | null,
  ): Promise<ReviewPaymentResult> {
    return this.review(id, adminUserId, "REJECTED", reason);
  }

  public async transitionOrder(
    publicId: string,
    targetStatus: OrderStatusValue,
    adminUserId: string,
  ): Promise<OrderMutationResult> {
    const actor = adminAuditActor(adminUserId);
    try {
      return await prisma.$transaction(
        async (tx) => {
          const order = await tx.order.findUnique({
            where: { publicId },
            include: orderInclude,
          });
          if (!order) throw new OrderNotFoundError();
          if (order.status === targetStatus) {
            return { order, changed: false };
          }
          assertAdminStatusTransition(order.status, targetStatus);
          const changed = await tx.order.updateMany({
            where: { id: order.id, status: order.status },
            data: {
              status: targetStatus,
              ...(targetStatus === "COMPLETED"
                ? { completedAt: new Date() }
                : {}),
            },
          });
          if (changed.count !== 1) throw new OrderTransitionConflictError();
          await tx.auditLog.create({
            data: {
              actorId: actor.actorId,
              action: "order.status_changed",
              entityType: "Order",
              entityId: order.id,
              metadata: {
                ...actor.metadata,
                publicId,
                from: order.status,
                to: targetStatus,
              },
            },
          });
          if (targetStatus === "COMPLETED") {
            await tx.auditLog.create({
              data: {
                actorId: actor.actorId,
                action: "order.completed",
                entityType: "Order",
                entityId: order.id,
                metadata: { ...actor.metadata, publicId },
              },
            });
          }
          const updatedOrder = await tx.order.findUniqueOrThrow({
            where: { id: order.id },
            include: orderInclude,
          });
          return { order: updatedOrder, changed: true };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (
        error instanceof OrderTransitionConflictError ||
        prismaCode(error) === "P2034"
      ) {
        const current = await prisma.order.findUnique({
          where: { publicId },
          include: orderInclude,
        });
        if (current?.status === targetStatus) {
          return { order: current, changed: false };
        }
        throw new OrderTransitionConflictError();
      }
      throw error;
    }
  }

  public async requestFinalPayment(
    publicId: string,
    cargoAmount: number,
    adminUserId: string,
  ): Promise<OrderMutationResult> {
    const actor = adminAuditActor(adminUserId);
    try {
      return await prisma.$transaction(
        async (tx) => {
          const order = await tx.order.findUnique({
            where: { publicId },
            include: orderInclude,
          });
          if (!order) throw new OrderNotFoundError();
          if (
            order.status === "AWAITING_FINAL_PAYMENT" &&
            order.cargoAmount === cargoAmount
          ) {
            return { order, changed: false };
          }
          if (order.status !== "WEIGHING") {
            throw new FinalPaymentRequestNotAllowedError();
          }
          if (order.remainingAmount + cargoAmount > 2_147_483_647) {
            throw new FinalPaymentAmountTooLargeError();
          }
          const changed = await tx.order.updateMany({
            where: { id: order.id, status: "WEIGHING" },
            data: { cargoAmount, status: "AWAITING_FINAL_PAYMENT" },
          });
          if (changed.count !== 1) throw new OrderTransitionConflictError();
          await tx.auditLog.create({
            data: {
              actorId: actor.actorId,
              action: "order.cargo_assigned",
              entityType: "Order",
              entityId: order.id,
              metadata: { ...actor.metadata, publicId, cargoAmount },
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.actorId,
              action: "order.final_payment_requested",
              entityType: "Order",
              entityId: order.id,
              metadata: {
                ...actor.metadata,
                publicId,
                amount: order.remainingAmount + cargoAmount,
              },
            },
          });
          const updatedOrder = await tx.order.findUniqueOrThrow({
            where: { id: order.id },
            include: orderInclude,
          });
          return { order: updatedOrder, changed: true };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (
        error instanceof OrderTransitionConflictError ||
        prismaCode(error) === "P2034"
      ) {
        const current = await prisma.order.findUnique({
          where: { publicId },
          include: orderInclude,
        });
        if (
          current?.status === "AWAITING_FINAL_PAYMENT" &&
          current.cargoAmount === cargoAmount
        ) {
          return { order: current, changed: false };
        }
        throw new OrderTransitionConflictError();
      }
      throw error;
    }
  }

  private async review(
    id: string,
    adminUserId: string,
    decision: "APPROVED" | "REJECTED",
    reason: string | null,
  ): Promise<ReviewPaymentResult> {
    const actor = adminAuditActor(adminUserId);
    try {
      return await prisma.$transaction(
        async (tx) => {
          const payment = await tx.payment.findUnique({
            where: { id },
            include: adminPaymentInclude,
          });
          if (!payment) throw new PaymentNotFoundError();
          if (payment.status === decision) {
            return { payment, changed: false };
          }
          if (payment.status !== "SUBMITTED") {
            throw new PaymentReviewNotAllowedError();
          }
          const submittedStatus =
            payment.type === "PREPAYMENT"
              ? "PREPAYMENT_SUBMITTED"
              : "FINAL_PAYMENT_SUBMITTED";
          if (payment.order.status !== submittedStatus) {
            throw new PaymentReviewNotAllowedError();
          }
          const amountDue = expectedAmount(payment.order, payment.type);
          if (payment.expectedAmount !== amountDue) {
            throw new PaymentAmountMismatchError();
          }
          const paymentChanged = await tx.payment.updateMany({
            where: { id, status: "SUBMITTED" },
            data: {
              status: decision,
              rejectionReason: decision === "REJECTED" ? reason : null,
              reviewedByUserId: actor.actorId,
              reviewedAt: new Date(),
            },
          });
          if (paymentChanged.count !== 1) throw new PaymentConflictError();

          const orderData: Prisma.OrderUpdateManyMutationInput =
            decision === "REJECTED"
              ? {
                  status:
                    payment.type === "PREPAYMENT"
                      ? "AWAITING_PREPAYMENT"
                      : "AWAITING_FINAL_PAYMENT",
                }
              : payment.type === "PREPAYMENT"
                ? {
                    status: "AWAITING_PURCHASE",
                    paidAmount: payment.order.requiredPrepayment,
                  }
                : {
                    status: "PAID_FULL",
                    paidAmount: payment.order.total,
                    remainingAmount: 0,
                    cargoPaidAmount: payment.order.cargoAmount ?? 0,
                  };
          const orderChanged = await tx.order.updateMany({
            where: { id: payment.order.id, status: submittedStatus },
            data: orderData,
          });
          if (orderChanged.count !== 1) throw new PaymentConflictError();
          await tx.auditLog.create({
            data: {
              actorId: actor.actorId,
              action:
                decision === "APPROVED"
                  ? "payment.approved"
                  : "payment.rejected",
              entityType: "Payment",
              entityId: payment.id,
              metadata: {
                ...actor.metadata,
                orderPublicId: payment.order.publicId,
                type: payment.type,
                expectedAmount: payment.expectedAmount,
                ...(decision === "REJECTED" ? { reason } : {}),
              },
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.actorId,
              action: "order.status_changed",
              entityType: "Order",
              entityId: payment.order.id,
              metadata: {
                ...actor.metadata,
                publicId: payment.order.publicId,
                from: submittedStatus,
                to: orderData.status,
              },
            },
          });
          const updatedPayment = await tx.payment.findUniqueOrThrow({
            where: { id },
            include: adminPaymentInclude,
          });
          return { payment: updatedPayment, changed: true };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (
        error instanceof PaymentConflictError ||
        prismaCode(error) === "P2034"
      ) {
        const current = await this.getForAdmin(id);
        if (current?.status === decision) {
          return { payment: current, changed: false };
        }
        throw new PaymentReviewNotAllowedError();
      }
      throw error;
    }
  }
}
