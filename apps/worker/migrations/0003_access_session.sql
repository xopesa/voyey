-- Bind opaque Admin sessions to the independently verified Access identity.
ALTER TABLE "AdminWebSession" ADD COLUMN "principalHash" TEXT;
