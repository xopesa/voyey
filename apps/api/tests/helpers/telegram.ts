import { createHmac } from "node:crypto";

export function createTelegramInitData(
  botToken: string,
  user: Record<string, unknown>,
  authDate: number,
): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "stenzo-test-query",
    user: JSON.stringify(user),
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  params.set("hash", hash);
  return params.toString();
}
