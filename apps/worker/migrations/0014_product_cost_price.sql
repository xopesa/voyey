-- Private per-unit cost default for future order snapshots. No backfill or business-row updates.
ALTER TABLE "Product" ADD COLUMN "costPrice" INTEGER CHECK ("costPrice" IS NULL OR (typeof("costPrice")='integer' AND "costPrice" BETWEEN 1 AND 2147483647));
