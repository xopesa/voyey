-- Existing rows keep IDs, measurements and legacy checkout semantics.
ALTER TABLE "CartItem" ADD COLUMN "saleMode" TEXT NOT NULL DEFAULT 'LEGACY'
  CHECK ("saleMode" IN ('LEGACY','IN_STOCK','PREORDER'));
DROP INDEX "CartItem_0_idx";
CREATE UNIQUE INDEX "CartItem_0_idx" ON "CartItem" ("cartId","variantId","saleMode");
