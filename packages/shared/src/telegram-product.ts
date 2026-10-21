export function productStartParam(slug: string): string | null {
  return slug.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    ? `product_${slug}`
    : null;
}
export function productPathFromStartParam(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("product_")) return null;
  const slug = value.slice(8);
  return productStartParam(slug) === value ? `/catalog/${slug}` : null;
}
export type ChannelErrorCode =
  | "CHANNEL_NOT_CONFIGURED"
  | "SALES_USERNAME_NOT_CONFIGURED"
  | "BOT_NOT_CONFIGURED"
  | "BOT_NOT_ALLOWED"
  | "CHANNEL_NOT_ALLOWED"
  | "MAIN_MINIAPP_NOT_CONFIGURED"
  | "PREVIEW_BOT_MISMATCH"
  | "PRODUCT_INACTIVE"
  | "UZ_CONTENT_REQUIRED"
  | "PRICE_INVALID"
  | "PHOTO_MISSING"
  | "PHOTO_NOT_PUBLIC"
  | "VARIANTS_MISSING"
  | "INVALID_SLUG"
  | "TELEGRAM_UNAVAILABLE"
  | "TELEGRAM_REJECTED"
  | "PHOTO_UNAVAILABLE"
  | "DELIVERY_UNCONFIRMED"
  | "PERSISTENCE_UNAVAILABLE";
export interface ChannelPublication {
  status:
    "NOT_CONFIGURED" | "NOT_PUBLISHED" | "PENDING" | "PUBLISHED" | "FAILED";
  errorCode?: ChannelErrorCode;
  publishedAt?: string;
  messageId?: number;
  retryAllowed: boolean;
  alreadyPublished?: boolean;
}
