-- Additive Finance V1. No seeds, timestamp backfill or business-record updates.
ALTER TABLE "OrderItem" ADD COLUMN "procurementUnitCost" INTEGER CHECK ("procurementUnitCost" IS NULL OR (typeof("procurementUnitCost")='integer' AND "procurementUnitCost" BETWEEN 1 AND 2147483647));
ALTER TABLE "OrderItem" ADD COLUMN "procurementUpdatedAt" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN "procurementUpdatedBy" TEXT;
ALTER TABLE "Order" ADD COLUMN "completedAt" INTEGER;
CREATE INDEX "Order_completedAt" ON "Order"("completedAt","id");
CREATE TABLE "Expense" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "category" TEXT NOT NULL CHECK ("category" IN ('CARGO','PACKAGING','DELIVERY','ADVERTISING','BANK_FEE','OTHER')),
 "amount" INTEGER NOT NULL CHECK (typeof("amount")='integer' AND "amount" BETWEEN 1 AND 2147483647),
 "occurredAt" INTEGER NOT NULL,
 "description" TEXT CHECK ("description" IS NULL OR length("description")<=500),
 "orderId" TEXT REFERENCES "Order"("id") ON DELETE RESTRICT,
 "createdBy" TEXT NOT NULL,
 "createdAt" INTEGER NOT NULL,
 "updatedAt" INTEGER NOT NULL,
 "voidedAt" INTEGER,
 "voidedBy" TEXT
);
CREATE INDEX "Expense_occurredAt" ON "Expense"("occurredAt" DESC,"id" DESC);
CREATE INDEX "Expense_category_occurredAt" ON "Expense"("category","occurredAt" DESC,"id" DESC);
CREATE INDEX "Expense_orderId" ON "Expense"("orderId");
CREATE INDEX "Payment_finance_reviewedAt" ON "Payment"(COALESCE("reviewedAt","submittedAt")) WHERE "status"='APPROVED';
CREATE TRIGGER "revision_Expense_INSERT" AFTER INSERT ON "Expense" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Expense_UPDATE" AFTER UPDATE ON "Expense" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Expense_DELETE" AFTER DELETE ON "Expense" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
