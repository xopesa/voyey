import type { ChannelErrorCode, ChannelPublication } from "@stenzo/shared";
import type { MessageKey } from "./i18n";
export type { ChannelPublication };
export const channelErrorKeys: Record<ChannelErrorCode, MessageKey> = {
  CHANNEL_NOT_CONFIGURED: "channelMissing",
  SALES_USERNAME_NOT_CONFIGURED: "channelSalesMissing",
  BOT_NOT_CONFIGURED: "channelBotMissing",
  BOT_NOT_ALLOWED: "channelPermission",
  CHANNEL_NOT_ALLOWED: "channelInvalid",
  MAIN_MINIAPP_NOT_CONFIGURED: "channelMainMissing",
  PREVIEW_BOT_MISMATCH: "channelBotMismatch",
  PRODUCT_INACTIVE: "channelInactive",
  UZ_CONTENT_REQUIRED: "channelUzRequired",
  PRICE_INVALID: "channelPrice",
  PHOTO_MISSING: "channelPhoto",
  PHOTO_NOT_PUBLIC: "channelPhotoPublic",
  VARIANTS_MISSING: "channelVariants",
  INVALID_SLUG: "channelSlug",
  TELEGRAM_UNAVAILABLE: "channelUnavailable",
  TELEGRAM_REJECTED: "channelRejected",
  PHOTO_UNAVAILABLE: "channelPhotoFetch",
  DELIVERY_UNCONFIRMED: "channelUncertain",
  PERSISTENCE_UNAVAILABLE: "channelUncertain",
};
export const channelStatusKeys: Record<
  ChannelPublication["status"],
  MessageKey
> = {
  NOT_CONFIGURED: "channelNotConfigured",
  NOT_PUBLISHED: "channelNotPublished",
  PENDING: "channelPending",
  PUBLISHED: "channelPublished",
  FAILED: "channelFailed",
};
