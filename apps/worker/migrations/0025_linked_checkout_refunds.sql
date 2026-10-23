-- Apply atomically in one D1 batch. Original 0021-0024 contracts/ledger/cancellations stay immutable.
-- Only FULL confirmed allocations; REQUESTED is not a monetary event.
CREATE UNIQUE INDEX CheckoutPaymentLedger_refund_fk ON CheckoutPaymentLedger(id,orderId);
CREATE TABLE CheckoutRefund (
 id TEXT PRIMARY KEY NOT NULL, orderId TEXT NOT NULL UNIQUE REFERENCES CheckoutOrder(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
 createdBy TEXT NOT NULL REFERENCES User(id) ON DELETE RESTRICT,createdAt INTEGER NOT NULL CHECK(typeof(createdAt)='integer'),
 operationKey TEXT NOT NULL CHECK(length(operationKey) BETWEEN 16 AND 200),
 requestFingerprint TEXT NOT NULL CHECK(length(requestFingerprint)=64 AND requestFingerprint NOT GLOB '*[^0-9a-f]*'),
 goodsAmount INTEGER NOT NULL CHECK(typeof(goodsAmount)='integer' AND goodsAmount BETWEEN 0 AND 2147483647),
 cargoAmount INTEGER NOT NULL CHECK(typeof(cargoAmount)='integer' AND cargoAmount BETWEEN 0 AND 2147483647),
 totalAmount INTEGER NOT NULL CHECK(totalAmount=goodsAmount+cargoAmount AND totalAmount BETWEEN 1 AND 2147483647),
 financialSnapshot TEXT NOT NULL CHECK(json_valid(financialSnapshot) AND json_type(financialSnapshot)='object'),
 sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN(0,1)), UNIQUE(id,orderId),UNIQUE(createdBy,operationKey)
);
CREATE TABLE CheckoutRefundAllocation (
 id TEXT PRIMARY KEY NOT NULL,refundId TEXT NOT NULL,orderId TEXT NOT NULL,
 paymentLedgerId TEXT NOT NULL UNIQUE,
 goodsAmount INTEGER NOT NULL CHECK(typeof(goodsAmount)='integer' AND goodsAmount BETWEEN 0 AND 2147483647),
 cargoAmount INTEGER NOT NULL CHECK(typeof(cargoAmount)='integer' AND cargoAmount BETWEEN 0 AND 2147483647),
 CHECK(goodsAmount+cargoAmount BETWEEN 1 AND 2147483647),
 FOREIGN KEY(refundId,orderId) REFERENCES CheckoutRefund(id,orderId) ON DELETE RESTRICT,
 FOREIGN KEY(paymentLedgerId,orderId) REFERENCES CheckoutPaymentLedger(id,orderId) ON DELETE RESTRICT
);
CREATE INDEX CheckoutRefundAllocation_refund ON CheckoutRefundAllocation(refundId);
CREATE TABLE CheckoutRefundLedger (
 id TEXT PRIMARY KEY NOT NULL,refundId TEXT NOT NULL UNIQUE,orderId TEXT NOT NULL UNIQUE,
 goodsAmount INTEGER NOT NULL CHECK(typeof(goodsAmount)='integer' AND goodsAmount BETWEEN 0 AND 2147483647),
 cargoAmount INTEGER NOT NULL CHECK(typeof(cargoAmount)='integer' AND cargoAmount BETWEEN 0 AND 2147483647),
 totalAmount INTEGER NOT NULL CHECK(totalAmount=goodsAmount+cargoAmount AND totalAmount BETWEEN 1 AND 2147483647),
 currency TEXT NOT NULL CHECK(currency='UZS'),
 confirmedBy TEXT NOT NULL REFERENCES User(id) ON DELETE RESTRICT,confirmedAt INTEGER NOT NULL CHECK(typeof(confirmedAt)='integer'),
 bankOperationDigest TEXT NOT NULL UNIQUE CHECK(length(bankOperationDigest)=64 AND bankOperationDigest NOT GLOB '*[^0-9a-f]*'),
 operationKey TEXT NOT NULL CHECK(length(operationKey) BETWEEN 16 AND 200),
 requestFingerprint TEXT NOT NULL CHECK(length(requestFingerprint)=64 AND requestFingerprint NOT GLOB '*[^0-9a-f]*'),
 bankTransferVerified INTEGER NOT NULL CHECK(bankTransferVerified=1),
 FOREIGN KEY(refundId,orderId) REFERENCES CheckoutRefund(id,orderId) ON DELETE RESTRICT,
 UNIQUE(id,refundId,orderId),UNIQUE(confirmedBy,operationKey)
);
CREATE TABLE CheckoutRefundStockReconciliation (
 id TEXT PRIMARY KEY NOT NULL,refundId TEXT NOT NULL UNIQUE,orderId TEXT NOT NULL UNIQUE,refundLedgerId TEXT NOT NULL UNIQUE,
 createdBy TEXT NOT NULL REFERENCES User(id) ON DELETE RESTRICT,createdAt INTEGER NOT NULL CHECK(typeof(createdAt)='integer'),
 operationKey TEXT NOT NULL CHECK(length(operationKey) BETWEEN 16 AND 200),
 requestFingerprint TEXT NOT NULL CHECK(length(requestFingerprint)=64 AND requestFingerprint NOT GLOB '*[^0-9a-f]*'),
 sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN(0,1)),
 FOREIGN KEY(refundLedgerId,refundId,orderId) REFERENCES CheckoutRefundLedger(id,refundId,orderId) ON DELETE RESTRICT,
 UNIQUE(id,refundId,orderId),UNIQUE(createdBy,operationKey)
);
CREATE TABLE CheckoutRefundStockRelease (
 id TEXT PRIMARY KEY NOT NULL,reconciliationId TEXT NOT NULL,refundId TEXT NOT NULL,orderId TEXT NOT NULL,
 itemId TEXT NOT NULL UNIQUE REFERENCES CheckoutOrderItem(id) ON DELETE RESTRICT,
 variantId TEXT NOT NULL REFERENCES ProductVariant(id) ON DELETE RESTRICT,
 quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity BETWEEN 1 AND 99),
 stockBefore INTEGER NOT NULL CHECK(typeof(stockBefore)='integer' AND stockBefore BETWEEN 0 AND 2147483647),
 stockAfter INTEGER NOT NULL CHECK(typeof(stockAfter)='integer' AND stockAfter=stockBefore+quantity AND stockAfter<=2147483647),
 createdAt INTEGER NOT NULL CHECK(typeof(createdAt)='integer'),
 FOREIGN KEY(reconciliationId,refundId,orderId) REFERENCES CheckoutRefundStockReconciliation(id,refundId,orderId) ON DELETE RESTRICT
);
CREATE INDEX CheckoutRefundStockRelease_order ON CheckoutRefundStockRelease(orderId);
CREATE TRIGGER CheckoutRefund_insert BEFORE INSERT ON CheckoutRefund BEGIN SELECT CASE WHEN NEW.sealed<>0 OR NOT EXISTS(SELECT 1 FROM User u JOIN TelegramAdmin a ON a.telegramId=CAST(u.telegramId AS TEXT) WHERE u.id=NEW.createdBy AND u.status='ACTIVE' AND a.isActive=1) OR NOT EXISTS(SELECT 1 FROM CheckoutOrder o JOIN CheckoutGroup g ON g.id=o.checkoutGroupId WHERE o.id=NEW.orderId AND g.sealed=1 AND o.state='PAYMENTS_BLOCKED' AND NEW.createdAt>=o.createdAt) OR EXISTS(SELECT 1 FROM CheckoutCancellation WHERE orderId=NEW.orderId) OR EXISTS(SELECT 1 FROM Refund WHERE orderId=NEW.orderId) OR EXISTS(SELECT 1 FROM CheckoutStockRelease WHERE orderId=NEW.orderId) THEN RAISE(ABORT,'invalid refund authority or order') END; SELECT CASE WHEN EXISTS(SELECT 1 FROM CheckoutPayment WHERE orderId=NEW.orderId AND status='SUBMITTED') THEN RAISE(ABORT,'refund blocked by pending receipt') END; SELECT CASE WHEN NEW.goodsAmount IS NOT (SELECT SUM(goodsAmount) FROM CheckoutPaymentLedger WHERE orderId=NEW.orderId) OR NEW.cargoAmount IS NOT (SELECT SUM(cargoAmount) FROM CheckoutPaymentLedger WHERE orderId=NEW.orderId) OR NOT EXISTS(SELECT 1 FROM CheckoutPaymentLedger WHERE orderId=NEW.orderId) OR EXISTS(SELECT 1 FROM CheckoutPaymentLedger l LEFT JOIN CheckoutPayment p ON p.id=l.paymentId WHERE l.orderId=NEW.orderId AND (p.status IS NOT 'APPROVED' OR p.confirmedAmount IS NOT l.goodsAmount+l.cargoAmount)) THEN RAISE(ABORT,'refund must equal full confirmed allocations') END; SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM CheckoutOrderFinance f WHERE f.orderId=NEW.orderId AND f.orderState='PAYMENTS_BLOCKED' AND f.fulfillmentAllowed=0 AND NOT(json_extract(NEW.financialSnapshot,'$.orderId') IS NOT f.orderId OR json_extract(NEW.financialSnapshot,'$.userId') IS NOT f.userId OR json_extract(NEW.financialSnapshot,'$.publicId') IS NOT f.publicId OR json_extract(NEW.financialSnapshot,'$.saleMode') IS NOT f.saleMode OR json_extract(NEW.financialSnapshot,'$.orderState') IS NOT f.orderState OR json_extract(NEW.financialSnapshot,'$.goodsTotal') IS NOT f.goodsTotal OR json_extract(NEW.financialSnapshot,'$.firstPaymentAmount') IS NOT f.firstPaymentAmount OR json_extract(NEW.financialSnapshot,'$.goodsPaid') IS NOT f.goodsPaid OR json_extract(NEW.financialSnapshot,'$.unpaidGoods') IS NOT f.unpaidGoods OR json_extract(NEW.financialSnapshot,'$.firstPaymentDue') IS NOT f.firstPaymentDue OR json_extract(NEW.financialSnapshot,'$.firstPaymentState') IS NOT f.firstPaymentState OR json_extract(NEW.financialSnapshot,'$.goodsPaymentState') IS NOT f.goodsPaymentState OR json_extract(NEW.financialSnapshot,'$.cargoAmount') IS NOT f.cargoAmount OR json_extract(NEW.financialSnapshot,'$.cargoPaid') IS NOT f.cargoPaid OR json_extract(NEW.financialSnapshot,'$.unpaidCargo') IS NOT f.unpaidCargo OR json_extract(NEW.financialSnapshot,'$.arrivalId') IS NOT f.arrivalId OR json_extract(NEW.financialSnapshot,'$.arrivedAt') IS NOT f.arrivedAt OR json_extract(NEW.financialSnapshot,'$.cargoChargeId') IS NOT f.cargoChargeId OR json_extract(NEW.financialSnapshot,'$.cargoVersion') IS NOT f.cargoVersion OR json_extract(NEW.financialSnapshot,'$.finalInvoiceId') IS NOT f.finalInvoiceId OR json_extract(NEW.financialSnapshot,'$.finalInvoiceTotal') IS NOT f.finalInvoiceTotal OR json_extract(NEW.financialSnapshot,'$.finalDue') IS NOT f.finalDue OR json_extract(NEW.financialSnapshot,'$.finalPaymentState') IS NOT f.finalPaymentState OR json_extract(NEW.financialSnapshot,'$.financiallySettled') IS NOT f.financiallySettled OR json_extract(NEW.financialSnapshot,'$.fulfillmentAllowed') IS NOT f.fulfillmentAllowed OR json_extract(NEW.financialSnapshot,'$.finalPaymentEnabled') IS NOT f.finalPaymentEnabled OR json_extract(NEW.financialSnapshot,'$.cargoEnabled') IS NOT f.cargoEnabled OR json_extract(NEW.financialSnapshot,'$.cancellationId') IS NOT f.cancellationId OR json_extract(NEW.financialSnapshot,'$.cancelledAt') IS NOT f.cancelledAt OR json_extract(NEW.financialSnapshot,'$.paymentAllowed') IS NOT f.paymentAllowed OR json_extract(NEW.financialSnapshot,'$.refundId') IS NOT f.refundId OR json_extract(NEW.financialSnapshot,'$.refundStatus') IS NOT f.refundStatus OR json_extract(NEW.financialSnapshot,'$.refundCompletedAt') IS NOT f.refundCompletedAt OR json_extract(NEW.financialSnapshot,'$.goodsRefunded') IS NOT f.goodsRefunded OR json_extract(NEW.financialSnapshot,'$.cargoRefunded') IS NOT f.cargoRefunded OR json_extract(NEW.financialSnapshot,'$.receivedTotal') IS NOT f.receivedTotal OR json_extract(NEW.financialSnapshot,'$.refundedTotal') IS NOT f.refundedTotal OR json_extract(NEW.financialSnapshot,'$.netGoodsReceived') IS NOT f.netGoodsReceived OR json_extract(NEW.financialSnapshot,'$.netCargoReceived') IS NOT f.netCargoReceived OR json_extract(NEW.financialSnapshot,'$.netReceivedTotal') IS NOT f.netReceivedTotal OR json_extract(NEW.financialSnapshot,'$.stockReconciliationState') IS NOT f.stockReconciliationState)) THEN RAISE(ABORT,'invalid refund financial snapshot') END; END;
CREATE TRIGGER CheckoutRefundAllocation_insert BEFORE INSERT ON CheckoutRefundAllocation BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM CheckoutRefund r JOIN CheckoutPaymentLedger l ON l.orderId=r.orderId WHERE r.id=NEW.refundId AND r.orderId=NEW.orderId AND r.sealed=0 AND l.id=NEW.paymentLedgerId AND l.goodsAmount=NEW.goodsAmount AND l.cargoAmount=NEW.cargoAmount) THEN RAISE(ABORT,'refund allocation must match original ledger') END; END;
CREATE TRIGGER CheckoutRefund_seal BEFORE UPDATE ON CheckoutRefund BEGIN SELECT CASE WHEN OLD.sealed<>0 OR NEW.sealed<>1 OR NEW.id IS NOT OLD.id OR NEW.orderId IS NOT OLD.orderId OR NEW.reason IS NOT OLD.reason OR NEW.createdBy IS NOT OLD.createdBy OR NEW.createdAt IS NOT OLD.createdAt OR NEW.operationKey IS NOT OLD.operationKey OR NEW.requestFingerprint IS NOT OLD.requestFingerprint OR NEW.goodsAmount IS NOT OLD.goodsAmount OR NEW.cargoAmount IS NOT OLD.cargoAmount OR NEW.totalAmount IS NOT OLD.totalAmount OR NEW.financialSnapshot IS NOT OLD.financialSnapshot THEN RAISE(ABORT,'immutable refund request') END; SELECT CASE WHEN (SELECT COUNT(*) FROM CheckoutRefundAllocation WHERE refundId=OLD.id)<>(SELECT COUNT(*) FROM CheckoutPaymentLedger WHERE orderId=OLD.orderId) OR COALESCE((SELECT SUM(goodsAmount) FROM CheckoutRefundAllocation WHERE refundId=OLD.id),0)<>OLD.goodsAmount OR COALESCE((SELECT SUM(cargoAmount) FROM CheckoutRefundAllocation WHERE refundId=OLD.id),0)<>OLD.cargoAmount OR NOT EXISTS(SELECT 1 FROM AuditLog WHERE action='linked-refund.requested' AND entityType='CheckoutRefund' AND entityId=OLD.id AND actorId=OLD.createdBy) THEN RAISE(ABORT,'incomplete refund allocations or audit') END; END;
CREATE TRIGGER CheckoutRefundLedger_insert BEFORE INSERT ON CheckoutRefundLedger BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM User u JOIN TelegramAdmin a ON a.telegramId=CAST(u.telegramId AS TEXT) WHERE u.id=NEW.confirmedBy AND u.status='ACTIVE' AND a.isActive=1) OR NOT EXISTS(SELECT 1 FROM CheckoutRefund r WHERE r.id=NEW.refundId AND r.orderId=NEW.orderId AND r.sealed=1 AND NEW.confirmedAt>=r.createdAt AND NEW.goodsAmount=r.goodsAmount AND NEW.cargoAmount=r.cargoAmount AND NEW.totalAmount=r.totalAmount) OR EXISTS(SELECT 1 FROM CheckoutCancellation WHERE orderId=NEW.orderId) OR EXISTS(SELECT 1 FROM CheckoutPayment WHERE orderId=NEW.orderId AND status='SUBMITTED') THEN RAISE(ABORT,'refund completion requires full sealed request') END; END;
CREATE TRIGGER CheckoutRefundLedger_audit AFTER INSERT ON CheckoutRefundLedger BEGIN INSERT INTO AuditLog(id,actorId,action,entityType,entityId,metadata,createdAt) VALUES('refund-completion:'||NEW.id,NEW.confirmedBy,'linked-refund.completed','CheckoutRefund',NEW.refundId,json_object('orderId',NEW.orderId,'goodsAmount',NEW.goodsAmount,'cargoAmount',NEW.cargoAmount,'totalAmount',NEW.totalAmount),NEW.confirmedAt); END;
CREATE TRIGGER CheckoutRefundStockReconciliation_insert BEFORE INSERT ON CheckoutRefundStockReconciliation BEGIN SELECT CASE WHEN NEW.sealed<>0 OR NOT EXISTS(SELECT 1 FROM User u JOIN TelegramAdmin a ON a.telegramId=CAST(u.telegramId AS TEXT) WHERE u.id=NEW.createdBy AND u.status='ACTIVE' AND a.isActive=1) OR NOT EXISTS(SELECT 1 FROM CheckoutRefundLedger l JOIN CheckoutOrder o ON o.id=l.orderId WHERE l.id=NEW.refundLedgerId AND l.refundId=NEW.refundId AND l.orderId=NEW.orderId AND o.saleMode='IN_STOCK' AND NEW.createdAt>=l.confirmedAt) OR EXISTS(SELECT 1 FROM CheckoutStockRelease WHERE orderId=NEW.orderId) THEN RAISE(ABORT,'stock reconciliation requires completed IN_STOCK refund') END; END;
CREATE TRIGGER CheckoutRefundStockRelease_insert BEFORE INSERT ON CheckoutRefundStockRelease BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM CheckoutStockRelease WHERE itemId=NEW.itemId) OR NOT EXISTS(SELECT 1 FROM CheckoutRefundStockReconciliation r JOIN CheckoutOrderItem i ON i.orderId=r.orderId JOIN ProductVariant v ON v.id=i.variantId WHERE r.id=NEW.reconciliationId AND r.refundId=NEW.refundId AND r.orderId=NEW.orderId AND r.sealed=0 AND i.id=NEW.itemId AND i.saleMode='IN_STOCK' AND i.inventoryReservedQuantity=NEW.quantity AND i.variantId=NEW.variantId AND v.productId=i.productId AND v.isActive=1 AND typeof(v.stock)='integer' AND v.stock=NEW.stockBefore AND NEW.createdAt=r.createdAt) THEN RAISE(ABORT,'unsafe refund stock release') END; END;
CREATE TRIGGER CheckoutRefundStockRelease_apply AFTER INSERT ON CheckoutRefundStockRelease BEGIN UPDATE ProductVariant SET stock=NEW.stockAfter,updatedAt=NEW.createdAt WHERE id=NEW.variantId; INSERT INTO AuditLog(id,actorId,action,entityType,entityId,metadata,createdAt) SELECT 'refund-stock-release:'||NEW.id,createdBy,'linked-refund.stock-released','CheckoutRefundStockRelease',NEW.id,json_object('orderId',NEW.orderId,'itemId',NEW.itemId,'quantity',NEW.quantity,'stockBefore',NEW.stockBefore,'stockAfter',NEW.stockAfter),NEW.createdAt FROM CheckoutRefundStockReconciliation WHERE id=NEW.reconciliationId; END;
CREATE TRIGGER CheckoutRefundStockReconciliation_seal BEFORE UPDATE ON CheckoutRefundStockReconciliation BEGIN SELECT CASE WHEN OLD.sealed<>0 OR NEW.sealed<>1 OR NEW.id IS NOT OLD.id OR NEW.refundId IS NOT OLD.refundId OR NEW.orderId IS NOT OLD.orderId OR NEW.refundLedgerId IS NOT OLD.refundLedgerId OR NEW.createdBy IS NOT OLD.createdBy OR NEW.createdAt IS NOT OLD.createdAt OR NEW.operationKey IS NOT OLD.operationKey OR NEW.requestFingerprint IS NOT OLD.requestFingerprint THEN RAISE(ABORT,'immutable stock reconciliation') END; SELECT CASE WHEN (SELECT COUNT(*) FROM CheckoutRefundStockRelease WHERE reconciliationId=OLD.id)<>(SELECT COUNT(*) FROM CheckoutOrderItem WHERE orderId=OLD.orderId AND inventoryReservedQuantity>0) OR EXISTS(SELECT 1 FROM CheckoutOrderItem i WHERE i.orderId=OLD.orderId AND i.inventoryReservedQuantity>0 AND NOT EXISTS(SELECT 1 FROM CheckoutRefundStockRelease s WHERE s.reconciliationId=OLD.id AND s.itemId=i.id AND s.quantity=i.inventoryReservedQuantity)) OR NOT EXISTS(SELECT 1 FROM AuditLog WHERE action='linked-refund.stock-reconciled' AND entityType='CheckoutRefund' AND entityId=OLD.refundId AND actorId=OLD.createdBy AND json_extract(metadata,'$.reconciliationId')=OLD.id) THEN RAISE(ABORT,'incomplete refund stock release or audit') END; END;
CREATE TRIGGER CheckoutPayment_refund_locked BEFORE INSERT ON CheckoutPayment WHEN EXISTS(SELECT 1 FROM CheckoutRefund WHERE orderId=NEW.orderId) BEGIN SELECT RAISE(ABORT,'linked order locked by refund'); END;
CREATE TRIGGER CheckoutPaymentLedger_refund_locked BEFORE INSERT ON CheckoutPaymentLedger WHEN EXISTS(SELECT 1 FROM CheckoutRefund WHERE orderId=NEW.orderId) BEGIN SELECT RAISE(ABORT,'linked order locked by refund'); END;
CREATE TRIGGER CheckoutArrival_refund_locked BEFORE INSERT ON CheckoutArrival WHEN EXISTS(SELECT 1 FROM CheckoutRefund WHERE orderId=NEW.orderId) BEGIN SELECT RAISE(ABORT,'linked order locked by refund'); END;
CREATE TRIGGER CheckoutCargoCharge_refund_locked BEFORE INSERT ON CheckoutCargoCharge WHEN EXISTS(SELECT 1 FROM CheckoutRefund WHERE orderId=NEW.orderId) BEGIN SELECT RAISE(ABORT,'linked order locked by refund'); END;
CREATE TRIGGER CheckoutFinalInvoice_refund_locked BEFORE INSERT ON CheckoutFinalInvoice WHEN EXISTS(SELECT 1 FROM CheckoutRefund WHERE orderId=NEW.orderId) BEGIN SELECT RAISE(ABORT,'linked order locked by refund'); END;
CREATE TRIGGER CheckoutCancellation_refund_locked BEFORE INSERT ON CheckoutCancellation WHEN EXISTS(SELECT 1 FROM CheckoutRefund WHERE orderId=NEW.orderId) BEGIN SELECT RAISE(ABORT,'linked order locked by refund'); END;
CREATE TRIGGER CheckoutStockRelease_refund_locked BEFORE INSERT ON CheckoutStockRelease WHEN EXISTS(SELECT 1 FROM CheckoutRefund WHERE orderId=NEW.orderId) BEGIN SELECT RAISE(ABORT,'linked order locked by refund'); END;
CREATE TRIGGER CheckoutPayment_refund_review BEFORE UPDATE ON CheckoutPayment WHEN EXISTS(SELECT 1 FROM CheckoutRefund WHERE orderId=OLD.orderId) BEGIN SELECT RAISE(ABORT,'linked order locked by refund'); END;
CREATE TRIGGER CheckoutRefund_delete BEFORE DELETE ON CheckoutRefund BEGIN SELECT RAISE(ABORT,'refund history immutable'); END;
CREATE TRIGGER revision_CheckoutRefund_INSERT AFTER INSERT ON CheckoutRefund BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutRefund_UPDATE AFTER UPDATE ON CheckoutRefund BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutRefund_DELETE AFTER DELETE ON CheckoutRefund BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER CheckoutRefundAllocation_update BEFORE UPDATE ON CheckoutRefundAllocation BEGIN SELECT RAISE(ABORT,'refund history immutable'); END;
CREATE TRIGGER CheckoutRefundAllocation_delete BEFORE DELETE ON CheckoutRefundAllocation BEGIN SELECT RAISE(ABORT,'refund history immutable'); END;
CREATE TRIGGER revision_CheckoutRefundAllocation_INSERT AFTER INSERT ON CheckoutRefundAllocation BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutRefundAllocation_UPDATE AFTER UPDATE ON CheckoutRefundAllocation BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutRefundAllocation_DELETE AFTER DELETE ON CheckoutRefundAllocation BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER CheckoutRefundLedger_update BEFORE UPDATE ON CheckoutRefundLedger BEGIN SELECT RAISE(ABORT,'refund history immutable'); END;
CREATE TRIGGER CheckoutRefundLedger_delete BEFORE DELETE ON CheckoutRefundLedger BEGIN SELECT RAISE(ABORT,'refund history immutable'); END;
CREATE TRIGGER revision_CheckoutRefundLedger_INSERT AFTER INSERT ON CheckoutRefundLedger BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutRefundLedger_UPDATE AFTER UPDATE ON CheckoutRefundLedger BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutRefundLedger_DELETE AFTER DELETE ON CheckoutRefundLedger BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER CheckoutRefundStockReconciliation_delete BEFORE DELETE ON CheckoutRefundStockReconciliation BEGIN SELECT RAISE(ABORT,'refund history immutable'); END;
CREATE TRIGGER revision_CheckoutRefundStockReconciliation_INSERT AFTER INSERT ON CheckoutRefundStockReconciliation BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutRefundStockReconciliation_UPDATE AFTER UPDATE ON CheckoutRefundStockReconciliation BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutRefundStockReconciliation_DELETE AFTER DELETE ON CheckoutRefundStockReconciliation BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER CheckoutRefundStockRelease_update BEFORE UPDATE ON CheckoutRefundStockRelease BEGIN SELECT RAISE(ABORT,'refund history immutable'); END;
CREATE TRIGGER CheckoutRefundStockRelease_delete BEFORE DELETE ON CheckoutRefundStockRelease BEGIN SELECT RAISE(ABORT,'refund history immutable'); END;
CREATE TRIGGER revision_CheckoutRefundStockRelease_INSERT AFTER INSERT ON CheckoutRefundStockRelease BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutRefundStockRelease_UPDATE AFTER UPDATE ON CheckoutRefundStockRelease BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutRefundStockRelease_DELETE AFTER DELETE ON CheckoutRefundStockRelease BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
DROP VIEW CheckoutOrderFinance;
CREATE VIEW CheckoutOrderFinance AS
SELECT o.id orderId,g.userId,o.publicId,o.saleMode,CASE WHEN x.id IS NOT NULL THEN 'CANCELLED' WHEN rl.id IS NOT NULL THEN 'CANCELLED_REFUNDED' WHEN r.id IS NOT NULL THEN 'REFUND_REQUESTED' ELSE o.state END orderState,o.goodsTotal,o.firstPaymentAmount,
 COALESCE(f.goodsAmount,0)+COALESCE(l.goodsAmount,0) goodsPaid,
 o.goodsTotal-COALESCE(f.goodsAmount,0)-COALESCE(l.goodsAmount,0) unpaidGoods,
 o.firstPaymentAmount-COALESCE(f.goodsAmount,0) firstPaymentDue,
 CASE WHEN f.id IS NOT NULL THEN 'CONFIRMED' WHEN EXISTS(SELECT 1 FROM CheckoutPayment p WHERE p.orderId=o.id AND p.phase='FIRST' AND p.status='SUBMITTED') THEN 'PENDING_REVIEW' WHEN EXISTS(SELECT 1 FROM CheckoutPayment p WHERE p.orderId=o.id AND p.phase='FIRST' AND p.status='REJECTED') THEN 'REJECTED' ELSE 'AWAITING_PAYMENT' END firstPaymentState,
 CASE WHEN COALESCE(f.goodsAmount,0)+COALESCE(l.goodsAmount,0)=0 THEN 'UNPAID' WHEN COALESCE(f.goodsAmount,0)+COALESCE(l.goodsAmount,0)=o.goodsTotal THEN 'PAID' ELSE 'PARTIALLY_PAID' END goodsPaymentState,
 c.amount cargoAmount,COALESCE(l.cargoAmount,0) cargoPaid,
 CASE WHEN c.id IS NULL THEN NULL ELSE c.amount-COALESCE(l.cargoAmount,0) END unpaidCargo,
 a.id arrivalId,a.arrivedAt,c.id cargoChargeId,c.version cargoVersion,i.id finalInvoiceId,i.totalDue finalInvoiceTotal,
 CASE WHEN i.id IS NULL THEN NULL ELSE i.totalDue-COALESCE(l.goodsAmount,0)-COALESCE(l.cargoAmount,0) END finalDue,
 CASE WHEN i.id IS NULL THEN 'UNAVAILABLE' WHEN i.totalDue=0 THEN 'SETTLED_ZERO' WHEN l.id IS NOT NULL THEN 'CONFIRMED' WHEN EXISTS(SELECT 1 FROM CheckoutPayment p WHERE p.orderId=o.id AND p.phase='FINAL' AND p.status='SUBMITTED') THEN 'PENDING_REVIEW' WHEN EXISTS(SELECT 1 FROM CheckoutPayment p WHERE p.orderId=o.id AND p.phase='FINAL' AND p.status='REJECTED') THEN 'REJECTED' ELSE 'AWAITING_PAYMENT' END finalPaymentState,
 CASE WHEN x.id IS NOT NULL OR r.id IS NOT NULL THEN 0 WHEN o.saleMode='IN_STOCK' THEN CASE WHEN COALESCE(f.goodsAmount,0)=o.goodsTotal THEN 1 ELSE 0 END WHEN i.id IS NOT NULL AND i.totalDue=COALESCE(l.goodsAmount,0)+COALESCE(l.cargoAmount,0) THEN 1 ELSE 0 END financiallySettled,
 0 fulfillmentAllowed,
 CASE WHEN x.id IS NULL AND r.id IS NULL AND i.id IS NOT NULL AND i.totalDue>0 AND l.id IS NULL AND NOT EXISTS(SELECT 1 FROM CheckoutPayment p WHERE p.orderId=o.id AND p.phase='FINAL' AND p.status='SUBMITTED') THEN 1 ELSE 0 END finalPaymentEnabled,
 CASE WHEN x.id IS NULL AND r.id IS NULL AND o.saleMode='PREORDER' AND a.id IS NOT NULL AND c.id IS NULL THEN 1 ELSE 0 END cargoEnabled,
 x.id cancellationId,x.createdAt cancelledAt,CASE WHEN x.id IS NULL AND r.id IS NULL THEN 1 ELSE 0 END paymentAllowed,
 r.id refundId,CASE WHEN rl.id IS NOT NULL THEN 'COMPLETED' WHEN r.id IS NOT NULL THEN 'REQUESTED' ELSE NULL END refundStatus,rl.confirmedAt refundCompletedAt,
 COALESCE(rl.goodsAmount,0) goodsRefunded,COALESCE(rl.cargoAmount,0) cargoRefunded,
 COALESCE(f.goodsAmount,0)+COALESCE(l.goodsAmount,0)+COALESCE(l.cargoAmount,0) receivedTotal,
 COALESCE(rl.totalAmount,0) refundedTotal,
 COALESCE(f.goodsAmount,0)+COALESCE(l.goodsAmount,0)-COALESCE(rl.goodsAmount,0) netGoodsReceived,
 COALESCE(l.cargoAmount,0)-COALESCE(rl.cargoAmount,0) netCargoReceived,
 COALESCE(f.goodsAmount,0)+COALESCE(l.goodsAmount,0)+COALESCE(l.cargoAmount,0)-COALESCE(rl.totalAmount,0) netReceivedTotal,
 CASE WHEN r.id IS NULL THEN 'NONE' WHEN rl.id IS NULL THEN 'AWAITING_REFUND' WHEN o.saleMode='PREORDER' THEN 'NOT_APPLICABLE' WHEN sr.id IS NOT NULL THEN 'RELEASED' ELSE 'REQUIRES_RECONCILIATION' END stockReconciliationState
FROM CheckoutOrder o JOIN CheckoutGroup g ON g.id=o.checkoutGroupId
LEFT JOIN CheckoutPaymentLedger f ON f.orderId=o.id AND f.phase='FIRST'
LEFT JOIN CheckoutPaymentLedger l ON l.orderId=o.id AND l.phase='FINAL'
LEFT JOIN CheckoutArrival a ON a.orderId=o.id LEFT JOIN CheckoutCargoCharge c ON c.orderId=o.id
LEFT JOIN CheckoutFinalInvoice i ON i.orderId=o.id LEFT JOIN CheckoutCancellation x ON x.orderId=o.id AND x.sealed=1 LEFT JOIN CheckoutRefund r ON r.orderId=o.id AND r.sealed=1
LEFT JOIN CheckoutRefundLedger rl ON rl.refundId=r.id
LEFT JOIN CheckoutRefundStockReconciliation sr ON sr.refundId=r.id AND sr.sealed=1 WHERE g.sealed=1;
UPDATE _Revision SET version=version+1 WHERE id=1;
