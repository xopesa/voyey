export type UserStatusValue = "ACTIVE" | "BLOCKED" | "DELETED";
export * from "./telegram-product.js";
export * from "./telegram-admin.js";
export * from "./telegram-payment.js";
export * from "./variant-generator.js";
export * from "./admin-dashboard.js";
export type UserLocale = "uz" | "ru";

export interface PublicUser {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  preferredLocale: UserLocale;
  status: UserStatusValue;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramAuthResponse {
  accessToken: string;
  user: PublicUser;
}

export interface HealthResponse {
  status: "ok";
  service: "stenzo-api";
  timestamp: string;
}
export * from "./banners.js";
export * from "./promotions.js";

export * from "./promo-codes.js";

export * from "./customers.js";
export * from "./finance.js";
export * from "./lifecycle.js";

export * from "./cart-snapshot.js";
