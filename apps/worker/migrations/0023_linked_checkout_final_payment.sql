-- Apply this entire migration as ONE atomic migration file/D1 batch.
-- 0021 is untouched; 0022's FIRST rows and all bank digests are copied verbatim.
CREATE TABLE _C2PaymentCopy AS SELECT * FROM CheckoutPayment;
CREATE TABLE _C2LedgerCopy AS SELECT * FROM CheckoutPaymentLedger;
CREATE TABLE CheckoutArrival (
 id TEXT PRIMARY KEY NOT NULL, orderId TEXT NOT NULL UNIQUE REFERENCES CheckoutOrder(id) ON DELETE RESTRICT,
 arrivedAt INTEGER NOT NULL CHECK(typeof(arrivedAt)='integer'),
 itemSnapshot TEXT NOT NULL CHECK(json_valid(itemSnapshot) AND json_type(itemSnapshot)='array'),
 createdBy TEXT NOT NULL REFERENCES User(id) ON DELETE RESTRICT, createdAt INTEGER NOT NULL,
 operationKey TEXT NOT NULL CHECK(length(operationKey) BETWEEN 16 AND 200), requestFingerprint TEXT NOT NULL CHECK(length(requestFingerprint)=64),
 UNIQUE(id,orderId), UNIQUE(createdBy,operationKey), CHECK(arrivedAt<=createdAt)
);
CREATE TABLE CheckoutCargoCharge (
 id TEXT PRIMARY KEY NOT NULL, orderId TEXT NOT NULL UNIQUE REFERENCES CheckoutOrder(id) ON DELETE RESTRICT,
 arrivalId TEXT NOT NULL UNIQUE, version INTEGER NOT NULL CHECK(version=1),
 amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 0 AND 2147483647),
 createdBy TEXT NOT NULL REFERENCES User(id) ON DELETE RESTRICT, createdAt INTEGER NOT NULL,
 operationKey TEXT NOT NULL CHECK(length(operationKey) BETWEEN 16 AND 200), requestFingerprint TEXT NOT NULL CHECK(length(requestFingerprint)=64),
 UNIQUE(id,orderId), UNIQUE(createdBy,operationKey), FOREIGN KEY(arrivalId,orderId) REFERENCES CheckoutArrival(id,orderId) ON DELETE RESTRICT
);
CREATE TABLE CheckoutFinalInvoice (
 id TEXT PRIMARY KEY NOT NULL, orderId TEXT NOT NULL UNIQUE REFERENCES CheckoutOrder(id) ON DELETE RESTRICT,
 arrivalId TEXT NOT NULL, cargoChargeId TEXT NOT NULL UNIQUE, firstLedgerId TEXT NOT NULL UNIQUE REFERENCES CheckoutPaymentLedger(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version=1), currency TEXT NOT NULL CHECK(currency='UZS'),
 goodsTotal INTEGER NOT NULL CHECK(typeof(goodsTotal)='integer' AND goodsTotal BETWEEN 0 AND 2147483647),
 firstGoodsPaid INTEGER NOT NULL CHECK(typeof(firstGoodsPaid)='integer' AND firstGoodsPaid BETWEEN 0 AND goodsTotal),
 goodsDue INTEGER NOT NULL CHECK(goodsDue=goodsTotal-firstGoodsPaid),
 cargoDue INTEGER NOT NULL CHECK(typeof(cargoDue)='integer' AND cargoDue BETWEEN 0 AND 2147483647),
 totalDue INTEGER NOT NULL CHECK(totalDue=goodsDue+cargoDue AND totalDue BETWEEN 0 AND 2147483647 AND goodsTotal+cargoDue<=2147483647),
 createdBy TEXT NOT NULL REFERENCES User(id) ON DELETE RESTRICT, createdAt INTEGER NOT NULL,
 operationKey TEXT NOT NULL CHECK(length(operationKey) BETWEEN 16 AND 200), requestFingerprint TEXT NOT NULL CHECK(length(requestFingerprint)=64),
 UNIQUE(id,orderId), UNIQUE(createdBy,operationKey),
 FOREIGN KEY(arrivalId,orderId) REFERENCES CheckoutArrival(id,orderId) ON DELETE RESTRICT,
 FOREIGN KEY(cargoChargeId,orderId) REFERENCES CheckoutCargoCharge(id,orderId) ON DELETE RESTRICT
);
DROP VIEW CheckoutOrderFinance;
DROP TABLE CheckoutPaymentLedger;
DROP TABLE CheckoutPayment;
CREATE TABLE CheckoutPayment (
 id TEXT PRIMARY KEY NOT NULL,
 orderId TEXT NOT NULL REFERENCES CheckoutOrder(id) ON DELETE RESTRICT,
 phase TEXT NOT NULL DEFAULT 'FIRST' CHECK(phase IN('FIRST','FINAL')),
 source TEXT NOT NULL CHECK(source IN('WEBSITE','TELEGRAM_OPERATOR')),
 submittedBy TEXT NOT NULL REFERENCES User(id) ON DELETE RESTRICT,
 attachedBy TEXT NOT NULL REFERENCES User(id) ON DELETE RESTRICT,
 submitKey TEXT NOT NULL CHECK(length(submitKey) BETWEEN 16 AND 200), submitFingerprint TEXT NOT NULL CHECK(length(submitFingerprint)=64),
 declaredAmount INTEGER NOT NULL CHECK(typeof(declaredAmount)='integer' AND declaredAmount BETWEEN 1 AND 2147483647),
 expectedAmount INTEGER NOT NULL CHECK(typeof(expectedAmount)='integer' AND expectedAmount BETWEEN 1 AND 2147483647),
 confirmedAmount INTEGER NOT NULL DEFAULT 0 CHECK(typeof(confirmedAmount)='integer' AND confirmedAmount BETWEEN 0 AND expectedAmount),
 proofStorageKey TEXT NOT NULL UNIQUE REFERENCES MediaObject(key) ON DELETE RESTRICT,
 proofMimeType TEXT NOT NULL CHECK(proofMimeType IN('image/png','image/jpeg','image/webp')),
 proofSize INTEGER NOT NULL CHECK(typeof(proofSize)='integer' AND proofSize BETWEEN 1 AND 5242880),
 proofSha256 TEXT NOT NULL CHECK(length(proofSha256)=64 AND proofSha256 NOT GLOB '*[^0-9a-f]*'),
 status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN('SUBMITTED','APPROVED','REJECTED')),
 submittedAt INTEGER NOT NULL,
 reviewedBy TEXT REFERENCES User(id) ON DELETE RESTRICT, reviewedAt INTEGER,
 reviewKey TEXT, reviewFingerprint TEXT, rejectionReason TEXT,
 invoiceId TEXT,
 FOREIGN KEY(invoiceId,orderId) REFERENCES CheckoutFinalInvoice(id,orderId) ON DELETE RESTRICT,
 CHECK((phase='FIRST' AND invoiceId IS NULL) OR (phase='FINAL' AND invoiceId IS NOT NULL)),
 UNIQUE(id,orderId), UNIQUE(submittedBy,submitKey), UNIQUE(reviewedBy,reviewKey),
 CHECK(COALESCE((status='SUBMITTED' AND confirmedAmount=0 AND reviewedBy IS NULL AND reviewedAt IS NULL AND reviewKey IS NULL AND reviewFingerprint IS NULL AND rejectionReason IS NULL)
 OR (status IN('APPROVED','REJECTED') AND reviewedBy IS NOT NULL AND reviewedAt>=submittedAt AND length(reviewKey)>=16 AND length(reviewFingerprint)=64
 AND ((status='APPROVED' AND confirmedAmount=expectedAmount AND rejectionReason IS NULL)
 OR (status='REJECTED' AND confirmedAmount=0 AND rejectionReason IN('NOT_RECEIVED','UNREADABLE','AMOUNT_MISMATCH','DUPLICATE_TRANSFER','OTHER')))),0))
);
CREATE TABLE CheckoutPaymentLedger (
 id TEXT PRIMARY KEY NOT NULL,
 paymentId TEXT NOT NULL UNIQUE, orderId TEXT NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN('FIRST','FINAL')), kind TEXT NOT NULL CHECK(kind='MANUAL_CARD_TRANSFER'),
 goodsAmount INTEGER NOT NULL CHECK(typeof(goodsAmount)='integer' AND goodsAmount BETWEEN 0 AND 2147483647),
 cargoAmount INTEGER NOT NULL DEFAULT 0 CHECK(typeof(cargoAmount)='integer' AND cargoAmount BETWEEN 0 AND 2147483647),
 bankOperationDigest TEXT NOT NULL UNIQUE CHECK(length(bankOperationDigest)=64 AND bankOperationDigest NOT GLOB '*[^0-9a-f]*'),
 verifiedBy TEXT NOT NULL REFERENCES User(id) ON DELETE RESTRICT, verifiedAt INTEGER NOT NULL,
 reviewKey TEXT NOT NULL, reviewFingerprint TEXT NOT NULL CHECK(length(reviewFingerprint)=64),
 invoiceId TEXT,
 FOREIGN KEY(invoiceId,orderId) REFERENCES CheckoutFinalInvoice(id,orderId) ON DELETE RESTRICT,
 CHECK(goodsAmount+cargoAmount BETWEEN 1 AND 2147483647),
 CHECK((phase='FIRST' AND invoiceId IS NULL AND goodsAmount>0 AND cargoAmount=0) OR (phase='FINAL' AND invoiceId IS NOT NULL)),
 UNIQUE(orderId,phase), FOREIGN KEY(paymentId,orderId) REFERENCES CheckoutPayment(id,orderId) ON DELETE RESTRICT
);
INSERT INTO CheckoutPayment SELECT *,NULL FROM _C2PaymentCopy;
INSERT INTO CheckoutPaymentLedger SELECT *,NULL FROM _C2LedgerCopy;
DROP TABLE _C2LedgerCopy;
DROP TABLE _C2PaymentCopy;
CREATE UNIQUE INDEX CheckoutPayment_pending ON CheckoutPayment(orderId,phase) WHERE status='SUBMITTED';
CREATE UNIQUE INDEX CheckoutPayment_approved ON CheckoutPayment(orderId,phase) WHERE status='APPROVED';
CREATE INDEX CheckoutPayment_history ON CheckoutPayment(orderId,submittedAt,id);
CREATE TRIGGER CheckoutPayment_insert BEFORE INSERT ON CheckoutPayment BEGIN SELECT CASE WHEN NEW.status<>'SUBMITTED' OR NEW.source<>'WEBSITE' OR NEW.attachedBy<>NEW.submittedBy OR NOT EXISTS(SELECT 1 FROM CheckoutOrder o JOIN CheckoutGroup g ON g.id=o.checkoutGroupId WHERE o.id=NEW.orderId AND g.sealed=1 AND g.userId=NEW.submittedBy) OR EXISTS(SELECT 1 FROM CheckoutPaymentLedger WHERE orderId=NEW.orderId AND phase=NEW.phase) THEN RAISE(ABORT,'first payment unavailable') END; SELECT CASE WHEN NEW.phase='FIRST' AND (NEW.invoiceId IS NOT NULL OR NEW.expectedAmount<>(SELECT firstPaymentAmount FROM CheckoutOrder WHERE id=NEW.orderId)) THEN RAISE(ABORT,'invalid first payment') END; SELECT CASE WHEN NEW.phase='FINAL' AND NOT EXISTS(SELECT 1 FROM CheckoutFinalInvoice i WHERE i.id=NEW.invoiceId AND i.orderId=NEW.orderId AND i.totalDue=NEW.expectedAmount AND i.totalDue>0) THEN RAISE(ABORT,'final invoice unavailable') END; SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM MediaObject m WHERE m.key=NEW.proofStorageKey AND m.private=1 AND m.contentType=NEW.proofMimeType AND m.size=NEW.proofSize AND (SELECT SUM(length(data)) FROM MediaChunk WHERE objectKey=m.key)=m.size) OR EXISTS(SELECT 1 FROM Payment WHERE proofStorageKey=NEW.proofStorageKey) THEN RAISE(ABORT,'invalid private receipt') END; END;
CREATE TRIGGER CheckoutPayment_update BEFORE UPDATE ON CheckoutPayment BEGIN SELECT CASE WHEN OLD.status<>'SUBMITTED' OR NEW.status NOT IN('APPROVED','REJECTED') OR NEW.id IS NOT OLD.id OR NEW.orderId IS NOT OLD.orderId OR NEW.phase IS NOT OLD.phase OR NEW.source IS NOT OLD.source OR NEW.submittedBy IS NOT OLD.submittedBy OR NEW.attachedBy IS NOT OLD.attachedBy OR NEW.submitKey IS NOT OLD.submitKey OR NEW.submitFingerprint IS NOT OLD.submitFingerprint OR NEW.declaredAmount IS NOT OLD.declaredAmount OR NEW.expectedAmount IS NOT OLD.expectedAmount OR NEW.proofStorageKey IS NOT OLD.proofStorageKey OR NEW.proofMimeType IS NOT OLD.proofMimeType OR NEW.proofSize IS NOT OLD.proofSize OR NEW.proofSha256 IS NOT OLD.proofSha256 OR NEW.submittedAt IS NOT OLD.submittedAt OR NEW.invoiceId IS NOT OLD.invoiceId THEN RAISE(ABORT,'immutable payment claim') END; SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM User u JOIN TelegramAdmin a ON a.telegramId=CAST(u.telegramId AS TEXT) WHERE u.id=NEW.reviewedBy AND u.status='ACTIVE' AND a.isActive=1) THEN RAISE(ABORT,'inactive reviewer') END; SELECT CASE WHEN NEW.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM CheckoutPaymentLedger l WHERE l.paymentId=NEW.id AND l.orderId=NEW.orderId AND l.phase=NEW.phase AND l.invoiceId IS NEW.invoiceId AND l.goodsAmount+l.cargoAmount=NEW.confirmedAmount AND l.verifiedBy=NEW.reviewedBy AND l.verifiedAt=NEW.reviewedAt AND l.reviewKey=NEW.reviewKey AND l.reviewFingerprint=NEW.reviewFingerprint) THEN RAISE(ABORT,'approval requires ledger') END; END;
CREATE TRIGGER CheckoutPayment_delete BEFORE DELETE ON CheckoutPayment BEGIN SELECT RAISE(ABORT,'payment history immutable'); END;
CREATE TRIGGER CheckoutPaymentLedger_insert BEFORE INSERT ON CheckoutPaymentLedger BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM CheckoutPayment p JOIN CheckoutGroup g ON g.id=(SELECT checkoutGroupId FROM CheckoutOrder WHERE id=p.orderId) WHERE p.id=NEW.paymentId AND p.orderId=NEW.orderId AND p.phase=NEW.phase AND p.invoiceId IS NEW.invoiceId AND p.status='SUBMITTED' AND p.expectedAmount=NEW.goodsAmount+NEW.cargoAmount AND g.sealed=1 AND NEW.verifiedAt>=p.submittedAt) OR NOT EXISTS(SELECT 1 FROM User u JOIN TelegramAdmin a ON a.telegramId=CAST(u.telegramId AS TEXT) WHERE u.id=NEW.verifiedBy AND u.status='ACTIVE' AND a.isActive=1) THEN RAISE(ABORT,'invalid payment ledger') END; SELECT CASE WHEN NEW.phase='FIRST' AND (NEW.invoiceId IS NOT NULL OR NEW.cargoAmount<>0 OR NEW.goodsAmount<>(SELECT firstPaymentAmount FROM CheckoutOrder WHERE id=NEW.orderId)) THEN RAISE(ABORT,'invalid first allocation') END; SELECT CASE WHEN NEW.phase='FINAL' AND NOT EXISTS(SELECT 1 FROM CheckoutFinalInvoice i WHERE i.id=NEW.invoiceId AND i.orderId=NEW.orderId AND i.goodsDue=NEW.goodsAmount AND i.cargoDue=NEW.cargoAmount AND i.totalDue=NEW.goodsAmount+NEW.cargoAmount AND i.totalDue>0) THEN RAISE(ABORT,'invalid final allocation') END; END;
CREATE TRIGGER CheckoutPaymentLedger_approve AFTER INSERT ON CheckoutPaymentLedger BEGIN UPDATE CheckoutPayment SET status='APPROVED',confirmedAmount=NEW.goodsAmount+NEW.cargoAmount,reviewedBy=NEW.verifiedBy,reviewedAt=NEW.verifiedAt,reviewKey=NEW.reviewKey,reviewFingerprint=NEW.reviewFingerprint WHERE id=NEW.paymentId; END;
CREATE TRIGGER CheckoutPaymentLedger_update BEFORE UPDATE ON CheckoutPaymentLedger BEGIN SELECT RAISE(ABORT,'ledger immutable'); END;
CREATE TRIGGER CheckoutPaymentLedger_delete BEFORE DELETE ON CheckoutPaymentLedger BEGIN SELECT RAISE(ABORT,'ledger immutable'); END;
CREATE TRIGGER CheckoutPayment_legacy_id BEFORE INSERT ON CheckoutPayment WHEN EXISTS(SELECT 1 FROM Payment WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'legacy payment identity isolated'); END;
CREATE TRIGGER CheckoutArrival_insert BEFORE INSERT ON CheckoutArrival BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM User u JOIN TelegramAdmin a ON a.telegramId=CAST(u.telegramId AS TEXT) WHERE u.id=NEW.createdBy AND u.status='ACTIVE' AND a.isActive=1) OR NOT EXISTS(SELECT 1 FROM CheckoutOrder o JOIN CheckoutGroup g ON g.id=o.checkoutGroupId WHERE o.id=NEW.orderId AND o.saleMode='PREORDER' AND g.sealed=1 AND NEW.arrivedAt>=o.createdAt) THEN RAISE(ABORT,'invalid preorder arrival') END; SELECT CASE WHEN json_array_length(NEW.itemSnapshot)<>(SELECT COUNT(*) FROM CheckoutOrderItem WHERE orderId=NEW.orderId) OR json_array_length(NEW.itemSnapshot)=0 OR (SELECT COUNT(DISTINCT json_extract(value,'$.itemId')) FROM json_each(NEW.itemSnapshot))<>json_array_length(NEW.itemSnapshot) OR EXISTS(SELECT 1 FROM CheckoutOrderItem i WHERE i.orderId=NEW.orderId AND NOT EXISTS(SELECT 1 FROM json_each(NEW.itemSnapshot) j WHERE json_extract(j.value,'$.itemId')=i.id AND json_extract(j.value,'$.quantity')=i.quantity AND json_extract(j.value,'$.variantId')=i.variantId)) THEN RAISE(ABORT,'all preorder items must arrive') END; END;
CREATE TRIGGER CheckoutCargoCharge_insert BEFORE INSERT ON CheckoutCargoCharge BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM User u JOIN TelegramAdmin a ON a.telegramId=CAST(u.telegramId AS TEXT) WHERE u.id=NEW.createdBy AND u.status='ACTIVE' AND a.isActive=1) OR NOT EXISTS(SELECT 1 FROM CheckoutArrival a WHERE a.id=NEW.arrivalId AND a.orderId=NEW.orderId AND NEW.createdAt>=a.arrivedAt AND (SELECT goodsTotal FROM CheckoutOrder WHERE id=NEW.orderId)+NEW.amount<=2147483647) THEN RAISE(ABORT,'cargo requires arrival and owner') END; END;
CREATE TRIGGER CheckoutFinalInvoice_insert BEFORE INSERT ON CheckoutFinalInvoice BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM User u JOIN TelegramAdmin a ON a.telegramId=CAST(u.telegramId AS TEXT) WHERE u.id=NEW.createdBy AND u.status='ACTIVE' AND a.isActive=1) OR NOT EXISTS(SELECT 1 FROM CheckoutOrder o JOIN CheckoutArrival a ON a.orderId=o.id JOIN CheckoutCargoCharge c ON c.orderId=o.id JOIN CheckoutPaymentLedger l ON l.orderId=o.id AND l.phase='FIRST' WHERE o.id=NEW.orderId AND o.saleMode='PREORDER' AND a.id=NEW.arrivalId AND c.id=NEW.cargoChargeId AND c.arrivalId=a.id AND l.id=NEW.firstLedgerId AND l.goodsAmount=o.firstPaymentAmount AND l.cargoAmount=0 AND NEW.goodsTotal=o.goodsTotal AND NEW.firstGoodsPaid=l.goodsAmount AND NEW.cargoDue=c.amount AND NEW.createdAt>=c.createdAt) THEN RAISE(ABORT,'invalid final invoice snapshot') END; END;
CREATE TRIGGER CheckoutArrival_update BEFORE UPDATE ON CheckoutArrival BEGIN SELECT RAISE(ABORT,'immutable final obligation'); END;
CREATE TRIGGER CheckoutArrival_delete BEFORE DELETE ON CheckoutArrival BEGIN SELECT RAISE(ABORT,'immutable final obligation'); END;
CREATE TRIGGER CheckoutCargoCharge_update BEFORE UPDATE ON CheckoutCargoCharge BEGIN SELECT RAISE(ABORT,'immutable final obligation'); END;
CREATE TRIGGER CheckoutCargoCharge_delete BEFORE DELETE ON CheckoutCargoCharge BEGIN SELECT RAISE(ABORT,'immutable final obligation'); END;
CREATE TRIGGER CheckoutFinalInvoice_update BEFORE UPDATE ON CheckoutFinalInvoice BEGIN SELECT RAISE(ABORT,'immutable final obligation'); END;
CREATE TRIGGER CheckoutFinalInvoice_delete BEFORE DELETE ON CheckoutFinalInvoice BEGIN SELECT RAISE(ABORT,'immutable final obligation'); END;
CREATE TRIGGER revision_CheckoutArrival_INSERT AFTER INSERT ON CheckoutArrival BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutArrival_UPDATE AFTER UPDATE ON CheckoutArrival BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutArrival_DELETE AFTER DELETE ON CheckoutArrival BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutCargoCharge_INSERT AFTER INSERT ON CheckoutCargoCharge BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutCargoCharge_UPDATE AFTER UPDATE ON CheckoutCargoCharge BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutCargoCharge_DELETE AFTER DELETE ON CheckoutCargoCharge BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutFinalInvoice_INSERT AFTER INSERT ON CheckoutFinalInvoice BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutFinalInvoice_UPDATE AFTER UPDATE ON CheckoutFinalInvoice BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutFinalInvoice_DELETE AFTER DELETE ON CheckoutFinalInvoice BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutPayment_INSERT AFTER INSERT ON CheckoutPayment BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutPayment_UPDATE AFTER UPDATE ON CheckoutPayment BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutPayment_DELETE AFTER DELETE ON CheckoutPayment BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutPaymentLedger_INSERT AFTER INSERT ON CheckoutPaymentLedger BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutPaymentLedger_UPDATE AFTER UPDATE ON CheckoutPaymentLedger BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutPaymentLedger_DELETE AFTER DELETE ON CheckoutPaymentLedger BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE VIEW CheckoutOrderFinance AS
SELECT o.id orderId,g.userId,o.publicId,o.saleMode,o.state orderState,o.goodsTotal,o.firstPaymentAmount,
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
 CASE WHEN o.saleMode='IN_STOCK' THEN CASE WHEN COALESCE(f.goodsAmount,0)=o.goodsTotal THEN 1 ELSE 0 END WHEN i.id IS NOT NULL AND i.totalDue=COALESCE(l.goodsAmount,0)+COALESCE(l.cargoAmount,0) THEN 1 ELSE 0 END financiallySettled,
 0 fulfillmentAllowed,
 CASE WHEN i.id IS NOT NULL AND i.totalDue>0 AND l.id IS NULL AND NOT EXISTS(SELECT 1 FROM CheckoutPayment p WHERE p.orderId=o.id AND p.phase='FINAL' AND p.status='SUBMITTED') THEN 1 ELSE 0 END finalPaymentEnabled,
 CASE WHEN o.saleMode='PREORDER' AND a.id IS NOT NULL AND c.id IS NULL THEN 1 ELSE 0 END cargoEnabled
FROM CheckoutOrder o JOIN CheckoutGroup g ON g.id=o.checkoutGroupId
LEFT JOIN CheckoutPaymentLedger f ON f.orderId=o.id AND f.phase='FIRST'
LEFT JOIN CheckoutPaymentLedger l ON l.orderId=o.id AND l.phase='FINAL'
LEFT JOIN CheckoutArrival a ON a.orderId=o.id LEFT JOIN CheckoutCargoCharge c ON c.orderId=o.id
LEFT JOIN CheckoutFinalInvoice i ON i.orderId=o.id WHERE g.sealed=1;
UPDATE _Revision SET version=version+1 WHERE id=1;
