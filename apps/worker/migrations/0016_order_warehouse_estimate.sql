-- Optional admin-entered calendar date. No changes to existing order status or money.
ALTER TABLE "Order" ADD COLUMN "estimatedWarehouseArrival" TEXT;
