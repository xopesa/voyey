-- Additive policy version; all historical codes remain version 1. Apply in one D1 batch.
ALTER TABLE PromoCode ADD COLUMN engineVersion INTEGER NOT NULL DEFAULT 1 CHECK(engineVersion IN(1,2));
CREATE TABLE PromoCampaign (
 id TEXT PRIMARY KEY NOT NULL,campaignKey TEXT NOT NULL UNIQUE CHECK(length(campaignKey) BETWEEN 3 AND 64 AND campaignKey=upper(trim(campaignKey)) AND campaignKey NOT GLOB '*[^A-Z0-9_-]*'),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 createdBy TEXT NOT NULL REFERENCES User(id) ON DELETE RESTRICT,createdAt INTEGER NOT NULL CHECK(typeof(createdAt)='integer')
);
CREATE TABLE PromoCodePolicy (
 promoCodeId TEXT PRIMARY KEY NOT NULL REFERENCES PromoCode(id) ON DELETE RESTRICT,
 saleModes TEXT NOT NULL CHECK(saleModes IN('IN_STOCK','PREORDER','BOTH')),
 audience TEXT NOT NULL CHECK(audience IN('PUBLIC','PERSONAL','BLOGGER')),
 purpose TEXT NOT NULL CHECK(purpose IN('STANDARD','COMPENSATION')),
 personalUserId TEXT REFERENCES User(id) ON DELETE RESTRICT,campaignId TEXT REFERENCES PromoCampaign(id) ON DELETE RESTRICT,
 scope TEXT NOT NULL CHECK(scope IN('ALL','CATEGORIES','PRODUCTS')),
 createdBy TEXT NOT NULL REFERENCES User(id) ON DELETE RESTRICT,createdAt INTEGER NOT NULL CHECK(typeof(createdAt)='integer'),
 sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN(0,1)),
 CHECK((audience='PERSONAL' AND personalUserId IS NOT NULL) OR (audience<>'PERSONAL' AND personalUserId IS NULL)),
 CHECK((audience='BLOGGER' AND campaignId IS NOT NULL) OR (audience<>'BLOGGER' AND campaignId IS NULL)),
 CHECK(purpose<>'COMPENSATION' OR audience='PERSONAL')
);
CREATE TABLE PromoPolicyCategory (
 promoCodeId TEXT NOT NULL REFERENCES PromoCodePolicy(promoCodeId) ON DELETE RESTRICT,
 categoryId TEXT NOT NULL REFERENCES Category(id) ON DELETE RESTRICT,PRIMARY KEY(promoCodeId,categoryId)
);
CREATE TABLE PromoPolicyProduct (
 promoCodeId TEXT NOT NULL REFERENCES PromoCodePolicy(promoCodeId) ON DELETE RESTRICT,
 productId TEXT NOT NULL REFERENCES Product(id) ON DELETE RESTRICT,PRIMARY KEY(promoCodeId,productId)
);
CREATE TABLE PromoPolicyExclusion (
 promoCodeId TEXT NOT NULL REFERENCES PromoCodePolicy(promoCodeId) ON DELETE RESTRICT,
 productId TEXT NOT NULL REFERENCES Product(id) ON DELETE RESTRICT,
 saleModes TEXT NOT NULL CHECK(saleModes IN('IN_STOCK','PREORDER','BOTH')),PRIMARY KEY(promoCodeId,productId,saleModes)
);
CREATE TRIGGER PromoCode_canonical_duplicate BEFORE INSERT ON PromoCode WHEN EXISTS(SELECT 1 FROM PromoCode WHERE upper(trim(code))=upper(trim(NEW.code))) BEGIN SELECT RAISE(ABORT,'normalized promo code duplicate'); END;
CREATE TRIGGER PromoCode_v2_insert BEFORE INSERT ON PromoCode WHEN NEW.engineVersion=2 BEGIN SELECT CASE WHEN NEW.code<>upper(trim(NEW.code)) OR NEW.code GLOB '*[^A-Z0-9-]*' OR substr(NEW.code,1,1)='-' OR substr(NEW.code,-1,1)='-' OR instr(NEW.code,'--')>0 OR typeof(NEW.value)<>'integer' OR typeof(NEW.perUserLimit)<>'integer' OR (NEW.minOrderAmount IS NOT NULL AND typeof(NEW.minOrderAmount)<>'integer') OR (NEW.maxDiscount IS NOT NULL AND typeof(NEW.maxDiscount)<>'integer') OR (NEW.usageLimit IS NOT NULL AND typeof(NEW.usageLimit)<>'integer') OR (NEW.startsAt IS NOT NULL AND typeof(NEW.startsAt)<>'integer') OR (NEW.endsAt IS NOT NULL AND typeof(NEW.endsAt)<>'integer') OR (NEW.type='FIXED' AND NEW.maxDiscount IS NOT NULL) THEN RAISE(ABORT,'invalid advanced promo configuration') END; END;
CREATE TRIGGER PromoCode_version_update BEFORE UPDATE ON PromoCode BEGIN SELECT CASE WHEN NEW.engineVersion IS NOT OLD.engineVersion THEN RAISE(ABORT,'promo engine version immutable') END; SELECT CASE WHEN OLD.engineVersion=2 AND (NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.type IS NOT OLD.type OR NEW.value IS NOT OLD.value OR NEW.minOrderAmount IS NOT OLD.minOrderAmount OR NEW.maxDiscount IS NOT OLD.maxDiscount OR NEW.startsAt IS NOT OLD.startsAt OR NEW.endsAt IS NOT OLD.endsAt OR NEW.usageLimit IS NOT OLD.usageLimit OR NEW.perUserLimit IS NOT OLD.perUserLimit OR NEW.createdAt IS NOT OLD.createdAt) THEN RAISE(ABORT,'advanced promo terms immutable') END; SELECT CASE WHEN OLD.engineVersion=1 AND NEW.code IS NOT OLD.code AND EXISTS(SELECT 1 FROM PromoCode WHERE id<>OLD.id AND upper(trim(code))=upper(trim(NEW.code))) THEN RAISE(ABORT,'normalized promo code duplicate') END; END;
CREATE TRIGGER PromoCode_v2_delete BEFORE DELETE ON PromoCode WHEN OLD.engineVersion=2 BEGIN SELECT RAISE(ABORT,'advanced promo identity immutable'); END;
CREATE TRIGGER PromoCampaign_insert BEFORE INSERT ON PromoCampaign WHEN NOT EXISTS(SELECT 1 FROM User u JOIN TelegramAdmin a ON a.telegramId=CAST(u.telegramId AS TEXT) WHERE u.id=NEW.createdBy AND u.status='ACTIVE' AND a.isActive=1) BEGIN SELECT RAISE(ABORT,'active campaign initiator required'); END;
CREATE TRIGGER PromoCodePolicy_insert BEFORE INSERT ON PromoCodePolicy BEGIN SELECT CASE WHEN NEW.sealed<>0 OR NOT EXISTS(SELECT 1 FROM User u JOIN TelegramAdmin a ON a.telegramId=CAST(u.telegramId AS TEXT) WHERE u.id=NEW.createdBy AND u.status='ACTIVE' AND a.isActive=1) OR NOT EXISTS(SELECT 1 FROM PromoCode WHERE id=NEW.promoCodeId AND engineVersion=2) OR (NEW.personalUserId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM User WHERE id=NEW.personalUserId AND status='ACTIVE')) THEN RAISE(ABORT,'invalid advanced promo policy') END; END;
CREATE TRIGGER PromoCodePolicy_seal BEFORE UPDATE ON PromoCodePolicy BEGIN SELECT CASE WHEN OLD.sealed<>0 OR NEW.sealed<>1 OR NEW.promoCodeId IS NOT OLD.promoCodeId OR NEW.saleModes IS NOT OLD.saleModes OR NEW.audience IS NOT OLD.audience OR NEW.purpose IS NOT OLD.purpose OR NEW.personalUserId IS NOT OLD.personalUserId OR NEW.campaignId IS NOT OLD.campaignId OR NEW.scope IS NOT OLD.scope OR NEW.createdBy IS NOT OLD.createdBy OR NEW.createdAt IS NOT OLD.createdAt THEN RAISE(ABORT,'promo policy immutable') END; SELECT CASE WHEN (OLD.scope='CATEGORIES')<>((SELECT COUNT(*) FROM PromoPolicyCategory WHERE promoCodeId=OLD.promoCodeId)>0) OR (OLD.scope='PRODUCTS')<>((SELECT COUNT(*) FROM PromoPolicyProduct WHERE promoCodeId=OLD.promoCodeId)>0) OR NOT EXISTS(SELECT 1 FROM AuditLog WHERE action='promo-policy.created' AND entityType='PromoPolicy' AND entityId=OLD.promoCodeId AND actorId=OLD.createdBy) THEN RAISE(ABORT,'incomplete promo scope or audit') END; END;
CREATE TRIGGER PromoPolicyExclusion_overlap BEFORE INSERT ON PromoPolicyExclusion WHEN EXISTS(SELECT 1 FROM PromoPolicyExclusion WHERE promoCodeId=NEW.promoCodeId AND productId=NEW.productId AND (saleModes='BOTH' OR NEW.saleModes='BOTH')) BEGIN SELECT RAISE(ABORT,'overlapping promo exclusion'); END;
CREATE TRIGGER PromoPolicyCategory_insert BEFORE INSERT ON PromoPolicyCategory WHEN NOT EXISTS(SELECT 1 FROM PromoCodePolicy WHERE promoCodeId=NEW.promoCodeId AND sealed=0) BEGIN SELECT RAISE(ABORT,'sealed promo policy'); END;
CREATE TRIGGER PromoPolicyProduct_insert BEFORE INSERT ON PromoPolicyProduct WHEN NOT EXISTS(SELECT 1 FROM PromoCodePolicy WHERE promoCodeId=NEW.promoCodeId AND sealed=0) BEGIN SELECT RAISE(ABORT,'sealed promo policy'); END;
CREATE TRIGGER PromoPolicyExclusion_insert BEFORE INSERT ON PromoPolicyExclusion WHEN NOT EXISTS(SELECT 1 FROM PromoCodePolicy WHERE promoCodeId=NEW.promoCodeId AND sealed=0) BEGIN SELECT RAISE(ABORT,'sealed promo policy'); END;
CREATE TRIGGER PromoCodeRedemption_advanced_blocked BEFORE INSERT ON PromoCodeRedemption WHEN (SELECT engineVersion FROM PromoCode WHERE id=NEW.promoCodeId)=2 BEGIN SELECT RAISE(ABORT,'advanced promo lifecycle disabled'); END;
CREATE TRIGGER CheckoutPromoUse_advanced_blocked BEFORE INSERT ON CheckoutPromoUse WHEN (SELECT engineVersion FROM PromoCode WHERE id=NEW.promoCodeId)=2 BEGIN SELECT RAISE(ABORT,'advanced promo lifecycle disabled'); END;
CREATE TRIGGER PromoCampaign_update BEFORE UPDATE ON PromoCampaign BEGIN SELECT RAISE(ABORT,'promo policy immutable'); END;
CREATE TRIGGER PromoCampaign_delete BEFORE DELETE ON PromoCampaign BEGIN SELECT RAISE(ABORT,'promo policy immutable'); END;
CREATE TRIGGER revision_PromoCampaign_INSERT AFTER INSERT ON PromoCampaign BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_PromoCampaign_UPDATE AFTER UPDATE ON PromoCampaign BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_PromoCampaign_DELETE AFTER DELETE ON PromoCampaign BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER PromoCodePolicy_delete BEFORE DELETE ON PromoCodePolicy BEGIN SELECT RAISE(ABORT,'promo policy immutable'); END;
CREATE TRIGGER revision_PromoCodePolicy_INSERT AFTER INSERT ON PromoCodePolicy BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_PromoCodePolicy_UPDATE AFTER UPDATE ON PromoCodePolicy BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_PromoCodePolicy_DELETE AFTER DELETE ON PromoCodePolicy BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER PromoPolicyCategory_update BEFORE UPDATE ON PromoPolicyCategory BEGIN SELECT RAISE(ABORT,'promo policy immutable'); END;
CREATE TRIGGER PromoPolicyCategory_delete BEFORE DELETE ON PromoPolicyCategory BEGIN SELECT RAISE(ABORT,'promo policy immutable'); END;
CREATE TRIGGER revision_PromoPolicyCategory_INSERT AFTER INSERT ON PromoPolicyCategory BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_PromoPolicyCategory_UPDATE AFTER UPDATE ON PromoPolicyCategory BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_PromoPolicyCategory_DELETE AFTER DELETE ON PromoPolicyCategory BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER PromoPolicyProduct_update BEFORE UPDATE ON PromoPolicyProduct BEGIN SELECT RAISE(ABORT,'promo policy immutable'); END;
CREATE TRIGGER PromoPolicyProduct_delete BEFORE DELETE ON PromoPolicyProduct BEGIN SELECT RAISE(ABORT,'promo policy immutable'); END;
CREATE TRIGGER revision_PromoPolicyProduct_INSERT AFTER INSERT ON PromoPolicyProduct BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_PromoPolicyProduct_UPDATE AFTER UPDATE ON PromoPolicyProduct BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_PromoPolicyProduct_DELETE AFTER DELETE ON PromoPolicyProduct BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER PromoPolicyExclusion_update BEFORE UPDATE ON PromoPolicyExclusion BEGIN SELECT RAISE(ABORT,'promo policy immutable'); END;
CREATE TRIGGER PromoPolicyExclusion_delete BEFORE DELETE ON PromoPolicyExclusion BEGIN SELECT RAISE(ABORT,'promo policy immutable'); END;
CREATE TRIGGER revision_PromoPolicyExclusion_INSERT AFTER INSERT ON PromoPolicyExclusion BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_PromoPolicyExclusion_UPDATE AFTER UPDATE ON PromoPolicyExclusion BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_PromoPolicyExclusion_DELETE AFTER DELETE ON PromoPolicyExclusion BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
UPDATE _Revision SET version=version+1 WHERE id=1;
