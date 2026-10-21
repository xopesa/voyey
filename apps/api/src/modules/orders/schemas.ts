import { z } from "zod";

export const orderStatusSchema = z.enum([
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
]);

export const recipientSchema = z
  .object({
    fullName: z.string().trim().min(2).max(200),
    phone: z
      .string()
      .trim()
      .min(7)
      .max(24)
      .regex(/^\+?[0-9][0-9 ()-]+$/),
    city: z.string().trim().min(1).max(100),
    address: z.string().trim().min(3).max(500),
    apartment: z.string().trim().min(1).max(100).nullable().default(null),
    comment: z.string().trim().min(1).max(1_000).nullable().default(null),
  })
  .strict();

export const orderListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const adminOrderListQuerySchema = orderListQuerySchema.extend({
  status: orderStatusSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

export const publicOrderParamsSchema = z
  .object({ publicId: z.string().trim().min(1).max(100) })
  .strict();

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(16)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const orderStatusPatchSchema = z
  .object({ status: orderStatusSchema })
  .strict();

export const finalPaymentRequestSchema = z
  .object({ cargoAmount: z.number().int().nonnegative().max(2_147_483_647) })
  .strict();
