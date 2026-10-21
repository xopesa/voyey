import { prisma } from "@stenzo/database";
import type { BotUsers } from "./users.js";

// Historical Node entry point only. Workers inject D1UserRepository instead.
export const nodeUsers: BotUsers = {
  createOrUpdateFromTelegram(profile) {
    const data = {
      username: profile.username ?? null,
      firstName: profile.firstName ?? null,
      lastName: profile.lastName ?? null,
      languageCode: profile.languageCode ?? null,
    };
    return prisma.user.upsert({
      where: { telegramId: profile.telegramId },
      create: { ...data, telegramId: profile.telegramId },
      update: data,
    });
  },
  setPreferredLocale(id, preferredLocale) {
    return prisma.user.update({ where: { id }, data: { preferredLocale } });
  },
};
