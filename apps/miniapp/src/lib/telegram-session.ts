import {
  ApiRequestError,
  authenticateTelegram,
  getCurrentUser,
  type PublicUser,
} from "./api-client";
import {
  clearAccessToken,
  readAccessToken,
  storeAccessToken,
} from "./auth-storage";

export type BootstrapState =
  | { status: "loading" }
  | { status: "outside-telegram" }
  | { status: "authenticated"; user: PublicUser }
  | { status: "error"; reason: "invalid-auth" | "unavailable" };

const defaults = {
  authenticateTelegram,
  getCurrentUser,
  clearAccessToken,
  readAccessToken,
  storeAccessToken,
};

export async function bootstrapTelegramSession(
  initData: string | undefined,
  signal: AbortSignal,
  dependencies = defaults,
): Promise<BootstrapState | undefined> {
  if (signal.aborted) return;
  // The SDK also exists in ordinary browsers. Never create/reuse a Telegram
  // session there, and do not send an empty initData request or retry in a loop.
  if (!initData) {
    dependencies.clearAccessToken();
    return { status: "outside-telegram" };
  }
  try {
    const stored = dependencies.readAccessToken();
    if (stored) {
      try {
        const { user } = await dependencies.getCurrentUser(stored, signal);
        return signal.aborted ? undefined : { status: "authenticated", user };
      } catch (error) {
        if (signal.aborted) return;
        // A temporary outage does not invalidate an otherwise usable token.
        if (
          !(error instanceof ApiRequestError) ||
          ![401, 403].includes(error.status)
        )
          throw error;
        dependencies.clearAccessToken();
      }
    }
    const result = await dependencies.authenticateTelegram(initData, signal);
    if (signal.aborted) return;
    dependencies.storeAccessToken(result.accessToken);
    return { status: "authenticated", user: result.user };
  } catch (error) {
    if (signal.aborted) return;
    return {
      status: "error",
      reason:
        error instanceof ApiRequestError &&
        [400, 401, 403].includes(error.status)
          ? "invalid-auth"
          : "unavailable",
    };
  }
}
