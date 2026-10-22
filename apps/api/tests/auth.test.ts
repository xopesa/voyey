import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { SignJWT, decodeJwt } from "jose";

import { registerAdminRoutes } from "../src/modules/admin/route.js";
import { registerAuthRoutes } from "../src/modules/auth/route.js";
import { AuthService } from "../src/modules/auth/service.js";
import { TelegramInitDataVerifier } from "../src/modules/auth/telegram/verifier.js";
import { JwtTokenService } from "../src/modules/auth/token.js";
import type { UserRepository } from "../src/modules/users/repository.js";
import { UserService } from "../src/modules/users/service.js";
import type {
  UserRecord,
  VerifiedTelegramUser,
} from "../src/modules/users/types.js";
import { createTelegramInitData } from "./helpers/telegram.js";

const botToken = "123456:stenzo-auth-test-token";
const jwtSecret = "stenzo-test-secret-that-is-longer-than-32-characters";
const now = 1_800_000_000;

class MemoryUserRepository implements UserRepository {
  private user: UserRecord | null = null;
  public async setPreferredLocale(
    id: string,
    preferredLocale: "uz" | "ru",
  ): Promise<UserRecord> {
    if (this.user?.id !== id) throw new Error("User not found");
    this.user.preferredLocale = preferredLocale;
    return this.user;
  }

  public getById(id: string): Promise<UserRecord | null> {
    return Promise.resolve(this.user?.id === id ? this.user : null);
  }

  public getByTelegramId(telegramId: bigint): Promise<UserRecord | null> {
    return Promise.resolve(
      this.user?.telegramId === telegramId ? this.user : null,
    );
  }

  public createOrUpdateFromTelegram(
    profile: VerifiedTelegramUser,
  ): Promise<UserRecord> {
    const timestamp = new Date("2026-09-29T00:00:00.000Z");
    this.user = {
      id: "user-1",
      telegramId: profile.telegramId,
      username: profile.username ?? null,
      firstName: profile.firstName ?? null,
      lastName: profile.lastName ?? null,
      languageCode: profile.languageCode ?? null,
      preferredLocale: this.user?.preferredLocale ?? "uz",
      status: "ACTIVE",
      createdAt: this.user?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    return Promise.resolve(this.user);
  }
}

function createFixture() {
  const userService = new UserService(new MemoryUserRepository());
  const tokenService = new JwtTokenService(jwtSecret);
  const authService = new AuthService(
    userService,
    new TelegramInitDataVerifier(botToken, 600, () => now),
    tokenService,
  );
  const app = Fastify();
  registerAuthRoutes(app, authService, tokenService, userService);
  registerAdminRoutes(app, tokenService, userService, new Set(["42"]));
  return { app, tokenService };
}

describe("Telegram auth flow", () => {
  it("issues VOYEY JWTs and refuses STENZO issuer/audience even with the same signing key", async () => {
    const service = new JwtTokenService(jwtSecret);
    expect(decodeJwt(await service.issue("user-1"))).toMatchObject({
      iss: "voyey-api",
      aud: "voyey-miniapp",
    });
    for (const [issuer, audience] of [
      ["stenzo-api", "stenzo-miniapp"],
      ["stenzo-api", "voyey-miniapp"],
      ["voyey-api", "stenzo-miniapp"],
    ]) {
      const legacy = await new SignJWT({})
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("user-1")
        .setIssuer(issuer!)
        .setAudience(audience!)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode(jwtSecret));
      await expect(service.verify(legacy)).rejects.toThrow();
    }
  });
  it("keeps Telegram RU metadata separate from default UZ; authenticated preference survives reauth", async () => {
    const { app } = createFixture();
    const initData = createTelegramInitData(
      botToken,
      { id: 42, language_code: "ru" },
      now,
    );
    const login = () =>
      app.inject({
        method: "POST",
        url: "/auth/telegram",
        payload: { initData },
      });
    const auth = (await login()).json();
    expect(auth.user.preferredLocale).toBe("uz");
    expect(auth.user.languageCode).toBe("ru");
    const headers = { authorization: `Bearer ${auth.accessToken}` };
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/me/preferences",
          payload: { locale: "ru" },
        })
      ).statusCode,
    ).toBe(401);
    for (const payload of [
      { locale: "en" },
      { locale: null },
      {},
      { locale: "ru", telegramId: "other" },
    ]) {
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: "/me/preferences",
            headers,
            payload,
          })
        ).statusCode,
      ).toBe(400);
    }
    for (const locale of ["ru", "uz"] as const) {
      const result = await app.inject({
        method: "PATCH",
        url: "/me/preferences",
        headers,
        payload: { locale },
      });
      expect(result.statusCode).toBe(200);
      expect(result.json().user.preferredLocale).toBe(locale);
      expect((await login()).json().user.preferredLocale).toBe(locale);
      expect(
        (await app.inject({ method: "GET", url: "/me", headers })).json().user
          .preferredLocale,
      ).toBe(locale);
    }
    await app.close();
  });
  it("authenticates initData, upserts the user and authorizes /me", async () => {
    const { app } = createFixture();
    const initData = createTelegramInitData(
      botToken,
      { id: 42, username: "customer", first_name: "STENZO" },
      now,
    );

    const authResponse = await app.inject({
      method: "POST",
      url: "/auth/telegram",
      payload: { initData },
    });
    expect(authResponse.statusCode).toBe(200);
    const auth = authResponse.json<{
      accessToken: string;
      user: { telegramId: string; username: string };
    }>();
    expect(auth.user).toMatchObject({ telegramId: "42", username: "customer" });

    const meResponse = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json()).toMatchObject({
      user: { id: "user-1", telegramId: "42" },
    });
    await app.close();
  });

  it("rejects invalid initData and missing bearer tokens", async () => {
    const { app } = createFixture();
    const invalidAuth = await app.inject({
      method: "POST",
      url: "/auth/telegram",
      payload: { initData: "invalid=true" },
    });
    const missingToken = await app.inject({ method: "GET", url: "/me" });

    expect(invalidAuth.statusCode).toBe(401);
    expect(missingToken.statusCode).toBe(401);
    await app.close();
  });

  it("authorizes only configured Telegram administrators", async () => {
    const { app, tokenService } = createFixture();
    const initData = createTelegramInitData(botToken, { id: 42 }, now);
    await app.inject({
      method: "POST",
      url: "/auth/telegram",
      payload: { initData },
    });
    const token = await tokenService.issue("user-1");
    const response = await app.inject({
      method: "GET",
      url: "/admin/health",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("rejects tokens signed with another secret", async () => {
    const { app } = createFixture();
    const foreignToken = await new JwtTokenService(
      "another-test-secret-that-is-longer-than-32-characters",
    ).issue("user-1");
    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${foreignToken}` },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
