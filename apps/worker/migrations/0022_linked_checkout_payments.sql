-- Immutable 0021 obligations remain untouched. Current received money is derived
-- exclusively from the append-only ledger, never from a receipt or client total.
CREATE TABLE CheckoutPayment (
 id TEXT PRIMARY KEY NOT NULL,
 orderId TEXT NOT NULL REFERENCES CheckoutOrder(id) ON DELETE RESTRICT,
 phase TEXT NOT NULL DEFAULT 'FIRST' CHECK(phase='FIRST'),
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
 UNIQUE(id,orderId), UNIQUE(submittedBy,submitKey), UNIQUE(reviewedBy,reviewKey),
 CHECK(COALESCE((status='SUBMITTED' AND confirmedAmount=0 AND reviewedBy IS NULL AND reviewedAt IS NULL AND reviewKey IS NULL AND reviewFingerprint IS NULL AND rejectionReason IS NULL)
 OR (status IN('APPROVED','REJECTED') AND reviewedBy IS NOT NULL AND reviewedAt>=submittedAt AND length(reviewKey)>=16 AND length(reviewFingerprint)=64
 AND ((status='APPROVED' AND confirmedAmount=expectedAmount AND rejectionReason IS NULL)
 OR (status='REJECTED' AND confirmedAmount=0 AND rejectionReason IN('NOT_RECEIVED','UNREADABLE','AMOUNT_MISMATCH','DUPLICATE_TRANSFER','OTHER')))),0))
);
CREATE UNIQUE INDEX CheckoutPayment_pending ON CheckoutPayment(orderId,phase) WHERE status='SUBMITTED';
CREATE UNIQUE INDEX CheckoutPayment_approved ON CheckoutPayment(orderId,phase) WHERE status='APPROVED';
CREATE INDEX CheckoutPayment_history ON CheckoutPayment(orderId,submittedAt,id);
CREATE TABLE CheckoutPaymentLedger (
 id TEXT PRIMARY KEY NOT NULL,
 paymentId TEXT NOT NULL UNIQUE, orderId TEXT NOT NULL,
 phase TEXT NOT NULL CHECK(phase='FIRST'), kind TEXT NOT NULL CHECK(kind='MANUAL_CARD_TRANSFER'),
 goodsAmount INTEGER NOT NULL CHECK(typeof(goodsAmount)='integer' AND goodsAmount BETWEEN 1 AND 2147483647),
 cargoAmount INTEGER NOT NULL DEFAULT 0 CHECK(cargoAmount=0),
 bankOperationDigest TEXT NOT NULL UNIQUE CHECK(length(bankOperationDigest)=64 AND bankOperationDigest NOT GLOB '*[^0-9a-f]*'),
 verifiedBy TEXT NOT NULL REFERENCES User(id) ON DELETE RESTRICT, verifiedAt INTEGER NOT NULL,
 reviewKey TEXT NOT NULL, reviewFingerprint TEXT NOT NULL CHECK(length(reviewFingerprint)=64),
 UNIQUE(orderId,phase), FOREIGN KEY(paymentId,orderId) REFERENCES CheckoutPayment(id,orderId) ON DELETE RESTRICT
);
-- A website receipt is a claim by the buyer, not a banking confirmation.
CREATE TRIGGER CheckoutPayment_insert BEFORE INSERT ON CheckoutPayment BEGIN SELECT CASE WHEN NEW.status<>'SUBMITTED' OR NEW.source<>'WEBSITE' OR NEW.attachedBy<>NEW.submittedBy OR NOT EXISTS(SELECT 1 FROM CheckoutOrder o JOIN CheckoutGroup g ON g.id=o.checkoutGroupId WHERE o.id=NEW.orderId AND g.sealed=1 AND g.userId=NEW.submittedBy AND o.firstPaymentAmount=NEW.expectedAmount) OR EXISTS(SELECT 1 FROM CheckoutPaymentLedger WHERE orderId=NEW.orderId) THEN RAISE(ABORT,'first payment unavailable') END; SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM MediaObject m WHERE m.key=NEW.proofStorageKey AND m.private=1 AND m.contentType=NEW.proofMimeType AND m.size=NEW.proofSize AND (SELECT SUM(length(data)) FROM MediaChunk WHERE objectKey=m.key)=m.size) OR EXISTS(SELECT 1 FROM Payment WHERE proofStorageKey=NEW.proofStorageKey) THEN RAISE(ABORT,'invalid private receipt') END; END;
CREATE TRIGGER CheckoutPayment_update BEFORE UPDATE ON CheckoutPayment BEGIN SELECT CASE WHEN OLD.status<>'SUBMITTED' OR NEW.status NOT IN('APPROVED','REJECTED') OR NEW.id IS NOT OLD.id OR NEW.orderId IS NOT OLD.orderId OR NEW.phase IS NOT OLD.phase OR NEW.source IS NOT OLD.source OR NEW.submittedBy IS NOT OLD.submittedBy OR NEW.attachedBy IS NOT OLD.attachedBy OR NEW.submitKey IS NOT OLD.submitKey OR NEW.submitFingerprint IS NOT OLD.submitFingerprint OR NEW.declaredAmount IS NOT OLD.declaredAmount OR NEW.expectedAmount IS NOT OLD.expectedAmount OR NEW.proofStorageKey IS NOT OLD.proofStorageKey OR NEW.proofMimeType IS NOT OLD.proofMimeType OR NEW.proofSize IS NOT OLD.proofSize OR NEW.proofSha256 IS NOT OLD.proofSha256 OR NEW.submittedAt IS NOT OLD.submittedAt THEN RAISE(ABORT,'immutable payment claim') END; SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM User u JOIN TelegramAdmin a ON a.telegramId=CAST(u.telegramId AS TEXT) WHERE u.id=NEW.reviewedBy AND u.status='ACTIVE' AND a.isActive=1) THEN RAISE(ABORT,'inactive reviewer') END; SELECT CASE WHEN NEW.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM CheckoutPaymentLedger l WHERE l.paymentId=NEW.id AND l.orderId=NEW.orderId AND l.goodsAmount=NEW.confirmedAmount AND l.verifiedBy=NEW.reviewedBy AND l.verifiedAt=NEW.reviewedAt AND l.reviewKey=NEW.reviewKey AND l.reviewFingerprint=NEW.reviewFingerprint) THEN RAISE(ABORT,'approval requires ledger') END; END;
CREATE TRIGGER CheckoutPayment_delete BEFORE DELETE ON CheckoutPayment BEGIN SELECT RAISE(ABORT,'payment history immutable'); END;
CREATE TRIGGER CheckoutPaymentLedger_insert BEFORE INSERT ON CheckoutPaymentLedger BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM CheckoutPayment p JOIN CheckoutOrder o ON o.id=p.orderId JOIN CheckoutGroup g ON g.id=o.checkoutGroupId WHERE p.id=NEW.paymentId AND p.orderId=NEW.orderId AND p.phase=NEW.phase AND p.status='SUBMITTED' AND p.expectedAmount=NEW.goodsAmount AND o.firstPaymentAmount=NEW.goodsAmount AND g.sealed=1 AND NEW.verifiedAt>=p.submittedAt) OR NOT EXISTS(SELECT 1 FROM User u JOIN TelegramAdmin a ON a.telegramId=CAST(u.telegramId AS TEXT) WHERE u.id=NEW.verifiedBy AND u.status='ACTIVE' AND a.isActive=1) THEN RAISE(ABORT,'invalid first payment ledger') END; END;
CREATE TRIGGER CheckoutPaymentLedger_approve AFTER INSERT ON CheckoutPaymentLedger BEGIN UPDATE CheckoutPayment SET status='APPROVED',confirmedAmount=NEW.goodsAmount,reviewedBy=NEW.verifiedBy,reviewedAt=NEW.verifiedAt,reviewKey=NEW.reviewKey,reviewFingerprint=NEW.reviewFingerprint WHERE id=NEW.paymentId; END;
CREATE TRIGGER CheckoutPaymentLedger_update BEFORE UPDATE ON CheckoutPaymentLedger BEGIN SELECT RAISE(ABORT,'ledger immutable'); END;
CREATE TRIGGER CheckoutPaymentLedger_delete BEFORE DELETE ON CheckoutPaymentLedger BEGIN SELECT RAISE(ABORT,'ledger immutable'); END;
-- No legacy handler may borrow a linked proof or make it public/mutable.
CREATE TRIGGER CheckoutPayment_legacy_id BEFORE INSERT ON CheckoutPayment WHEN EXISTS(SELECT 1 FROM Payment WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'legacy payment identity isolated'); END;
CREATE TRIGGER Payment_linked_proof BEFORE INSERT ON Payment WHEN EXISTS(SELECT 1 FROM CheckoutPayment WHERE id=NEW.id OR proofStorageKey=NEW.proofStorageKey) BEGIN SELECT RAISE(ABORT,'linked receipt isolated'); END;
CREATE TRIGGER Payment_linked_identity_update BEFORE UPDATE OF id,proofStorageKey ON Payment WHEN EXISTS(SELECT 1 FROM CheckoutPayment WHERE id=NEW.id OR proofStorageKey=NEW.proofStorageKey) BEGIN SELECT RAISE(ABORT,'linked receipt isolated'); END;
CREATE TRIGGER MediaObject_linked_update BEFORE UPDATE ON MediaObject WHEN EXISTS(SELECT 1 FROM CheckoutPayment WHERE proofStorageKey=OLD.key) BEGIN SELECT RAISE(ABORT,'linked receipt immutable'); END;
CREATE TRIGGER MediaObject_linked_delete BEFORE DELETE ON MediaObject WHEN EXISTS(SELECT 1 FROM CheckoutPayment WHERE proofStorageKey=OLD.key) BEGIN SELECT RAISE(ABORT,'linked receipt immutable'); END;
CREATE TRIGGER MediaChunk_linked_insert BEFORE INSERT ON MediaChunk WHEN EXISTS(SELECT 1 FROM CheckoutPayment WHERE proofStorageKey=NEW.objectKey) BEGIN SELECT RAISE(ABORT,'linked receipt immutable'); END;
CREATE TRIGGER MediaChunk_linked_update BEFORE UPDATE ON MediaChunk WHEN EXISTS(SELECT 1 FROM CheckoutPayment WHERE proofStorageKey=OLD.objectKey OR proofStorageKey=NEW.objectKey) BEGIN SELECT RAISE(ABORT,'linked receipt immutable'); END;
CREATE TRIGGER MediaChunk_linked_delete BEFORE DELETE ON MediaChunk WHEN EXISTS(SELECT 1 FROM CheckoutPayment WHERE proofStorageKey=OLD.objectKey) BEGIN SELECT RAISE(ABORT,'linked receipt immutable'); END;
CREATE TRIGGER revision_CheckoutPayment_INSERT AFTER INSERT ON CheckoutPayment BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutPayment_UPDATE AFTER UPDATE ON CheckoutPayment BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutPayment_DELETE AFTER DELETE ON CheckoutPayment BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutPaymentLedger_INSERT AFTER INSERT ON CheckoutPaymentLedger BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutPaymentLedger_UPDATE AFTER UPDATE ON CheckoutPaymentLedger BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_CheckoutPaymentLedger_DELETE AFTER DELETE ON CheckoutPaymentLedger BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_linked_MediaObject_INSERT AFTER INSERT ON MediaObject BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_linked_MediaObject_UPDATE AFTER UPDATE ON MediaObject BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_linked_MediaObject_DELETE AFTER DELETE ON MediaObject BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_linked_MediaChunk_INSERT AFTER INSERT ON MediaChunk BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_linked_MediaChunk_UPDATE AFTER UPDATE ON MediaChunk BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_linked_MediaChunk_DELETE AFTER DELETE ON MediaChunk BEGIN UPDATE _Revision SET version=version+1 WHERE id=1; END;
CREATE VIEW CheckoutOrderFinance AS
SELECT o.id orderId,g.userId,o.publicId,o.saleMode,o.state orderState,o.goodsTotal,o.firstPaymentAmount,
 COALESCE(l.goodsAmount,0) goodsPaid,o.goodsTotal-COALESCE(l.goodsAmount,0) unpaidGoods,
 o.firstPaymentAmount-COALESCE(l.goodsAmount,0) firstPaymentDue,
 CASE WHEN l.id IS NOT NULL THEN 'CONFIRMED' WHEN EXISTS(SELECT 1 FROM CheckoutPayment p WHERE p.orderId=o.id AND p.status='SUBMITTED') THEN 'PENDING_REVIEW' WHEN EXISTS(SELECT 1 FROM CheckoutPayment p WHERE p.orderId=o.id AND p.status='REJECTED') THEN 'REJECTED' ELSE 'AWAITING_PAYMENT' END firstPaymentState,
 CASE WHEN COALESCE(l.goodsAmount,0)=0 THEN 'UNPAID' WHEN l.goodsAmount=o.goodsTotal THEN 'PAID' ELSE 'PARTIALLY_PAID' END goodsPaymentState,
 NULL cargoAmount,0 cargoPaid,0 fulfillmentAllowed,0 finalPaymentEnabled,0 cargoEnabled
FROM CheckoutOrder o JOIN CheckoutGroup g ON g.id=o.checkoutGroupId LEFT JOIN CheckoutPaymentLedger l ON l.orderId=o.id AND l.phase='FIRST' WHERE g.sealed=1;
