-- New orders are physically isolated from legacy Order/Payment/Refund handlers.
CREATE TABLE CheckoutGroup (
 id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES User(id) ON DELETE RESTRICT,
 idempotencyKey TEXT NOT NULL, requestFingerprint TEXT NOT NULL,
 recipient TEXT NOT NULL CHECK(json_valid(recipient) AND json_type(recipient)='object'),
 goodsSubtotal INTEGER NOT NULL CHECK(typeof(goodsSubtotal)='integer' AND goodsSubtotal BETWEEN 0 AND 2147483647),
 discountAmount INTEGER NOT NULL CHECK(typeof(discountAmount)='integer' AND discountAmount BETWEEN 0 AND goodsSubtotal),
 goodsTotal INTEGER NOT NULL CHECK(goodsTotal=goodsSubtotal-discountAmount),
 sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN(0,1)), createdAt INTEGER NOT NULL,
 UNIQUE(userId,idempotencyKey), UNIQUE(id,userId)
);
CREATE TABLE CheckoutOrder (
 id TEXT PRIMARY KEY, publicId TEXT NOT NULL UNIQUE, checkoutGroupId TEXT NOT NULL REFERENCES CheckoutGroup(id) ON DELETE RESTRICT,
 saleMode TEXT NOT NULL CHECK(saleMode IN('IN_STOCK','PREORDER')),
 state TEXT NOT NULL DEFAULT 'PAYMENTS_BLOCKED' CHECK(state='PAYMENTS_BLOCKED'),
 financialPolicy TEXT NOT NULL CHECK(json_valid(financialPolicy) AND json_type(financialPolicy)='object'),
 goodsSubtotal INTEGER NOT NULL CHECK(typeof(goodsSubtotal)='integer' AND goodsSubtotal BETWEEN 0 AND 2147483647),
 discountAmount INTEGER NOT NULL CHECK(typeof(discountAmount)='integer' AND discountAmount BETWEEN 0 AND goodsSubtotal),
 goodsTotal INTEGER NOT NULL CHECK(goodsTotal=goodsSubtotal-discountAmount),
 prepaymentPercent INTEGER NOT NULL CHECK(prepaymentPercent IN(50,100) AND (saleMode='PREORDER' OR prepaymentPercent=100)),
 firstPaymentAmount INTEGER NOT NULL CHECK(firstPaymentAmount=CASE prepaymentPercent WHEN 100 THEN goodsTotal ELSE (goodsTotal/2)+(goodsTotal%2) END),
 remainingAfterFirst INTEGER NOT NULL CHECK(remainingAfterFirst=goodsTotal-firstPaymentAmount),
 goodsPaid INTEGER NOT NULL DEFAULT 0 CHECK(goodsPaid=0), unpaidGoods INTEGER NOT NULL CHECK(unpaidGoods=goodsTotal),
 cargoAmount INTEGER CHECK(cargoAmount IS NULL), cargoPaid INTEGER NOT NULL DEFAULT 0 CHECK(cargoPaid=0),
 createdAt INTEGER NOT NULL, UNIQUE(checkoutGroupId,saleMode), UNIQUE(id,saleMode),
 CHECK(COALESCE(json_extract(financialPolicy,'$.version')=1
 AND json_extract(financialPolicy,'$.saleMode')=saleMode
 AND json_extract(financialPolicy,'$.goodsSubtotal')=goodsSubtotal
 AND json_extract(financialPolicy,'$.discountAmount')=discountAmount
 AND json_extract(financialPolicy,'$.goodsTotal')=goodsTotal
 AND json_extract(financialPolicy,'$.prepaymentPercent')=prepaymentPercent
 AND json_extract(financialPolicy,'$.firstPaymentAmount')=firstPaymentAmount
 AND json_extract(financialPolicy,'$.goodsRemainderAfterFirstConfirmation')=remainingAfterFirst,0))
);
CREATE TABLE CheckoutOrderItem (
 id TEXT PRIMARY KEY, orderId TEXT NOT NULL, saleMode TEXT NOT NULL,
 cartItemId TEXT NOT NULL, productId TEXT NOT NULL REFERENCES Product(id) ON DELETE RESTRICT,
 variantId TEXT NOT NULL REFERENCES ProductVariant(id) ON DELETE RESTRICT,
 quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity BETWEEN 1 AND 99),
 unitPrice INTEGER NOT NULL CHECK(typeof(unitPrice)='integer' AND unitPrice BETWEEN 0 AND 2147483647),
 lineTotal INTEGER NOT NULL CHECK(lineTotal=unitPrice*quantity AND lineTotal BETWEEN 0 AND 2147483647),
 inventoryReservedQuantity INTEGER NOT NULL CHECK(inventoryReservedQuantity=CASE saleMode WHEN 'IN_STOCK' THEN quantity ELSE 0 END),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot) AND json_type(snapshot)='object' AND length(CAST(snapshot AS BLOB))<=65536),
 createdAt INTEGER NOT NULL, UNIQUE(orderId,variantId),
 FOREIGN KEY(orderId,saleMode) REFERENCES CheckoutOrder(id,saleMode) ON DELETE RESTRICT,
 CHECK(COALESCE(json_extract(snapshot,'$.version')=1 AND json_extract(snapshot,'$.saleMode')=saleMode
 AND json_extract(snapshot,'$.quantity')=quantity AND json_extract(snapshot,'$.unitPrice')=unitPrice
 AND json_extract(snapshot,'$.lineTotal')=lineTotal AND json_extract(snapshot,'$.variantId')=variantId
 AND json_extract(snapshot,'$.productId')=productId,0))
);
CREATE TABLE CheckoutPromoUse (
 id TEXT PRIMARY KEY, checkoutGroupId TEXT NOT NULL UNIQUE, userId TEXT NOT NULL,
 promoCodeId TEXT NOT NULL REFERENCES PromoCode(id) ON DELETE RESTRICT,
 discountAmount INTEGER NOT NULL CHECK(discountAmount>0), releasedAt INTEGER, createdAt INTEGER NOT NULL,
 FOREIGN KEY(checkoutGroupId,userId) REFERENCES CheckoutGroup(id,userId) ON DELETE RESTRICT
);
CREATE INDEX CheckoutPromoUse_limits ON CheckoutPromoUse(promoCodeId,userId,releasedAt);
-- Shared identifier/key namespace: a new ID must never resolve as a legacy order.
CREATE TRIGGER CheckoutGroup_legacy_key BEFORE INSERT ON CheckoutGroup WHEN EXISTS(SELECT 1 FROM "Order" WHERE userId=NEW.userId AND idempotencyKey=NEW.idempotencyKey) BEGIN SELECT RAISE(ABORT,'key belongs to legacy order'); END;
CREATE TRIGGER CheckoutOrder_legacy_identity BEFORE INSERT ON CheckoutOrder WHEN EXISTS(SELECT 1 FROM "Order" WHERE id=NEW.id OR publicId=NEW.publicId) BEGIN SELECT RAISE(ABORT,'identity belongs to legacy order'); END;
CREATE TRIGGER Order_linked_insert BEFORE INSERT ON "Order" WHEN EXISTS(SELECT 1 FROM CheckoutOrder WHERE id=NEW.id OR publicId=NEW.publicId) OR EXISTS(SELECT 1 FROM CheckoutGroup WHERE userId=NEW.userId AND idempotencyKey=NEW.idempotencyKey) BEGIN SELECT RAISE(ABORT,'identity or key belongs to linked checkout'); END;
CREATE TRIGGER Order_linked_update BEFORE UPDATE OF id,publicId,userId,idempotencyKey ON "Order" WHEN EXISTS(SELECT 1 FROM CheckoutOrder WHERE id=NEW.id OR publicId=NEW.publicId) OR EXISTS(SELECT 1 FROM CheckoutGroup WHERE userId=NEW.userId AND idempotencyKey=NEW.idempotencyKey) BEGIN SELECT RAISE(ABORT,'identity or key belongs to linked checkout'); END;
CREATE TRIGGER CheckoutGroup_seal BEFORE UPDATE ON CheckoutGroup WHEN OLD.sealed=0 BEGIN  SELECT CASE WHEN NEW.id<>OLD.id OR NEW.userId<>OLD.userId OR NEW.idempotencyKey<>OLD.idempotencyKey OR NEW.requestFingerprint<>OLD.requestFingerprint OR NEW.recipient<>OLD.recipient OR NEW.goodsSubtotal<>OLD.goodsSubtotal OR NEW.discountAmount<>OLD.discountAmount OR NEW.goodsTotal<>OLD.goodsTotal OR NEW.createdAt<>OLD.createdAt OR NEW.sealed<>1 THEN RAISE(ABORT,'invalid group seal') END;  SELECT CASE WHEN (SELECT COUNT(*) FROM CheckoutOrder WHERE checkoutGroupId=OLD.id) NOT BETWEEN 1 AND 2 THEN RAISE(ABORT,'incomplete group') END;  SELECT CASE WHEN (SELECT SUM(goodsSubtotal) FROM CheckoutOrder WHERE checkoutGroupId=OLD.id)<>OLD.goodsSubtotal OR (SELECT SUM(discountAmount) FROM CheckoutOrder WHERE checkoutGroupId=OLD.id)<>OLD.discountAmount OR (SELECT SUM(goodsTotal) FROM CheckoutOrder WHERE checkoutGroupId=OLD.id)<>OLD.goodsTotal THEN RAISE(ABORT,'group money mismatch') END;  SELECT CASE WHEN EXISTS(SELECT 1 FROM CheckoutOrder o WHERE o.checkoutGroupId=OLD.id AND ((SELECT COUNT(*) FROM CheckoutOrderItem i WHERE i.orderId=o.id)=0 OR (SELECT SUM(lineTotal) FROM CheckoutOrderItem i WHERE i.orderId=o.id)<>o.goodsSubtotal)) THEN RAISE(ABORT,'incomplete order items') END;  SELECT CASE WHEN OLD.discountAmount>0 AND COALESCE((SELECT discountAmount FROM CheckoutPromoUse WHERE checkoutGroupId=OLD.id),0)<>OLD.discountAmount THEN RAISE(ABORT,'missing group promotion') END; END;
CREATE TRIGGER CheckoutGroup_locked BEFORE UPDATE ON CheckoutGroup WHEN OLD.sealed=1 BEGIN SELECT RAISE(ABORT,'linked group immutable until 2.4C'); END;
CREATE TRIGGER CheckoutGroup_delete BEFORE DELETE ON CheckoutGroup BEGIN SELECT RAISE(ABORT,'linked group deletion blocked'); END;
CREATE TRIGGER CheckoutGroup_insert BEFORE INSERT ON CheckoutGroup WHEN NEW.sealed<>0 BEGIN SELECT RAISE(ABORT,'group must be sealed after items'); END;
CREATE TRIGGER CheckoutOrder_insert BEFORE INSERT ON CheckoutOrder WHEN (SELECT sealed FROM CheckoutGroup WHERE id=NEW.checkoutGroupId)<>0 BEGIN SELECT RAISE(ABORT,'sealed group'); END;
CREATE TRIGGER CheckoutOrderItem_insert BEFORE INSERT ON CheckoutOrderItem WHEN (SELECT g.sealed FROM CheckoutOrder o JOIN CheckoutGroup g ON g.id=o.checkoutGroupId WHERE o.id=NEW.orderId)<>0 BEGIN SELECT RAISE(ABORT,'sealed group'); END;
CREATE TRIGGER CheckoutPromoUse_insert BEFORE INSERT ON CheckoutPromoUse WHEN (SELECT sealed FROM CheckoutGroup WHERE id=NEW.checkoutGroupId)<>0 OR NEW.discountAmount<>(SELECT discountAmount FROM CheckoutGroup WHERE id=NEW.checkoutGroupId) OR NEW.releasedAt IS NOT NULL BEGIN SELECT RAISE(ABORT,'invalid group promotion'); END;
CREATE TRIGGER CheckoutOrder_update BEFORE UPDATE ON CheckoutOrder BEGIN SELECT RAISE(ABORT,'new payment operations blocked until 2.4C'); END;
CREATE TRIGGER CheckoutOrder_delete BEFORE DELETE ON CheckoutOrder BEGIN SELECT RAISE(ABORT,'new cancellation blocked until 2.4C'); END;
CREATE TRIGGER CheckoutOrderItem_update BEFORE UPDATE ON CheckoutOrderItem BEGIN SELECT RAISE(ABORT,'linked snapshot immutable'); END;
CREATE TRIGGER CheckoutOrderItem_delete BEFORE DELETE ON CheckoutOrderItem BEGIN SELECT RAISE(ABORT,'linked snapshot immutable'); END;
CREATE TRIGGER CheckoutPromoUse_update BEFORE UPDATE ON CheckoutPromoUse BEGIN SELECT RAISE(ABORT,'group promotion release blocked until 2.4C'); END;
CREATE TRIGGER CheckoutPromoUse_delete BEFORE DELETE ON CheckoutPromoUse BEGIN SELECT RAISE(ABORT,'group promotion deletion blocked'); END;

CREATE TRIGGER revision_CheckoutGroup_INSERT AFTER INSERT ON CheckoutGroup BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutGroup_UPDATE AFTER UPDATE ON CheckoutGroup BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutGroup_DELETE AFTER DELETE ON CheckoutGroup BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutOrder_INSERT AFTER INSERT ON CheckoutOrder BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutOrder_UPDATE AFTER UPDATE ON CheckoutOrder BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutOrder_DELETE AFTER DELETE ON CheckoutOrder BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutOrderItem_INSERT AFTER INSERT ON CheckoutOrderItem BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutOrderItem_UPDATE AFTER UPDATE ON CheckoutOrderItem BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutOrderItem_DELETE AFTER DELETE ON CheckoutOrderItem BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutPromoUse_INSERT AFTER INSERT ON CheckoutPromoUse BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutPromoUse_UPDATE AFTER UPDATE ON CheckoutPromoUse BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutPromoUse_DELETE AFTER DELETE ON CheckoutPromoUse BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
