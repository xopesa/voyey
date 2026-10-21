-- Additive only; no customer, order, note or notification seeds.
CREATE TABLE "CustomerNote" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "body" TEXT NOT NULL CHECK (length(trim("body")) BETWEEN 1 AND 2000),
 "createdBy" TEXT NOT NULL,
 "createdAt" INTEGER NOT NULL
);
CREATE INDEX "CustomerNote_user_created" ON "CustomerNote"("userId","createdAt" DESC,"id" DESC);
ALTER TABLE "Order" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MINIAPP' CHECK ("source" IN ('MINIAPP','ADMIN'));
CREATE INDEX "Order_source_created" ON "Order"("source","createdAt" DESC,"id" DESC);
CREATE INDEX "User_created_id" ON "User"("createdAt" DESC,"id" DESC);
CREATE TRIGGER "revision_CustomerNote_INSERT" AFTER INSERT ON "CustomerNote" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_CustomerNote_UPDATE" AFTER UPDATE ON "CustomerNote" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_CustomerNote_DELETE" AFTER DELETE ON "CustomerNote" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
