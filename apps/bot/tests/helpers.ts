import type { BotUsers, BotUserProfile, BotUser } from "../src/users.js";
export class MemoryBotUsers implements BotUsers {
  readonly profiles = new Map<bigint, BotUserProfile & BotUser>();
  async createOrUpdateFromTelegram(profile: BotUserProfile) {
    const previous = this.profiles.get(profile.telegramId);
    const user = {
      ...profile,
      id: previous?.id ?? String(profile.telegramId),
      preferredLocale: previous?.preferredLocale ?? "uz",
      status: previous?.status ?? "ACTIVE",
    };
    this.profiles.set(profile.telegramId, user);
    return user;
  }
  async setPreferredLocale(id: string, locale: "uz" | "ru") {
    const user = [...this.profiles.values()].find((u) => u.id === id)!;
    user.preferredLocale = locale;
    return user;
  }
}
