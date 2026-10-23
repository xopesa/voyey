import { atomic, database, type prisma } from "@stenzo/database";
import { HttpError } from "../auth/errors.js";
import type { GroupFinance } from "./finance.js";
import type { SplitCheckoutPlan } from "./split-plan.js";
import type { z } from "zod";
import type { recipientSchema } from "../orders/schemas.js";
import { readOrderFinance } from "./payment-state.js";

type GroupRow = Omit<
  Awaited<ReturnType<typeof prisma.checkoutGroup.findUniqueOrThrow>>,
  "createdAt" | "recipient" | "sealed"
> & { createdAt: number; recipient: string; sealed: number };
type OrderRow = Omit<
  Awaited<ReturnType<typeof prisma.checkoutOrder.findUniqueOrThrow>>,
  "createdAt" | "financialPolicy"
> & { createdAt: number; financialPolicy: string };
type ItemRow = Omit<
  Awaited<ReturnType<typeof prisma.checkoutOrderItem.findUniqueOrThrow>>,
  "createdAt" | "snapshot"
> & { createdAt: number; snapshot: string };

export async function assertNoCheckoutGroupKey(userId: string, key: string) {
  if (
    await database()
      .prepare(
        "SELECT id FROM CheckoutGroup WHERE userId=? AND idempotencyKey=?",
      )
      .bind(userId, key)
      .first()
  )
    throw new HttpError(409, "Idempotency key belongs to linked checkout");
}
export async function readCheckoutGroup(userId: string, id: string) {
  return atomic(() => readGroupSnapshot(userId, id));
}
async function readGroupSnapshot(userId: string, id: string) {
  const group = await database()
    .prepare("SELECT * FROM CheckoutGroup WHERE id=? AND userId=? AND sealed=1")
    .bind(id, userId)
    .first<GroupRow>();
  if (!group) throw new HttpError(404, "Checkout group not found");
  const orders = (
    await database()
      .prepare(
        "SELECT * FROM CheckoutOrder WHERE checkoutGroupId=? ORDER BY saleMode",
      )
      .bind(id)
      .all<OrderRow>()
  ).results;
  return {
    ...group,
    recipient: JSON.parse(group.recipient) as z.infer<typeof recipientSchema>,
    orders: await Promise.all(
      orders.map(async (order) => ({
        ...order,
        // The 0021 row is the immutable creation contract; expose current ledger money.
        ...(await readOrderFinance(order.id)),
        financialPolicy: JSON.parse(order.financialPolicy) as GroupFinance & {
          version: 1;
        },
        items: (
          await database()
            .prepare(
              "SELECT * FROM CheckoutOrderItem WHERE orderId=? ORDER BY id",
            )
            .bind(order.id)
            .all<ItemRow>()
        ).results.map((item) => ({
          ...item,
          snapshot: JSON.parse(
            item.snapshot,
          ) as SplitCheckoutPlan["orders"][number]["items"][number] & {
            version: 1;
          },
        })),
      })),
    ),
  };
}
