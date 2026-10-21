-- Additive only. Existing order prices remain immutable historical snapshots.
ALTER TABLE "Product" ADD COLUMN "salePrice" INTEGER;
ALTER TABLE "Product" ADD COLUMN "saleStartsAt" DATETIME;
ALTER TABLE "Product" ADD COLUMN "saleEndsAt" DATETIME;
ALTER TABLE "OrderItem" ADD COLUMN "originalUnitPrice" INTEGER;
