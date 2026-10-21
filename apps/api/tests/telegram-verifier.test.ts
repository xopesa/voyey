import { describe, expect, it } from "vitest";

import { InvalidTelegramAuthError } from "../src/modules/auth/errors.js";
import { verifyTelegramInitData } from "../src/modules/auth/telegram/verifier.js";
import { createTelegramInitData } from "./helpers/telegram.js";

const botToken = "123456:stenzo-test-token";
const now = 1_800_000_000;

describe("verifyTelegramInitData", () => {
  it("accepts valid signed initData and extracts the Telegram profile", () => {
    const initData = createTelegramInitData(
      botToken,
      {
        id: 42,
        username: "stenzo_customer",
        first_name: "Stenzo",
        language_code: "uz",
      },
      now - 10,
    );

    expect(
      verifyTelegramInitData(initData, botToken, {
        nowSeconds: now,
        ttlSeconds: 600,
      }),
    ).toEqual({
      authDate: now - 10,
      user: {
        telegramId: 42n,
        username: "stenzo_customer",
        firstName: "Stenzo",
        lastName: undefined,
        languageCode: "uz",
      },
    });
  });

  it("rejects a modified hash in constant-time verification flow", () => {
    const initData = createTelegramInitData(botToken, { id: 42 }, now).replace(
      /hash=[^&]+/,
      `hash=${"0".repeat(64)}`,
    );
    expect(() =>
      verifyTelegramInitData(initData, botToken, { nowSeconds: now }),
    ).toThrow(InvalidTelegramAuthError);
  });

  it("rejects expired and future initData", () => {
    const expired = createTelegramInitData(botToken, { id: 42 }, now - 601);
    const future = createTelegramInitData(botToken, { id: 42 }, now + 1);

    expect(() =>
      verifyTelegramInitData(expired, botToken, {
        nowSeconds: now,
        ttlSeconds: 600,
      }),
    ).toThrow(InvalidTelegramAuthError);
    expect(() =>
      verifyTelegramInitData(future, botToken, { nowSeconds: now }),
    ).toThrow(InvalidTelegramAuthError);
  });

  it("rejects malformed initData", () => {
    expect(() => verifyTelegramInitData("auth_date=1", botToken)).toThrow(
      InvalidTelegramAuthError,
    );
  });
});
