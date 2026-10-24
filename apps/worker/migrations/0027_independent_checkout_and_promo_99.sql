-- Apply as ONE atomic D1 batch. Never rename the FK parent or disable foreign keys.
-- Existing child references use RESTRICT. Deferred checks allow same-name rebuilding,
-- all data, FK targets, indexes and parent triggers are restored before commit.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE _PromoCode_0027_copy AS SELECT * FROM PromoCode;
DROP TABLE PromoCode;
CREATE TABLE "PromoCode" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "code" TEXT NOT NULL UNIQUE CHECK (length("code") BETWEEN 3 AND 32 AND "code"=upper("code")),
 "type" TEXT NOT NULL CHECK ("type" IN ('PERCENT','FIXED')),
 "value" INTEGER NOT NULL CHECK ("value" BETWEEN 1 AND 2147483647 AND ("type"<>'PERCENT' OR "value"<=CASE engineVersion WHEN 2 THEN 99 ELSE 90 END)),
 "minOrderAmount" INTEGER CHECK ("minOrderAmount" BETWEEN 1 AND 2147483647),
 "maxDiscount" INTEGER CHECK ("maxDiscount" BETWEEN 1 AND 2147483647),
 "startsAt" INTEGER, "endsAt" INTEGER,
 "usageLimit" INTEGER CHECK ("usageLimit" BETWEEN 1 AND 2147483647),
 "perUserLimit" INTEGER NOT NULL DEFAULT 1 CHECK ("perUserLimit" BETWEEN 1 AND 2147483647),
 "isActive" INTEGER NOT NULL DEFAULT 0 CHECK ("isActive" IN (0,1)),
 "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL,
 "engineVersion" INTEGER NOT NULL DEFAULT 1 CHECK(engineVersion IN(1,2)),
 CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "startsAt"<"endsAt")
);
INSERT INTO PromoCode SELECT * FROM _PromoCode_0027_copy;
DROP TABLE _PromoCode_0027_copy;
CREATE TRIGGER "revision_PromoCode_INSERT" AFTER INSERT ON "PromoCode" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_PromoCode_UPDATE" AFTER UPDATE ON "PromoCode" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_PromoCode_DELETE" AFTER DELETE ON "PromoCode" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER PromoCode_canonical_duplicate BEFORE INSERT ON PromoCode WHEN EXISTS(SELECT 1 FROM PromoCode WHERE upper(trim(code))=upper(trim(NEW.code))) BEGIN SELECT RAISE(ABORT,'normalized promo code duplicate'); END;
CREATE TRIGGER PromoCode_v2_insert BEFORE INSERT ON PromoCode WHEN NEW.engineVersion=2 BEGIN SELECT CASE WHEN NEW.code<>upper(trim(NEW.code)) OR NEW.code GLOB '*[^A-Z0-9-]*' OR substr(NEW.code,1,1)='-' OR substr(NEW.code,-1,1)='-' OR instr(NEW.code,'--')>0 OR typeof(NEW.value)<>'integer' OR typeof(NEW.perUserLimit)<>'integer' OR (NEW.minOrderAmount IS NOT NULL AND typeof(NEW.minOrderAmount)<>'integer') OR (NEW.maxDiscount IS NOT NULL AND typeof(NEW.maxDiscount)<>'integer') OR (NEW.usageLimit IS NOT NULL AND typeof(NEW.usageLimit)<>'integer') OR (NEW.startsAt IS NOT NULL AND typeof(NEW.startsAt)<>'integer') OR (NEW.endsAt IS NOT NULL AND typeof(NEW.endsAt)<>'integer') OR (NEW.type='FIXED' AND NEW.maxDiscount IS NOT NULL) THEN RAISE(ABORT,'invalid advanced promo configuration') END; END;
CREATE TRIGGER PromoCode_version_update BEFORE UPDATE ON PromoCode BEGIN SELECT CASE WHEN NEW.engineVersion IS NOT OLD.engineVersion THEN RAISE(ABORT,'promo engine version immutable') END; SELECT CASE WHEN OLD.engineVersion=2 AND (NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.type IS NOT OLD.type OR NEW.value IS NOT OLD.value OR NEW.minOrderAmount IS NOT OLD.minOrderAmount OR NEW.maxDiscount IS NOT OLD.maxDiscount OR NEW.startsAt IS NOT OLD.startsAt OR NEW.endsAt IS NOT OLD.endsAt OR NEW.usageLimit IS NOT OLD.usageLimit OR NEW.perUserLimit IS NOT OLD.perUserLimit OR NEW.createdAt IS NOT OLD.createdAt) THEN RAISE(ABORT,'advanced promo terms immutable') END; SELECT CASE WHEN OLD.engineVersion=1 AND NEW.code IS NOT OLD.code AND EXISTS(SELECT 1 FROM PromoCode WHERE id<>OLD.id AND upper(trim(code))=upper(trim(NEW.code))) THEN RAISE(ABORT,'normalized promo code duplicate') END; END;
CREATE TRIGGER PromoCode_v2_delete BEFORE DELETE ON PromoCode WHEN OLD.engineVersion=2 BEGIN SELECT RAISE(ABORT,'advanced promo identity immutable'); END;
-- NULL is the historical 1/2-order contract. Only the new internal writer selects a mode.
ALTER TABLE CheckoutGroup ADD COLUMN selectedSaleMode TEXT CHECK(selectedSaleMode IS NULL OR selectedSaleMode IN('IN_STOCK','PREORDER'));
CREATE TRIGGER CheckoutGroup_selection_immutable BEFORE UPDATE ON CheckoutGroup WHEN NEW.selectedSaleMode IS NOT OLD.selectedSaleMode BEGIN SELECT RAISE(ABORT,'checkout selection immutable'); END;
CREATE TRIGGER CheckoutGroup_selection_insert BEFORE INSERT ON CheckoutGroup WHEN NEW.selectedSaleMode IS NOT NULL AND (NEW.goodsSubtotal<=0 OR NEW.goodsTotal<=0) BEGIN SELECT RAISE(ABORT,'positive selected checkout required'); END;
CREATE TRIGGER CheckoutOrder_selection_insert BEFORE INSERT ON CheckoutOrder WHEN EXISTS(SELECT 1 FROM CheckoutGroup WHERE id=NEW.checkoutGroupId AND selectedSaleMode IS NOT NULL) BEGIN SELECT CASE WHEN NEW.saleMode<>(SELECT selectedSaleMode FROM CheckoutGroup WHERE id=NEW.checkoutGroupId) OR NEW.goodsSubtotal<=0 OR NEW.goodsTotal<=0 OR NEW.firstPaymentAmount<=0 OR EXISTS(SELECT 1 FROM CheckoutOrder WHERE checkoutGroupId=NEW.checkoutGroupId) THEN RAISE(ABORT,'exactly one positive selected-mode order required') END; END;
CREATE TRIGGER CheckoutOrderItem_selection_insert BEFORE INSERT ON CheckoutOrderItem WHEN NEW.unitPrice<=0 AND EXISTS(SELECT 1 FROM CheckoutOrder o JOIN CheckoutGroup g ON g.id=o.checkoutGroupId WHERE o.id=NEW.orderId AND g.selectedSaleMode IS NOT NULL) BEGIN SELECT RAISE(ABORT,'positive selected goods price required'); END;
CREATE TRIGGER CheckoutGroup_selection_seal BEFORE UPDATE OF sealed ON CheckoutGroup WHEN OLD.selectedSaleMode IS NOT NULL BEGIN SELECT CASE WHEN (SELECT COUNT(*) FROM CheckoutOrder WHERE checkoutGroupId=OLD.id)<>1 OR EXISTS(SELECT 1 FROM CheckoutOrder WHERE checkoutGroupId=OLD.id AND (saleMode<>OLD.selectedSaleMode OR goodsTotal<=0 OR firstPaymentAmount<=0)) THEN RAISE(ABORT,'incomplete selected checkout') END; END;
UPDATE _Revision SET version=version+1 WHERE id=1;
