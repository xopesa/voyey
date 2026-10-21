import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { createWebhookServer } from "../src/webhook-server.js";

test("webhook requires secret, bounds bodies and preserves update/response without registering Telegram", async () => {
  const secret = randomBytes(32).toString("hex");
  const calls: unknown[] = [];
  const server = createWebhookServer(
    async (request) => {
      calls.push(await request.json());
      assert.equal(
        request.headers.get("x-telegram-bot-api-secret-token"),
        secret,
      );
      return new Response("processed", { status: 200 });
    },
    secret,
    128,
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("cache-control"), "no-store");
    assert.equal((await fetch(`${base}/telegram/webhook`)).status, 405);
    assert.equal(
      (await fetch(`${base}/other`, { method: "POST" })).status,
      404,
    );
    const post = (body: string, token?: string) =>
      fetch(`${base}/telegram/webhook`, {
        method: "POST",
        body,
        headers: token ? { "x-telegram-bot-api-secret-token": token } : {},
      });
    assert.equal((await post('{"update_id":1}')).status, 401);
    assert.equal((await post('{"update_id":1}', "wrong")).status, 401);
    assert.equal((await post("x".repeat(129), secret)).status, 413);
    assert.equal((await post("not json", secret)).status, 400);
    assert.deepEqual(calls, []);
    const response = await post('{"update_id":1}', secret);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "processed");
    assert.deepEqual(calls, [{ update_id: 1 }]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("webhook failures return a retryable sanitized 500", async () => {
  const secret = randomBytes(32).toString("hex");
  const server = createWebhookServer(async () => {
    throw new Error("private update/token");
  }, secret);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/telegram/webhook`,
      {
        method: "POST",
        body: "{}",
        headers: { "x-telegram-bot-api-secret-token": secret },
      },
    );
    assert.equal(response.status, 500);
    assert.equal(await response.text(), "");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
