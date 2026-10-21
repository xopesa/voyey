-- One durable publication attempt per product/channel; no secrets are stored.
CREATE TABLE "TelegramProductPost" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT,
  "channelChatId" TEXT NOT NULL,
  "messageId" INTEGER CHECK ("messageId" IS NULL OR "messageId" > 0),
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','PUBLISHED','FAILED')),
  "attemptId" TEXT NOT NULL,
  "publishedAt" INTEGER,
  "lastAttemptAt" INTEGER NOT NULL,
  "lastErrorCode" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  CHECK ("status" != 'PUBLISHED' OR ("messageId" IS NOT NULL AND "publishedAt" IS NOT NULL)),
  UNIQUE ("productId", "channelChatId")
);
CREATE TRIGGER "revision_TelegramProductPost_INSERT" AFTER INSERT ON "TelegramProductPost" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_TelegramProductPost_UPDATE" AFTER UPDATE ON "TelegramProductPost" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_TelegramProductPost_DELETE" AFTER DELETE ON "TelegramProductPost" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
