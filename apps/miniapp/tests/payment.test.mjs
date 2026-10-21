import * as shared from "@stenzo/shared";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { URL, URLSearchParams } from "node:url";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { paymentFixture } from "./fixtures/payment-preview/data.mjs";
const { Headers, FormData, File, AbortController, setTimeout, clearTimeout } =
  globalThis;
function load(file, globals = {}) {
  const code = ts.transpileModule(
    readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const exports = {};
  runInNewContext(code, {
    exports,
    require: (name) => {
      if (name === "@stenzo/shared") return shared;
      throw Error(name);
    },
    Headers,
    FormData,
    File,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    ...globals,
  });
  return exports;
}
const checkout = load("lib/checkout.ts"),
  cart = load("lib/cart.ts"),
  catalog = load("lib/catalog.ts"),
  product = load("lib/product.ts", { require: () => catalog }),
  payment = load("lib/payment.ts", { require: () => checkout });
const { PaymentResource } = load("lib/payment-resource.ts", {
  require: () => payment,
});
const orders = load("lib/orders.ts", { require: () => payment });
function client(fetch) {
  return load("lib/api-client.ts", {
    fetch,
    require: (name) =>
      ({
        "./checkout": checkout,
        "./cart": cart,
        "./catalog": catalog,
        "./product": product,
        "./payment": payment,
      })[name],
  });
}
const file = new File([new Uint8Array([1, 2, 3])], "test-proof.png", {
  type: "image/png",
});
function resource(scenario = "waiting", overrides = {}) {
  let data = paymentFixture(scenario),
    journal = null,
    posts = [];
  const api = {
    order: async () => data.order,
    instructions: async () => data.instructions,
    submit: async (id, file, key) => {
      posts.push(key);
      data = paymentFixture(
        scenario.startsWith("final") ? "final-pending" : "pending",
      );
      return data.instructions.latestPayment;
    },
    token: () => "test-token",
    key: () => `payment-key-${String(posts.length).padStart(16, "0")}`,
    read: () => journal,
    write: (value) => {
      journal = value;
    },
    ...overrides,
  };
  const r = new PaymentResource(data.order.publicId, api);
  return {
    r,
    api,
    posts,
    setData: (value) => {
      data = value;
    },
    getJournal: () => journal,
  };
}
test("real response guards accept both phases and reject invalid amounts or private/malformed payment shapes", () => {
  for (const scenario of [
    "waiting",
    "pending",
    "rejected",
    "approved",
    "final-waiting",
    "final-pending",
    "final-rejected",
    "final-approved",
    "cancelled",
  ]) {
    const d = paymentFixture(scenario);
    assert.ok(payment.isPaymentOrder(d.order));
    assert.ok(payment.isPaymentInstructions(d.instructions));
    assert.ok(payment.coherentPayment(d));
  }
  const d = paymentFixture();
  assert.equal(
    payment.isPaymentInstructions({ ...d.instructions, amount: -1 }),
    false,
  );
  assert.equal(payment.isPaymentOrder({ ...d.order, paidAmount: 0.5 }), false);
  assert.equal(
    payment.isPaymentInstructions({
      ...d.instructions,
      latestPayment: { status: "SUBMITTED" },
    }),
    false,
  );
  assert.equal(
    payment.coherentPayment({
      order: d.order,
      instructions: { ...d.instructions, amount: 1 },
    }),
    false,
  );
});
test("FINAL awaiting state never inherits approved prepayment UI", () => {
  const d = paymentFixture("final-waiting");
  d.instructions.latestPayment =
    paymentFixture("approved").instructions.latestPayment;
  d.instructions.latestPaymentStatus = "APPROVED";
  d.order.payment.latestStatus = "APPROVED";
  assert.equal(payment.paymentState(d), "waiting");
  assert.equal(
    payment.paymentState(paymentFixture("final-approved")),
    "approvedFinal",
  );
  assert.equal(
    payment.paymentState(paymentFixture("approved")),
    "approvedPrepayment",
  );
});
test("proof validation covers supported MIME, empty and server-configured size", () => {
  assert.equal(payment.proofError(file, 3), null);
  assert.equal(payment.proofError(file, 2), "fileSize");
  assert.equal(
    payment.proofError({ type: "image/svg+xml", size: 1 }, 10),
    "fileType",
  );
  assert.equal(
    payment.proofError({ type: "image/webp", size: 0 }, 10),
    "fileEmpty",
  );
});
test("multipart uses existing JWT proxy, file-only body and idempotency without forcing JSON Content-Type", async () => {
  let seen;
  const c = client(async (path, init) => {
    seen = { path, init };
    return {
      ok: true,
      json: async () => ({
        payment: paymentFixture("pending").instructions.latestPayment,
      }),
    };
  });
  await c.submitPaymentProof(
    "STZ-FIXTURE-001",
    file,
    "proof-key-1234567890",
    "test-token",
  );
  assert.equal(seen.path, "/api/orders/STZ-FIXTURE-001/payments");
  assert.equal(seen.init.headers.get("Content-Type"), null);
  assert.equal(seen.init.headers.get("Authorization"), "Bearer test-token");
  assert.equal(
    seen.init.headers.get("Idempotency-Key"),
    "proof-key-1234567890",
  );
  assert.equal(seen.init.body.get("file").size, 3);
  assert.deepEqual([...seen.init.body.keys()], ["file"]);
});
test("client refuses fake acknowledgement and wrong order ownership responses", async () => {
  const c = client(async () => ({
    ok: true,
    json: async () => ({
      payment: { success: true },
      order: paymentFixture().order,
    }),
  }));
  await assert.rejects(
    c.submitPaymentProof(
      "STZ-FIXTURE-001",
      file,
      "proof-key-1234567890",
      "token",
    ),
    /not confirmed/,
  );
  await assert.rejects(c.getPaymentOrder("another-order", "token"), /Invalid/);
  await assert.rejects(
    c.getPaymentInstructions("STZ-FIXTURE-001", ""),
    (e) => e.status === 401,
  );
});
test("preflight catches server amount/status change and never uploads stale proof", async () => {
  const f = resource();
  await f.r.refresh();
  const d = paymentFixture();
  d.instructions.amount = 999;
  d.order.payment.amountDue = 999;
  f.setData(d);
  assert.equal(await f.r.submit(file), false);
  assert.equal(f.posts.length, 0);
  assert.equal(f.r.snapshot().error, "changed");
  assert.equal(f.r.snapshot().data.instructions.amount, 999);
});
test("pending state and synchronous lock prevent repeat upload/double taps", async () => {
  let resolve;
  const gate = new Promise((yes) => {
    resolve = yes;
  });
  const f = resource("waiting", {
    submit: async () => {
      await gate;
      return paymentFixture("pending").instructions.latestPayment;
    },
  });
  await f.r.refresh();
  const first = f.r.submit(file);
  assert.equal(await f.r.submit(file), false);
  resolve();
  assert.equal(await first, true);
  const pending = resource("pending");
  await pending.r.refresh();
  assert.equal(await pending.r.submit(file), false);
  assert.equal(pending.posts.length, 0);
  assert.equal(pending.r.snapshot().error, "alreadySubmitted");
});
test("lost acknowledgement persists same key across retry and remount", async () => {
  const keys = [];
  const f = resource("waiting", {
    submit: async (id, file, key) => {
      keys.push(key);
      throw Error("Lost response");
    },
  });
  await f.r.refresh();
  assert.equal(await f.r.submit(file), false);
  assert.equal(f.r.snapshot().sent, false);
  const journal = f.getJournal();
  f.r.dispose();
  const second = new PaymentResource("STZ-FIXTURE-001", {
    ...f.api,
    key: () => "must-not-create-new-key",
    read: () => journal,
  });
  await second.refresh();
  await second.submit(file);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.ok(!JSON.stringify(journal).includes("test-proof"));
});

test("blocked browser storage still reuses an in-memory idempotency key", async () => {
  let generation = 0;
  const keys = [];
  const f = resource("waiting", {
    read: () => null,
    write: () => {},
    key: () => `memory-key-${String(++generation).padStart(16, "0")}`,
    submit: async (id, file, key) => {
      keys.push(key);
      throw Error("Lost response");
    },
  });
  await f.r.refresh();
  await f.r.submit(file);
  await f.r.submit(file);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test("unmount during preflight cancels submission before it can write a payment", async () => {
  let resolve;
  const f = resource();
  await f.r.refresh();
  f.api.order = () =>
    new Promise((yes) => {
      resolve = yes;
    });
  const request = f.r.submit(file);
  f.r.dispose();
  resolve(paymentFixture().order);
  assert.equal(await request, false);
  assert.equal(f.posts.length, 0);
});

test("background status refresh does not silently dismiss an unconfirmed upload error", async () => {
  const f = resource("waiting", {
    submit: async () => {
      throw { status: 502 };
    },
  });
  await f.r.refresh();
  await f.r.submit(file);
  assert.equal(f.r.snapshot().error, "upload");
  await f.r.refresh(true);
  assert.equal(f.r.snapshot().error, "upload");
  await f.r.refresh();
  assert.equal(f.r.snapshot().error, undefined);
});
test("rejection permits a fresh idempotency attempt while preserving prior payment", async () => {
  const f = resource("rejected");
  await f.r.refresh();
  assert.equal(payment.paymentState(f.r.snapshot().data), "rejected");
  assert.equal(await f.r.submit(file), true);
  assert.equal(f.getJournal().latestId, "fixture-attempt");
  assert.equal(payment.paymentState(f.r.snapshot().data), "pending");
});
test("mismatched paired responses block rendering bank data and submission", async () => {
  const f = resource("waiting", {
    instructions: async () => ({ ...paymentFixture().instructions, amount: 1 }),
  });
  await f.r.refresh();
  assert.equal(f.r.snapshot().data, undefined);
  assert.equal(await f.r.submit(file), false);
  assert.equal(f.posts.length, 0);
});
test("auth, not found, invalid status, size/type and server/network failures stay distinct", () => {
  for (const [status, expected] of [
    [401, "auth"],
    [403, "auth"],
    [404, "missing"],
    [409, "invalidStatus"],
    [413, "fileSize"],
    [415, "fileType"],
    [502, "upload"],
  ])
    assert.equal(payment.paymentError({ status }), expected);
  assert.equal(payment.paymentError(Error("network")), "network");
});
test("confirmed submission stays pending even if the following refresh fails", async () => {
  let failed = false;
  const f = resource("waiting", {
    order: async () => {
      if (failed) throw Error("offline");
      return paymentFixture().order;
    },
    submit: async () => {
      failed = true;
      return paymentFixture("pending").instructions.latestPayment;
    },
  });
  await f.r.refresh();
  assert.equal(await f.r.submit(file), true);
  assert.equal(f.r.snapshot().sent, true);
  assert.equal(payment.paymentState(f.r.snapshot().data), "pending");
  assert.equal(f.r.snapshot().data.instructions.canSubmit, false);
});
test("RU/UZ receipts render backend sums, status and private proof controls across lifecycle", () => {
  const i18n = load("lib/i18n.ts");
  for (const locale of ["ru", "uz"])
    for (const scenario of [
      "waiting",
      "pending",
      "rejected",
      "approved",
      "final-waiting",
      "final-pending",
      "final-rejected",
      "final-approved",
      "cancelled",
    ]) {
      const globals = {
        require: (name) =>
          name === "react"
            ? React
            : name === "react/jsx-runtime"
              ? jsxRuntime
              : name === "next/link"
                ? {
                    default: ({ children, ...props }) =>
                      React.createElement("a", props, children),
                  }
                : name.includes("PreferencesProvider")
                  ? {
                      usePreferences: () => ({
                        t: (key, values) => i18n.translate(locale, key, values),
                        locale,
                        localizedText: (values) =>
                          i18n.localizedText(locale, values),
                      }),
                    }
                  : name.includes("CartItemCard")
                    ? {
                        CartPhoto: () =>
                          React.createElement("span", null, "TEST PHOTO"),
                      }
                    : name.includes("Brand")
                      ? {
                          Brand: () =>
                            React.createElement("span", null, "STENZO Wear"),
                        }
                      : name.includes("foundation")
                        ? load("components/ui/foundation.tsx", {
                            require: (n) =>
                              n === "react" ? React : jsxRuntime,
                          })
                        : name.includes("ShellActionBar")
                          ? {
                              ShellActionBar: ({ children }) =>
                                React.createElement("div", null, children),
                            }
                          : name.includes("/orders")
                            ? orders
                            : name.includes("/cart")
                              ? cart
                              : payment,
      };
      const { PaymentView } = load(
        "components/payment/PaymentView.tsx",
        globals,
      );
      const data = paymentFixture(scenario);
      const html = renderToStaticMarkup(
        React.createElement(PaymentView, {
          state: { data, loading: false, busy: false },
          submit: async () => true,
          refresh: () => {},
        }),
      );
      assert.ok(html.includes("850 000"));
      assert.ok(
        !html.includes("sourceUrl") && !html.includes("proofStorageKey"),
      );
      const mode = payment.paymentState(data);
      assert.ok(html.includes(i18n.translate(locale, `payment.state.${mode}`)));
      if (scenario.includes("final") && !scenario.includes("approved"))
        assert.ok(html.includes("490 000"));
      if (
        ["pending", "approved", "final-pending", "final-approved"].includes(
          scenario,
        )
      )
        assert.ok(!html.includes('type="file"'));
    }
});
