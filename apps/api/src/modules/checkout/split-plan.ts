import { createHash } from "node:crypto";
import { atomic, prisma } from "@stenzo/database";
import { cartInclude } from "../cart/repository.js";
import { assertCartSelection, cartSaleMode } from "../cart/domain.js";
import type { CartRecord } from "../cart/types.js";
import { HttpError } from "../auth/errors.js";
import { idempotencyKeySchema } from "../orders/schemas.js";
import { snapshotCheckoutLine } from "./domain.js";

export type CheckoutSaleMode = "IN_STOCK" | "PREORDER";
type Mode = CheckoutSaleMode;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type SplitCheckoutPlan = {
  version: 1;
  executable: false;
  checkoutGroupId: string;
  requestFingerprint: string;
  cartId: string;
  subtotal: number;
  orders: Array<{
    plannedOrderId: string;
    saleMode: Mode;
    subtotal: number;
    items: Array<
      ReturnType<typeof snapshotCheckoutLine> & {
        saleMode: Mode;
        cartItemId: string;
        inventoryReservedQuantity: number;
      }
    >;
  }>;
  inventory: Array<{
    variantId: string;
    quantity: number;
    expectedStock: number;
  }>;
  consumeCartItemIds: string[];
  transaction: readonly string[];
};

/** Pure non-executable proposal: no payment amounts/statuses, writes or notifications. */
export function buildSplitCheckoutPlan(
  cart: CartRecord,
  key: string,
  now = Date.now(),
  selectedMode?: Mode,
): SplitCheckoutPlan {
  const parsedKey = idempotencyKeySchema.safeParse(key);
  if (!parsedKey.success) throw new HttpError(400, "Invalid Idempotency-Key");
  key = parsedKey.data;
  if (!cart.items.length) throw new HttpError(409, "Cart is empty");
  const selected = selectedMode
    ? cart.items.filter((i) => i.saleMode === selectedMode)
    : cart.items;
  if (!selected.length)
    throw new HttpError(409, "Selected sale-mode tab is empty");
  if (selected.some((i) => cartSaleMode(i.saleMode) === "LEGACY"))
    throw new HttpError(
      409,
      "LEGACY rows require the legacy checkout; automatic conversion is disabled",
    );
  const rowKeys = selected.map((i) => `${i.variantId}:${i.saleMode}`);
  if (new Set(rowKeys).size !== rowKeys.length)
    throw new HttpError(409, "Duplicate cart mode row");
  const checkoutGroupId =
    "plan-" + digest(["VOYEY_SPLIT_V1", cart.userId, key]);
  const orders: SplitCheckoutPlan["orders"] = [];
  for (const mode of ["IN_STOCK", "PREORDER"] as const) {
    const rows = selected
      .filter((i) => i.saleMode === mode)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!rows.length) continue;
    const items = rows.map((row) => {
      assertCartSelection(
        row.product,
        row.variant,
        row.productId,
        mode,
        row.quantity,
        cart.items.filter(
          (other) => other.variantId === row.variantId && other.id !== row.id,
        ),
      );
      return {
        ...snapshotCheckoutLine(row, now),
        saleMode: mode,
        cartItemId: row.id,
        inventoryReservedQuantity: mode === "IN_STOCK" ? row.quantity : 0,
      };
    });
    const subtotal = items.reduce((n, i) => n + i.lineTotal, 0);
    if (!Number.isSafeInteger(subtotal) || subtotal > 2147483647)
      throw new HttpError(409, "Order amount limit");
    orders.push({
      plannedOrderId: checkoutGroupId + ":" + mode,
      saleMode: mode,
      subtotal,
      items,
    });
  }
  const subtotal = orders.reduce((n, o) => n + o.subtotal, 0);
  if (!Number.isSafeInteger(subtotal) || subtotal > 2147483647)
    throw new HttpError(409, "Checkout amount limit");
  const inventory = selected
    .filter((i) => i.saleMode === "IN_STOCK")
    .map((i) => ({
      variantId: i.variantId,
      quantity: i.quantity,
      expectedStock: i.variant.stock!,
    }))
    .sort((a, b) => a.variantId.localeCompare(b.variantId));
  const consumeCartItemIds = selected.map((i) => i.id).sort();
  return {
    version: 1,
    executable: false,
    checkoutGroupId,
    cartId: cart.id,
    subtotal,
    orders,
    inventory,
    consumeCartItemIds,
    requestFingerprint: digest(["VOYEY_SPLIT_V1", cart.id, orders, inventory]),
    transaction: [
      "claim unique (userId, idempotencyKey, operation) and compare request fingerprint",
      "revalidate user, selected cart rows, current catalog, money and revision",
      "insert checkout group and all sale-mode orders/items using approved 2.4 financial policy",
      "reserve IN_STOCK only; PREORDER reservation must be zero",
      "write single discount accounting and all audits",
      "delete only selected cart item IDs; commit everything in one guarded D1 batch",
      "notify only after commit, keyed per group/order",
    ],
  };
}

/** No route/config flag enables writes. This opt-in only permits isolated preparation. */
export class SplitCheckoutPlanner {
  constructor(private readonly preparationEnabled = false) {}
  async prepare(userId: string, key: string): Promise<SplitCheckoutPlan> {
    if (!this.preparationEnabled)
      throw new HttpError(503, "Split checkout preparation is disabled");
    const parsedKey = idempotencyKeySchema.safeParse(key);
    if (!parsedKey.success) throw new HttpError(400, "Invalid Idempotency-Key");
    key = parsedKey.data;
    return atomic(async () => {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.status !== "ACTIVE")
        throw new HttpError(409, "Customer unavailable");
      if (
        await prisma.order.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
        })
      )
        throw new HttpError(
          409,
          "Idempotency key belongs to an existing order",
        );
      const cart = await prisma.cart.findUnique({
        where: { userId },
        include: cartInclude,
      });
      if (!cart) throw new HttpError(409, "Cart is empty");
      return buildSplitCheckoutPlan(cart, key);
    });
  }
  commit(): never {
    throw new HttpError(
      503,
      "Split order persistence and payments are blocked until stage 2.4",
    );
  }
}

/** Unconnected proposal only: largest remainder, deterministic tie by group key. */
export function proposeDiscountAllocation(
  groups: { key: string; subtotal: number }[],
  discount: number,
) {
  if (
    !Number.isSafeInteger(discount) ||
    discount < 0 ||
    new Set(groups.map((g) => g.key)).size !== groups.length ||
    groups.some((g) => !Number.isSafeInteger(g.subtotal) || g.subtotal < 0)
  )
    throw new HttpError(400, "Invalid discount allocation");
  const total = groups.reduce((n, g) => n + BigInt(g.subtotal), 0n);
  if (BigInt(discount) > total)
    throw new HttpError(400, "Discount exceeds subtotal");
  const ranked = groups.map((g) => ({
    ...g,
    amount: total ? (BigInt(discount) * BigInt(g.subtotal)) / total : 0n,
    remainder: total ? (BigInt(discount) * BigInt(g.subtotal)) % total : 0n,
  }));
  let left = BigInt(discount) - ranked.reduce((n, g) => n + g.amount, 0n);
  ranked.sort((a, b) =>
    a.remainder === b.remainder
      ? a.key.localeCompare(b.key)
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const g of ranked)
    if (left > 0n) {
      g.amount++;
      left--;
    }
  return groups.map((g) => ({
    key: g.key,
    discount: Number(ranked.find((r) => r.key === g.key)!.amount),
  }));
}
