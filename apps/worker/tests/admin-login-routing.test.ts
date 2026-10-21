import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";

test("Admin login alias is host-scoped, preserves password protection and leaves Mini App routing unchanged", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: fileURLToPath(new URL("../dist/index.js", import.meta.url)),
      compatibilityDate: "2026-10-15",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      log: new Log(LogLevel.NONE),
      bindings: {
        PREVIEW_ONLY: "1",
        COMMERCE_ENABLED: "1",
        ADMIN_AUTH_MODE: "password",
        PUBLIC_ORIGIN: "https://preview.invalid",
        ADMIN_ORIGIN: "https://admin.preview.invalid",
      },
      serviceBindings: {
        ASSETS: async (request) => {
          const path = new URL(request.url).pathname;
          if (path === "/admin/index.html") return new Response("Admin shell");
          if (path === "/index.html") return new Response("Mini App shell");
          return new Response("missing", { status: 404 });
        },
      },
      outboundService: async () => {
        throw new Error("Routing checks must make no external requests");
      },
    }),
  );
  try {
    for (const method of ["GET", "HEAD"]) {
      const response = await mf.dispatchFetch(
        "https://admin.preview.invalid/login?next=https://evil.invalid",
        { method, redirect: "manual" },
      );
      assert.equal(response.status, 302);
      assert.equal(
        response.headers.get("location"),
        "https://admin.preview.invalid/admin/login",
      );
    }
    const root = await mf.dispatchFetch("https://admin.preview.invalid/", {
      redirect: "manual",
    });
    assert.equal(
      root.headers.get("location"),
      "https://admin.preview.invalid/admin/",
    );
    const login = await mf.dispatchFetch(
      "https://admin.preview.invalid/admin/login",
    );
    assert.equal(login.status, 200);
    assert.equal(await login.text(), "Admin shell");
    const publicLogin = await mf.dispatchFetch("https://preview.invalid/login");
    assert.equal(publicLogin.status, 200);
    assert.equal(await publicLogin.text(), "Mini App shell");
    const fallbackLogin = await mf.dispatchFetch(
      "https://fallback.invalid/login",
    );
    assert.equal(await fallbackLogin.text(), "Mini App shell");
    const mutation = await mf.dispatchFetch(
      "https://admin.preview.invalid/login",
      {
        method: "POST",
      },
    );
    assert.equal(mutation.status, 405);
    const health = await mf.dispatchFetch(
      "https://admin.preview.invalid/health",
    );
    assert.equal(
      ((await health.json()) as { commerceEnabled: boolean }).commerceEnabled,
      true,
    );
  } finally {
    await mf.dispose();
  }
});
