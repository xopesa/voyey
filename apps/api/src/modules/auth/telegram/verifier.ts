import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { VerifiedTelegramUser } from "../../users/types.js";
import { InvalidTelegramAuthError } from "../errors.js";

export const DEFAULT_TELEGRAM_INIT_DATA_TTL_SECONDS = 600;

export interface VerifiedTelegramInitData {
  authDate: number;
  user: VerifiedTelegramUser;
}

const telegramUserSchema = z
  .object({
    id: z.union([
      z.number().int().nonnegative().refine(Number.isSafeInteger),
      z.string().regex(/^\d+$/),
    ]),
    username: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    language_code: z.string().optional(),
  })
  .transform((user) => ({
    telegramId: BigInt(String(user.id)),
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    languageCode: user.language_code,
  }));

function invalidAuth(): InvalidTelegramAuthError {
  return new InvalidTelegramAuthError();
}

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  options: { nowSeconds?: number; ttlSeconds?: number } = {},
): VerifiedTelegramInitData {
  if (!initData || !botToken) throw invalidAuth();

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDateValue = params.get("auth_date");
  const userValue = params.get("user");

  if (!hash || !authDateValue || !userValue || !/^[a-f\d]{64}$/i.test(hash)) {
    throw invalidAuth();
  }

  const authDate = Number(authDateValue);
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TELEGRAM_INIT_DATA_TTL_SECONDS;

  if (
    !Number.isSafeInteger(authDate) ||
    authDate > nowSeconds ||
    nowSeconds - authDate > ttlSeconds
  ) {
    throw invalidAuth();
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculatedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest();
  const receivedHash = Buffer.from(hash, "hex");

  if (!timingSafeEqual(calculatedHash, receivedHash)) throw invalidAuth();

  let rawUser: unknown;
  try {
    rawUser = JSON.parse(userValue) as unknown;
  } catch {
    throw invalidAuth();
  }

  const parsedUser = telegramUserSchema.safeParse(rawUser);
  if (!parsedUser.success) throw invalidAuth();

  return { authDate, user: parsedUser.data };
}

export class TelegramInitDataVerifier {
  public constructor(
    private readonly botToken: string,
    private readonly ttlSeconds: number,
    private readonly nowSeconds?: () => number,
  ) {}

  public verify(initData: string): VerifiedTelegramInitData {
    return verifyTelegramInitData(initData, this.botToken, {
      nowSeconds: this.nowSeconds?.() ?? Math.floor(Date.now() / 1000),
      ttlSeconds: this.ttlSeconds,
    });
  }
}
