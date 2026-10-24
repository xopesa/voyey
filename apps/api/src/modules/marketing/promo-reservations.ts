import { database } from "@stenzo/database";
import type { CartRecord } from "../cart/types.js";
import type { SplitCheckoutPlan } from "../checkout/split-plan.js";
import { hasPromoLifecycle } from "../checkout/first-window.js";
import { promoUsage } from "./promo-codes.js";
import { readPromoPolicy } from "./promo-store.js";
import { evaluatePromoPolicy } from "./promo-policy.js";
import { HttpError } from "../auth/errors.js";

/** Historical usage is counted once in its original table; no CheckoutPromoUse mirror for v2. */
export async function promoV2Usage(promoCodeId: string, userId?: string) {
  const old = await promoUsage(promoCodeId, userId);
  if (!(await hasPromoLifecycle())) return old;
  const reserved = await database()
    .prepare(
      `SELECT COUNT(*) n FROM PromoReservation r WHERE promoCodeId=?
     AND NOT EXISTS(SELECT 1 FROM PromoReservationEvent e WHERE e.reservationId=r.id AND e.kind='RELEASED')${userId ? " AND userId=?" : ""}`,
    )
    .bind(promoCodeId, ...(userId ? [userId] : []))
    .first<{ n: number }>();
  return old + reserved!.n;
}

/** Only used inside the new opt-in checkout's atomic callback. No reservation is made by a quote. */
export async function quoteReservedPromo(
  userId: string,
  code: string,
  cart: CartRecord,
  plan: SplitCheckoutPlan,
  now: number,
) {
  const { promoCodeId, config } = await readPromoPolicy(code);
  const quote = evaluatePromoPolicy(config, {
    userId,
    now,
    usage: {
      global: await promoV2Usage(promoCodeId),
      account: await promoV2Usage(promoCodeId, userId),
    },
    lines: plan.orders.flatMap((o) =>
      o.items.map((i) => ({
        lineId: i.cartItemId,
        productId: i.productId,
        categoryId: cart.items.find((row) => row.id === i.cartItemId)!.product
          .category.id!,
        saleMode: i.saleMode,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
    ),
  });
  if (!quote.valid)
    throw new HttpError(409, `Promo ineligible: ${quote.reason}`);
  return { promoCodeId, quote, snapshot: { version: 2, config, quote } };
}
