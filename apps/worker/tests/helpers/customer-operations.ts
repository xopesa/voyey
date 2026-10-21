import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import type { marketingRuntime } from "./marketing-runtime.js";
export async function runtimeUser(
  f: Awaited<ReturnType<typeof marketingRuntime>>,
  id: number,
) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: "Isolated operations" }),
  });
  const text = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(f.botToken).digest();
  params.set("hash", createHmac("sha256", key).update(text).digest("hex"));
  const response = await f.call(
    "/auth/telegram",
    "POST",
    { initData: params.toString() },
    {},
    "https://preview.invalid",
  );
  assert.equal(response.status, 200);
  const result = (await response.json()) as {
    accessToken: string;
    user: { id: string };
  };
  return { token: result.accessToken, id: result.user.id };
}
