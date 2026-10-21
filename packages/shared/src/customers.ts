export type CustomerStatus = "ACTIVE" | "BLOCKED" | "DELETED";
export type CustomerFilter =
  "all" | "active" | "blocked" | "with-orders" | "no-orders";
export type Customer = {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  preferredLocale: "ru" | "uz";
  status: CustomerStatus;
  registeredAt: string;
  lastInteractionAt: string;
  orderCount: number;
  approvedPayments: number;
  refunded?: number;
  pendingRefunds?: number;
  activeOrders: number;
  completedOrders: number;
  prepayments: number;
  finalPayments: number;
  latestOrder: { publicId: string; createdAt: string } | null;
};
export type CustomerRecipient = {
  fullName: string;
  phone: string;
  city: string;
  address: string;
  apartment: string | null;
  comment: string | null;
};
export type CustomerCard = Customer & {
  latestRecipient: CustomerRecipient | null;
};
export type CustomerOrder = {
  publicId: string;
  source: "MINIAPP" | "ADMIN";
  createdAt: string;
  total: number;
  discountAmount: number;
  paid: number;
  status: string;
};
export type CustomerPage = { customers: Customer[]; nextCursor: string | null };
export type CustomerOrderPage = {
  orders: CustomerOrder[];
  nextCursor: string | null;
};
