import type { BotLocale } from "./texts.js";

export interface BotUser {
  id: string;
  preferredLocale: BotLocale;
  status: string;
}
export interface BotUserProfile {
  telegramId: bigint;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
}
// The Worker injects the same D1-backed UserService used by Telegram auth.
export interface BotUsers {
  createOrUpdateFromTelegram(profile: BotUserProfile): Promise<BotUser>;
  setPreferredLocale(id: string, locale: BotLocale): Promise<BotUser>;
}
