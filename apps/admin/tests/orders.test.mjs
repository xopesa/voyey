import { URL, URLSearchParams } from "node:url";
import * as shared from "@stenzo/shared";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const require = createRequire(import.meta.url);
const cache = new Map();
let locale = "ru";
function load(file) {
  const url = new URL(file, import.meta.url);
  if (cache.has(url.href)) return cache.get(url.href);
  const exports = {};
  cache.set(url.href, exports);
  const source = readFileSync(url, "utf8");
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports,
      URL,
      URLSearchParams,
      Intl,
      require: (id) => {
        if (id === "@stenzo/shared") return shared;
        if (id.endsWith("Preferences"))
          return {
            usePreferences: () => ({
              locale,
              t: (key) => load("../src/lib/i18n.ts").messages[locale][key],
            }),
          };
        if (!id.startsWith(".")) return require(id);
        const target = [".ts", ".tsx"]
          .map((extension) => new URL(`${id}${extension}`, url))
          .find((candidate) => existsSync(candidate));
        if (!target) throw new Error(`Unknown test module: ${id}`);
        return load(target.href);
      },
    },
  );
  return exports;
}

const helpers = load("../src/lib/orders.ts");
const order = {
  publicId: "STZ-123",
  status: "AWAITING_PURCHASE",
  total: 1150001,
  requiredPrepayment: 575001,
  cargoAmount: 65000,
  finance: {
    confirmedPrepayment: 575001,
    remainingProducts: 575000,
    finalPaymentTotal: 640000,
  },
  payment: { phase: "FINAL", amountDue: 640000, latestStatus: "SUBMITTED" },
  nextStatus: "PURCHASED",
  canRequestFinalPayment: false,
  recipient: {
    fullName: "Test",
    phone: "+998900000000",
    city: "Test",
    address: "Test",
    apartment: null,
    comment: null,
  },
  customer: { telegramId: "101", username: "test" },
  items: [
    {
      productNameRu: "Снимок",
      productNameUz: "Nusxa",
      sku: "SKU-XL",
      size: "XL",
      color: "Black",
      quantity: 1,
      unitPrice: 850001,
      lineTotal: 850001,
      heightCm: 182,
      weightKg: 79,
      sourceUrl: "https://example.com/private",
      imageUrl: null,
    },
    {
      productNameRu: "Снимок 2",
      productNameUz: "Nusxa 2",
      sku: "SKU-M",
      size: "M",
      color: null,
      quantity: 2,
      unitPrice: 150000,
      lineTotal: 300000,
      heightCm: 168,
      weightKg: 59,
      sourceUrl: null,
      imageUrl: null,
    },
  ],
};

test("filters are encoded and every order/payment state has RU/UZ labels", () => {
  const query = new URL(
    helpers.orderQuery({ search: " STZ-123 ", status: "WEIGHING" }, "cursor"),
    "http://test",
  ).searchParams;
  assert.equal(query.get("search"), "STZ-123");
  assert.equal(query.get("status"), "WEIGHING");
  assert.equal(query.get("cursor"), "cursor");
  const { messages } = load("../src/lib/i18n.ts");
  for (const lang of ["ru", "uz"]) {
    for (const status of helpers.orderStatuses)
      assert.ok(messages[lang][helpers.orderStatusKey(status)]);
    for (const status of ["SUBMITTED", "APPROVED", "REJECTED"])
      assert.ok(messages[lang][helpers.paymentStatusKey(status)]);
    for (const phase of ["PREPAYMENT", "FINAL"])
      assert.ok(messages[lang][helpers.paymentTypeKey(phase)]);
  }
});
test("financial UI displays server amounts and only the server-authorized next action", () => {
  const { OrderFinance } = load("../src/components/orders/OrderFinance.tsx");
  for (const lang of ["ru", "uz"]) {
    locale = lang;
    const html = renderToStaticMarkup(
      createElement(OrderFinance, {
        order,
        disabled: false,
        busy: false,
        perform: async () => {
          throw new Error("No mutation during render");
        },
      }),
    );
    assert.ok(html.includes(helpers.uzs(640000, lang)));
    assert.ok(html.includes(helpers.uzs(575001, lang)));
    assert.ok(!html.includes("<select"));
    assert.equal((html.match(/<button/g) ?? []).length, 1);
    const terminal = renderToStaticMarkup(
      createElement(OrderFinance, {
        order: { ...order, nextStatus: null, canRequestFinalPayment: false },
        disabled: false,
        busy: false,
        perform: async () => false,
      }),
    );
    assert.ok(!terminal.includes("<button"));
    const weighing = renderToStaticMarkup(
      createElement(OrderFinance, {
        order: { ...order, nextStatus: null, canRequestFinalPayment: true },
        disabled: true,
        busy: false,
        perform: async () => false,
      }),
    );
    assert.ok(weighing.includes('pattern="[0-9]+"'));
    assert.ok(weighing.includes("disabled"));
    const awaiting = renderToStaticMarkup(
      createElement(OrderFinance, {
        order: {
          ...order,
          status: "AWAITING_FINAL_PAYMENT",
          nextStatus: null,
          payment: { ...order.payment, latestStatus: null },
        },
        disabled: false,
        busy: false,
        perform: async () => false,
      }),
    );
    assert.ok(
      awaiting.includes(
        load("../src/lib/i18n.ts").messages[lang][
          helpers.orderStatusKey("AWAITING_FINAL_PAYMENT")
        ],
      ),
    );
  }
  locale = "ru";
});
test("each item renders its own snapshot measurements and procurement link opens without referrer", () => {
  const { OrderOverview } = load("../src/components/orders/OrderOverview.tsx");
  for (const lang of ["ru", "uz"]) {
    locale = lang;
    const html = renderToStaticMarkup(createElement(OrderOverview, { order }));
    for (const value of ["182", "79", "168", "59", "SKU-XL", "SKU-M"])
      assert.ok(html.includes(value));
    assert.ok(html.includes('rel="noopener noreferrer"'));
    assert.ok(html.includes('referrerPolicy="no-referrer"'));
    assert.ok(html.includes('target="_blank"'));
    const invalid = renderToStaticMarkup(
      createElement(OrderOverview, {
        order: {
          ...order,
          items: [{ ...order.items[0], sourceUrl: "javascript:alert(1)" }],
        },
      }),
    );
    assert.ok(!invalid.includes('href="javascript:'));
  }
  locale = "ru";
});
test("confirmation dialog names the action and blocks repeated submission while pending", () => {
  const { ConfirmAction } = load("../src/components/orders/ConfirmAction.tsx");
  const html = renderToStaticMarkup(
    createElement(
      ConfirmAction,
      {
        title: "Проверить поступление",
        busy: true,
        onConfirm() {},
        onCancel() {},
      },
      "Проверить банковскую карту",
    ),
  );
  assert.ok(html.includes("<dialog"));
  assert.ok(html.includes("aria-labelledby"));
  assert.ok(html.includes("Проверить банковскую карту"));
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
});

test("discounted order finance shows separate immutable subtotal/code/discount without treating discount as a payment", () => {
  const { OrderFinance } = load("../src/components/orders/OrderFinance.tsx");
  for (const lang of ["ru", "uz"]) {
    locale = lang;
    const html = renderToStaticMarkup(
      createElement(OrderFinance, {
        order: {
          ...order,
          subtotal: 1200001,
          discountAmount: 50000,
          promoCodeSnapshot: "SAVED10",
        },
        disabled: false,
        busy: false,
        perform: async () => {
          throw Error("No mutations during render");
        },
      }),
    );
    assert.ok(html.includes("SAVED10"));
    assert.ok(html.includes(helpers.uzs(1200001, lang)));
    assert.ok(html.includes(helpers.uzs(50000, lang)));
    assert.ok(
      html.includes(helpers.uzs(order.finance.confirmedPrepayment, lang)),
    );
  }
  locale = "ru";
});
