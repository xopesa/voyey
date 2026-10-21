-- Optional reporting annotation only. No existing orders/payments/stock are changed.
ALTER TABLE "Order" ADD COLUMN "dashboardHiddenAt" INTEGER;
CREATE INDEX "Order_dashboard_visibility_createdAt" ON "Order"("dashboardHiddenAt","createdAt","id");
