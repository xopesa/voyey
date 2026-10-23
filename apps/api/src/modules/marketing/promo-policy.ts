import { z } from "zod";
import { HttpError } from "../auth/errors.js";
import { proposeDiscountAllocation } from "../checkout/split-plan.js";
import { promoSchema } from "./promo-codes.js";

const id = z.string().trim().min(1).max(100);
const mode = z.enum(["IN_STOCK", "PREORDER", "BOTH"]);
const ids = z.array(id).max(100).default([]);
/** Reuses the existing code/money/date validation, including the inherited 1..90 percent limit. */
export const promoPolicySchema = promoSchema
  .safeExtend({
    saleModes: mode.default("BOTH"),
    audience: z.enum(["PUBLIC", "PERSONAL", "BLOGGER"]).default("PUBLIC"),
    purpose: z.enum(["STANDARD", "COMPENSATION"]).default("STANDARD"),
    personalUserId: id.nullable().default(null),
    campaignId: id.nullable().default(null),
    scope: z.enum(["ALL", "CATEGORIES", "PRODUCTS"]).default("ALL"),
    categoryIds: ids,
    productIds: ids,
    exclusions: z
      .array(z.object({ productId: id, saleModes: mode }).strict())
      .max(100)
      .default([]),
  })
  .superRefine((p, ctx) => {
    const invalid = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (
      (p.audience === "PERSONAL") !== (p.personalUserId !== null) ||
      (p.audience === "BLOGGER") !== (p.campaignId !== null)
    )
      invalid("Audience association required exclusively for its type");
    if (p.purpose === "COMPENSATION" && p.audience !== "PERSONAL")
      invalid("Compensation requires a specific account");
    if (
      (p.scope === "CATEGORIES") !== p.categoryIds.length > 0 ||
      (p.scope === "PRODUCTS") !== p.productIds.length > 0
    )
      invalid("Scope must match selected IDs");
    for (const list of [p.categoryIds, p.productIds])
      if (new Set(list).size !== list.length) invalid("Duplicate selection");
    const byProduct = new Map<string, Set<string>>();
    for (const e of p.exclusions) {
      const set = byProduct.get(e.productId) ?? new Set<string>();
      if (
        set.has(e.saleModes) ||
        set.has("BOTH") ||
        (e.saleModes === "BOTH" && set.size)
      )
        invalid("Duplicate or overlapping exclusion");
      set.add(e.saleModes);
      byProduct.set(e.productId, set);
    }
  });
export function parsePromoPolicy(value: unknown) {
  const p = promoPolicySchema.safeParse(value);
  if (!p.success) throw new HttpError(400, "Invalid VOYEY promo policy");
  return { ...p.data, code: p.data.code! };
}
export type PromoPolicy = z.output<typeof promoPolicySchema>;
export type PromoPolicyInput = z.input<typeof promoPolicySchema>;
const money = z.number().int().min(0).max(2147483647);
const contextSchema = z
  .object({
    userId: id,
    now: z.number().int().min(0).max(8640000000000000),
    usage: z
      .object({ global: money, account: money })
      .strict()
      .refine((u) => u.account <= u.global),
    lines: z
      .array(
        z
          .object({
            lineId: id,
            productId: id,
            categoryId: id,
            saleMode: z.enum(["IN_STOCK", "PREORDER"]),
            quantity: z.number().int().min(1).max(99),
            unitPrice: money,
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
export type PromoEligibilityContext = z.input<typeof contextSchema>;
export function promoKind(p: Pick<PromoPolicy, "audience" | "saleModes">) {
  return p.audience !== "PUBLIC"
    ? p.audience
    : p.saleModes === "BOTH"
      ? "UNIVERSAL"
      : p.saleModes;
}
/** Deterministic, server-input-only quote. NO reservation, redemption, order or payment writes. */
export function evaluatePromoPolicy(value: unknown, context: unknown) {
  const p = parsePromoPolicy(value),
    parsed = contextSchema.safeParse(context);
  if (!parsed.success)
    throw new HttpError(400, "Invalid promo eligibility context");
  const c = parsed.data;
  if (new Set(c.lines.map((l) => l.lineId)).size !== c.lines.length)
    throw new HttpError(400, "Duplicate promo line");
  const safe = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0 || n > 2147483647)
      throw new HttpError(400, "Promo amount overflow");
    return n;
  };
  const lines = c.lines.map((l) => {
    const modeAllowed = p.saleModes === "BOTH" || p.saleModes === l.saleMode;
    const scopeAllowed =
      p.scope === "ALL" ||
      (p.scope === "CATEGORIES"
        ? p.categoryIds.includes(l.categoryId)
        : p.productIds.includes(l.productId));
    const excluded = p.exclusions.some(
      (e) =>
        e.productId === l.productId &&
        (e.saleModes === "BOTH" || e.saleModes === l.saleMode),
    );
    return {
      ...l,
      subtotal: safe(l.quantity * l.unitPrice),
      eligible: modeAllowed && scopeAllowed && !excluded,
    };
  });
  const subtotal = safe(lines.reduce((n, l) => n + l.subtotal, 0));
  const eligibleSubtotal = safe(
    lines.reduce((n, l) => n + (l.eligible ? l.subtotal : 0), 0),
  );
  const fail = (reason: string) => ({
    valid: false as const,
    version: 2 as const,
    executable: false as const,
    reason,
  });
  if (!p.isActive) return fail("INACTIVE");
  if (p.startsAt && c.now < p.startsAt.getTime()) return fail("NOT_STARTED");
  if (p.endsAt && c.now >= p.endsAt.getTime()) return fail("EXPIRED");
  if (p.audience === "PERSONAL" && p.personalUserId !== c.userId)
    return fail("PERSONAL_MISMATCH");
  if (!lines.length) return fail("EMPTY_CART");
  if (!eligibleSubtotal) return fail("NO_ELIGIBLE_ITEMS");
  if (p.minOrderAmount !== null && eligibleSubtotal < p.minOrderAmount)
    return fail("MINIMUM");
  if (p.usageLimit !== null && c.usage.global >= p.usageLimit)
    return fail("LIMIT");
  if (c.usage.account >= p.perUserLimit) return fail("USER_LIMIT");
  const raw =
    p.type === "FIXED"
      ? p.value
      : Number((BigInt(eligibleSubtotal) * BigInt(p.value)) / 100n);
  const discountAmount = Math.min(
    eligibleSubtotal,
    raw,
    p.type === "PERCENT" ? (p.maxDiscount ?? 2147483647) : 2147483647,
  );
  if (!discountAmount) return fail("ZERO_DISCOUNT");
  const groups = (["IN_STOCK", "PREORDER"] as const).map((key) => ({
    key,
    subtotal: lines
      .filter((l) => l.eligible && l.saleMode === key)
      .reduce((n, l) => n + l.subtotal, 0),
  }));
  return {
    valid: true as const,
    version: 2 as const,
    executable: false as const,
    code: p.code!,
    kind: promoKind(p),
    audience: p.audience,
    saleModes: p.saleModes,
    campaignId: p.campaignId,
    subtotal,
    eligibleSubtotal,
    discountAmount,
    total: subtotal - discountAmount,
    lines,
    allocationProposal: proposeDiscountAllocation(groups, discountAmount),
    allocationPolicy:
      "PROPOSAL_ELIGIBLE_SUBTOTAL_LARGEST_REMAINDER_V1" as const,
  };
}
