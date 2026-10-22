-- Additive category schemas and scalar values. Existing catalog/order data stays intact.
-- Legacy size stays a NOT NULL string for existing DTOs and order snapshots.
-- New catalog inputs may omit it; repositories persist "" to represent no size.
ALTER TABLE "Category" ADD COLUMN "attributeDefinitions" TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid("attributeDefinitions") AND json_type("attributeDefinitions")='array'
    AND length(CAST("attributeDefinitions" AS BLOB))<=16384);
ALTER TABLE "Product" ADD COLUMN "attributes" TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid("attributes") AND json_type("attributes")='object'
    AND length(CAST("attributes" AS BLOB))<=16384);
ALTER TABLE "ProductVariant" ADD COLUMN "attributes" TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid("attributes") AND json_type("attributes")='object'
    AND length(CAST("attributes" AS BLOB))<=16384);
