import type { UserRepository } from "./repository.js";
import type { UserRecord, VerifiedTelegramUser } from "./types.js";
import type { UserLocale } from "@stenzo/shared";

export class UserService {
  public constructor(private readonly repository: UserRepository) {}

  public setPreferredLocale(
    id: string,
    locale: UserLocale,
  ): Promise<UserRecord> {
    return this.repository.setPreferredLocale(id, locale);
  }

  public getById(id: string): Promise<UserRecord | null> {
    return this.repository.getById(id);
  }

  public getByTelegramId(telegramId: bigint): Promise<UserRecord | null> {
    return this.repository.getByTelegramId(telegramId);
  }

  public createOrUpdateFromTelegram(
    profile: VerifiedTelegramUser,
  ): Promise<UserRecord> {
    return this.repository.createOrUpdateFromTelegram(profile);
  }
}
