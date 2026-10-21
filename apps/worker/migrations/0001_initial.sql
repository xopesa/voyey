-- D1 schema. Independent preview database only; never run against Turon.
PRAGMA foreign_keys = ON;

CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "telegramId" TEXT NOT NULL UNIQUE,
  "username" TEXT,
  "firstName" TEXT,
  "lastName" TEXT,
  "languageCode" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','BLOCKED','DELETED')),
  "createdAt" INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  "updatedAt" INTEGER NOT NULL
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "metadata" TEXT CHECK ("metadata" IS NULL OR json_valid("metadata")),
  "createdAt" INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "AuditLog_0_idx" ON "AuditLog" ("actorId","createdAt");
CREATE INDEX "AuditLog_1_idx" ON "AuditLog" ("entityType","entityId");
CREATE INDEX "AuditLog_2_idx" ON "AuditLog" ("createdAt");

CREATE TABLE "Category" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "nameRu" TEXT NOT NULL,
  "nameRu__fold" TEXT,
  "nameUz" TEXT NOT NULL,
  "nameUz__fold" TEXT,
  "slug" TEXT NOT NULL UNIQUE,
  "slug__fold" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0 CHECK ("sortOrder" BETWEEN -2147483648 AND 2147483647),
  "isActive" INTEGER NOT NULL DEFAULT 1 CHECK ("isActive" IN (0,1)),
  "createdAt" INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  "updatedAt" INTEGER NOT NULL,
  CONSTRAINT "Category_sortOrder_check" CHECK ("sortOrder" >= 0)
);
CREATE INDEX "Category_0_idx" ON "Category" ("isActive","sortOrder");

CREATE TABLE "Product" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "categoryId" TEXT NOT NULL,
  "nameRu" TEXT NOT NULL,
  "nameRu__fold" TEXT,
  "nameUz" TEXT NOT NULL,
  "nameUz__fold" TEXT,
  "slug" TEXT NOT NULL UNIQUE,
  "slug__fold" TEXT,
  "descriptionRu" TEXT,
  "descriptionRu__fold" TEXT,
  "descriptionUz" TEXT,
  "descriptionUz__fold" TEXT,
  "sourceUrl" TEXT,
  "price" INTEGER NOT NULL CHECK ("price" BETWEEN -2147483648 AND 2147483647),
  "currency" TEXT NOT NULL DEFAULT 'UZS' CHECK ("currency" IN ('UZS')),
  "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','ACTIVE','INACTIVE')),
  "isFeatured" INTEGER NOT NULL DEFAULT 0 CHECK ("isFeatured" IN (0,1)),
  "createdAt" INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Product_price_check" CHECK ("price" >= 0)
);
CREATE INDEX "Product_0_idx" ON "Product" ("categoryId","status");
CREATE INDEX "Product_1_idx" ON "Product" ("status","isFeatured");
CREATE INDEX "Product_2_idx" ON "Product" ("status","createdAt","id");

CREATE TABLE "ProductImage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "storageKey" TEXT UNIQUE,
  "sortOrder" INTEGER NOT NULL DEFAULT 0 CHECK ("sortOrder" BETWEEN -2147483648 AND 2147483647),
  "isPrimary" INTEGER NOT NULL DEFAULT 0 CHECK ("isPrimary" IN (0,1)),
  "createdAt" INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductImage_sortOrder_check" CHECK ("sortOrder" >= 0)
);
CREATE INDEX "ProductImage_0_idx" ON "ProductImage" ("productId","sortOrder");
CREATE INDEX "ProductImage_1_idx" ON "ProductImage" ("productId","isPrimary");

CREATE TABLE "ProductVariant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "sku" TEXT NOT NULL UNIQUE,
  "size" TEXT NOT NULL,
  "color" TEXT,
  "stock" INTEGER CHECK ("stock" BETWEEN -2147483648 AND 2147483647),
  "isActive" INTEGER NOT NULL DEFAULT 1 CHECK ("isActive" IN (0,1)),
  "createdAt" INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductVariant_stock_check" CHECK ("stock" IS NULL OR "stock" >= 0)
);
CREATE INDEX "ProductVariant_0_idx" ON "ProductVariant" ("productId","isActive");
CREATE INDEX "ProductVariant_1_idx" ON "ProductVariant" ("productId","size");

CREATE TABLE "Cart" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "createdAt" INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CartItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "cartId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" BETWEEN -2147483648 AND 2147483647),
  "heightCm" INTEGER CHECK ("heightCm" BETWEEN -2147483648 AND 2147483647),
  "weightKg" INTEGER CHECK ("weightKg" BETWEEN -2147483648 AND 2147483647),
  "createdAt" INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("cartId") REFERENCES "Cart" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CartItem_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "CartItem_heightCm_check" CHECK ("heightCm" IS NULL OR "heightCm" BETWEEN 100 AND 250),
  CONSTRAINT "CartItem_weightKg_check" CHECK ("weightKg" IS NULL OR "weightKg" BETWEEN 30 AND 300)
);
CREATE UNIQUE INDEX "CartItem_0_idx" ON "CartItem" ("cartId","variantId");
CREATE INDEX "CartItem_1_idx" ON "CartItem" ("productId");
CREATE INDEX "CartItem_2_idx" ON "CartItem" ("variantId");

CREATE TABLE "Order" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "publicId" TEXT NOT NULL UNIQUE,
  "publicId__fold" TEXT,
  "userId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'AWAITING_PREPAYMENT' CHECK ("status" IN ('AWAITING_PREPAYMENT','PREPAYMENT_SUBMITTED','AWAITING_PURCHASE','PURCHASED','IN_TRANSIT','ARRIVED','WEIGHING','AWAITING_FINAL_PAYMENT','FINAL_PAYMENT_SUBMITTED','PAID_FULL','READY_TO_SHIP','SHIPPED','COMPLETED','CANCELLED')),
  "fullName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "apartment" TEXT,
  "comment" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'UZS' CHECK ("currency" IN ('UZS')),
  "subtotal" INTEGER NOT NULL CHECK ("subtotal" BETWEEN -2147483648 AND 2147483647),
  "total" INTEGER NOT NULL CHECK ("total" BETWEEN -2147483648 AND 2147483647),
  "requiredPrepayment" INTEGER NOT NULL CHECK ("requiredPrepayment" BETWEEN -2147483648 AND 2147483647),
  "paidAmount" INTEGER NOT NULL DEFAULT 0 CHECK ("paidAmount" BETWEEN -2147483648 AND 2147483647),
  "remainingAmount" INTEGER NOT NULL CHECK ("remainingAmount" BETWEEN -2147483648 AND 2147483647),
  "cargoAmount" INTEGER CHECK ("cargoAmount" BETWEEN -2147483648 AND 2147483647),
  "cargoPaidAmount" INTEGER NOT NULL DEFAULT 0 CHECK ("cargoPaidAmount" BETWEEN -2147483648 AND 2147483647),
  "createdAt" INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Order_amounts_check" CHECK (
      "subtotal" >= 0 AND "subtotal" = "total" AND "total" >= 0 AND "requiredPrepayment" >= 0 AND
      "paidAmount" >= 0 AND "remainingAmount" >= 0 AND
      "paidAmount" <= "total" AND
      ("cargoAmount" IS NULL OR "cargoAmount" >= 0)
    ),
  CONSTRAINT "Order_total_split_check" CHECK (
  ("paidAmount" = 0 AND "requiredPrepayment" + "remainingAmount" = "total") OR
  ("paidAmount" > 0 AND "paidAmount" + "remainingAmount" = "total")
),
  CONSTRAINT "Order_cargoPaidAmount_check" CHECK (
  "cargoPaidAmount" >= 0 AND
  ("cargoAmount" IS NULL OR "cargoPaidAmount" <= "cargoAmount")
)
);
CREATE UNIQUE INDEX "Order_0_idx" ON "Order" ("userId","idempotencyKey");
CREATE INDEX "Order_1_idx" ON "Order" ("userId","createdAt","id");
CREATE INDEX "Order_2_idx" ON "Order" ("status","createdAt","id");

CREATE TABLE "OrderItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "productId" TEXT,
  "variantId" TEXT,
  "productNameRu" TEXT NOT NULL,
  "productNameUz" TEXT NOT NULL,
  "productSlug" TEXT NOT NULL,
  "imageUrl" TEXT,
  "sku" TEXT NOT NULL,
  "size" TEXT NOT NULL,
  "color" TEXT,
  "unitPrice" INTEGER NOT NULL CHECK ("unitPrice" BETWEEN -2147483648 AND 2147483647),
  "quantity" INTEGER NOT NULL CHECK ("quantity" BETWEEN -2147483648 AND 2147483647),
  "lineTotal" INTEGER NOT NULL CHECK ("lineTotal" BETWEEN -2147483648 AND 2147483647),
  "heightCm" INTEGER CHECK ("heightCm" BETWEEN -2147483648 AND 2147483647),
  "weightKg" INTEGER CHECK ("weightKg" BETWEEN -2147483648 AND 2147483647),
  "createdAt" INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "OrderItem_amounts_check" CHECK ("unitPrice" >= 0 AND "quantity" > 0 AND "lineTotal" = "unitPrice" * "quantity"),
  CONSTRAINT "OrderItem_heightCm_check" CHECK ("heightCm" IS NULL OR "heightCm" BETWEEN 100 AND 250),
  CONSTRAINT "OrderItem_weightKg_check" CHECK ("weightKg" IS NULL OR "weightKg" BETWEEN 30 AND 300)
);
CREATE INDEX "OrderItem_0_idx" ON "OrderItem" ("orderId");
CREATE INDEX "OrderItem_1_idx" ON "OrderItem" ("productId");
CREATE INDEX "OrderItem_2_idx" ON "OrderItem" ("variantId");

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('PREPAYMENT','FINAL')),
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK ("status" IN ('SUBMITTED','APPROVED','REJECTED')),
  "expectedAmount" INTEGER NOT NULL CHECK ("expectedAmount" BETWEEN -2147483648 AND 2147483647),
  "idempotencyKey" TEXT NOT NULL,
  "proofStorageKey" TEXT NOT NULL UNIQUE,
  "proofMimeType" TEXT NOT NULL,
  "reviewedByUserId" TEXT,
  "rejectionReason" TEXT,
  "submittedAt" INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  "reviewedAt" INTEGER,
  "createdAt" INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Payment_expectedAmount_check" CHECK ("expectedAmount" >= 0),
  CONSTRAINT "Payment_proofMimeType_check" CHECK ("proofMimeType" IN ('image/jpeg', 'image/png', 'image/webp'))
);
CREATE UNIQUE INDEX "Payment_0_idx" ON "Payment" ("orderId","idempotencyKey");
CREATE INDEX "Payment_1_idx" ON "Payment" ("orderId","submittedAt");
CREATE INDEX "Payment_2_idx" ON "Payment" ("status","type","submittedAt");

CREATE TABLE "AdminWebSession" (
  "tokenHash" TEXT NOT NULL PRIMARY KEY,
  "csrfToken" TEXT NOT NULL,
  "expiresAt" INTEGER NOT NULL
);
CREATE INDEX "AdminWebSession_0_idx" ON "AdminWebSession" ("expiresAt");

CREATE TABLE "AdminLoginRateLimit" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL CHECK ("count" BETWEEN -2147483648 AND 2147483647),
  "expiresAt" INTEGER NOT NULL,
  CONSTRAINT "AdminLoginRateLimit_count_check" CHECK ("count" >= 0)
);
CREATE INDEX "AdminLoginRateLimit_0_idx" ON "AdminLoginRateLimit" ("expiresAt");

CREATE UNIQUE INDEX "ProductImage_one_primary_per_product_key" ON "ProductImage" ("productId") WHERE "isPrimary" = 1;
CREATE TABLE "_Revision" ("id" INTEGER PRIMARY KEY CHECK (id=1), "version" INTEGER NOT NULL);
INSERT INTO "_Revision" VALUES (1,0);
CREATE TABLE "_BatchGuard" ("id" TEXT PRIMARY KEY, "ok" INTEGER NOT NULL CHECK (ok=1));
CREATE TRIGGER "revision_User_INSERT" AFTER INSERT ON "User" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_User_UPDATE" AFTER UPDATE ON "User" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_User_DELETE" AFTER DELETE ON "User" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_AuditLog_INSERT" AFTER INSERT ON "AuditLog" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_AuditLog_UPDATE" AFTER UPDATE ON "AuditLog" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_AuditLog_DELETE" AFTER DELETE ON "AuditLog" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Category_INSERT" AFTER INSERT ON "Category" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Category_UPDATE" AFTER UPDATE ON "Category" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Category_DELETE" AFTER DELETE ON "Category" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Product_INSERT" AFTER INSERT ON "Product" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Product_UPDATE" AFTER UPDATE ON "Product" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Product_DELETE" AFTER DELETE ON "Product" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_ProductImage_INSERT" AFTER INSERT ON "ProductImage" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_ProductImage_UPDATE" AFTER UPDATE ON "ProductImage" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_ProductImage_DELETE" AFTER DELETE ON "ProductImage" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_ProductVariant_INSERT" AFTER INSERT ON "ProductVariant" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_ProductVariant_UPDATE" AFTER UPDATE ON "ProductVariant" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_ProductVariant_DELETE" AFTER DELETE ON "ProductVariant" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Cart_INSERT" AFTER INSERT ON "Cart" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Cart_UPDATE" AFTER UPDATE ON "Cart" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Cart_DELETE" AFTER DELETE ON "Cart" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_CartItem_INSERT" AFTER INSERT ON "CartItem" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_CartItem_UPDATE" AFTER UPDATE ON "CartItem" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_CartItem_DELETE" AFTER DELETE ON "CartItem" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Order_INSERT" AFTER INSERT ON "Order" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Order_UPDATE" AFTER UPDATE ON "Order" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Order_DELETE" AFTER DELETE ON "Order" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_OrderItem_INSERT" AFTER INSERT ON "OrderItem" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_OrderItem_UPDATE" AFTER UPDATE ON "OrderItem" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_OrderItem_DELETE" AFTER DELETE ON "OrderItem" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Payment_INSERT" AFTER INSERT ON "Payment" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Payment_UPDATE" AFTER UPDATE ON "Payment" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_Payment_DELETE" AFTER DELETE ON "Payment" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_AdminWebSession_INSERT" AFTER INSERT ON "AdminWebSession" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_AdminWebSession_UPDATE" AFTER UPDATE ON "AdminWebSession" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_AdminWebSession_DELETE" AFTER DELETE ON "AdminWebSession" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_AdminLoginRateLimit_INSERT" AFTER INSERT ON "AdminLoginRateLimit" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_AdminLoginRateLimit_UPDATE" AFTER UPDATE ON "AdminLoginRateLimit" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
CREATE TRIGGER "revision_AdminLoginRateLimit_DELETE" AFTER DELETE ON "AdminLoginRateLimit" BEGIN UPDATE "_Revision" SET "version"="version"+1 WHERE id=1; END;
