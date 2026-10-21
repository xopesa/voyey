import assert from "node:assert/strict";
import { randomBytes, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import ts from "typescript";
const { Response, Headers, AbortSignal, FormData, Blob } = globalThis;

function load(file, globals) {
  const exports = {};
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      Response,
      Headers,
      Buffer,
      AbortSignal,
      FormData,
      process: { env: {} },
      require: (name) => {
        if (name === "./i18n") return load("../src/lib/i18n.ts", {});
        throw new Error("Unexpected test dependency " + name);
      },
      ...globals,
    },
  );
  return exports;
}
function proxy(fetch, env = {}) {
  const nativeRequire = createRequire(import.meta.url);
  return load("../src/app/api/admin/[...path]/route.ts", {
    fetch,
    process: { env },
    require: (name) =>
      name.startsWith("node:")
        ? nativeRequire(name)
        : { apiUrl: (path) => `http://api.test/admin/${path}` },
  });
}

test("lifecycle/refund/archive allowlists forward only explicit paths while preserving CSRF", async () => {
  const calls = [];
  const handler = proxy(async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.headers.get("x-csrf-token"), "fixture");
    return Response.json({ ok: true });
  });
  for (const path of [
    "orders/STZ-ORDER/cancel",
    "orders/STZ-ORDER/stock-reviewed",
    "finance/refunds/r/complete",
    "catalog/products/p/archive",
    "catalog/products/p/restore",
    "catalog/categories/c/archive",
    "catalog/categories/c/restore",
  ]) {
    assert.equal(
      (
        await handler.POST(
          request("POST", { "x-csrf-token": "fixture" }),
          context(path),
        )
      ).status,
      200,
    );
  }
  for (const path of [
    "catalog/products/p/delete",
    "catalog/variants/v/archive",
    "finance/refunds/r/undo",
  ]) {
    assert.equal(
      (await handler.POST(request("POST"), context(path))).status,
      404,
    );
  }
  assert.equal(calls.length, 7);
});
function request(method, headers = {}, body = "") {
  return {
    method,
    headers: new Headers(headers),
    cookies: {
      get: (name) =>
        name === "stenzo_admin_session" ? { value: "test-session" } : undefined,
    },
    body: body ? new Response(body).body : null,
    nextUrl: { search: "" },
  };
}
const context = (path) => ({
  params: Promise.resolve({ path: path.split("/") }),
});

test("Finance proxy preserves period filters and CSRF for narrowly allowed cost/expense routes", async () => {
  const calls = [];
  const handler = proxy(async (url, init) => {
    calls.push({ url, init });
    return Response.json({});
  });
  const req = request("GET");
  req.nextUrl.search = "?range=custom&from=2026-10-01&to=2026-10-20";
  assert.equal((await handler.GET(req, context("finance"))).status, 200);
  assert.match(
    calls[0].url,
    /finance\?range=custom&from=2026-10-01&to=2026-10-20$/,
  );
  const patch = request(
    "PATCH",
    { "x-csrf-token": "fixture", "content-type": "application/json" },
    '{"procurementUnitCost":90000}',
  );
  assert.equal(
    (
      await handler.PATCH(
        patch,
        context("orders/STZ-FINANCE/items/item/procurement-cost"),
      )
    ).status,
    200,
  );
  assert.equal(calls[1].init.headers.get("x-csrf-token"), "fixture");
  assert.equal(
    (
      await handler.PATCH(
        request(
          "PATCH",
          { "x-csrf-token": "fixture", "content-type": "application/json" },
          '{"amount":60000}',
        ),
        context("finance/expenses/e"),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await handler.POST(
        request("POST", { "x-csrf-token": "fixture" }),
        context("finance/expenses/e/void"),
      )
    ).status,
    200,
  );
  for (const path of [
    "finance/bank",
    "finance/expenses/e/unvoid",
    "orders/STZ-FINANCE/items/item/paid",
  ])
    assert.equal((await handler.GET(req, context(path))).status, 404);
});

test("manual order proxy preserves CSRF and idempotency key without accepting arbitrary subroutes", async () => {
  const calls = [];
  const handler = proxy(
    async (url, init) => {
      calls.push({ url, init });
      return Response.json({ order: { publicId: "ISOLATED" } });
    },
    {
      NODE_ENV: "production",
      ADMIN_PROXY_SECRET: randomBytes(32).toString("hex"),
    },
  );
  const req = request(
    "POST",
    {
      "x-real-ip": "203.0.113.22",
      "x-csrf-token": "isolated-csrf",
      "idempotency-key": "isolated-manual-order-0001",
      "content-type": "application/json",
    },
    "{}",
  );
  assert.equal((await handler.POST(req, context("orders/manual"))).status, 200);
  assert.equal(
    calls[0].init.headers.get("idempotency-key"),
    "isolated-manual-order-0001",
  );
  assert.equal(calls[0].init.headers.get("x-csrf-token"), "isolated-csrf");
  assert.equal(
    (await handler.POST(req, context("orders/manual/paid"))).status,
    404,
  );
  assert.equal(calls.length, 1);
});

test("dashboard GET proxy preserves period query and session, without admitting dashboard subpaths", async () => {
  const calls = [];
  const handler = proxy(
    async (url, init) => {
      calls.push({ url, init });
      assert.equal(init.method, "GET");
      assert.equal(
        init.headers.get("cookie"),
        "stenzo_admin_session=test-session",
      );
      return Response.json({ kpis: {} });
    },
    {
      NODE_ENV: "production",
      ADMIN_PROXY_SECRET: randomBytes(32).toString("hex"),
    },
  );
  const req = request("GET", { "x-real-ip": "203.0.113.22" });
  req.nextUrl.search = "?range=custom&from=2026-10-01&to=2026-10-19";
  assert.equal((await handler.GET(req, context("dashboard"))).status, 200);
  assert.match(
    calls[0].url,
    /dashboard\?range=custom&from=2026-10-01&to=2026-10-19$/,
  );
  assert.equal(
    (await handler.GET(req, context("dashboard/export"))).status,
    404,
  );
  assert.equal(calls.length, 1);
});

for (const { name, headers, ip } of [
  {
    name: "prefers X-Real-IP over a spoofed forwarding chain",
    headers: {
      "x-real-ip": "203.0.113.22",
      "x-forwarded-for": "198.51.100.1, 198.51.100.2",
    },
    ip: "203.0.113.22",
  },
  {
    name: "falls back to a single XFF address without X-Real-IP",
    headers: { "x-forwarded-for": "203.0.113.22" },
    ip: "203.0.113.22",
  },
  {
    name: "selects the last XFF address, including an IPv6 TCP peer",
    headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.22, 2001:db8::22 " },
    ip: "2001:db8::22",
  },
  {
    name: "treats an empty X-Real-IP as absent",
    headers: { "x-real-ip": " ", "x-forwarded-for": "203.0.113.22" },
    ip: "203.0.113.22",
  },
]) {
  test(`ISPmanager production ${name} and signs the selected IP`, async () => {
    const secret = randomBytes(32).toString("hex");
    let calls = 0;
    const handler = proxy(
      async (_url, init) => {
        calls++;
        const at = init.headers.get("x-stenzo-client-at");
        assert.match(at, /^\d+$/);
        assert.equal(init.headers.get("x-stenzo-client-ip"), ip);
        assert.equal(
          init.headers.get("x-stenzo-client-signature"),
          createHmac("sha256", secret).update(`${at}:${ip}`).digest("hex"),
        );
        assert.equal(init.headers.get("x-forwarded-for"), null);
        assert.equal(init.headers.get("x-real-ip"), null);
        return Response.json({ ok: true });
      },
      {
        NODE_ENV: "production",
        API_URL: "https://api.stenzo.example",
        ADMIN_PROXY_SECRET: secret,
      },
    );
    const response = await handler.POST(
      request("POST", {
        ...headers,
        "x-stenzo-client-ip": "198.51.100.99",
        "x-stenzo-client-at": "0",
        "x-stenzo-client-signature": "spoof",
      }),
      context("auth/login"),
    );
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
  });
}

test("production login keeps its 503 response without a valid selected IP", async () => {
  let calls = 0;
  const handler = proxy(
    async () => {
      calls++;
      return Response.json({ ok: true });
    },
    {
      NODE_ENV: "production",
      API_URL: "https://api.stenzo.example",
      ADMIN_PROXY_SECRET: randomBytes(32).toString("hex"),
    },
  );
  for (const headers of [
    {},
    { "x-real-ip": "", "x-forwarded-for": "" },
    { "x-forwarded-for": "invalid" },
    { "x-forwarded-for": "203.0.113.22, invalid" },
    { "x-forwarded-for": "203.0.113.22, " },
    { "x-real-ip": "invalid", "x-forwarded-for": "203.0.113.22" },
    { "x-real-ip": "203.0.113.22, 203.0.113.23" },
  ]) {
    const response = await handler.POST(
      request("POST", headers),
      context("auth/login"),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Admin proxy unavailable",
    });
  }
  assert.equal(calls, 0);
});

test("production IP fallback never bypasses required HMAC signing configuration", async () => {
  let calls = 0;
  for (const secret of [undefined, "short"]) {
    const handler = proxy(
      async () => {
        calls++;
        return Response.json({ ok: true });
      },
      {
        NODE_ENV: "production",
        API_URL: "https://api.stenzo.example",
        ADMIN_PROXY_SECRET: secret,
      },
    );
    const response = await handler.POST(
      request("POST", { "x-forwarded-for": "203.0.113.22" }),
      context("auth/login"),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Admin proxy unavailable",
    });
  }
  assert.equal(calls, 0);
});

test("Vercel admin proxy signs platform IP and drops spoofed forwarding headers", async () => {
  const secret = randomBytes(32).toString("hex");
  let calls = 0;
  const handler = proxy(
    async (_url, init) => {
      calls++;
      const at = init.headers.get("x-stenzo-client-at");
      assert.equal(init.headers.get("x-stenzo-client-ip"), "203.0.113.9");
      assert.equal(init.headers.get("x-forwarded-for"), null);
      assert.equal(
        init.headers.get("x-stenzo-client-signature"),
        createHmac("sha256", secret).update(`${at}:203.0.113.9`).digest("hex"),
      );
      return Response.json({ ok: true });
    },
    { VERCEL: "1", ADMIN_PROXY_SECRET: secret },
  );
  assert.equal(
    (
      await handler.POST(
        request("POST", {
          "x-vercel-forwarded-for": "203.0.113.9, 198.51.100.3",
          "x-real-ip": "198.51.100.4",
          "x-forwarded-for": "spoof",
          "x-stenzo-client-signature": "spoof",
        }),
        context("auth/login"),
      )
    ).status,
    200,
  );
  assert.equal(
    (await handler.POST(request("POST", {}), context("auth/login"))).status,
    503,
  );
  assert.equal(calls, 1);
});

test("private proof proxy streams original bytes with session-only no-store security headers", async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0, 0xff]);
  const handler = proxy(async (url, init) => {
    assert.equal(url, "http://api.test/admin/payments/id/proof");
    assert.equal(
      init.headers.get("cookie"),
      "stenzo_admin_session=test-session",
    );
    assert.equal(init.headers.get("authorization"), null);
    return new Response(bytes, { headers: { "content-type": "image/png" } });
  });
  const response = await handler.GET(
    request("GET", { authorization: "Bearer unrelated" }),
    context("payments/id/proof"),
  );
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    response.headers.get("cross-origin-resource-policy"),
    "same-origin",
  );
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const expired = proxy(async () =>
    Response.json({ error: "Admin session required" }, { status: 401 }),
  );
  const rejected = await expired.GET(
    request("GET"),
    context("payments/id/proof"),
  );
  assert.equal(rejected.status, 401);
  assert.equal(rejected.headers.get("content-type"), "application/json");
  const svg = proxy(
    async () =>
      new Response("<svg></svg>", {
        headers: { "content-type": "image/svg+xml" },
      }),
  );
  assert.equal(
    (await svg.GET(request("GET"), context("payments/id/proof"))).status,
    502,
  );
});

test("orders/payment mutations keep CSRF headers and GET filters without expanding to arbitrary admin paths", async () => {
  const calls = [];
  const handler = proxy(async (url, init) => {
    calls.push({ url, method: init.method });
    assert.equal(init.headers.get("x-csrf-token"), "csrf");
    return Response.json({ ok: true });
  });
  const headers = { origin: "http://localhost:3002", "x-csrf-token": "csrf" };
  for (const [method, path, body] of [
    ["PATCH", "orders/STZ-123/status", { status: "PURCHASED" }],
    ["POST", "orders/STZ-123/request-final-payment", { cargoAmount: 0 }],
    ["POST", "payments/id/approve", null],
    ["POST", "payments/id/reject", { reason: "Not received" }],
  ])
    assert.equal(
      (
        await handler[method](
          request(method, headers, body ? JSON.stringify(body) : ""),
          context(path),
        )
      ).status,
      200,
    );
  const list = request("GET", headers);
  list.nextUrl.search = "?status=WEIGHING&search=STZ-123";
  assert.equal((await handler.GET(list, context("orders"))).status, 200);
  assert.match(calls.at(-1).url, /orders\?status=WEIGHING&search=STZ-123$/);
  for (const path of [
    "orders/STZ-123/delete",
    "payments/id/refund",
    "payments/id/../proof",
    "notifications",
  ])
    assert.equal(
      (await handler.POST(request("POST"), context(path))).status,
      404,
    );
  assert.equal(calls.length, 5);
});

test("bodyless activation and logout work through the proxy against Fastify", async () => {
  const apiRequire = createRequire(
    new URL("../../api/package.json", import.meta.url),
  );
  const app = apiRequire("fastify")();
  const origin = "http://localhost:3002";
  for (const path of [
    "catalog/categories/id/activate",
    "catalog/categories/id/deactivate",
    "auth/logout",
  ]) {
    app.post(`/admin/${path}`, async (req, reply) => {
      assert.equal(req.headers.origin, origin);
      assert.equal(req.headers["x-csrf-token"], "test-csrf");
      assert.equal(req.headers.cookie, "stenzo_admin_session=test-session");
      reply.header(
        "set-cookie",
        "stenzo_admin_session=; HttpOnly; SameSite=Strict; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      );
      return { ok: true };
    });
  }
  const handler = proxy(async (url, init) => {
    const result = await app.inject({
      url: new URL(url).pathname,
      method: init.method,
      headers: Object.fromEntries(init.headers),
      ...(init.body ? { payload: init.body } : {}),
    });
    return new Response(result.body, {
      status: result.statusCode,
      headers: result.headers,
    });
  });
  try {
    for (const path of [
      "catalog/categories/id/activate",
      "catalog/categories/id/deactivate",
      "auth/logout",
    ]) {
      const response = await handler.POST(
        request("POST", {
          origin,
          "x-csrf-token": "test-csrf",
          "content-type": "application/json",
        }),
        context(path),
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match(response.headers.get("set-cookie"), /HttpOnly/);
    }
  } finally {
    await app.close();
  }
});

test("proxy preserves JSON mutations and cookie attributes, drops bearer and unrelated cookies", async () => {
  const body = JSON.stringify({
    nameRu: "Категория",
    nameUz: "Kategoriya",
    slug: "category",
    sortOrder: 1,
  });
  const handler = proxy(async (url, init) => {
    assert.equal(url, "http://api.test/admin/catalog/categories");
    assert.equal(Buffer.from(init.body).toString("utf8"), body);
    assert.equal(init.headers.get("content-type"), "application/json");
    assert.equal(init.headers.get("authorization"), null);
    assert.equal(
      init.headers.get("cookie"),
      "stenzo_admin_session=test-session",
    );
    return Response.json(
      { category: { id: "id" } },
      {
        status: 201,
        headers: {
          "set-cookie":
            "stenzo_admin_session=test; HttpOnly; Secure; SameSite=Strict; Path=/",
        },
      },
    );
  });
  const response = await handler.POST(
    request(
      "POST",
      {
        "content-type": "application/json",
        authorization: "Bearer unrelated",
        cookie: "other=unrelated",
      },
      body,
    ),
    context("catalog/categories"),
  );
  assert.equal(response.status, 201);
  assert.match(response.headers.get("set-cookie"), /Secure; SameSite=Strict/);
});

test("proxy rejects unrelated admin resources, traversal and oversized payloads", async () => {
  let calls = 0;
  const handler = proxy(async () => {
    calls++;
    return Response.json({});
  });
  for (const path of [
    "catalog/orders",
    "settings",
    "catalog/categories/..",
    "catalog/categories/id/../../auth/login",
  ]) {
    assert.equal(
      (await handler.GET(request("GET"), context(path))).status,
      404,
    );
  }
  assert.equal(
    (
      await handler.POST(
        request("POST", {}, "x".repeat(4097)),
        context("auth/login"),
      )
    ).status,
    413,
  );
  assert.equal(calls, 0);
});

test("proxy returns a recoverable unavailable state without leaking upstream errors", async () => {
  const secret = randomBytes(24).toString("hex");
  const handler = proxy(async () => {
    throw new Error(secret);
  });
  const response = await handler.GET(
    request("GET"),
    context("catalog/categories"),
  );
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).error, "API unavailable");
});

test("client redirects expired sessions and omits JSON content type for bodyless mutations", async () => {
  const redirects = [];
  const client = load("../src/lib/api.ts", {
    window: { location: { replace: (url) => redirects.push(url) } },
    fetch: async (_url, init) => {
      assert.equal(init.headers["Content-Type"], undefined);
      return new Response("{}", { status: 401 });
    },
  });
  await assert.rejects(client.api("auth/logout", { method: "POST" }));
  assert.deepEqual(redirects, ["/admin/login"]);
});

test("proxy preserves binary multipart bytes, upload metadata and session CSRF headers", async () => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array([0x89, 0x50, 0, 0xff])], { type: "image/png" }),
    "photo.png",
  );
  const encoded = new Response(form);
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const input = request(
    "POST",
    {
      "content-type": encoded.headers.get("content-type"),
      origin: "http://localhost:3002",
      "x-csrf-token": "test-csrf",
    },
    bytes,
  );
  input.nextUrl.search = "?sortOrder=7&isPrimary=true";
  const handler = proxy(async (url, init) => {
    assert.equal(
      url,
      "http://api.test/admin/catalog/products/id/images/upload?sortOrder=7&isPrimary=true",
    );
    assert.deepEqual(Buffer.from(init.body), Buffer.from(bytes));
    assert.equal(
      init.headers.get("content-type"),
      encoded.headers.get("content-type"),
    );
    assert.equal(init.headers.get("x-csrf-token"), "test-csrf");
    assert.equal(
      init.headers.get("cookie"),
      "stenzo_admin_session=test-session",
    );
    const parsed = await new Response(init.body, {
      headers: init.headers,
    }).formData();
    assert.deepEqual(
      Buffer.from(await parsed.get("file").arrayBuffer()),
      Buffer.from([0x89, 0x50, 0, 0xff]),
    );
    return Response.json({ image: { id: "image" } }, { status: 201 });
  });
  assert.equal(
    (await handler.POST(input, context("catalog/products/id/images/upload")))
      .status,
    201,
  );
  const client = load("../src/lib/api.ts", {
    fetch: async (_url, init) => {
      assert.equal(init.headers["Content-Type"], undefined);
      assert.equal(init.body, form);
      assert.equal(init.headers["x-csrf-token"], "test-csrf");
      return Response.json({ image: { id: "image" } });
    },
  });
  await client.api("catalog/products/id/images/upload", {
    method: "POST",
    body: form,
    headers: { "x-csrf-token": "test-csrf" },
  });
});

test("proxy bounds upload streams and forwards query filters and image DELETE", async () => {
  let calls = 0;
  const handler = proxy(async (url, init) => {
    calls++;
    if (init.method === "GET")
      assert.equal(
        url,
        "http://api.test/admin/catalog/products?category=hoodies&status=DRAFT&search=Hudi",
      );
    else {
      assert.equal(init.method, "DELETE");
      assert.equal(url, "http://api.test/admin/catalog/images/id");
    }
    return Response.json({ ok: true });
  });
  const input = request("GET");
  input.nextUrl.search = "?category=hoodies&status=DRAFT&search=Hudi";
  assert.equal(
    (await handler.GET(input, context("catalog/products"))).status,
    200,
  );
  assert.equal(
    (await handler.DELETE(request("DELETE"), context("catalog/images/id")))
      .status,
    200,
  );
  assert.equal(
    (
      await handler.POST(
        request("POST", {}, new Uint8Array(5242880 + 65537)),
        context("catalog/products/id/images/upload"),
      )
    ).status,
    413,
  );
  assert.equal(calls, 2);
});
