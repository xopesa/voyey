-- Preserve legacy clothing behaviour; non-sizing categories explicitly opt out.
-- Buyer weight is unrelated to cargo weight/cost. No order/payment backfill.
ALTER TABLE "Category" ADD COLUMN "requiresBuyerMeasurements" INTEGER NOT NULL DEFAULT 1
  CHECK ("requiresBuyerMeasurements" IN (0,1));
-- NULL means an older order has no historical catalog attributes available.
ALTER TABLE "OrderItem" ADD COLUMN "catalogSnapshot" TEXT
  CHECK ("catalogSnapshot" IS NULL OR (
    json_valid("catalogSnapshot") AND json_type("catalogSnapshot")='object'
    AND COALESCE(json_type("catalogSnapshot",'$.version'),'')='integer'
    AND json_extract("catalogSnapshot",'$.version')=1
    AND length(CAST("catalogSnapshot" AS BLOB))<=65536
  ));
