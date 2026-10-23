import { z } from "zod";

const quantitySchema = z.number().int().min(1).max(99);
const heightSchema = z.number().int().min(100).max(250).nullable();
const weightSchema = z.number().int().min(30).max(300).nullable();

export const addCartItemSchema = z
  .object({
    productId: z.string().trim().min(1).max(100),
    saleMode: z.enum(["IN_STOCK", "PREORDER"]).optional(),
    variantId: z.string().trim().min(1).max(100),
    quantity: quantitySchema,
    heightCm: heightSchema.default(null),
    weightKg: weightSchema.default(null),
  })
  .strict();

export const patchCartItemSchema = z
  .object({
    quantity: quantitySchema.optional(),
    heightCm: heightSchema.optional(),
    weightKg: weightSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const cartItemParamsSchema = z
  .object({ id: z.string().trim().min(1).max(100) })
  .strict();
