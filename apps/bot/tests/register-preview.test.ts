import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
const { registerPreviewWebhook } = await import(
  new URL("../../../scripts/register-preview-webhook.mjs", import.meta.url).href
);
function fixture(
  overrides: Record<string, unknown> = {},
  secret = randomBytes(21).toString("base64url"),
) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const config = {
    token: "123456:" + randomBytes(32).toString("base64url"),
    secret,
    username: "preview_test_bot",
  };
  const fetcher = async (url: string, init: RequestInit) => {
    const method = new URL(url).pathname.split("/").at(-1)!;
    calls.push({ method, payload: JSON.parse(String(init.body)) });
    if (new URL(url).hostname === "store.voyey.example.invalid")
      return Response.json(
        { ok: true },
        { status: Number(overrides.probeStatus ?? 200) },
      );
    const defaults = {
      getMe: { username: config.username },
      getWebhookInfo: { url: "https://store.voyey.example.invalid/telegram/webhook" },
      getChatMenuButton: { type: "commands" },
      setWebhook: true,
    };
    return Response.json({
      ok: true,
      result: ({ ...defaults, ...overrides } as Record<string, unknown>)[
        method
      ],
    });
  };
  return { calls, run: () => registerPreviewWebhook({ ...config, fetcher }) };
}
test("preview webhook registration preserves pending updates and limits update types", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.registered, true);
  const payload = f.calls.find((c) => c.method === "setWebhook")!.payload;
  assert.equal(payload.url, "https://store.voyey.example.invalid/telegram/webhook");
  assert.equal(payload.drop_pending_updates, false);
  assert.equal(payload.max_connections, 1);
  assert.deepEqual(payload.allowed_updates, ["message", "callback_query"]);
});
test("registration refuses a mismatched bot identity without changing webhook", async () => {
  const f = fixture({ getMe: { username: "another_bot" } });
  await assert.rejects(f.run(), /identity/);
  assert.equal(
    f.calls.some((c) => c.method === "setWebhook"),
    false,
  );
});
test("registration refuses an existing non-preview webhook", async () => {
  const f = fixture({
    getWebhookInfo: { url: "https://api.stenzo.uz/telegram/webhook" },
  });
  await assert.rejects(f.run(), /Refusing/);
  assert.equal(
    f.calls.some((c) => c.method === "setWebhook"),
    false,
  );
});
test("registration refuses a bot menu pointing to production", async () => {
  const f = fixture({
    getChatMenuButton: {
      type: "web_app",
      web_app: { url: "https://stenzo.uz" },
    },
  });
  await assert.rejects(f.run(), /Refusing/);
  assert.equal(
    f.calls.some((c) => c.method === "setWebhook"),
    false,
  );
});

test("registration refuses an unready preview or mismatched deployed secret", async () => {
  const f = fixture({ probeStatus: 403 });
  await assert.rejects(f.run(), /secret does not match/);
  assert.equal(
    f.calls.some((c) => c.method === "setWebhook"),
    false,
  );
});

test("registration accepts Telegram secret length bounds and rejects invalid characters before network", async () => {
  for (const secret of ["a", randomBytes(192).toString("base64url")]) {
    assert.equal((await fixture({}, secret).run()).registered, true);
  }
  for (const secret of [
    "",
    "a".repeat(257),
    "with space",
    "with:colon",
    "не-ascii",
  ]) {
    const f = fixture({}, secret);
    await assert.rejects(f.run(), /Invalid preview credentials/);
    assert.equal(f.calls.length, 0);
  }
});
