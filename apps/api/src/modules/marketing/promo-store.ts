import { database, prisma } from "@stenzo/database";
import { HttpError } from "../auth/errors.js";
import type { PromoPolicy } from "./promo-policy.js";
type PolicyRow = {
  promoCodeId: string;
  saleModes: PromoPolicy["saleModes"];
  audience: PromoPolicy["audience"];
  scope: PromoPolicy["scope"];
  purpose: PromoPolicy["purpose"];
  personalUserId: string | null;
  campaignId: string | null;
};

/** Read-only internal store. Authentication and CAS belong to the caller. */
export async function readPromoPolicy(code: string) {
  const p = await prisma.promoCode.findUnique({ where: { code } });
  if (!p || p.engineVersion !== 2)
    throw new HttpError(
      404,
      "Advanced promo not found; legacy codes use the existing engine",
    );
  const policy = await database()
    .prepare("SELECT * FROM PromoCodePolicy WHERE promoCodeId=? AND sealed=1")
    .bind(p.id)
    .first<PolicyRow>();
  if (!policy) throw new HttpError(409, "Promo policy incomplete");
  const categories = (
    await database()
      .prepare(
        "SELECT categoryId FROM PromoPolicyCategory WHERE promoCodeId=? ORDER BY categoryId",
      )
      .bind(p.id)
      .all<{ categoryId: string }>()
  ).results;
  const products = (
    await database()
      .prepare(
        "SELECT productId FROM PromoPolicyProduct WHERE promoCodeId=? ORDER BY productId",
      )
      .bind(p.id)
      .all<{ productId: string }>()
  ).results;
  const exclusions = (
    await database()
      .prepare(
        "SELECT productId,saleModes FROM PromoPolicyExclusion WHERE promoCodeId=? ORDER BY productId,saleModes",
      )
      .bind(p.id)
      .all<{ productId: string; saleModes: PromoPolicy["saleModes"] }>()
  ).results;
  const config = {
    code: p.code,
    type: p.type,
    value: p.value,
    minOrderAmount: p.minOrderAmount,
    maxDiscount: p.maxDiscount,
    startsAt: p.startsAt?.toISOString() ?? null,
    endsAt: p.endsAt?.toISOString() ?? null,
    usageLimit: p.usageLimit,
    perUserLimit: p.perUserLimit,
    isActive: p.isActive,
    saleModes: policy.saleModes,
    audience: policy.audience,
    purpose: policy.purpose,
    personalUserId: policy.personalUserId,
    campaignId: policy.campaignId,
    scope: policy.scope,
    categoryIds: categories.map((c) => c.categoryId),
    productIds: products.map((p) => p.productId),
    exclusions,
  };
  return { promoCodeId: p.id, config };
}
