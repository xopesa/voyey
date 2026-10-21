-- Private admin reference; existing products and order snapshots are unchanged.
ALTER TABLE "Product" ADD COLUMN "sourceUrl" TEXT;
