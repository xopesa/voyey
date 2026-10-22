-- Additive catalog metadata only. Does not select an order fulfilment mode.
-- NULL stock keeps its existing untracked/unlimited meaning; never infer PREORDER.
ALTER TABLE "ProductVariant" ADD COLUMN "preorderEnabled" INTEGER NOT NULL DEFAULT 0
  CHECK ("preorderEnabled" IN (0, 1));
