import { variantSaleAvailability, type SaleMode } from "@stenzo/shared";
import {
  products,
  initialCart,
  type DemoCartRow,
  type DemoProduct,
  type DemoVariant,
} from "./fixtures";

export type ErrorCode =
  | "stock"
  | "quantity"
  | "variant"
  | "measurements"
  | "empty"
  | "promo"
  | "promoMode"
  | "tiny"
  | "form"
  | "terms"
  | "file"
  | "expired"
  | "pending"
  | "attempts"
  | "paid";
export class DemoError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
  }
}
export type Inventory = Record<string, number | null>;
export type Recipient = {
  fullName: string;
  phone: string;
  city: string;
  address: string;
  apartment: string | null;
  comment: string | null;
};
export type PromoSelection = {
  input: string;
  applied: string | null;
  error: ErrorCode | null;
};
export type CatalogFilters = {
  query: string;
  category: string;
  mode: "ALL" | SaleMode;
  sort: "popular" | "new" | "priceAsc" | "priceDesc";
  min: number;
  max: number;
  size: string;
};
export type DemoOrder = {
  id: string;
  saleMode: SaleMode;
  createdAt: number;
  expiresAt: number;
  extensionAt: number | null;
  recipient: Recipient;
  delivery: "pickup" | "local";
  lines: Array<
    DemoCartRow & {
      unitPrice: number;
      nameRu: string;
      nameUz: string;
      variantRu: string;
      variantUz: string;
      image: DemoProduct["image"];
      attributes: DemoProduct["attributes"];
    }
  >;
  subtotal: number;
  discount: number;
  goodsTotal: number;
  firstAmount: number;
  percent: 50 | 100;
  remaining: number;
  cargo: 0 | null;
  promoCode: string | null;
  claims: Array<{
    key: string;
    submittedAt: number;
    status: "SUBMITTED" | "APPROVED" | "REJECTED";
    name: string;
    decisionAt: number | null;
  }>;
};
export type DemoState = {
  cart: DemoCartRow[];
  stock: Inventory;
  favorites: string[];
  promos: Record<SaleMode, PromoSelection>;
  orders: DemoOrder[];
};
export const defaultFilters: CatalogFilters = {
  query: "",
  category: "",
  mode: "ALL",
  sort: "popular",
  min: 0,
  max: 1000000,
  size: "",
};
export function initialState(): DemoState {
  return {
    cart: initialCart.map((r) => ({ ...r })),
    stock: Object.fromEntries(
      products.flatMap((p) => p.variants.map((v) => [v.id, v.stock])),
    ),
    favorites: [],
    promos: {
      IN_STOCK: { input: "", applied: null, error: null },
      PREORDER: { input: "", applied: null, error: null },
    },
    orders: [],
  };
}
export function item(
  row: Pick<DemoCartRow, "productId" | "variantId">,
  catalog = products,
) {
  const p = catalog.find((p) => p.id === row.productId),
    v = p?.variants.find((v) => v.id === row.variantId);
  if (!p || !v) throw new DemoError("variant");
  return { p, v };
}
export function modes(v: DemoVariant, inventory: Inventory) {
  const a = variantSaleAvailability(inventory[v.id] ?? null, v.preorderEnabled);
  return {
    IN_STOCK: v.isAvailable && a.IN_STOCK.available,
    PREORDER: v.isAvailable && a.PREORDER.enabled,
  };
}
export function changeQuantity(
  state: DemoState,
  row: DemoCartRow,
  quantity: number,
  catalog = products,
): DemoState {
  const { p, v } = item(row, catalog),
    same = state.cart
      .filter((r) => r.variantId === row.variantId && r.id !== row.id)
      .reduce((n, r) => n + r.quantity, 0);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity + same > 99)
    throw new DemoError("quantity");
  if (!modes(v, state.stock)[row.saleMode])
    throw new DemoError(row.saleMode === "IN_STOCK" ? "stock" : "variant");
  if (
    row.saleMode === "IN_STOCK" &&
    (state.stock[v.id] === null || quantity > state.stock[v.id]!)
  )
    throw new DemoError("stock");
  if (
    p.category.requiresBuyerMeasurements &&
    (!row.heightCm ||
      row.heightCm < 50 ||
      row.heightCm > 250 ||
      !row.weightKg ||
      row.weightKg < 10 ||
      row.weightKg > 300)
  )
    throw new DemoError("measurements");
  const updated = { ...row, quantity };
  return {
    ...state,
    cart: state.cart.some((r) => r.id === row.id)
      ? state.cart.map((r) => (r.id === row.id ? updated : r))
      : [...state.cart, updated],
    promos: {
      ...state.promos,
      [row.saleMode]: {
        ...state.promos[row.saleMode],
        applied: null,
        error: null,
      },
    },
  };
}
export function addToCart(
  state: DemoState,
  productId: string,
  variantId: string,
  saleMode: SaleMode,
  quantity: number,
  heightCm: number | null = null,
  weightKg: number | null = null,
) {
  const id = `${variantId}:${saleMode}`,
    old = state.cart.find((r) => r.id === id);
  return changeQuantity(
    state,
    { id, productId, variantId, saleMode, quantity, heightCm, weightKg },
    (old?.quantity ?? 0) + quantity,
  );
}
export function removeRow(state: DemoState, id: string) {
  const row = state.cart.find((r) => r.id === id);
  return {
    ...state,
    cart: state.cart.filter((r) => r.id !== id),
    promos: row
      ? {
          ...state.promos,
          [row.saleMode]: {
            ...state.promos[row.saleMode],
            applied: null,
            error: null,
          },
        }
      : state.promos,
  };
}
const demoCodes: Record<
  string,
  { type: "PERCENT" | "FIXED"; value: number; mode: "BOTH" | SaleMode }
> = {
  READY10: { type: "PERCENT", value: 10, mode: "IN_STOCK" },
  PRE15: { type: "PERCENT", value: 15, mode: "PREORDER" },
  VOYEY99: { type: "PERCENT", value: 99, mode: "BOTH" },
  HELLO50000: { type: "FIXED", value: 50000, mode: "BOTH" },
};
export function promoDiscount(
  subtotal: number,
  type: "PERCENT" | "FIXED",
  value: number,
) {
  if (
    !Number.isSafeInteger(subtotal) ||
    subtotal <= 0 ||
    !Number.isInteger(value) ||
    value < 1 ||
    (type === "PERCENT" && value > 99)
  )
    throw new DemoError("promo");
  const cap = (BigInt(subtotal) * 99n) / 100n,
    raw =
      type === "PERCENT"
        ? (BigInt(subtotal) * BigInt(value)) / 100n
        : BigInt(value);
  const discount = Number(raw < cap ? raw : cap);
  if (discount <= 0) throw new DemoError("tiny");
  return discount;
}
export function summary(state: DemoState, mode: SaleMode) {
  const rows = state.cart.filter((r) => r.saleMode === mode),
    subtotal = rows.reduce((n, r) => n + item(r).p.price * r.quantity, 0),
    code = state.promos[mode].applied;
  let discount = 0;
  if (code) {
    const policy = demoCodes[code];
    if (!policy) throw new DemoError("promo");
    if (policy.mode !== "BOTH" && policy.mode !== mode)
      throw new DemoError("promoMode");
    discount = promoDiscount(subtotal, policy.type, policy.value);
  }
  return { rows, subtotal, discount, goodsTotal: subtotal - discount };
}
export function applyPromo(state: DemoState, mode: SaleMode, raw: string) {
  const code = raw.trim().toUpperCase(),
    p = demoCodes[code];
  if (!state.cart.some((r) => r.saleMode === mode))
    throw new DemoError("empty");
  if (!p) throw new DemoError("promo");
  if (p.mode !== "BOTH" && p.mode !== mode) throw new DemoError("promoMode");
  const next = {
    ...state,
    promos: {
      ...state.promos,
      [mode]: { input: code, applied: code, error: null },
    },
  };
  summary(next, mode);
  return next;
}
export function filterProducts(
  filters: CatalogFilters,
  stock: Inventory,
  catalog = products,
) {
  return catalog
    .filter((p) => {
      const q = filters.query.trim().toLocaleLowerCase();
      return (
        (!filters.category || p.category.id === filters.category) &&
        (!q || `${p.nameRu} ${p.nameUz}`.toLocaleLowerCase().includes(q)) &&
        p.price >= filters.min &&
        p.price <= filters.max &&
        p.variants.some(
          (v) =>
            (!filters.size || v.size === filters.size) &&
            (filters.mode === "ALL" ||
              modes(v, stock)[filters.mode as SaleMode]),
        )
      );
    })
    .sort((a, b) =>
      filters.sort === "priceAsc"
        ? a.price - b.price
        : filters.sort === "priceDesc"
          ? b.price - a.price
          : filters.sort === "new"
            ? a.newRank - b.newRank
            : b.popularity - a.popularity,
    );
}
export function checkout(
  state: DemoState,
  mode: SaleMode,
  recipient: Recipient,
  delivery: "pickup" | "local",
  percent: 50 | 100,
  terms: boolean,
  now: number,
): { state: DemoState; order: DemoOrder } {
  if (!terms) throw new DemoError("terms");
  if (
    recipient.fullName.trim().length < 2 ||
    !/^\+?[0-9 ()-]{9,20}$/.test(recipient.phone) ||
    recipient.city.trim().length < 2 ||
    recipient.address.trim().length < 3
  )
    throw new DemoError("form");
  const s = summary(state, mode);
  if (!s.rows.length) throw new DemoError("empty");
  for (const row of s.rows) changeQuantity(state, row, row.quantity);
  if (s.goodsTotal <= 0 || !Number.isSafeInteger(s.goodsTotal))
    throw new DemoError("tiny");
  const rate = mode === "IN_STOCK" ? 100 : percent,
    firstAmount =
      rate === 100
        ? s.goodsTotal
        : Math.floor(s.goodsTotal / 2) + (s.goodsTotal % 2);
  const order: DemoOrder = {
    id: `DEMO-${state.orders.length + 1}`,
    saleMode: mode,
    createdAt: now,
    expiresAt: now + 86400000,
    extensionAt: null,
    recipient: { ...recipient },
    delivery,
    lines: s.rows.map((row) => {
      const { p, v } = item(row);
      return {
        ...row,
        unitPrice: p.price,
        nameRu: p.nameRu,
        nameUz: p.nameUz,
        variantRu: v.nameRu,
        variantUz: v.nameUz,
        image: p.image,
        attributes: { ...p.attributes, ...v.attributes },
      };
    }),
    subtotal: s.subtotal,
    discount: s.discount,
    goodsTotal: s.goodsTotal,
    firstAmount,
    percent: rate,
    remaining: s.goodsTotal - firstAmount,
    cargo: mode === "PREORDER" ? null : 0,
    promoCode: state.promos[mode].applied,
    claims: [],
  };
  const stock = { ...state.stock };
  if (mode === "IN_STOCK")
    for (const r of s.rows)
      stock[r.variantId] = stock[r.variantId]! - r.quantity;
  return {
    state: {
      ...state,
      stock,
      cart: state.cart.filter((r) => r.saleMode !== mode),
      orders: [...state.orders, order],
      promos: {
        ...state.promos,
        [mode]: { input: "", applied: null, error: null },
      },
    },
    order,
  };
}
export function deadline(order: DemoOrder) {
  return order.extensionAt === null
    ? order.expiresAt
    : order.extensionAt + 7200000;
}
export function submitReceipt(
  order: DemoOrder,
  key: string,
  file: { name: string; type: string; size: number },
  now: number,
): DemoOrder {
  if (order.claims.some((c) => c.key === key)) return order;
  if (order.claims.some((c) => c.status === "APPROVED"))
    throw new DemoError("paid");
  if (order.claims.some((c) => c.status === "SUBMITTED"))
    throw new DemoError("pending");
  if (order.claims.length >= 3) throw new DemoError("attempts");
  if (now >= deadline(order)) throw new DemoError("expired");
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size <= 0 ||
    file.size > 5 * 1024 * 1024
  )
    throw new DemoError("file");
  return {
    ...order,
    claims: [
      ...order.claims,
      {
        key,
        submittedAt: now,
        status: "SUBMITTED",
        name: file.name,
        decisionAt: null,
      },
    ],
  };
}
export function reviewReceipt(
  order: DemoOrder,
  decision: "APPROVED" | "REJECTED",
  now: number,
): DemoOrder {
  const pending = order.claims.find((c) => c.status === "SUBMITTED");
  if (!pending) return order;
  return {
    ...order,
    extensionAt:
      decision === "REJECTED" &&
      order.extensionAt === null &&
      now >= order.expiresAt
        ? now
        : order.extensionAt,
    claims: order.claims.map((c) =>
      c.key === pending.key ? { ...c, status: decision, decisionAt: now } : c,
    ),
  };
}
