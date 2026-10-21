import type { DatabaseSync } from "node:sqlite";
import { isolatedD1 } from "./sqlite.js";
export const financeSeed = `
INSERT INTO User(id,telegramId,firstName,updatedAt) VALUES('finance-user',980001,'Isolated finance',1);
INSERT INTO "Order"(id,publicId,userId,idempotencyKey,status,fullName,phone,city,address,subtotal,total,requiredPrepayment,remainingAmount,updatedAt) VALUES('o','STZ-FINANCE','finance-user','finance-fixture-key-0001','AWAITING_PURCHASE','Isolated','0000000','Test','Fixture',290000,290000,145000,145000,1);
INSERT INTO OrderItem(id,orderId,productNameRu,productNameUz,productSlug,sku,size,unitPrice,quantity,lineTotal) VALUES('i','o','Брюки','Shim','fixture','FIN-M','M',145000,2,290000);
`;
export function financeFixture() {
  const f = isolatedD1();
  f.sqlite.exec(financeSeed);
  return f;
}
export function payment(
  sqlite: DatabaseSync,
  id: string,
  type: "PREPAYMENT" | "FINAL",
  status: "APPROVED" | "SUBMITTED" | "REJECTED",
  amount: number,
  date = Date.parse("2026-10-20T00:00:00Z"),
  reviewed: number | null = date,
) {
  sqlite
    .prepare(
      `INSERT INTO Payment(id,orderId,type,status,expectedAmount,idempotencyKey,proofStorageKey,proofMimeType,submittedAt,reviewedAt,updatedAt) VALUES(?,'o',?,?,?,?,?,'image/png',?,?,1)`,
    )
    .run(id, type, status, amount, id, id, date, reviewed);
}
