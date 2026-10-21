import { z } from "zod";

export const publicCatalogQuerySchema = z
  .object({
    category: z.string().trim().min(1).max(100).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const productSlugParamsSchema = z
  .object({
    slug: z.string().trim().min(1).max(100),
  })
  .strict();
