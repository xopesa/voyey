import { z } from "zod";

const utcDate = z.iso
  .datetime({ offset: false })
  .transform((v) => new Date(v))
  .nullable()
  .optional();
const saleFields = {
  salePrice: z.number().int().positive().max(2147483647).nullable().optional(),
  saleStartsAt: utcDate,
  saleEndsAt: utcDate,
};
const MAX_INT32 = 2_147_483_647;
const localizedNameSchema = z.string().trim().min(1).max(200);
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const descriptionSchema = z.string().trim().max(20_000).nullable();
const productStatusSchema = z.enum(["DRAFT", "ACTIVE", "INACTIVE"]);
const httpUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "URL must use HTTP or HTTPS");

export const categoryCreateSchema = z
  .object({
    nameRu: localizedNameSchema,
    nameUz: localizedNameSchema,
    slug: slugSchema,
    sortOrder: z.number().int().nonnegative().max(MAX_INT32).default(0),
    isActive: z.boolean().default(true),
  })
  .strict();

export const categoryPatchSchema = z
  .object({
    nameRu: localizedNameSchema.optional(),
    nameUz: localizedNameSchema.optional(),
    slug: slugSchema.optional(),
    sortOrder: z.number().int().nonnegative().max(MAX_INT32).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const productCreateSchema = z
  .object({
    ...saleFields,
    publishToChannel: z.boolean().optional(),
    costPrice: z.number().int().positive().max(MAX_INT32).nullable().optional(),
    categoryId: z.string().trim().min(1).max(100),
    nameRu: localizedNameSchema,
    nameUz: localizedNameSchema,
    slug: slugSchema,
    descriptionRu: descriptionSchema.default(null),
    descriptionUz: descriptionSchema.default(null),
    sourceUrl: httpUrlSchema.nullable().default(null),
    price: z.number().int().positive().max(MAX_INT32),
    currency: z.literal("UZS").default("UZS"),
    status: productStatusSchema.default("DRAFT"),
    isFeatured: z.boolean().default(false),
  })
  .strict();

export const productPatchSchema = z
  .object({
    ...saleFields,
    publishToChannel: z.boolean().optional(),
    costPrice: z.number().int().positive().max(MAX_INT32).nullable().optional(),
    categoryId: z.string().trim().min(1).max(100).optional(),
    nameRu: localizedNameSchema.optional(),
    nameUz: localizedNameSchema.optional(),
    slug: slugSchema.optional(),
    descriptionRu: descriptionSchema.optional(),
    descriptionUz: descriptionSchema.optional(),
    sourceUrl: httpUrlSchema.nullable().optional(),
    status: productStatusSchema.optional(),
    price: z.number().int().positive().max(MAX_INT32).optional(),
    isFeatured: z.boolean().optional(),
  })
  .strict()
  .refine((value) =>
    Object.keys(value).some((key) => key !== "publishToChannel"),
  );

export const productActivationSchema = z
  .object({
    publishToChannel: z.boolean().default(false),
  })
  .strict();

export const imageCreateSchema = z
  .object({
    url: httpUrlSchema,
    sortOrder: z.number().int().nonnegative().max(MAX_INT32).default(0),
    isPrimary: z.boolean().default(false),
  })
  .strict();

export const imagePatchSchema = z
  .object({
    url: httpUrlSchema.optional(),
    sortOrder: z.number().int().nonnegative().max(MAX_INT32).optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const imageUploadQuerySchema = z
  .object({
    sortOrder: z.coerce.number().int().nonnegative().max(MAX_INT32).default(0),
    isPrimary: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .default(false),
  })
  .strict();

export const variantCreateSchema = z
  .object({
    sku: z.string().trim().min(1).max(100),
    size: z.string().trim().min(1).max(50),
    color: z.string().trim().min(1).max(100).nullable().default(null),
    stock: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_INT32)
      .nullable()
      .default(null),
    isActive: z.boolean().default(true),
  })
  .strict();

export const variantPatchSchema = z
  .object({
    sku: z.string().trim().min(1).max(100).optional(),
    size: z.string().trim().min(1).max(50).optional(),
    color: z.string().trim().min(1).max(100).nullable().optional(),
    stock: z.number().int().nonnegative().max(MAX_INT32).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const variantGeneratorSchema = z
  .object({
    baseSku: z.string().max(200),
    sizes: z.array(z.string().max(100)).min(1).max(40),
    colors: z
      .array(
        z
          .object({
            color: z.string().min(1).max(100),
            code: z.string().max(20),
            reviewed: z.boolean().optional(),
          })
          .strict(),
      )
      .max(20),
    stock: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_INT32)
      .nullable()
      .default(null),
    isActive: z.boolean().default(true),
  })
  .strict();

export const adminProductListQuerySchema = z
  .object({
    category: z.string().trim().min(1).max(100).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    status: productStatusSchema.optional(),
    archive: z.enum(["current", "archived"]).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const idParamsSchema = z.object({
  id: z.string().trim().min(1).max(100),
});

export const productIdParamsSchema = z.object({
  productId: z.string().trim().min(1).max(100),
});
