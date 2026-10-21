-- Additive, D1-only notification infrastructure (like MediaObject/MediaChunk).
-- No changes to business tables or existing admin delivery receipts in 0006.
CREATE TABLE "CustomerTelegramNotificationDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventKey" TEXT NOT NULL,
  "telegramId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL CHECK ("eventType" IN ('payment.approved','payment.rejected','order.status_changed','order.final_payment_requested')),
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','SENT','FAILED')),
  "attemptId" TEXT NOT NULL,
  "telegramMessageId" INTEGER CHECK ("telegramMessageId" IS NULL OR "telegramMessageId" > 0),
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  "sentAt" INTEGER,
  "lastErrorCode" TEXT CHECK ("lastErrorCode" IS NULL OR "lastErrorCode" IN ('TELEGRAM_REJECTED','DELIVERY_UNCONFIRMED')),
  CHECK ("status" != 'SENT' OR ("telegramMessageId" IS NOT NULL AND "sentAt" IS NOT NULL)),
  UNIQUE ("eventKey", "telegramId")
);
CREATE TRIGGER "revision_CustomerTelegramNotificationDelivery_INSERT" AFTER INSERT ON "CustomerTelegramNotificationDelivery" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_CustomerTelegramNotificationDelivery_UPDATE" AFTER UPDATE ON "CustomerTelegramNotificationDelivery" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_CustomerTelegramNotificationDelivery_DELETE" AFTER DELETE ON "CustomerTelegramNotificationDelivery" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
