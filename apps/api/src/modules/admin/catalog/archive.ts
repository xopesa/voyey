import { atomic, prisma } from "@stenzo/database";
import { HttpError } from "../../auth/errors.js";
import { lifecycleAudit } from "../lifecycle.js";
import { financePrincipal } from "../finance/procurement.js";

export class CatalogArchiveService {
  async product(id: string, actor: string, archive: boolean) {
    await atomic(async (b) => {
      const product = await prisma.product.findUnique({ where: { id } });
      if (!product) throw new HttpError(404, "notFound");
      if (Boolean(product.archivedAt) === archive) return;
      if (!archive) {
        const category = await prisma.category.findUnique({
          where: { id: product.categoryId },
        });
        if (category?.archivedAt)
          throw new HttpError(409, "archiveCategoryFirst");
      }
      b.update("Product", id, {
        archivedAt: archive ? new Date() : null,
        archivedBy: archive ? financePrincipal(actor) : null,
        status: "INACTIVE",
        isFeatured: false,
      });
      lifecycleAudit(
        b,
        actor,
        archive ? "product.archived" : "product.restored",
        "Product",
        id,
      );
    });
    return prisma.product.findUniqueOrThrow({
      where: { id },
      include: { category: true, images: true, variants: true },
    });
  }
  async category(id: string, actor: string, archive: boolean) {
    await atomic(async (b) => {
      const category = await prisma.category.findUnique({ where: { id } });
      if (!category) throw new HttpError(404, "notFound");
      if (Boolean(category.archivedAt) === archive) return;
      if (
        archive &&
        (await prisma.product.count({
          where: { categoryId: id, archivedAt: null },
        }))
      )
        throw new HttpError(409, "archiveCategoryNotEmpty");
      b.update("Category", id, {
        archivedAt: archive ? new Date() : null,
        archivedBy: archive ? financePrincipal(actor) : null,
        isActive: false,
      });
      lifecycleAudit(
        b,
        actor,
        archive ? "category.archived" : "category.restored",
        "Category",
        id,
      );
    });
    return prisma.category.findUniqueOrThrow({ where: { id } });
  }
}
