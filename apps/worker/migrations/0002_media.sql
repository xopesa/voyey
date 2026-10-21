-- Optional R2 is not required: small previews can keep bounded uploads in D1.
-- Product images and private proofs have separate namespaces and access policies.
CREATE TABLE "MediaObject" (
  "key" TEXT PRIMARY KEY,
  "private" INTEGER NOT NULL CHECK ("private" IN (0,1)),
  "contentType" TEXT NOT NULL CHECK ("contentType" IN ('image/jpeg','image/png','image/webp')),
  "size" INTEGER NOT NULL CHECK ("size" BETWEEN 1 AND 5242880),
  "etag" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  CHECK (("private"=0 AND "key" LIKE 'products/%') OR ("private"=1 AND "key" LIKE 'payment-proofs/%'))
);
CREATE TABLE "MediaChunk" (
  "objectKey" TEXT NOT NULL REFERENCES "MediaObject"("key") ON DELETE CASCADE,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal">=0),
  "data" BLOB NOT NULL CHECK (length("data") BETWEEN 1 AND 262144),
  PRIMARY KEY ("objectKey","ordinal")
);
