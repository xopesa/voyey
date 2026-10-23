import { atomic, prisma } from "@stenzo/database";
import { createHash } from "node:crypto";
import { cartInclude } from "../cart/repository.js";
import { HttpError } from "../auth/errors.js";
import { idempotencyKeySchema } from "../orders/schemas.js";
import { promoForCheckout } from "../marketing/promo-codes.js";
import { buildSplitCheckoutPlan } from "./split-plan.js";
import {
  calculateSplitFinance,
  parseSplitFinanceSelection,
} from "./finance.js";

/** Internal read-only quote. No HTTP registration, receipt uploads, approvals or redemptions. */
export class SplitFinanceQuotes {
  constructor(private readonly preparationEnabled = false) {}
  async quote(userId: string, key: string, value: unknown) {
    if (!this.preparationEnabled)
      throw new HttpError(503, "New financial quotes are disabled");
    const selection = parseSplitFinanceSelection(value),
      parsedKey = idempotencyKeySchema.safeParse(key);
    if (!parsedKey.success) throw new HttpError(400, "Invalid Idempotency-Key");
    return atomic(async () => {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.status !== "ACTIVE")
        throw new HttpError(409, "Customer unavailable");
      if (
        await prisma.order.findUnique({
          where: {
            userId_idempotencyKey: { userId, idempotencyKey: parsedKey.data },
          },
        })
      )
        throw new HttpError(409, "Key belongs to an existing order");
      const cart = await prisma.cart.findUnique({
        where: { userId },
        include: cartInclude,
      });
      if (!cart) throw new HttpError(409, "Cart is empty");
      const now = Date.now(),
        plan = buildSplitCheckoutPlan(cart, parsedKey.data, now);
      let discount = 0,
        promoCode: string | null = null;
      if (selection.promoCode !== undefined) {
        const result = await promoForCheckout(
          userId,
          selection.promoCode,
          plan.subtotal,
          now,
        );
        if (!result.quote.valid) throw new HttpError(409, result.quote.reason);
        discount = result.quote.discountAmount;
        promoCode = result.quote.code;
      }
      const finance = calculateSplitFinance(
        plan,
        selection.preorderPercent,
        discount,
      );
      return {
        quoteFingerprint: createHash("sha256")
          .update(JSON.stringify([finance.financialFingerprint, promoCode]))
          .digest("hex"),
        plan,
        finance,
        promoCode,
        promoRedemptionCount: 0 as const,
        ownerAuthorization: "UNRESOLVED_WRITE_BLOCKED" as const,
      };
    });
  }
  confirmPayment(): never {
    throw new HttpError(
      503,
      "Owner identity and new payment persistence are not implemented",
    );
  }
  commit(): never {
    throw new HttpError(503, "Linked orders are blocked until stage 2.4B");
  }
}
