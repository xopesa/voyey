ALTER TABLE "ProductImage"
ADD COLUMN "storageKey" TEXT;

CREATE UNIQUE INDEX "ProductImage_storageKey_key"
ON "ProductImage"("storageKey");
