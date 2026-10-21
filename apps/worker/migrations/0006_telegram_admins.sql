-- Preview admin roles and durable notification receipts; no credentials.
CREATE TABLE "TelegramAdmin" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "telegramId" TEXT NOT NULL UNIQUE CHECK (
    typeof("telegramId") = 'text' AND length("telegramId") BETWEEN 1 AND 16
    AND "telegramId" NOT GLOB '*[^0-9]*' AND substr("telegramId",1,1) != '0'
    AND CAST("telegramId" AS INTEGER) <= 9007199254740991
  ),
  "label" TEXT,
  "isActive" INTEGER NOT NULL DEFAULT 1 CHECK ("isActive" IN (0,1)),
  "notifyNewOrders" INTEGER NOT NULL DEFAULT 1 CHECK ("notifyNewOrders" IN (0,1)),
  "notifyPayments" INTEGER NOT NULL DEFAULT 1 CHECK ("notifyPayments" IN (0,1)),
  "createdBy" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE TABLE "TelegramNotificationDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventKey" TEXT NOT NULL,
  "telegramId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL CHECK ("eventType" IN ('order.created','payment.submitted')),
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','SENT','FAILED')),
  "attemptId" TEXT NOT NULL,
  "telegramMessageId" INTEGER CHECK ("telegramMessageId" IS NULL OR "telegramMessageId" > 0),
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  "sentAt" INTEGER,
  "lastErrorCode" TEXT,
  CHECK ("status" != 'SENT' OR ("telegramMessageId" IS NOT NULL AND "sentAt" IS NOT NULL)),
  UNIQUE ("eventKey", "telegramId")
);
CREATE TRIGGER "revision_TelegramAdmin_INSERT" AFTER INSERT ON "TelegramAdmin" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_TelegramAdmin_UPDATE" AFTER UPDATE ON "TelegramAdmin" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_TelegramAdmin_DELETE" AFTER DELETE ON "TelegramAdmin" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_TelegramNotificationDelivery_INSERT" AFTER INSERT ON "TelegramNotificationDelivery" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_TelegramNotificationDelivery_UPDATE" AFTER UPDATE ON "TelegramNotificationDelivery" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_TelegramNotificationDelivery_DELETE" AFTER DELETE ON "TelegramNotificationDelivery" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
