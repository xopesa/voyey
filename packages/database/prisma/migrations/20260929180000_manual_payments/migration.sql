ALTER TYPE "OrderStatus" ADD VALUE 'PREPAYMENT_SUBMITTED';
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_PURCHASE';
ALTER TYPE "OrderStatus" ADD VALUE 'PURCHASED';
ALTER TYPE "OrderStatus" ADD VALUE 'IN_TRANSIT';
ALTER TYPE "OrderStatus" ADD VALUE 'ARRIVED';
ALTER TYPE "OrderStatus" ADD VALUE 'WEIGHING';
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_FINAL_PAYMENT';
ALTER TYPE "OrderStatus" ADD VALUE 'FINAL_PAYMENT_SUBMITTED';
ALTER TYPE "OrderStatus" ADD VALUE 'PAID_FULL';
ALTER TYPE "OrderStatus" ADD VALUE 'READY_TO_SHIP';
ALTER TYPE "OrderStatus" ADD VALUE 'SHIPPED';
ALTER TYPE "OrderStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "OrderStatus" ADD VALUE 'CANCELLED';

CREATE TYPE "PaymentType" AS ENUM ('PREPAYMENT', 'FINAL');
CREATE TYPE "PaymentStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

ALTER TABLE "Order"
ADD COLUMN "cargoPaidAmount" INTEGER NOT NULL DEFAULT 0,
ADD CONSTRAINT "Order_cargoPaidAmount_check" CHECK (
  "cargoPaidAmount" >= 0 AND
  ("cargoAmount" IS NULL OR "cargoPaidAmount" <= "cargoAmount")
);

-- remainingAmount is the currently unpaid product balance. The original
-- checkout constraint only described a brand-new order and would reject the
-- required zero balance after final payment approval.
ALTER TABLE "Order"
DROP CONSTRAINT "Order_total_split_check",
ADD CONSTRAINT "Order_total_split_check" CHECK (
  ("paidAmount" = 0 AND "requiredPrepayment" + "remainingAmount" = "total") OR
  ("paidAmount" > 0 AND "paidAmount" + "remainingAmount" = "total")
);

CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "PaymentType" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "expectedAmount" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "proofStorageKey" TEXT NOT NULL,
    "proofMimeType" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Payment_expectedAmount_check" CHECK ("expectedAmount" >= 0),
    CONSTRAINT "Payment_proofMimeType_check" CHECK ("proofMimeType" IN ('image/jpeg', 'image/png', 'image/webp'))
);

CREATE UNIQUE INDEX "Payment_proofStorageKey_key" ON "Payment"("proofStorageKey");
CREATE UNIQUE INDEX "Payment_orderId_idempotencyKey_key" ON "Payment"("orderId", "idempotencyKey");
CREATE INDEX "Payment_orderId_submittedAt_idx" ON "Payment"("orderId", "submittedAt");
CREATE INDEX "Payment_status_type_submittedAt_idx" ON "Payment"("status", "type", "submittedAt");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
