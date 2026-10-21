import { atomic, D1Conflict, prisma } from "@stenzo/database";
import {
  classifyVariantGeneration,
  normalizeVariantGenerator,
  variantCombinations,
  type VariantGeneratorInput,
} from "@stenzo/shared";
import type { VariantGeneratorRepository } from "../modules/admin/catalog/variant-generator.js";
import { AdminCatalogProductNotFoundError } from "../modules/admin/catalog/errors.js";
import { HttpError } from "../modules/auth/errors.js";
import { adminAuditActor } from "../modules/admin/audit-actor.js";

export class D1VariantGenerator implements VariantGeneratorRepository {
  async preview(productId: string, raw: VariantGeneratorInput) {
    const input = normalizeVariantGenerator(raw);
    if (!(await prisma.product.findUnique({ where: { id: productId } })))
      throw new AdminCatalogProductNotFoundError();
    const existing = await prisma.productVariant.findMany({
      where: { productId },
    });
    const occupied = await prisma.productVariant.findMany({
      where: { sku: { in: variantCombinations(input).map((row) => row.sku) } },
    });
    return { rows: classifyVariantGeneration(input, existing, occupied) };
  }
  async apply(actorId: string, productId: string, raw: VariantGeneratorInput) {
    const input = normalizeVariantGenerator(raw);
    let initialPlan: string | undefined;
    try {
      const counts = await atomic(async (batch) => {
        // Re-read inside the guarded transaction, never trust the browser preview.
        const { rows } = await this.preview(productId, input);
        const plan = JSON.stringify(rows);
        // An overlapping generation that loses the revision race must return 409,
        // whereas a later, separate repeated Apply can safely report zero new rows.
        if (
          (initialPlan !== undefined && initialPlan !== plan) ||
          rows.some((row) => row.status === "CONFLICT")
        )
          throw new HttpError(409, "SKU generation conflict; preview again");
        initialPlan = plan;
        const fresh = rows.filter((row) => row.status === "NEW");
        // Ten rows/statement: 90 bindings, below D1's 100 parameter limit.
        // Keep the whole generation in ONE guarded batch, with ample room for
        // authentication/read queries within the Free invocation query budget.
        const now = new Date();
        for (let offset = 0; offset < fresh.length; offset += 10) {
          const chunk = fresh.slice(offset, offset + 10);
          batch.sql(
            `INSERT INTO "ProductVariant" (id,productId,sku,size,color,stock,isActive,createdAt,updatedAt) VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?,?)").join(",")}`,
            ...chunk.flatMap(({ sku, size, color, stock, isActive }) => [
              crypto.randomUUID(),
              productId,
              sku,
              size,
              color,
              stock,
              isActive,
              now,
              now,
            ]),
          );
        }
        const result = {
          createdCount: fresh.length,
          existingCount: rows.length - fresh.length,
        };
        const actor = adminAuditActor(actorId);
        batch.insert("AuditLog", {
          actorId: actor.actorId,
          action: "variant.generate",
          entityType: "Product",
          entityId: productId,
          metadata: {
            ...actor.metadata,
            baseSku: input.baseSku,
            requestedCount: rows.length,
            ...result,
            sizes: input.sizes,
            colors: input.colors.map(({ color, code }) => ({ color, code })),
          },
        });
        return result;
      });
      return {
        ...counts,
        variants: await prisma.productVariant.findMany({
          where: { productId },
          orderBy: [{ size: "asc" }, { color: "asc" }, { id: "asc" }],
        }),
      };
    } catch (error) {
      if (
        error instanceof D1Conflict ||
        (error instanceof Error &&
          /UNIQUE constraint failed/i.test(error.message))
      )
        throw new HttpError(409, "SKU generation conflict; preview again");
      throw error;
    }
  }
}
