// Historical identifiers below are a DENYLIST, never deployment targets.
const oldAccessHost = "cool-bush-5c50.cloudflareaccess.com";
const oldAccessAudience =
  "b8e4a1545e95be70497d182d85814439456c09534a20f36dd20c99dad70fffc0";

export function isStenzoHost(value: string): boolean {
  const host = value.toLowerCase().replace(/\.+$/, "");
  return (
    host === "stenzo.uz" ||
    host.endsWith(".stenzo.uz") ||
    host === oldAccessHost ||
    (host.endsWith(".workers.dev") &&
      host.split(".").some((part) => part.includes("stenzo")))
  );
}

interface IsolationEnvironment {
  PUBLIC_ORIGIN?: string;
  ADMIN_ORIGIN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  VOYEY_LOCAL_ONLY?: string;
  COMMERCE_ENABLED?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_CHANNEL_ID?: string;
  ADMIN_TELEGRAM_IDS?: string;
}

export function infrastructureIsolated(env: IsolationEnvironment): boolean {
  if (
    env.ACCESS_AUD?.split(",").some(
      (value) => value.trim().toLowerCase() === oldAccessAudience,
    )
  )
    return false;
  for (const value of [
    env.PUBLIC_ORIGIN,
    env.ADMIN_ORIGIN,
    env.ACCESS_TEAM_DOMAIN,
  ]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (isStenzoHost(url.hostname) || url.username || url.password)
        return false;
      if (env.VOYEY_LOCAL_ONLY === "1" && !url.hostname.endsWith(".invalid"))
        return false;
    } catch {
      return false;
    }
  }
  // The stage 1.1 template cannot contact ANY real bot/channel or Access team.
  if (
    env.VOYEY_LOCAL_ONLY === "1" &&
    (env.COMMERCE_ENABLED !== "0" ||
      env.TELEGRAM_BOT_TOKEN ||
      env.TELEGRAM_WEBHOOK_SECRET ||
      env.TELEGRAM_CHANNEL_ID ||
      env.ADMIN_TELEGRAM_IDS ||
      env.ACCESS_TEAM_DOMAIN ||
      env.ACCESS_AUD)
  )
    return false;
  return true;
}
