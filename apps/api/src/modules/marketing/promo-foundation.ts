import { randomUUID } from "node:crypto";
import { atomic, database, prisma, type Batch } from "@stenzo/database";
import { z } from "zod";
import { normalizePromoCode } from "@stenzo/shared";
import { VoyeyOwnerAuthority } from "../admin/owner.js";
import { HttpError } from "../auth/errors.js";
import { cartInclude } from "../cart/repository.js";
import { buildSplitCheckoutPlan } from "../checkout/split-plan.js";
import { promoUsage } from "./promo-codes.js";
import {
  parsePromoPolicy,
  evaluatePromoPolicy,
  type PromoPolicy,
} from "./promo-policy.js";

type PolicyRow = {
  promoCodeId: string;
  saleModes: PromoPolicy["saleModes"];
  audience: PromoPolicy["audience"];
  scope: PromoPolicy["scope"];
  purpose: PromoPolicy["purpose"];
  personalUserId: string | null;
  campaignId: string | null;
};
const campaignSchema = z
  .object({
    campaignKey: z
      .string()
      .trim()
      .toUpperCase()
      .min(3)
      .max(64)
      .regex(/^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/),
    name: z.string().trim().min(1).max(120),
  })
  .strict();

/** Internal opt-in only. Shares PromoCode identity, namespace and existing usage history.
 * Advanced codes are SQL-quarantined from BOTH old checkout writers until 2.5B. */
export class PromoFoundation {
  constructor(
    private readonly owner: VoyeyOwnerAuthority,
    private readonly enabled = false,
  ) {}
  private gate() {
    if (!this.enabled)
      throw new HttpError(503, "Promo foundation is internal and disabled");
  }
  private async run<T>(
    authorization: string | undefined,
    fn: (b: Batch, actor: string) => Promise<T>,
  ) {
    this.gate();
    const r = await atomic(async (b) => {
      const a = await this.owner.inspect(
        b,
        await this.owner.identify(authorization),
        "PROMO_CONFIGURE",
      );
      if (a.reason !== "AUTHORIZED") return { denied: a, value: null };
      return { denied: null, value: await fn(b, a.userId!) };
    });
    if (r.denied) this.owner.require(r.denied);
    return r.value!;
  }
  private audit(b: Batch, actor: string, action: string, entityId: string) {
    b.insert("AuditLog", {
      actorId: actor,
      action,
      entityType: "PromoPolicy",
      entityId,
      metadata: { engineVersion: 2 },
    });
  }
  async createCampaign(authorization: string | undefined, value: unknown) {
    const parsed = campaignSchema.safeParse(value);
    if (!parsed.success) throw new HttpError(400, "Invalid promo campaign");
    return this.run(authorization, async (b, actor) => {
      const { campaignKey, name } = parsed.data;
      if (
        await database()
          .prepare("SELECT id FROM PromoCampaign WHERE campaignKey=?")
          .bind(campaignKey)
          .first()
      )
        throw new HttpError(409, "Campaign already exists");
      const id = randomUUID();
      b.sql(
        "INSERT INTO PromoCampaign(id,campaignKey,name,createdBy,createdAt) VALUES(?,?,?,?,?)",
        id,
        campaignKey,
        name,
        actor,
        Date.now(),
      );
      this.audit(b, actor, "promo-policy.campaign-created", id);
      return { id, campaignKey, name };
    });
  }
  async create(authorization: string | undefined, value: unknown) {
    const p = parsePromoPolicy(value);
    return this.run(authorization, async (b, actor) => {
      if (
        await database()
          .prepare("SELECT id FROM PromoCode WHERE upper(trim(code))=?")
          .bind(p.code)
          .first()
      )
        throw new HttpError(409, "Promo code already exists");
      if (
        p.personalUserId &&
        !(await database()
          .prepare("SELECT id FROM User WHERE id=? AND status='ACTIVE'")
          .bind(p.personalUserId)
          .first())
      )
        throw new HttpError(409, "Personal account unavailable");
      if (
        p.campaignId &&
        !(await database()
          .prepare("SELECT id FROM PromoCampaign WHERE id=?")
          .bind(p.campaignId)
          .first())
      )
        throw new HttpError(409, "Campaign unavailable");
      await this.assertIds("Category", p.categoryIds);
      await this.assertIds("Product", [
        ...new Set([...p.productIds, ...p.exclusions.map((e) => e.productId)]),
      ]);
      const id = randomUUID(),
        now = Date.now();
      b.sql(
        "INSERT INTO PromoCode(id,code,type,value,minOrderAmount,maxDiscount,startsAt,endsAt,usageLimit,perUserLimit,isActive,engineVersion,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,2,?,?)",
        id,
        p.code,
        p.type,
        p.value,
        p.minOrderAmount,
        p.maxDiscount,
        p.startsAt,
        p.endsAt,
        p.usageLimit,
        p.perUserLimit,
        p.isActive,
        now,
        now,
      );
      b.sql(
        "INSERT INTO PromoCodePolicy(promoCodeId,saleModes,audience,purpose,personalUserId,campaignId,scope,createdBy,createdAt) VALUES(?,?,?,?,?,?,?,?,?)",
        id,
        p.saleModes,
        p.audience,
        p.purpose,
        p.personalUserId,
        p.campaignId,
        p.scope,
        actor,
        now,
      );
      for (const categoryId of p.categoryIds)
        b.sql(
          "INSERT INTO PromoPolicyCategory(promoCodeId,categoryId) VALUES(?,?)",
          id,
          categoryId,
        );
      for (const productId of p.productIds)
        b.sql(
          "INSERT INTO PromoPolicyProduct(promoCodeId,productId) VALUES(?,?)",
          id,
          productId,
        );
      for (const e of p.exclusions)
        b.sql(
          "INSERT INTO PromoPolicyExclusion(promoCodeId,productId,saleModes) VALUES(?,?,?)",
          id,
          e.productId,
          e.saleModes,
        );
      this.audit(b, actor, "promo-policy.created", id);
      b.sql("UPDATE PromoCodePolicy SET sealed=1 WHERE promoCodeId=?", id);
      return {
        id,
        code: p.code,
        engineVersion: 2 as const,
        executable: false as const,
      };
    });
  }
  private async assertIds(table: "Product" | "Category", ids: string[]) {
    for (let n = 0; n < ids.length; n += 90) {
      const chunk = ids.slice(n, n + 90);
      const found = await database()
        .prepare(
          `SELECT id FROM ${table} WHERE id IN (${chunk.map(() => "?").join(",")})`,
        )
        .bind(...chunk)
        .all();
      if (found.results.length !== chunk.length)
        throw new HttpError(
          409,
          "Promo selection references missing catalog IDs",
        );
    }
  }
  async setActive(
    authorization: string | undefined,
    id: string,
    isActive: boolean,
  ) {
    if (typeof isActive !== "boolean")
      throw new HttpError(400, "Invalid promo status");
    await this.run(authorization, async (b, actor) => {
      const p = await prisma.promoCode.findUnique({ where: { id } });
      if (
        !p ||
        p.engineVersion !== 2 ||
        !(await database()
          .prepare(
            "SELECT promoCodeId FROM PromoCodePolicy WHERE promoCodeId=? AND sealed=1",
          )
          .bind(id)
          .first())
      )
        throw new HttpError(404, "Promo policy not found");
      if (p.isActive !== isActive) {
        b.update("PromoCode", id, { isActive });
        this.audit(
          b,
          actor,
          isActive ? "promo-policy.activated" : "promo-policy.deactivated",
          id,
        );
      }
    });
  }
  async preview(
    authorization: string | undefined,
    value: string,
    selectedMode?: "IN_STOCK" | "PREORDER",
  ) {
    this.gate();
    if (
      selectedMode !== undefined &&
      !["IN_STOCK", "PREORDER"].includes(selectedMode)
    )
      throw new HttpError(400, "Invalid selected sale mode");
    const code = normalizePromoCode(value);
    if (!code) throw new HttpError(400, "Invalid promo code");
    return atomic(async () => {
      const userId = await this.owner.identify(authorization);
      if (
        !userId ||
        !(await database()
          .prepare("SELECT id FROM User WHERE id=? AND status='ACTIVE'")
          .bind(userId)
          .first())
      )
        throw new HttpError(403, "Personal authentication required");
      const p = await prisma.promoCode.findUnique({ where: { code } });
      if (!p || p.engineVersion !== 2)
        throw new HttpError(
          404,
          "Advanced promo not found; legacy codes use the existing engine",
        );
      const policy = await database()
        .prepare(
          "SELECT * FROM PromoCodePolicy WHERE promoCodeId=? AND sealed=1",
        )
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
      const now = Date.now(),
        cart = await prisma.cart.findUnique({
          where: { userId },
          include: cartInclude,
        });
      const lines = cart?.items.length
        ? buildSplitCheckoutPlan(
            cart,
            "voyey-promo-preview-v2",
            now,
            selectedMode,
          ).orders.flatMap((o) =>
            o.items.map((i) => ({
              lineId: i.cartItemId,
              productId: i.productId,
              categoryId: cart.items.find((row) => row.id === i.cartItemId)!
                .product.category.id!,
              saleMode: i.saleMode,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
            })),
          )
        : [];
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
      return evaluatePromoPolicy(config, {
        userId,
        now,
        usage: {
          global: await promoUsage(p.id),
          account: await promoUsage(p.id, userId),
        },
        lines,
      });
    });
  }
}
