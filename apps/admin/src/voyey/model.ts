import { translate, type Locale, type MessageKey } from "./messages";
export const sections = [
  "dashboard",
  "orders",
  "products",
  "categories",
  "stock",
  "payments",
  "refunds",
  "promos",
  "campaigns",
  "customers",
  "staff",
  "analytics",
  "settings",
] as const;
export type Section = (typeof sections)[number];
export const demoPath = "/admin/voyey-admin-demo.html";
export function readRoute(search: string): Section | "login" {
  const value = new URLSearchParams(search).get("screen");
  return sections.includes(value as Section) ? (value as Section) : "login";
}
export const routeHref = (screen: Section | "login") =>
  `${demoPath}?screen=${screen}`;
export type Mode = "IN_STOCK" | "PREORDER";
export type ClaimStatus = "SUBMITTED" | "APPROVED" | "REJECTED";
export type DemoOrderStatus =
  | "AWAITING_PREPAYMENT"
  | "PREPAYMENT_SUBMITTED"
  | "AWAITING_PURCHASE"
  | "AWAITING_FINAL_PAYMENT"
  | "FINAL_PAYMENT_SUBMITTED"
  | "PAID_FULL"
  | "CANCELLED";
export interface DemoProduct {
  id: string;
  name: { ru: string; uz: string };
  category: "stationery" | "clothing" | "care";
  price: number;
  sku: string;
  stock: number;
  preorderEnabled: boolean;
  status: "ACTIVE" | "DRAFT" | "INACTIVE";
  image: "notebook" | "markers" | "hoodie" | "care";
  attributes: {
    label: MessageKey;
    value: string | MessageKey;
    translated?: boolean;
  }[];
}
export interface DemoOrder {
  id: string;
  buyer: number;
  created: string;
  mode: Mode;
  status: DemoOrderStatus;
  payment: ClaimStatus | "UNPAID";
  percent: 50 | 100;
  subtotal: number;
  discount: number;
  goodsTotal: number;
  first: number;
  paidGoods: number;
  cargo: number | null;
  // Independent immutable fixture snapshot, never a reference to the mutable catalogue.
  item: {
    name: { ru: string; uz: string };
    sku: string;
    quantity: number;
    attributes: DemoProduct["attributes"];
  };
}
const named = (key: MessageKey) => ({
  ru: translate("ru", key),
  uz: translate("uz", key),
});
export const initialProducts: DemoProduct[] = [
  {
    id: "demo-p1",
    name: named("planner"),
    category: "stationery",
    price: 89000,
    sku: "DEMO-A5-PINK",
    stock: 3,
    preorderEnabled: true,
    status: "ACTIVE",
    image: "notebook",
    attributes: [
      { label: "material", value: "paper", translated: true },
      { label: "color", value: "pink", translated: true },
    ],
  },
  {
    id: "demo-p2",
    name: named("markers"),
    category: "stationery",
    price: 72000,
    sku: "DEMO-MARK-12",
    stock: 0,
    preorderEnabled: true,
    status: "ACTIVE",
    image: "markers",
    attributes: [{ label: "pack", value: "12" }],
  },
  {
    id: "demo-p3",
    name: named("hoodie"),
    category: "clothing",
    price: 299000,
    sku: "DEMO-HOOD-M",
    stock: 12,
    preorderEnabled: false,
    status: "ACTIVE",
    image: "hoodie",
    attributes: [
      { label: "size", value: "M" },
      { label: "material", value: "cotton", translated: true },
      { label: "color", value: "beige", translated: true },
    ],
  },
  {
    id: "demo-p4",
    name: named("soap"),
    category: "care",
    price: 48000,
    sku: "DEMO-SOAP-300",
    stock: 8,
    preorderEnabled: true,
    status: "DRAFT",
    image: "care",
    attributes: [{ label: "volume", value: "300 ml" }],
  },
];
const snapshot = (index: number) => {
  const p = initialProducts[index]!;
  return structuredClone({
    name: p.name,
    sku: p.sku,
    quantity: 1,
    attributes: p.attributes,
  });
};
export const orders: DemoOrder[] = [
  {
    id: "DEMO-1048",
    buyer: 1,
    created: "2026-10-24T07:35:00Z",
    mode: "IN_STOCK",
    status: "PREPAYMENT_SUBMITTED",
    payment: "SUBMITTED",
    percent: 100,
    subtotal: 89000,
    discount: 8900,
    goodsTotal: 80100,
    first: 80100,
    paidGoods: 0,
    cargo: null,
    item: snapshot(0),
  },
  {
    id: "DEMO-1047",
    buyer: 2,
    created: "2026-10-24T06:20:00Z",
    mode: "PREORDER",
    status: "AWAITING_PURCHASE",
    payment: "APPROVED",
    percent: 50,
    subtotal: 72000,
    discount: 10800,
    goodsTotal: 61200,
    first: 30600,
    paidGoods: 30600,
    cargo: null,
    item: snapshot(1),
  },
  {
    id: "DEMO-1046",
    buyer: 3,
    created: "2026-10-24T05:10:00Z",
    mode: "IN_STOCK",
    status: "PAID_FULL",
    payment: "APPROVED",
    percent: 100,
    subtotal: 299000,
    discount: 0,
    goodsTotal: 299000,
    first: 299000,
    paidGoods: 299000,
    cargo: null,
    item: snapshot(2),
  },
  {
    id: "DEMO-1045",
    buyer: 4,
    created: "2026-10-23T10:00:00Z",
    mode: "PREORDER",
    status: "FINAL_PAYMENT_SUBMITTED",
    payment: "SUBMITTED",
    percent: 100,
    subtotal: 72000,
    discount: 0,
    goodsTotal: 72000,
    first: 72000,
    paidGoods: 72000,
    cargo: 17000,
    item: snapshot(1),
  },
  {
    id: "DEMO-1044",
    buyer: 5,
    created: "2026-10-23T08:40:00Z",
    mode: "IN_STOCK",
    status: "AWAITING_PREPAYMENT",
    payment: "REJECTED",
    percent: 100,
    subtotal: 89000,
    discount: 0,
    goodsTotal: 89000,
    first: 89000,
    paidGoods: 0,
    cargo: null,
    item: snapshot(0),
  },
  {
    id: "DEMO-1043",
    buyer: 6,
    created: "2026-10-22T08:00:00Z",
    mode: "PREORDER",
    status: "CANCELLED",
    payment: "UNPAID",
    percent: 50,
    subtotal: 72000,
    discount: 0,
    goodsTotal: 72000,
    first: 36000,
    paidGoods: 0,
    cargo: null,
    item: snapshot(1),
  },
];
export const orderFilters = [
  "all",
  "inStock",
  "preorder",
  "waitPay",
  "onReview",
  "paid",
  "cancelled",
] as const;
export type OrderFilter = (typeof orderFilters)[number];
export function filterOrders(
  source: DemoOrder[],
  filter: OrderFilter,
  query = "",
  locale: Locale = "ru",
) {
  const q = query.trim().toLocaleLowerCase();
  return source.filter(
    (o) =>
      (!q ||
        `${o.id} ${translate(locale, "syntheticBuyer")} ${o.buyer}`
          .toLocaleLowerCase()
          .includes(q)) &&
      (filter === "all" ||
        (filter === "inStock" && o.mode === "IN_STOCK") ||
        (filter === "preorder" && o.mode === "PREORDER") ||
        (filter === "waitPay" &&
          ["AWAITING_PREPAYMENT", "AWAITING_FINAL_PAYMENT"].includes(
            o.status,
          )) ||
        (filter === "onReview" && o.payment === "SUBMITTED") ||
        (filter === "paid" && o.status === "PAID_FULL") ||
        (filter === "cancelled" && o.status === "CANCELLED")),
  );
}
export type ProductSort = "nameSort" | "priceSort" | "stockSort";
export function filterProducts(
  source: DemoProduct[],
  query: string,
  category: string,
  sort: ProductSort,
  locale: Locale,
) {
  const q = query.trim().toLocaleLowerCase();
  return source
    .filter(
      (p) =>
        (category === "all" || p.category === category) &&
        `${p.name.ru} ${p.name.uz} ${p.sku} ${translate(locale, p.category)}`
          .toLocaleLowerCase()
          .includes(q),
    )
    .sort((a, b) =>
      sort === "priceSort"
        ? a.price - b.price
        : sort === "stockSort"
          ? a.stock - b.stock
          : a.name[locale].localeCompare(b.name[locale]),
    );
}
export function saveProduct(
  source: DemoProduct[],
  draft: DemoProduct,
): DemoProduct[] {
  if (
    !draft.name.ru.trim() ||
    !draft.name.uz.trim() ||
    !/^[A-Z0-9_-]{1,64}$/.test(draft.sku) ||
    !Number.isSafeInteger(draft.price) ||
    draft.price <= 0 ||
    !Number.isSafeInteger(draft.stock) ||
    draft.stock < 0 ||
    source.some((p) => p.id !== draft.id && p.sku === draft.sku)
  )
    throw new Error("invalidProduct");
  const value = structuredClone(draft);
  return source.some((p) => p.id === draft.id)
    ? source.map((p) => (p.id === draft.id ? value : p))
    : [...source, value];
}
export interface DemoClaim {
  id: string;
  orderId: string;
  phase: "FIRST" | "FINAL";
  amount: number;
  submitted: string;
  status: ClaimStatus;
  attempt: number;
  history: ClaimStatus[];
}
export const initialClaims: DemoClaim[] = [
  {
    id: "demo-claim-1",
    orderId: "DEMO-1048",
    phase: "FIRST",
    amount: 80100,
    submitted: "2026-10-24T07:40:00Z",
    status: "SUBMITTED",
    attempt: 1,
    history: [],
  },
  {
    id: "demo-claim-2",
    orderId: "DEMO-1047",
    phase: "FIRST",
    amount: 30600,
    submitted: "2026-10-24T06:30:00Z",
    status: "APPROVED",
    attempt: 1,
    history: ["APPROVED"],
  },
  {
    id: "demo-claim-3",
    orderId: "DEMO-1044",
    phase: "FIRST",
    amount: 89000,
    submitted: "2026-10-23T09:00:00Z",
    status: "REJECTED",
    attempt: 1,
    history: ["REJECTED"],
  },
  {
    id: "demo-claim-4",
    orderId: "DEMO-1045",
    phase: "FINAL",
    amount: 17000,
    submitted: "2026-10-24T05:40:00Z",
    status: "SUBMITTED",
    attempt: 1,
    history: [],
  },
];
// This changes only a mock claim display. It NEVER writes money, stock or order status.
export function reviewDemoClaim(
  source: DemoClaim[],
  id: string,
  decision: "APPROVED" | "REJECTED",
) {
  return source.map((c) =>
    c.id === id && c.status === "SUBMITTED"
      ? { ...c, status: decision, history: [...c.history, decision] }
      : c,
  );
}
export const promos = [
  {
    code: "DEMO-READY",
    type: "IN_STOCK",
    discount: "10%",
    mode: "IN_STOCK",
    limit: 100,
    uses: 12,
    min: 50000,
    personal: null,
    campaign: null,
  },
  {
    code: "DEMO-PRE",
    type: "PREORDER",
    discount: "15%",
    mode: "PREORDER",
    limit: 50,
    uses: 4,
    min: 0,
    personal: null,
    campaign: null,
  },
  {
    code: "DEMO-ALL",
    type: "UNIVERSAL",
    discount: 50000,
    mode: "IN_STOCK / PREORDER",
    limit: 100,
    uses: 8,
    min: 100000,
    personal: null,
    campaign: null,
  },
  {
    code: "DEMO-PERSONAL",
    type: "PERSONAL",
    discount: "20%",
    mode: "IN_STOCK",
    limit: 1,
    uses: 0,
    min: 0,
    personal: "DEMO-USER-1",
    campaign: null,
  },
  {
    code: "DEMO-BLOGGER",
    type: "BLOGGER",
    discount: "12%",
    mode: "PREORDER",
    limit: 200,
    uses: 16,
    min: 0,
    personal: null,
    campaign: "DEMO-CAMPAIGN-1",
  },
] as const;
