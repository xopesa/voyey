-- Additive only. No legacy reserve, cancellation, refund or archive backfill.
ALTER TABLE "Order" ADD COLUMN "cancelledAt" INTEGER;
ALTER TABLE "Order" ADD COLUMN "cancelledBy" TEXT;
ALTER TABLE "Order" ADD COLUMN "cancellationReason" TEXT CHECK ("cancellationReason" IS NULL OR "cancellationReason" IN ('CUSTOMER_REQUEST','OUT_OF_STOCK','SUPPLIER_UNAVAILABLE','DUPLICATE_ORDER','PAYMENT_ISSUE','OTHER'));
ALTER TABLE "Order" ADD COLUMN "cancellationNote" TEXT CHECK ("cancellationNote" IS NULL OR length("cancellationNote")<=500);
ALTER TABLE "Order" ADD COLUMN "stockReleaseStatus" TEXT NOT NULL DEFAULT 'NOT_RELEASED' CHECK ("stockReleaseStatus" IN ('NOT_RELEASED','RELEASED','REVIEW_REQUIRED'));
ALTER TABLE "Order" ADD COLUMN "stockReleasedAt" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN "inventoryReservedQuantity" INTEGER CHECK ("inventoryReservedQuantity" IS NULL OR (typeof("inventoryReservedQuantity")='integer' AND "inventoryReservedQuantity" IN (0,"quantity")));
ALTER TABLE "PromoCodeRedemption" ADD COLUMN "releasedAt" INTEGER;
ALTER TABLE "PromoCodeRedemption" ADD COLUMN "releaseReason" TEXT CHECK ("releaseReason" IS NULL OR "releaseReason"='ORDER_CANCELLED');
ALTER TABLE "Product" ADD COLUMN "archivedAt" INTEGER;
ALTER TABLE "Product" ADD COLUMN "archivedBy" TEXT;
ALTER TABLE "Category" ADD COLUMN "archivedAt" INTEGER;
ALTER TABLE "Category" ADD COLUMN "archivedBy" TEXT;
CREATE TABLE "Refund" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "orderId" TEXT NOT NULL UNIQUE REFERENCES "Order"("id") ON DELETE RESTRICT,
 "amount" INTEGER NOT NULL CHECK (typeof("amount")='integer' AND "amount" BETWEEN 1 AND 2147483647),
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','COMPLETED')),
 "reference" TEXT CHECK ("reference" IS NULL OR length("reference")<=200),
 "note" TEXT CHECK ("note" IS NULL OR length("note")<=500),
 "createdBy" TEXT NOT NULL,
 "createdAt" INTEGER NOT NULL,
 "updatedAt" INTEGER NOT NULL,
 "completedAt" INTEGER,
 "completedBy" TEXT
);
CREATE TABLE "CustomerRefundNotificationDelivery" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "eventKey" TEXT NOT NULL,
 "telegramId" TEXT NOT NULL,
 "eventType" TEXT NOT NULL CHECK ("eventType"='refund.completed'),
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','SENT','FAILED')),
 "attemptId" TEXT NOT NULL,
 "telegramMessageId" INTEGER,
 "createdAt" INTEGER NOT NULL,
 "updatedAt" INTEGER NOT NULL,
 "sentAt" INTEGER,
 "lastErrorCode" TEXT CHECK ("lastErrorCode" IS NULL OR "lastErrorCode" IN ('TELEGRAM_REJECTED','DELIVERY_UNCONFIRMED')),
 UNIQUE("eventKey","telegramId")
);
CREATE INDEX "Order_cancelledAt" ON "Order"("cancelledAt");
CREATE INDEX "Refund_status_created" ON "Refund"("status","createdAt" DESC,"id" DESC);
CREATE INDEX "Refund_completedAt" ON "Refund"("completedAt");
CREATE INDEX "Redemption_releasedAt" ON "PromoCodeRedemption"("releasedAt","promoCodeId","userId");
CREATE INDEX "Product_archivedAt" ON "Product"("archivedAt");
CREATE INDEX "Category_archivedAt" ON "Category"("archivedAt");
CREATE TRIGGER "revision_Refund_INSERT" AFTER INSERT ON "Refund" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Refund_UPDATE" AFTER UPDATE ON "Refund" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Refund_DELETE" AFTER DELETE ON "Refund" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_RefundDelivery_INSERT" AFTER INSERT ON "CustomerRefundNotificationDelivery" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_RefundDelivery_UPDATE" AFTER UPDATE ON "CustomerRefundNotificationDelivery" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_RefundDelivery_DELETE" AFTER DELETE ON "CustomerRefundNotificationDelivery" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
