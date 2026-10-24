import { atomic, prisma, database } from "@stenzo/database";
import {
  cartSnapshotVersion,
  type PromoCartQuote,
  normalizePromoCode,
  promoDiscount,
  type AdminPromoCode,
  type PromoQuote,
  type PromoFailure,
} from "@stenzo/shared";
import { z } from "zod";
import { HttpError } from "../auth/errors.js";
import { marketingAudit } from "./banners.js";
import { cartInclude } from "../cart/repository.js";
import { toCartDto } from "../cart/service.js";

const positive = z.number().int().positive().max(2147483647);
const date = z.iso
  .datetime()
  .transform((v) => new Date(v))
  .nullable()
  .default(null);
export const promoSettingsSchema = z
  .object({
    code: z
      .string()
      .max(64)
      .transform((v) => normalizePromoCode(v))
      .refine((v) => v !== null),
    type: z.enum(["PERCENT", "FIXED"]),
    value: positive,
    minOrderAmount: positive.nullable().default(null),
    maxDiscount: positive.nullable().default(null),
    startsAt: date,
    endsAt: date,
    usageLimit: positive.nullable().default(null),
    perUserLimit: positive.default(1),
    isActive: z.boolean().default(false),
  })
  .strict()
  .refine((p) => !(p.startsAt && p.endsAt) || p.startsAt < p.endsAt)
  .refine((p) => p.type !== "FIXED" || p.maxDiscount == null);
// Legacy API contract remains 1..90; the internal v2 policy has its own limit.
export const promoSchema = promoSettingsSchema.refine(
  (p) => p.type !== "PERCENT" || p.value <= 90,
);
export function parsePromo(value: unknown) {
  const result = promoSchema.safeParse(value);
  if (!result.success) throw new HttpError(400, "promoInvalidSettings");
  return { ...result.data, code: result.data.code! };
}
export async function promoUsage(promoCodeId: string, userId?: string) {
  const legacy = await prisma.promoCodeRedemption.count({
    where: { promoCodeId, releasedAt: null, ...(userId ? { userId } : {}) },
  });
  const linked = await database()
    .prepare(
      "SELECT COUNT(*) n FROM CheckoutPromoUse WHERE promoCodeId=? AND releasedAt IS NULL" +
        (userId ? " AND userId=?" : ""),
    )
    .bind(promoCodeId, ...(userId ? [userId] : []))
    .first<{ n: number }>();
  return legacy + linked!.n;
}

type PromoRecord = Awaited<
  ReturnType<typeof prisma.promoCode.findUniqueOrThrow>
>;
async function dto(p: PromoRecord): Promise<AdminPromoCode> {
  return {
    id: p.id,
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
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    usageCount: await promoUsage(p.id),
  };
}
export class PromoCodeService {
  async list() {
    const records = await prisma.promoCode.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    return Promise.all(
      records.filter((p) => (p.engineVersion ?? 1) === 1).map(dto),
    );
  }
  private async get(id: string) {
    const row = await prisma.promoCode.findUnique({ where: { id } });
    if (!row || (row.engineVersion ?? 1) !== 1)
      throw new HttpError(404, "notFound");
    return row;
  }
  async save(actor: string, input: unknown, id?: string) {
    const data = parsePromo(input);
    const savedId = await atomic(async (b) => {
      const old = id ? await this.get(id) : null;
      const duplicate = await prisma.promoCode.findUnique({
        where: { code: data.code },
      });
      if (duplicate && duplicate.id !== id)
        throw new HttpError(409, "promoDuplicate");
      if (old) {
        const changed = Object.keys(data).some(
          (k) =>
            String(old[k as keyof typeof data] ?? "") !==
            String(data[k as keyof typeof data] ?? ""),
        );
        if (changed) {
          b.update("PromoCode", old.id, data);
          if (
            Object.keys(data).some(
              (k) =>
                k !== "isActive" &&
                String(old[k as keyof typeof data] ?? "") !==
                  String(data[k as keyof typeof data] ?? ""),
            )
          )
            marketingAudit(b, actor, "promo_code.update", "PromoCode", old.id);
          if (old.isActive !== data.isActive)
            marketingAudit(
              b,
              actor,
              data.isActive ? "promo_code.activate" : "promo_code.deactivate",
              "PromoCode",
              old.id,
            );
        }
        return old.id;
      }
      const created = b.insert("PromoCode", data);
      marketingAudit(b, actor, "promo_code.create", "PromoCode", created);
      return created;
    });
    return dto(await this.get(savedId));
  }
  async setActive(actor: string, id: string, isActive: boolean) {
    await atomic(async (b) => {
      const row = await this.get(id);
      if (row.isActive === isActive) return;
      b.update("PromoCode", id, { isActive });
      marketingAudit(
        b,
        actor,
        isActive ? "promo_code.activate" : "promo_code.deactivate",
        "PromoCode",
        id,
      );
    });
    return dto(await this.get(id));
  }
  async validateCart(userId: string, value: string): Promise<PromoCartQuote> {
    // Read only: do not create an empty Cart, reserve a code or write a redemption.
    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: cartInclude,
    });
    if (!cart?.items.length)
      return { valid: false, reason: "PROMO_EMPTY_CART", cartVersion: null };
    const now = Date.now();
    const snapshot = toCartDto(cart, now);
    const result = await promoForCheckout(
      userId,
      value,
      snapshot.subtotal,
      now,
    );
    return { ...result.quote, cartVersion: cartSnapshotVersion(snapshot) };
  }
}

/** Called INSIDE the same revision-guarded D1 transaction as order creation. */
export async function promoForCheckout(
  userId: string,
  value: string,
  subtotal: number,
  now = Date.now(),
): Promise<{ quote: PromoQuote; promoCodeId?: string }> {
  const fail = (reason: PromoFailure) => ({
    quote: { valid: false, reason } as PromoQuote,
  });
  const code = normalizePromoCode(value);
  if (!code) return fail("PROMO_INVALID");
  const promo = await prisma.promoCode.findUnique({ where: { code } });
  if (!promo || (promo.engineVersion ?? 1) !== 1) return fail("PROMO_INVALID");
  if (!promo.isActive) return fail("PROMO_INACTIVE");
  if (promo.startsAt && now < promo.startsAt.getTime())
    return fail("PROMO_NOT_STARTED");
  if (promo.endsAt && now >= promo.endsAt.getTime())
    return fail("PROMO_EXPIRED");
  if (promo.minOrderAmount != null && subtotal < promo.minOrderAmount)
    return fail("PROMO_MINIMUM");
  if (
    promo.usageLimit != null &&
    (await promoUsage(promo.id)) >= promo.usageLimit
  )
    return fail("PROMO_LIMIT");
  if ((await promoUsage(promo.id, userId)) >= promo.perUserLimit)
    return fail("PROMO_USER_LIMIT");
  const discountAmount = promoDiscount(promo, subtotal);
  if (discountAmount == null) return fail("PROMO_AMOUNT");
  return {
    quote: {
      valid: true,
      code,
      subtotal,
      discountAmount,
      total: subtotal - discountAmount,
    },
    promoCodeId: promo.id,
  };
}

export class PromoUnavailableError extends HttpError {
  constructor(public readonly reason: PromoFailure) {
    super(409, reason);
  }
}
