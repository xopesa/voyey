import type { UserRepository } from "../../src/modules/users/repository.js";
import { UserService } from "../../src/modules/users/service.js";
import type { UserRecord } from "../../src/modules/users/types.js";

const timestamp = new Date("2026-09-29T00:00:00.000Z");

export const testUsers: UserRecord[] = [
  {
    id: "user-1",
    telegramId: 101n,
    username: "customer_one",
    firstName: "Customer",
    lastName: "One",
    languageCode: "ru",
    preferredLocale: "uz",
    status: "ACTIVE",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: "user-2",
    telegramId: 202n,
    username: "customer_two",
    firstName: "Customer",
    lastName: "Two",
    languageCode: "uz",
    preferredLocale: "uz",
    status: "ACTIVE",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: "admin",
    telegramId: 42n,
    username: "stenzo_admin",
    firstName: "Admin",
    lastName: null,
    languageCode: "ru",
    preferredLocale: "uz",
    status: "ACTIVE",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

class TestUserRepository implements UserRepository {
  public setPreferredLocale(): Promise<UserRecord> {
    return Promise.reject(new Error("Not used by commerce tests"));
  }
  public getById(id: string): Promise<UserRecord | null> {
    return Promise.resolve(testUsers.find((user) => user.id === id) ?? null);
  }

  public getByTelegramId(telegramId: bigint): Promise<UserRecord | null> {
    return Promise.resolve(
      testUsers.find((user) => user.telegramId === telegramId) ?? null,
    );
  }

  public createOrUpdateFromTelegram(): Promise<UserRecord> {
    return Promise.reject(new Error("Not used by commerce tests"));
  }
}

export function createTestUserService(): UserService {
  return new UserService(new TestUserRepository());
}
