CREATE TABLE "AdminWebSession" (
  "tokenHash" TEXT NOT NULL PRIMARY KEY,
  "csrfToken" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AdminWebSession_expiresAt_idx" ON "AdminWebSession"("expiresAt");

CREATE TABLE "AdminLoginRateLimit" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminLoginRateLimit_count_check" CHECK ("count" >= 0)
);
CREATE INDEX "AdminLoginRateLimit_expiresAt_idx" ON "AdminLoginRateLimit"("expiresAt");
