-- Additive marketing schema. No existing business records are rewritten.
CREATE TABLE "PromoCode" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "code" TEXT NOT NULL UNIQUE CHECK (length("code") BETWEEN 3 AND 32 AND "code"=upper("code")),
 "type" TEXT NOT NULL CHECK ("type" IN ('PERCENT','FIXED')),
 "value" INTEGER NOT NULL CHECK ("value" BETWEEN 1 AND 2147483647 AND ("type"<>'PERCENT' OR "value"<=90)),
 "minOrderAmount" INTEGER CHECK ("minOrderAmount" BETWEEN 1 AND 2147483647),
 "maxDiscount" INTEGER CHECK ("maxDiscount" BETWEEN 1 AND 2147483647),
 "startsAt" INTEGER, "endsAt" INTEGER,
 "usageLimit" INTEGER CHECK ("usageLimit" BETWEEN 1 AND 2147483647),
 "perUserLimit" INTEGER NOT NULL DEFAULT 1 CHECK ("perUserLimit" BETWEEN 1 AND 2147483647),
 "isActive" INTEGER NOT NULL DEFAULT 0 CHECK ("isActive" IN (0,1)),
 "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL,
 CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "startsAt"<"endsAt")
);
CREATE TABLE "PromoCodeRedemption" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "promoCodeId" TEXT NOT NULL REFERENCES "PromoCode"("id") ON DELETE RESTRICT,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "orderId" TEXT NOT NULL UNIQUE REFERENCES "Order"("id") ON DELETE RESTRICT,
 "discountAmount" INTEGER NOT NULL CHECK ("discountAmount">0),
 "createdAt" INTEGER NOT NULL
);
CREATE INDEX "PromoCodeRedemption_promo" ON "PromoCodeRedemption"("promoCodeId");
CREATE INDEX "PromoCodeRedemption_user" ON "PromoCodeRedemption"("userId");
CREATE INDEX "PromoCodeRedemption_created" ON "PromoCodeRedemption"("createdAt");
ALTER TABLE "Order" ADD COLUMN "discountAmount" INTEGER NOT NULL DEFAULT 0 CHECK ("discountAmount">=0);
ALTER TABLE "Order" ADD COLUMN "promoCodeSnapshot" TEXT;
-- 0001 has an immutable subtotal=total CHECK. Keep that legacy column as the
-- net compatibility amount; expose itemsSubtotal as the canonical API subtotal.
-- Existing rows keep NULL and read their original subtotal. No table rebuild,
-- order rewrite, foreign-key disable, or historical amount change is needed.
ALTER TABLE "Order" ADD COLUMN "itemsSubtotal" INTEGER CHECK ("itemsSubtotal" IS NULL OR ("itemsSubtotal" BETWEEN 1 AND 2147483647 AND "itemsSubtotal"-"discountAmount"="total"));
CREATE TRIGGER "revision_PromoCode_INSERT" AFTER INSERT ON "PromoCode" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_PromoCode_UPDATE" AFTER UPDATE ON "PromoCode" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_PromoCode_DELETE" AFTER DELETE ON "PromoCode" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_PromoCodeRedemption_INSERT" AFTER INSERT ON "PromoCodeRedemption" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_PromoCodeRedemption_UPDATE" AFTER UPDATE ON "PromoCodeRedemption" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_PromoCodeRedemption_DELETE" AFTER DELETE ON "PromoCodeRedemption" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
