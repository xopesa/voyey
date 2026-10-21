import type { PublicUser, UserStatusValue, UserLocale } from "@stenzo/shared";

export interface UserRecord {
  id: string;
  telegramId: bigint;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  preferredLocale: UserLocale;
  status: UserStatusValue;
  createdAt: Date;
  updatedAt: Date;
}

export interface VerifiedTelegramUser {
  telegramId: bigint;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    telegramId: user.telegramId.toString(),
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    languageCode: user.languageCode,
    preferredLocale: user.preferredLocale,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
