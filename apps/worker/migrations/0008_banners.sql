-- Additive preview-only home banners; no existing business records are changed.
CREATE TABLE "Banner" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "titleRu" TEXT NOT NULL, "titleUz" TEXT NOT NULL,
 "subtitleRu" TEXT, "subtitleUz" TEXT, "buttonRu" TEXT, "buttonUz" TEXT,
 "imageUrl" TEXT NOT NULL DEFAULT '', "storageKey" TEXT,
 "targetType" TEXT NOT NULL DEFAULT 'NONE' CHECK ("targetType" IN ('NONE','CATALOG','CATEGORY','PRODUCT','URL')),
 "targetCategoryId" TEXT REFERENCES "Category"("id") ON DELETE SET NULL,
 "targetProductId" TEXT REFERENCES "Product"("id") ON DELETE SET NULL,
 "targetUrl" TEXT,
 "sortOrder" INTEGER NOT NULL DEFAULT 0 CHECK ("sortOrder" BETWEEN 0 AND 2147483647),
 "isActive" INTEGER NOT NULL DEFAULT 0 CHECK ("isActive" IN (0,1)),
 "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL,
 CHECK ("isActive"=0 OR (length(trim("titleRu"))>0 AND length(trim("titleUz"))>0 AND length("imageUrl")>0 AND "storageKey" IS NOT NULL))
);
CREATE INDEX "Banner_active_sort" ON "Banner"("isActive","sortOrder","createdAt","id");
CREATE INDEX "Banner_updated" ON "Banner"("updatedAt");
CREATE TRIGGER "revision_Banner_INSERT" AFTER INSERT ON "Banner" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Banner_UPDATE" AFTER UPDATE ON "Banner" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Banner_DELETE" AFTER DELETE ON "Banner" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
