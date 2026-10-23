import { adminPrincipalHash } from "./principal.js";
import {
  categoryDefinitions,
  categoryAttributeValues,
  assertCategoryAttributesCompatible,
} from "../modules/admin/catalog/attributes.js";
import type { CheckoutLine } from "../modules/checkout/domain.js";
import type { PreparedOrder } from "../modules/orders/types.js";
import { atomic, Batch, prisma } from "@stenzo/database";
import {
  promoForCheckout,
  PromoUnavailableError,
} from "../modules/marketing/promo-codes.js";
import { validPromotion } from "@stenzo/shared";
import type { UserLocale } from "@stenzo/shared";
import { HttpError } from "../modules/auth/errors.js";
import { PrismaUserRepository } from "../modules/users/repository.js";
import type { VerifiedTelegramUser } from "../modules/users/types.js";
import {
  PrismaCartRepository,
  cartInclude,
} from "../modules/cart/repository.js";
import type {
  AddCartItemInput,
  PatchCartItemInput,
} from "../modules/cart/types.js";
import {
  assertCartSelection,
  assertLegacyCheckout,
} from "../modules/cart/domain.js";
import {
  CartItemNotFoundError,
  CartStockExceededError,
} from "../modules/cart/errors.js";
import {
  PrismaOrderRepository,
  orderInclude,
  type CheckoutWriteInput,
} from "../modules/orders/repository.js";
import { CheckoutEmptyCartError } from "../modules/checkout/errors.js";
import { OrderNotFoundError } from "../modules/orders/errors.js";
import { PrismaPaymentRepository } from "../modules/payments/repository.js";
import type { SubmitPaymentInput } from "../modules/payments/types.js";
import type { OrderStatusValue } from "../modules/orders/types.js";
import {
  submissionPhase,
  assertAdminStatusTransition,
} from "../modules/orders/status-policy.js";
import {
  FinalPaymentAmountTooLargeError,
  FinalPaymentRequestNotAllowedError,
  PaymentAmountMismatchError,
  PaymentNotFoundError,
  PaymentReviewNotAllowedError,
  PaymentSubmissionNotAllowedError,
} from "../modules/payments/errors.js";
import { adminAuditActor } from "../modules/admin/audit-actor.js";
import { PrismaAdminCatalogRepository } from "../modules/admin/catalog/repository.js";
import type {
  CategoryCreateInput,
  CategoryPatchInput,
  ProductCreateInput,
  ProductPatchInput,
  ProductStatusValue,
  ProductImageCreateInput,
  ProductImagePatchInput,
  ProductVariantCreateInput,
  ProductVariantPatchInput,
} from "../modules/admin/catalog/types.js";
import {
  AdminCatalogCategoryNotFoundError,
  AdminCatalogDuplicateSkuError,
  AdminCatalogDuplicateSlugError,
  AdminCatalogImageNotFoundError,
  AdminCatalogProductNotFoundError,
  AdminCatalogVariantNotFoundError,
  AdminCatalogPrimaryImageConflictError,
} from "../modules/admin/catalog/errors.js";

function audit(
  batch: Batch,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  const actor = adminAuditActor(actorId);
  batch.insert("AuditLog", {
    actorId: actor.actorId,
    action,
    entityType,
    entityId,
    metadata: { ...metadata, ...actor.metadata },
  });
}
function unique(error: unknown): boolean {
  return (
    error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
  );
}
export class D1UserRepository extends PrismaUserRepository {
  override async setPreferredLocale(id: string, locale: UserLocale) {
    await atomic(async (batch) => {
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user || user.status !== "ACTIVE")
        throw new HttpError(403, "User account is unavailable");
      batch.update("User", id, { preferredLocale: locale });
    });
    return prisma.user.findUniqueOrThrow({ where: { id } });
  }

  override async createOrUpdateFromTelegram(profile: VerifiedTelegramUser) {
    const id = await atomic(async (batch) => {
      const current = await prisma.user.findUnique({
        where: { telegramId: profile.telegramId },
      });
      const data = {
        username: profile.username ?? null,
        firstName: profile.firstName ?? null,
        lastName: profile.lastName ?? null,
        languageCode: profile.languageCode ?? null,
      };
      if (current) {
        batch.update("User", current.id, data);
        return current.id;
      }
      return batch.insert("User", { ...data, telegramId: profile.telegramId });
    });
    return prisma.user.findUniqueOrThrow({ where: { id } });
  }
}
const getCart = (userId: string) =>
  prisma.cart.findUniqueOrThrow({ where: { userId }, include: cartInclude });
export class D1CartRepository extends PrismaCartRepository {
  override async getOrCreate(userId: string) {
    await atomic(async (batch) => {
      if (!(await prisma.cart.findUnique({ where: { userId } })))
        batch.insert("Cart", { userId });
    });
    return getCart(userId);
  }
  override async addItem(userId: string, input: AddCartItemInput) {
    await atomic(async (batch) => {
      const cart = await prisma.cart.findUnique({ where: { userId } });
      const cartId = cart?.id ?? batch.insert("Cart", { userId });
      const product = await prisma.product.findUnique({
        where: { id: input.productId },
        include: { category: true, images: true },
      });
      const variant = await prisma.productVariant.findUnique({
        where: { id: input.variantId },
      });
      const existing = cart
        ? await prisma.cartItem.findUnique({
            where: {
              cartId_variantId_saleMode: {
                cartId,
                variantId: input.variantId,
                saleMode: input.saleMode ?? "LEGACY",
              },
            },
          })
        : null;
      const quantity = (existing?.quantity ?? 0) + input.quantity;
      const siblings = cart
        ? await prisma.cartItem.findMany({
            where: {
              cartId,
              variantId: input.variantId,
              ...(existing ? { id: { not: existing.id } } : {}),
            },
          })
        : [];
      assertCartSelection(
        product,
        variant,
        input.productId,
        input.saleMode,
        quantity,
        siblings,
      );
      if (existing)
        batch.update("CartItem", existing.id, {
          quantity,
          heightCm: input.heightCm,
          weightKg: input.weightKg,
        });
      else
        batch.insert("CartItem", {
          cartId,
          ...input,
          saleMode: input.saleMode ?? "LEGACY",
        });
    });
    return getCart(userId);
  }
  override async updateItem(
    userId: string,
    itemId: string,
    input: PatchCartItemInput,
  ) {
    await atomic(async (batch) => {
      const item = await prisma.cartItem.findFirst({
        where: { id: itemId, cart: { userId } },
      });
      if (!item) throw new CartItemNotFoundError();
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
        include: { category: true, images: true },
      });
      const variant = await prisma.productVariant.findUnique({
        where: { id: item.variantId },
      });
      const siblings = await prisma.cartItem.findMany({
        where: {
          cartId: item.cartId,
          variantId: item.variantId,
          id: { not: item.id },
        },
      });
      assertCartSelection(
        product,
        variant,
        item.productId,
        item.saleMode,
        input.quantity ?? item.quantity,
        siblings,
      );
      batch.update("CartItem", item.id, { ...input });
    });
    return getCart(userId);
  }
  override async deleteItem(userId: string, itemId: string) {
    await atomic(async (batch) => {
      const item = await prisma.cartItem.findFirst({
        where: { id: itemId, cart: { userId } },
      });
      if (!item) throw new CartItemNotFoundError();
      batch.delete("CartItem", "id", item.id);
    });
    return getCart(userId);
  }
  override async clear(userId: string) {
    await atomic(async (batch) => {
      const cart = await prisma.cart.findUnique({ where: { userId } });
      if (cart) batch.delete("CartItem", "cartId", cart.id);
      else batch.insert("Cart", { userId });
    });
    return getCart(userId);
  }
}
export async function priceD1Order(
  userId: string,
  promoCode: string | undefined,
  prepared: PreparedOrder,
  now = Date.now(),
) {
  const { items, ...amounts } = prepared;
  let promoCodeId: string | undefined;
  let discountAmount = 0,
    promoCodeSnapshot: string | null = null;
  if (promoCode !== undefined) {
    const result = await promoForCheckout(
      userId,
      promoCode,
      amounts.subtotal,
      now,
    );
    if (!result.quote.valid)
      throw new PromoUnavailableError(result.quote.reason);
    promoCodeId = result.promoCodeId;
    discountAmount = result.quote.discountAmount;
    promoCodeSnapshot = result.quote.code;
    amounts.total = result.quote.total;
    amounts.requiredPrepayment =
      Math.floor(amounts.total / 2) + (amounts.total % 2);
    amounts.remainingAmount = amounts.total - amounts.requiredPrepayment;
  }
  return { items, amounts, promoCodeId, discountAmount, promoCodeSnapshot };
}
export async function writeD1Order(
  batch: Batch,
  input: Omit<CheckoutWriteInput, "prepare">,
  lines: CheckoutLine[],
  priced: Awaited<ReturnType<typeof priceD1Order>>,
  source: "MINIAPP" | "ADMIN",
  actorId: string,
) {
  assertLegacyCheckout(lines);
  const { items, amounts, promoCodeId, discountAmount, promoCodeSnapshot } =
    priced;
  if (new Set(lines.map((l) => l.variantId)).size !== lines.length)
    throw new HttpError(400, "manualDuplicateVariant");
  for (const { variant, quantity } of lines) {
    if (variant.stock === null) continue;
    if (variant.stock < quantity)
      throw new CartStockExceededError(variant.stock);
    batch.update("ProductVariant", variant.id, {
      stock: variant.stock - quantity,
    });
  }
  const id = batch.insert("Order", {
    publicId: input.publicId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    ...input.recipient,
    source,
    status: "AWAITING_PREPAYMENT",
    currency: "UZS",
    ...amounts,
    // Preserve the legacy subtotal=total constraint without rebuilding Order.
    subtotal: amounts.total,
    itemsSubtotal: amounts.subtotal,
    discountAmount,
    promoCodeSnapshot,
  });
  for (const item of items) {
    const line = lines.find((l) => l.variantId === item.variantId);
    if (!line) throw new Error("Order inventory snapshot missing");
    batch.insert("OrderItem", {
      ...item,
      orderId: id,
      // Copy the private catalog default inside the same guarded order transaction.
      // Later product edits must never rewrite historical order costs.
      procurementUnitCost: line.product.costPrice ?? null,
      procurementUpdatedAt: line.product.costPrice != null ? new Date() : null,
      procurementUpdatedBy:
        line.product.costPrice != null ? "catalog-default" : null,
      inventoryReservedQuantity:
        line.variant.stock === null ? 0 : item.quantity,
    });
  }
  if (promoCodeId) {
    const redemption = batch.insert("PromoCodeRedemption", {
      promoCodeId,
      userId: input.userId,
      orderId: id,
      discountAmount,
    });
    audit(
      batch,
      actorId,
      "promo_code.redeemed",
      "PromoCodeRedemption",
      redemption,
      { orderId: id, discountAmount },
    );
  }
  audit(batch, actorId, "order.create", "Order", id, {
    source,
    userId: input.userId,
    discountAmount,
    ...(source === "ADMIN"
      ? {
          adminPrincipal:
            adminPrincipalHash() ??
            adminAuditActor(actorId).metadata.adminPrincipal ??
            actorId,
        }
      : {}),
    publicId: input.publicId,
    itemCount: items.length,
    total: amounts.total,
    requiredPrepayment: amounts.requiredPrepayment,
  });
  return id;
}

function orderSnapshot<
  T extends { subtotal: number; itemsSubtotal?: number | null },
>(row: T): T {
  return { ...row, subtotal: row.itemsSubtotal ?? row.subtotal };
}
export class D1OrderRepository extends PrismaOrderRepository {
  override async getForUser(userId: string, publicId: string) {
    const row = await super.getForUser(userId, publicId);
    return row ? orderSnapshot(row) : null;
  }
  override async getForAdmin(publicId: string) {
    const row = await super.getForAdmin(publicId);
    return row ? orderSnapshot(row) : null;
  }
  override async listForUser(
    userId: string,
    query: import("../modules/orders/types.js").OrderListQuery,
  ) {
    const page = await super.listForUser(userId, query);
    return { ...page, orders: page.orders.map(orderSnapshot) };
  }
  override async listForAdmin(
    query: import("../modules/orders/types.js").AdminOrderListQuery,
  ) {
    const page = await super.listForAdmin(query);
    return { ...page, orders: page.orders.map(orderSnapshot) };
  }
  override async checkout(input: CheckoutWriteInput) {
    const result = await atomic(async (batch) => {
      const existing = await prisma.order.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: input.userId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) {
        if (existing.source !== "MINIAPP")
          throw new HttpError(
            409,
            "Idempotency key belongs to another order source",
          );
        return { id: existing.id, created: false };
      }
      const cart = await prisma.cart.findUnique({
        where: { userId: input.userId },
        include: cartInclude,
      });
      if (!cart?.items.length) throw new CheckoutEmptyCartError();
      const now = Date.now();
      const prepared = input.prepare(cart, now);
      const priced = await priceD1Order(
        input.userId,
        input.promoCode,
        prepared,
        now,
      );
      const id = await writeD1Order(
        batch,
        input,
        cart.items,
        priced,
        "MINIAPP",
        input.userId,
      );
      batch.delete("CartItem", "cartId", cart.id);
      return { id, created: true };
    });
    return {
      order: orderSnapshot(
        await prisma.order.findUniqueOrThrow({
          where: { id: result.id },
          include: orderInclude,
        }),
      ),
      created: result.created,
    };
  }
}
export class D1PaymentRepository extends PrismaPaymentRepository {
  override async submit(input: SubmitPaymentInput) {
    const result = await atomic(async (batch) => {
      const existing = await this.findOwnerSubmission(
        input.userId,
        input.orderPublicId,
        input.idempotencyKey,
      );
      if (existing) return { id: existing.id, created: false };
      const order = await this.getOrderForUser(
        input.userId,
        input.orderPublicId,
      );
      if (!order) throw new OrderNotFoundError();
      const type = submissionPhase(order.status);
      if (!type) throw new PaymentSubmissionNotAllowedError();
      const expectedAmount =
        type === "PREPAYMENT"
          ? order.requiredPrepayment
          : order.remainingAmount + (order.cargoAmount ?? 0);
      const id = batch.insert("Payment", {
        orderId: order.id,
        type,
        expectedAmount,
        idempotencyKey: input.idempotencyKey,
        proofStorageKey: input.proofStorageKey,
        proofMimeType: input.proofMimeType,
      });
      const status =
        type === "PREPAYMENT"
          ? "PREPAYMENT_SUBMITTED"
          : "FINAL_PAYMENT_SUBMITTED";
      batch.update("Order", order.id, { status });
      audit(batch, input.userId, "payment.submitted", "Payment", id, {
        orderPublicId: order.publicId,
        type,
        expectedAmount,
      });
      audit(batch, input.userId, "order.status_changed", "Order", order.id, {
        publicId: order.publicId,
        from: order.status,
        to: status,
      });
      return { id, created: true };
    });
    return {
      payment: await prisma.payment.findUniqueOrThrow({
        where: { id: result.id },
      }),
      created: result.created,
    };
  }
  override approve(id: string, actor: string) {
    return this.reviewD1(id, actor, "APPROVED", null);
  }
  override reject(id: string, actor: string, reason: string | null) {
    return this.reviewD1(id, actor, "REJECTED", reason);
  }
  private async reviewD1(
    id: string,
    actor: string,
    decision: "APPROVED" | "REJECTED",
    reason: string | null,
  ) {
    const changed = await atomic(async (batch) => {
      const payment = await this.getForAdmin(id);
      if (!payment) throw new PaymentNotFoundError();
      if (payment.status === decision) return false;
      if (payment.status !== "SUBMITTED")
        throw new PaymentReviewNotAllowedError();
      const order = payment.order;
      const status =
        payment.type === "PREPAYMENT"
          ? "PREPAYMENT_SUBMITTED"
          : "FINAL_PAYMENT_SUBMITTED";
      if (order.status !== status) throw new PaymentReviewNotAllowedError();
      const amount =
        payment.type === "PREPAYMENT"
          ? order.requiredPrepayment
          : order.remainingAmount + (order.cargoAmount ?? 0);
      if (payment.expectedAmount !== amount)
        throw new PaymentAmountMismatchError();
      batch.update("Payment", id, {
        status: decision,
        rejectionReason: decision === "REJECTED" ? reason : null,
        reviewedByUserId: adminAuditActor(actor).actorId,
        reviewedAt: new Date(),
      });
      const data =
        decision === "REJECTED"
          ? {
              status:
                payment.type === "PREPAYMENT"
                  ? "AWAITING_PREPAYMENT"
                  : "AWAITING_FINAL_PAYMENT",
            }
          : payment.type === "PREPAYMENT"
            ? {
                status: "AWAITING_PURCHASE",
                paidAmount: order.requiredPrepayment,
                remainingAmount: order.total - order.requiredPrepayment,
              }
            : {
                status: "PAID_FULL",
                paidAmount: order.total,
                remainingAmount: 0,
                cargoPaidAmount: order.cargoAmount ?? 0,
              };
      batch.update("Order", order.id, data);
      audit(
        batch,
        actor,
        decision === "APPROVED" ? "payment.approved" : "payment.rejected",
        "Payment",
        id,
        {
          orderPublicId: order.publicId,
          type: payment.type,
          expectedAmount: payment.expectedAmount,
          ...(decision === "REJECTED" ? { reason } : {}),
        },
      );
      audit(batch, actor, "order.status_changed", "Order", order.id, {
        publicId: order.publicId,
        from: status,
        to: data.status,
      });
      return true;
    });
    const payment = await this.getForAdmin(id);
    if (!payment) throw new PaymentNotFoundError();
    return { payment, changed };
  }
  override async transitionOrder(
    publicId: string,
    targetStatus: OrderStatusValue,
    actor: string,
  ) {
    const changed = await atomic(async (batch) => {
      const order = await prisma.order.findUnique({
        where: { publicId },
        include: orderInclude,
      });
      if (!order) throw new OrderNotFoundError();
      if (order.status === targetStatus) return false;
      assertAdminStatusTransition(order.status, targetStatus);
      batch.update("Order", order.id, {
        status: targetStatus,
        ...(targetStatus === "COMPLETED" ? { completedAt: new Date() } : {}),
      });
      audit(batch, actor, "order.status_changed", "Order", order.id, {
        publicId,
        from: order.status,
        to: targetStatus,
      });
      if (targetStatus === "COMPLETED")
        audit(batch, actor, "order.completed", "Order", order.id, { publicId });
      return true;
    });
    return {
      order: await prisma.order.findUniqueOrThrow({
        where: { publicId },
        include: orderInclude,
      }),
      changed,
    };
  }
  override async requestFinalPayment(
    publicId: string,
    cargoAmount: number,
    actor: string,
  ) {
    const changed = await atomic(async (batch) => {
      const order = await prisma.order.findUnique({
        where: { publicId },
        include: orderInclude,
      });
      if (!order) throw new OrderNotFoundError();
      if (
        order.status === "AWAITING_FINAL_PAYMENT" &&
        order.cargoAmount === cargoAmount
      )
        return false;
      if (order.status !== "WEIGHING")
        throw new FinalPaymentRequestNotAllowedError();
      if (order.remainingAmount + cargoAmount > 2147483647)
        throw new FinalPaymentAmountTooLargeError();
      batch.update("Order", order.id, {
        cargoAmount,
        status: "AWAITING_FINAL_PAYMENT",
      });
      audit(batch, actor, "order.cargo_assigned", "Order", order.id, {
        publicId,
        cargoAmount,
      });
      audit(batch, actor, "order.final_payment_requested", "Order", order.id, {
        publicId,
        amount: order.remainingAmount + cargoAmount,
      });
      return true;
    });
    return {
      order: await prisma.order.findUniqueOrThrow({
        where: { publicId },
        include: orderInclude,
      }),
      changed,
    };
  }
}
export class D1AdminCatalogRepository extends PrismaAdminCatalogRepository {
  private async mutate<T>(
    operation: (batch: Batch) => Promise<T>,
    kind: "slug" | "sku" | "image" = "slug",
  ): Promise<T> {
    try {
      return await atomic(operation);
    } catch (error) {
      if (unique(error)) {
        if (kind === "sku") throw new AdminCatalogDuplicateSkuError();
        if (kind === "image") throw new AdminCatalogPrimaryImageConflictError();
        throw new AdminCatalogDuplicateSlugError();
      }
      throw error;
    }
  }
  override async createCategory(actor: string, input: CategoryCreateInput) {
    const id = await this.mutate(async (b) => {
      const definitions = categoryDefinitions(input.attributeDefinitions);
      const id = b.insert("Category", {
        ...input,
        attributeDefinitions: definitions,
      });
      audit(b, actor, "category.create", "Category", id, {
        slug: input.slug,
        requiresBuyerMeasurements: input.requiresBuyerMeasurements ?? true,
      });
      return id;
    });
    return prisma.category.findUniqueOrThrow({ where: { id } });
  }
  override async updateCategory(
    actor: string,
    id: string,
    input: CategoryPatchInput,
  ) {
    await this.mutate(async (b) => {
      const current = await prisma.category.findUnique({ where: { id } });
      if (!current) throw new AdminCatalogCategoryNotFoundError();
      const definitions =
        input.attributeDefinitions === undefined
          ? undefined
          : categoryDefinitions(input.attributeDefinitions);
      if (definitions !== undefined)
        await assertCategoryAttributesCompatible(
          id,
          current.attributeDefinitions,
          definitions,
        );
      b.update("Category", id, {
        ...input,
        ...(definitions === undefined
          ? {}
          : { attributeDefinitions: definitions }),
      });
      audit(b, actor, "category.update", "Category", id, {
        slug: input.slug ?? current.slug,
        ...(input.requiresBuyerMeasurements === undefined
          ? {}
          : { requiresBuyerMeasurements: input.requiresBuyerMeasurements }),
        ...(definitions === undefined
          ? {}
          : { attributeKeys: definitions.map((d) => d.key) }),
      });
    });
    return prisma.category.findUniqueOrThrow({ where: { id } });
  }
  override async setCategoryActive(
    actor: string,
    id: string,
    isActive: boolean,
  ) {
    await this.mutate(async (b) => {
      const current = await prisma.category.findUnique({ where: { id } });
      if (!current) throw new AdminCatalogCategoryNotFoundError();
      if (current.archivedAt && isActive)
        throw new HttpError(409, "archiveCategoryFirst");
      b.update("Category", id, { isActive });
      audit(
        b,
        actor,
        isActive ? "category.activate" : "category.deactivate",
        "Category",
        id,
        { isActive },
      );
    });
    return prisma.category.findUniqueOrThrow({ where: { id } });
  }
  override async createProduct(actor: string, input: ProductCreateInput) {
    const id = await this.mutate(async (b) => {
      const category = await prisma.category.findUnique({
        where: { id: input.categoryId },
      });
      if (!category) throw new AdminCatalogCategoryNotFoundError();
      if (category.archivedAt) throw new HttpError(409, "archiveCategoryFirst");
      if (!validPromotion(input))
        throw new HttpError(400, "Invalid product promotion");
      const attributes = categoryAttributeValues(
        category.attributeDefinitions,
        input.attributes,
        "PRODUCT",
      );
      const id = b.insert("Product", { ...input, attributes });
      if (input.salePrice != null)
        audit(b, actor, "product.promotion.update", "Product", id, {});
      audit(b, actor, "product.create", "Product", id, {
        slug: input.slug,
        categoryId: input.categoryId,
        ...(Object.keys(attributes).length
          ? { attributeKeys: Object.keys(attributes) }
          : {}),
      });
      return id;
    });
    return this.productOrThrow(id);
  }
  override async updateProduct(
    actor: string,
    id: string,
    input: ProductPatchInput,
  ) {
    await this.mutate(async (b) => {
      const current = await this.productOrThrow(id);
      if (current.archivedAt) throw new HttpError(409, "archiveProductLocked");
      if (
        input.categoryId &&
        !(await prisma.category.findUnique({ where: { id: input.categoryId } }))
      )
        throw new AdminCatalogCategoryNotFoundError();
      const next = { ...current, ...input };
      const category = await prisma.category.findUnique({
        where: { id: next.categoryId },
      });
      if (category?.archivedAt)
        throw new HttpError(409, "archiveCategoryFirst");
      const attributes = categoryAttributeValues(
        category?.attributeDefinitions,
        input.attributes === undefined ? current.attributes : input.attributes,
        "PRODUCT",
      );
      if (next.categoryId !== current.categoryId) {
        const used = new Set([
          ...Object.keys(attributes),
          ...current.variants.flatMap((v) => Object.keys(v.attributes ?? {})),
        ]);
        const oldDefinitions = categoryDefinitions(
          current.category.attributeDefinitions,
        );
        const newDefinitions = categoryDefinitions(
          category?.attributeDefinitions,
        );
        if (
          oldDefinitions.some(
            (d) =>
              used.has(d.key) &&
              newDefinitions.find((n) => n.key === d.key)?.unit !== d.unit,
          )
        )
          throw new HttpError(400, "Incompatible catalog attribute units");
        for (const variant of current.variants)
          categoryAttributeValues(
            category?.attributeDefinitions,
            variant.attributes,
            "VARIANT",
          );
      }
      if (!validPromotion(next))
        throw new HttpError(400, "Invalid product promotion");
      const saleKeys = ["salePrice", "saleStartsAt", "saleEndsAt"] as const;
      const changed = saleKeys.some(
        (key) => String(current[key] ?? "") !== String(next[key] ?? ""),
      );
      const regularChanged = Object.keys(input).some(
        (key) =>
          !saleKeys.includes(key as (typeof saleKeys)[number]) &&
          (key === "attributes"
            ? JSON.stringify(current.attributes ?? {}) !==
              JSON.stringify(attributes)
            : String(current[key as keyof ProductPatchInput] ?? "") !==
              String(input[key as keyof ProductPatchInput] ?? "")),
      );
      if (changed || regularChanged)
        b.update("Product", id, {
          ...input,
          ...(input.attributes === undefined ? {} : { attributes }),
        });
      if (changed)
        audit(
          b,
          actor,
          next.salePrice == null
            ? "product.promotion.clear"
            : "product.promotion.update",
          "Product",
          id,
          { salePrice: next.salePrice ?? null },
        );
      if (regularChanged)
        audit(b, actor, "product.update", "Product", id, {
          slug: input.slug ?? current.slug,
          categoryId: input.categoryId ?? current.categoryId,
          ...(input.attributes === undefined
            ? {}
            : { attributeKeys: Object.keys(attributes) }),
        });
    });
    return this.productOrThrow(id);
  }
  override async setProductStatus(
    actor: string,
    id: string,
    status: ProductStatusValue,
  ) {
    await this.mutate(async (b) => {
      const product = await this.productOrThrow(id);
      if (product.archivedAt) throw new HttpError(409, "archiveProductLocked");
      if (status === "ACTIVE" && product.category.archivedAt)
        throw new HttpError(409, "archiveCategoryFirst");
      b.update("Product", id, { status });
      audit(
        b,
        actor,
        status === "ACTIVE" ? "product.activate" : "product.deactivate",
        "Product",
        id,
        { status },
      );
    });
    return this.productOrThrow(id);
  }
  private async productOrThrow(id: string) {
    const product = await this.getProduct(id);
    if (!product) throw new AdminCatalogProductNotFoundError();
    return product;
  }
  override async createVariant(
    actor: string,
    productId: string,
    input: ProductVariantCreateInput,
  ) {
    const id = await this.mutate(async (b) => {
      const product = await this.productOrThrow(productId);
      const attributes = categoryAttributeValues(
        product.category.attributeDefinitions,
        input.attributes,
        "VARIANT",
      );
      const id = b.insert("ProductVariant", {
        ...input,
        size: input.size ?? "",
        attributes,
        productId,
        preorderEnabled: input.preorderEnabled ?? false,
      });
      audit(b, actor, "product-variant.create", "ProductVariant", id, {
        productId,
        sku: input.sku,
        preorderEnabled: input.preorderEnabled ?? false,
        ...(Object.keys(attributes).length
          ? { attributeKeys: Object.keys(attributes) }
          : {}),
      });
      return id;
    }, "sku");
    return prisma.productVariant.findUniqueOrThrow({ where: { id } });
  }
  override async updateVariant(
    actor: string,
    id: string,
    input: ProductVariantPatchInput,
  ) {
    await this.mutate(async (b) => {
      const current = await prisma.productVariant.findUnique({ where: { id } });
      if (!current) throw new AdminCatalogVariantNotFoundError();
      const attributes =
        input.attributes === undefined
          ? undefined
          : categoryAttributeValues(
              (await this.productOrThrow(current.productId)).category
                .attributeDefinitions,
              input.attributes,
              "VARIANT",
            );
      b.update("ProductVariant", id, {
        ...input,
        ...(attributes === undefined ? {} : { attributes }),
      });
      audit(b, actor, "product-variant.update", "ProductVariant", id, {
        productId: current.productId,
        sku: input.sku ?? current.sku,
        ...(input.preorderEnabled === undefined
          ? {}
          : { preorderEnabled: input.preorderEnabled }),
        ...(attributes === undefined
          ? {}
          : { attributeKeys: Object.keys(attributes) }),
      });
    }, "sku");
    return prisma.productVariant.findUniqueOrThrow({ where: { id } });
  }
  override async setVariantActive(
    actor: string,
    id: string,
    isActive: boolean,
  ) {
    await this.mutate(async (b) => {
      const current = await prisma.productVariant.findUnique({ where: { id } });
      if (!current) throw new AdminCatalogVariantNotFoundError();
      b.update("ProductVariant", id, { isActive });
      audit(
        b,
        actor,
        isActive ? "product-variant.activate" : "product-variant.deactivate",
        "ProductVariant",
        id,
        { productId: current.productId, isActive },
      );
    }, "sku");
    return prisma.productVariant.findUniqueOrThrow({ where: { id } });
  }
  override async createImage(
    actor: string,
    productId: string,
    input: ProductImageCreateInput,
  ) {
    const id = await this.mutate(async (b) => {
      await this.productOrThrow(productId);
      const primary = await prisma.productImage.findFirst({
        where: { productId, isPrimary: true },
      });
      const isPrimary = input.isPrimary || !primary;
      if (isPrimary)
        b.sql(
          'UPDATE "ProductImage" SET isPrimary=0 WHERE productId=? AND isPrimary=1',
          productId,
        );
      const id = b.insert("ProductImage", { ...input, productId, isPrimary });
      audit(b, actor, "product-image.create", "ProductImage", id, {
        productId,
        isPrimary,
      });
      return id;
    }, "image");
    return prisma.productImage.findUniqueOrThrow({ where: { id } });
  }
  override async updateImage(
    actor: string,
    id: string,
    input: ProductImagePatchInput,
  ) {
    await this.mutate(async (b) => {
      const current = await this.getImage(id);
      if (!current) throw new AdminCatalogImageNotFoundError();
      if (input.isPrimary)
        b.sql(
          'UPDATE "ProductImage" SET isPrimary=0 WHERE productId=? AND isPrimary=1 AND id!=?',
          current.productId,
          id,
        );
      b.update("ProductImage", id, { ...input });
      if (current.isPrimary && input.isPrimary === false) {
        const replacement = await prisma.productImage.findFirst({
          where: { productId: current.productId, id: { not: id } },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        });
        if (replacement)
          b.update("ProductImage", replacement.id, { isPrimary: true });
      }
      audit(b, actor, "product-image.update", "ProductImage", id, {
        productId: current.productId,
        isPrimary: input.isPrimary ?? current.isPrimary,
      });
    }, "image");
    return prisma.productImage.findUniqueOrThrow({ where: { id } });
  }
  override async deleteImage(actor: string, id: string) {
    return this.mutate(async (b) => {
      const current = await this.getImage(id);
      if (!current) throw new AdminCatalogImageNotFoundError();
      b.delete("ProductImage", "id", id);
      if (current.isPrimary) {
        const replacement = await prisma.productImage.findFirst({
          where: { productId: current.productId, id: { not: id } },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        });
        if (replacement)
          b.update("ProductImage", replacement.id, { isPrimary: true });
      }
      audit(b, actor, "product-image.delete", "ProductImage", id, {
        productId: current.productId,
        storageKey: current.storageKey,
      });
      return current;
    }, "image");
  }
}
export function runtimeUnavailable(): never {
  throw new HttpError(503, "Preview credentials are not configured");
}
