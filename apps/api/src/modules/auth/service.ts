import type { PublicUser, TelegramAuthResponse } from "@stenzo/shared";

import { toPublicUser, type UserService } from "../users/index.js";
import { AccountUnavailableError } from "./errors.js";
import type { TelegramInitDataVerifier } from "./telegram/verifier.js";
import type { JwtTokenService } from "./token.js";

export class AuthService {
  public constructor(
    private readonly userService: UserService,
    private readonly telegramVerifier: TelegramInitDataVerifier,
    private readonly tokenService: JwtTokenService,
  ) {}

  public async authenticateTelegram(initData: string): Promise<TelegramAuthResponse> {
    const verified = this.telegramVerifier.verify(initData);
    const user = await this.userService.createOrUpdateFromTelegram(verified.user);
    if (user.status !== "ACTIVE") throw new AccountUnavailableError();

    return {
      accessToken: await this.tokenService.issue(user.id),
      user: toPublicUser(user) satisfies PublicUser,
    };
  }
}
