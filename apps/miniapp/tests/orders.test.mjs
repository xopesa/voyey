import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { URL, URLSearchParams } from "node:url";
import ts from "typescript";
import * as React from "react";
import * as shared from "@stenzo/shared";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import {
  orderFixture,
  orderFixtures,
  statuses,
} from "./fixtures/orders-preview/data.mjs";
const { Headers, AbortController, setTimeout, clearTimeout } = globalThis;
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
    AbortController,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    ...globals,
  });
  return exports;
}
const checkout = load("lib/checkout.ts"),
  cart = load("lib/cart.ts"),
  catalog = load("lib/catalog.ts"),
  product = load("lib/product.ts", { require: () => catalog }),
  payment = load("lib/payment.ts", { require: () => checkout }),
  orders = load("lib/orders.ts", { require: () => payment });
const { OrdersFeed } = load("lib/orders-feed.ts", { require: () => orders });
test("tracking shows real Admin approval instants in Tashkent and manual ETA in RU/UZ without marking arrival", () => {
  for (const locale of ["ru", "uz"]) {
    const { detail, i18n } = ui(locale);
    const order = {
      ...orderFixture("IN_TRANSIT").order,
      estimatedWarehouseArrival: "2026-11-05",
      paymentConfirmations: { prepayment: "2026-10-21T22:17:00Z", final: null },
    };
    const render = (o) =>
      renderToStaticMarkup(
        React.createElement(detail.OrderTracking, { order: o }),
      );
    assert.equal(payment.isPaymentOrder(order), true);
    const html = render(order);
    assert.ok(html.includes(i18n.translate(locale, "orders.adminConfirmed")));
    assert.ok(html.includes('dateTime="2026-10-21T22:17:00Z"'));
    assert.ok(html.includes("03:17"));
    assert.ok(html.includes(i18n.translate(locale, "orders.tashkentTime")));
    assert.ok(html.includes('dateTime="2026-11-05"'));
    assert.ok(
      html.includes(i18n.translate(locale, "orders.warehouseEstimateHint")),
    );
    assert.ok(!html.includes("10–12"));
    assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
    assert.ok(
      !render({ ...order, status: "ARRIVED" }).includes(
        'dateTime="2026-11-05"',
      ),
    );
    assert.ok(
      !render({ ...order, status: "CANCELLED" }).includes(
        'dateTime="2026-11-05"',
      ),
    );
    assert.ok(
      !render({
        ...order,
        paymentConfirmations: { prepayment: null, final: null },
      }).includes(i18n.translate(locale, "orders.adminConfirmed")),
    );
    assert.ok(
      render({
        ...order,
        status: "PAID_FULL",
        paymentConfirmations: {
          ...order.paymentConfirmations,
          final: "2026-11-06T07:20:00Z",
        },
      }).includes('dateTime="2026-11-06T07:20:00Z"'),
    );
    assert.ok(
      !render({ ...order, status: "AWAITING_PREPAYMENT" }).includes(
        'dateTime="2026-10-21T22:17:00Z"',
      ),
    );
  }
});
test("order guards reject malformed forecast/confirmation dates and private confirmation metadata", () => {
  const order = orderFixture("IN_TRANSIT").order;
  for (const estimatedWarehouseArrival of [
    "2026-02-30",
    "nope",
    42,
    "2026-11-05T00:00:00Z",
  ])
    assert.equal(
      payment.isPaymentOrder({ ...order, estimatedWarehouseArrival }),
      false,
    );
  for (const paymentConfirmations of [
    null,
    { prepayment: "invalid", final: null },
    { prepayment: null },
    { prepayment: null, final: null, reviewedBy: "private" },
  ])
    assert.equal(
      payment.isPaymentOrder({ ...order, paymentConfirmations }),
      false,
    );
});
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
        "./orders": orders,
      })[name],
  });
}
function ui(locale = "ru", globals = {}) {
  const i18n = load("lib/i18n.ts");
  const modules = {
    "@stenzo/shared": shared,
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "next/link": {
      default: ({ children, ...props }) =>
        React.createElement("a", props, children),
    },
    "../PreferencesProvider": {
      usePreferences: () => ({
        locale,
        t: (key, v) => i18n.translate(locale, key, v),
        localizedText: (value) => i18n.localizedText(locale, value),
      }),
    },
    "../cart/CartItemCard": {
      CartPhoto: ({ name }) => React.createElement("span", null, name),
    },
    "../../lib/orders": orders,
    "../../lib/cart": cart,
    ...globals,
  };
  modules["../ui/foundation"] = load("components/ui/foundation.tsx", {
    require: (name) => modules[name],
  });
  const parts = load("components/orders/OrderParts.tsx", {
    require: (name) => modules[name],
  });
  return {
    parts,
    detail: load("components/orders/OrderDetailView.tsx", {
      require: (name) => (name === "./OrderParts" ? parts : modules[name]),
    }),
    i18n,
  };
}
test("customer order guards accept real snapshots, legacy measurements and reject malformed finances/recipient", () => {
  for (const { order } of orderFixtures())
    assert.ok(orders.isCustomerOrder(order));
  const { order } = orderFixture();
  assert.equal(
    orders.isCustomerOrder({ ...order, recipient: undefined }),
    false,
  );
  assert.equal(
    orders.isCustomerOrder({
      ...order,
      recipient: { ...order.recipient, phone: 42 },
    }),
    false,
  );
  assert.equal(
    orders.isCustomerOrder({
      ...order,
      payment: { ...order.payment, amountDue: -1 },
    }),
    false,
  );
  order.items[0].heightCm = null;
  order.items[0].weightKg = null;
  assert.ok(orders.isCustomerOrder(order));
});
test("every backend status has centralized display/action/group mapping and exactly one current timeline stage", () => {
  assert.deepEqual(Object.keys(orders.orderStatusMeta), statuses);
  for (const status of statuses) {
    const timeline = orders.orderTimeline(status);
    assert.equal(timeline.filter((s) => s.state === "current").length, 1);
    assert.equal(timeline.find((s) => s.state === "current").status, status);
    if (status === "CANCELLED") {
      assert.equal(timeline.length, 1);
      assert.equal(timeline[0].state, "current");
    } else {
      const idx = statuses.indexOf(status);
      assert.equal(timeline.filter((s) => s.state === "completed").length, idx);
      assert.equal(
        timeline.filter((s) => s.state === "upcoming").length,
        12 - idx,
      );
    }
  }
});
test("compact filters cover loaded pages and exclude terminal orders from active", () => {
  const data = orderFixtures().map((d) => d.order);
  assert.equal(orders.filterOrders(data, "all").length, 14);
  assert.equal(orders.filterOrders(data, "active").length, 12);
  assert.deepEqual(
    Array.from(orders.filterOrders(data, "completed"), (o) => o.status),
    ["COMPLETED", "CANCELLED"],
  );
});
test("authenticated list/detail use existing proxy contract and URL-encoded cursor/id, no unsupported status filter", async () => {
  const seen = [];
  const c = client(async (path, init) => {
    seen.push({ path, init });
    return {
      ok: true,
      json: async () =>
        path.includes("?")
          ? { orders: [orderFixture().order], nextCursor: null }
          : { order: orderFixture().order },
    };
  });
  await c.getUserOrders("test-token", "cursor+/=1");
  await c.getUserOrder("STZ-FIXTURE-001", "test-token");
  const query = new URL(seen[0].path, "http://local").searchParams;
  assert.equal(query.get("limit"), "12");
  assert.equal(query.get("cursor"), "cursor+/=1");
  assert.equal(query.has("status"), false);
  assert.equal(seen[0].init.headers.get("Authorization"), "Bearer test-token");
  assert.equal(seen[1].path, "/api/orders/STZ-FIXTURE-001");
  assert.equal(seen[1].init.cache, "no-store");
  assert.equal(orders.orderHref("STZ/A"), "/orders/STZ%2FA");
  assert.equal(orders.orderPaymentHref("STZ/A"), "/orders/STZ%2FA/payment");
});
test("malformed list and foreign order acknowledgements reject; HTTP auth/not-found/network remain distinct", async () => {
  const c = client(async () => ({
    ok: true,
    json: async () => ({
      orders: [{ publicId: "fake" }],
      nextCursor: null,
      order: orderFixture().order,
    }),
  }));
  await assert.rejects(c.getUserOrders("token"), /Invalid/);
  await assert.rejects(c.getUserOrder("foreign", "token"), /Invalid/);
  await assert.rejects(c.getUserOrders(""), (e) => e.status === 401);
  for (const [status, type] of [
    [401, "auth"],
    [403, "auth"],
    [404, "missing"],
    [500, "request"],
  ])
    assert.equal(orders.ordersError({ status }), type);
  assert.equal(orders.ordersError(Error("offline")), "request");
});
test("pagination merges by publicId, keeps snapshots and deduplicates overlapping results", async () => {
  const fixtures = orderFixtures(),
    calls = [];
  const feed = new OrdersFeed(async (cursor) => {
    calls.push(cursor);
    return cursor
      ? { orders: [fixtures[0].order, fixtures[1].order], nextCursor: null }
      : { orders: [fixtures[0].order], nextCursor: "page-2" };
  });
  await feed.start();
  await feed.more();
  assert.deepEqual(
    Array.from(feed.snapshot().orders, (o) => o.publicId),
    ["STZ-FIXTURE-001", "STZ-FIXTURE-002"],
  );
  assert.deepEqual(calls, [undefined, "page-2"]);
  assert.equal(feed.snapshot().nextCursor, null);
});
test("next-page error retains prior records/cursor for retry and empty page remains legitimate success", async () => {
  let failed = true;
  const feed = new OrdersFeed(async (cursor) => {
    if (cursor && failed) throw Error("offline");
    return {
      orders: cursor ? [] : [orderFixture().order],
      nextCursor: cursor ? null : "page-2",
    };
  });
  await feed.start();
  await feed.more();
  assert.equal(feed.snapshot().orders.length, 1);
  assert.equal(feed.snapshot().nextCursor, "page-2");
  assert.equal(feed.snapshot().moreError, "request");
  failed = false;
  await feed.more();
  assert.equal(feed.snapshot().nextCursor, null);
  const empty = new OrdersFeed(async () => ({ orders: [], nextCursor: null }));
  await empty.start();
  assert.equal(empty.snapshot().error, undefined);
  assert.equal(empty.snapshot().orders.length, 0);
});
test("refresh cancels stale pagination; double load-more and cyclic cursors are blocked", async () => {
  let resolve;
  const feed = new OrdersFeed(async (cursor) =>
    cursor
      ? await new Promise((yes) => {
          resolve = yes;
        })
      : { orders: [orderFixture().order], nextCursor: "page-2" },
  );
  await feed.start();
  const request = feed.more();
  await feed.more();
  await feed.start();
  resolve({
    orders: [orderFixture("COMPLETED", "stale").order],
    nextCursor: null,
  });
  await request;
  assert.equal(feed.snapshot().orders.length, 1);
  assert.equal(feed.snapshot().orders[0].publicId, "STZ-FIXTURE-001");
  const cyclic = new OrdersFeed(async (cursor) => ({
    orders: [],
    nextCursor: cursor === "page-2" ? "page-3" : "page-2",
  }));
  await cyclic.start();
  await cyclic.more();
  await cyclic.more();
  assert.equal(cyclic.snapshot().moreError, "request");
});
test("cancelled initial request cannot populate data; auth errors have a separate state", async () => {
  let resolve;
  const feed = new OrdersFeed(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  const request = feed.start();
  feed.cancel();
  resolve({ orders: [orderFixture().order], nextCursor: null });
  await request;
  assert.equal(feed.snapshot().orders.length, 0);
  const auth = new OrdersFeed(async () => {
    throw { status: 401 };
  });
  await auth.start();
  assert.equal(auth.snapshot().error, "auth");
  const paginationAuth = new OrdersFeed(async (cursor) => {
    if (cursor) throw { status: 401 };
    return { orders: [orderFixture().order], nextCursor: "page-2" };
  });
  await paginationAuth.start();
  await paginationAuth.more();
  assert.equal(paginationAuth.snapshot().error, "auth");
});

test("focus/visibility revalidation refreshes only visible pages and removes handlers on unmount", () => {
  const handlers = new Map();
  let cleanup,
    requests = 0;
  const events = {
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: (name, fn) => {
      assert.equal(handlers.get(name), fn);
      handlers.delete(name);
    },
  };
  const document = { ...events, visibilityState: "visible" };
  const { useOrdersRefresh } = load("components/orders/useOrdersRefresh.ts", {
    window: events,
    document,
    require: () => ({
      useEffect: (fn) => {
        cleanup = fn();
      },
    }),
  });
  useOrdersRefresh(() => requests++);
  handlers.get("focus")();
  assert.equal(requests, 1);
  document.visibilityState = "hidden";
  handlers.get("visibilitychange")();
  assert.equal(requests, 1);
  document.visibilityState = "visible";
  handlers.get("visibilitychange")();
  assert.equal(requests, 2);
  cleanup();
  assert.equal(handlers.size, 0);
});
test("all statuses render bilingual snapshot data, server amounts, correct payment actions and no private metadata", () => {
  for (const locale of ["ru", "uz"]) {
    const { parts, detail, i18n } = ui(locale);
    for (const status of statuses) {
      const { order } = orderFixture(status);
      order.items[0].sourceUrl = "PRIVATE_SOURCE_DO_NOT_SHOW";
      order.recipient.sourceUrl = "PRIVATE_SOURCE_DO_NOT_SHOW";
      const html = renderToStaticMarkup(
        React.createElement(detail.OrderDetailView, {
          order,
          loading: false,
          refresh: () => {},
        }),
      );
      assert.ok(
        html.includes(
          i18n.translate(locale, orders.orderStatusMeta[status].label),
        ),
      );
      assert.ok(html.includes("850 000"));
      assert.ok(html.includes("425 000"));
      assert.ok(
        html.includes(
          locale === "ru" ? "Худи · снимок заказа" : "Hudi · buyurtma nusxasi",
        ),
      );
      assert.ok(html.includes("TEST ADDRESS 1"));
      assert.ok(!html.includes("PRIVATE_SOURCE_DO_NOT_SHOW"));
      assert.equal(
        html.includes('href="/orders/STZ-FIXTURE-001/payment"'),
        ["AWAITING_PREPAYMENT", "AWAITING_FINAL_PAYMENT"].includes(status),
      );
      assert.equal(html.includes('aria-current="step"'), true);
      if (status === "CANCELLED")
        assert.ok(!html.includes('data-state="completed"'));
      if (status === "IN_TRANSIT") assert.ok(html.includes("10–12"));
      const card = renderToStaticMarkup(
        React.createElement(parts.OrderListCard, { order }),
      );
      assert.ok(card.includes('href="/orders/STZ-FIXTURE-001"'));
      assert.ok(!card.includes("TEST ADDRESS"));
    }
  }
});
test("skeleton/auth/missing/request states render RU/UZ labels without fixtures or fake data", () => {
  for (const locale of ["ru", "uz"]) {
    const { parts, i18n } = ui(locale);
    const skeleton = renderToStaticMarkup(
      React.createElement(parts.OrdersLoading),
    );
    assert.ok(skeleton.includes(i18n.translate(locale, "orders.loading")));
    for (const error of ["auth", "missing", "request"]) {
      const html = renderToStaticMarkup(
        React.createElement(parts.OrdersFailure, { error, retry: () => {} }),
      );
      assert.ok(html.includes('role="alert"'));
      assert.ok(!html.includes("STZ-FIXTURE"));
    }
  }
});
test("Telegram order BackButton binds one safe /orders handler and cleans it up", () => {
  let callback, cleanup;
  const actions = [];
  const ReactStub = {
    ...React,
    useCallback: (fn) => fn,
    useEffect: (fn) => {
      cleanup = fn();
    },
  };
  const { OrderBackButton } = load("components/orders/OrderBackButton.tsx", {
    window: {
      Telegram: {
        WebApp: {
          isVersionAtLeast: () => true,
          BackButton: {
            show: () => actions.push("show"),
            hide: () => actions.push("hide"),
            onClick: (fn) => {
              callback = fn;
            },
            offClick: (fn) => {
              assert.equal(fn, callback);
              actions.push("off");
            },
          },
        },
      },
    },
    require: (name) =>
      name === "react"
        ? ReactStub
        : name === "react/jsx-runtime"
          ? jsxRuntime
          : name === "next/navigation"
            ? { useRouter: () => ({ push: (path) => actions.push(path) }) }
            : name.includes("PreferencesProvider")
              ? { usePreferences: () => ({ t: (key) => key }) }
              : name.includes("foundation")
                ? { IconButton: () => null }
                : { Icon: () => null },
  });
  OrderBackButton();
  callback();
  cleanup();
  assert.deepEqual(actions, ["show", "/orders", "off", "hide"]);
});

test("customer order displays saved promo discount and subtotal separately from payments and cargo in RU/UZ", () => {
  for (const locale of ["ru", "uz"]) {
    const { detail, i18n } = ui(locale);
    const { order } = orderFixture("AWAITING_PREPAYMENT");
    const html = renderToStaticMarkup(
      React.createElement(detail.OrderDetailView, {
        order: {
          ...order,
          subtotal: 900000,
          discountAmount: 50000,
          promoCodeSnapshot: "SAVED10",
        },
        loading: false,
        refresh() {},
      }),
    );
    assert.ok(html.includes("SAVED10"));
    assert.ok(html.includes("900 000"));
    assert.ok(html.includes("50 000"));
    assert.ok(html.includes(i18n.translate(locale, "promo.subtotal")));
    assert.ok(html.includes("850 000"));
  }
});

test("cancelled order RU/UZ exposes reason and refund amount/status only, with no payment action", () => {
  for (const locale of ["ru", "uz"])
    for (const status of ["PENDING", "COMPLETED"]) {
      const { detail } = ui(locale);
      const order = {
        ...orderFixture("CANCELLED").order,
        cancellation: {
          reason: "CUSTOMER_REQUEST",
          cancelledAt: "2026-10-20T00:00:00Z",
          refund: { amount: 145000, status },
        },
      };
      assert.equal(orders.isCustomerOrder(order), true);
      const html = renderToStaticMarkup(
        React.createElement(detail.OrderDetailView, {
          order,
          loading: false,
          refresh() {},
        }),
      );
      assert.ok(
        html.includes(locale === "ru" ? "По просьбе клиента" : "Mijoz so‘rovi"),
      );
      assert.ok(
        html.includes(
          locale === "ru"
            ? status === "PENDING"
              ? "Ожидается возврат"
              : "Возврат выполнен"
            : status === "PENDING"
              ? "Qaytarish kutilmoqda"
              : "Pul qaytarildi",
        ),
      );
      assert.equal(html.includes("/payment"), false);
      assert.equal(
        orders.isCustomerOrder({
          ...order,
          cancellation: { ...order.cancellation, reference: "private" },
        }),
        false,
      );
      assert.equal(
        orders.isCustomerOrder({
          ...order,
          cancellation: {
            ...order.cancellation,
            refund: { amount: -1, status },
          },
        }),
        false,
      );
    }
});
