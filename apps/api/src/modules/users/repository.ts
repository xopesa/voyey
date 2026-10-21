import { prisma } from "@stenzo/database";
import type { UserLocale } from "@stenzo/shared";

import type { UserRecord, VerifiedTelegramUser } from "./types.js";

export interface UserRepository {
  getById(id: string): Promise<UserRecord | null>;
  getByTelegramId(telegramId: bigint): Promise<UserRecord | null>;
  createOrUpdateFromTelegram(
    profile: VerifiedTelegramUser,
  ): Promise<UserRecord>;
  setPreferredLocale(id: string, locale: UserLocale): Promise<UserRecord>;
}

export class PrismaUserRepository implements UserRepository {
  public setPreferredLocale(
    id: string,
    locale: UserLocale,
  ): Promise<UserRecord> {
    return prisma.user.update({
      where: { id },
      data: { preferredLocale: locale },
    });
  }

  public getById(id: string): Promise<UserRecord | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  public getByTelegramId(telegramId: bigint): Promise<UserRecord | null> {
    return prisma.user.findUnique({ where: { telegramId } });
  }

  public createOrUpdateFromTelegram(
    profile: VerifiedTelegramUser,
  ): Promise<UserRecord> {
    return prisma.user.upsert({
      where: { telegramId: profile.telegramId },
      create: {
        telegramId: profile.telegramId,
        username: profile.username ?? null,
        firstName: profile.firstName ?? null,
        lastName: profile.lastName ?? null,
        languageCode: profile.languageCode ?? null,
      },
      update: {
        username: profile.username ?? null,
        firstName: profile.firstName ?? null,
        lastName: profile.lastName ?? null,
        languageCode: profile.languageCode ?? null,
      },
    });
  }
}
