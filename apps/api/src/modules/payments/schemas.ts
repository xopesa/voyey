import { z } from "zod";

export const paymentIdParamsSchema = z
  .object({ id: z.string().trim().min(1).max(100) })
  .strict();

export const rejectPaymentSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).nullable().default(null),
  })
  .strict();

export const paymentListQuerySchema = z
  .object({
    status: z.enum(["SUBMITTED", "APPROVED", "REJECTED"]).optional(),
    type: z.enum(["PREPAYMENT", "FINAL"]).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
