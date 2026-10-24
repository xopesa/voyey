import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { Blob, File } from "node:buffer";
import ts from "typescript";
import * as shared from "@stenzo/shared";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url),
  base = fileURLToPath(new URL("../src/voyey/", import.meta.url));
function loader(globals = {}, modules = {}) {
  const cache = new Map();
  return function load(path) {
    const file = resolve(base, path);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    runInNewContext(code, {
      exports,
      Blob,
      File,
      Error,
      ...globals,
      require: (name) =>
        Object.prototype.hasOwnProperty.call(modules, name)
          ? modules[name]
          : name === "@stenzo/shared"
            ? shared
            : name === "./assets"
              ? { assets: { logo: "/original-logo.png" } }
              : name.startsWith(".")
                ? load(
                    resolve(
                      dirname(file),
                      name +
                        (existsSync(resolve(dirname(file), name + ".ts"))
                          ? ".ts"
                          : ".tsx"),
                    ),
                  )
                : require(name),
    });
    return exports;
  };
}
const load = loader(),
  d = load("domain.ts"),
  r = load("receipt.ts"),
  f = load("fixtures.ts"),
  i = load("messages.ts"),
  recipient = {
    fullName: "Demo User",
    phone: "+998000000000",
    city: "Demo city",
    address: "Demo location",
    apartment: null,
    comment: null,
  },
  file = { name: "test.png", type: "image/png", size: 100 };
const make = (mode = "PREORDER", percent = 50) =>
  d.checkout(d.initialState(), mode, recipient, "pickup", percent, true, 1000)
    .order;
const pending = (o) => d.submitReceipt(o, "proof", file, 2000);
const approved = (o) => d.reviewReceipt(pending(o), "APPROVED", 3000);
const ui = (reduced = false) =>
  loader(
    {},
    {
      "./motion": {
        useVoyeyMotion: () => ({ reduced }),
        useVoyeyTransition: (duration) => ({
          duration: reduced ? 0.08 : duration,
        }),
        motionTokens: {
          tap: 0.12,
          tab: 0.24,
          page: 0.26,
          dialog: 0.24,
          receipt: 0.62,
          ease: [0.22, 0.8, 0.28, 1],
        },
      },
    },
  )("ReceiptScreen.tsx");
const render = (component, props) =>
  renderToStaticMarkup(React.createElement(component, props));
test("real receipt and order components render pending/rejected without confirmation actions in RU/UZ", () => {
  const components = ui();
  for (const locale of ["ru", "uz"]) {
    const t = i.translator(locale);
    for (const o of [
      make(),
      pending(make()),
      d.reviewReceipt(pending(make()), "REJECTED", 3000),
    ]) {
      const details = render(components.VoyeyOrderDetails, {
          order: o,
          locale,
          t,
          onPayment: () => {},
          onReceipt: () => {},
          onArrival: () => {},
          onFinal: () => {},
        }),
        screen = render(components.VoyeyReceiptScreen, {
          data: r.receiptFor(o),
          locale,
          t,
          exporting: false,
          onExport: () => {},
        });
      assert.ok(screen.includes(t("receiptUnavailable")));
      assert.doesNotMatch(details, /class="vy-receipt-status"/);
      assert.ok(!details.includes(t("receiptFirst")));
      assert.ok(!screen.includes(t("receiptSave")));
    }
    const approvedDetails = render(components.VoyeyOrderDetails, {
      order: approved(make()),
      locale,
      t,
    });
    assert.ok(approvedDetails.includes(t("receiptFirst")));
  }
});
test("printer markup clips paper below body and reduced motion renders ready actions immediately", () => {
  const data = r.receiptFor(approved(make()));
  for (const reduced of [false, true]) {
    const components = ui(reduced),
      html = render(components.VoyeyReceiptScreen, {
        data,
        locale: "ru",
        t: i.translator("ru"),
        exporting: false,
        onExport: () => {},
      });
    assert.match(
      html,
      reduced ? /data-print-state="ready"/ : /data-print-state="printing"/,
    );
    assert.match(html, /vy-printer-body/);
    assert.match(html, /vy-print-window/);
    assert.match(html, /vy-receipt-paper/);
    assert.ok(
      html.indexOf('class="vy-printer-body"') <
        html.indexOf('class="vy-print-window"'),
    );
    if (reduced) {
      assert.ok(html.includes(i.translator("ru")("receiptSave")));
      assert.doesNotMatch(html, /translateY\(-24px\)/);
    } else {
      assert.match(html, /clip-path:inset\(0% 0% 100% 0%\)/);
      assert.ok(!html.includes(i.translator("ru")("receiptSave")));
    }
  }
});
test("approved FIRST and FINAL paper renders correct amounts/status without recipient data in RU/UZ", () => {
  const components = ui(),
    first = approved(make("PREORDER", 100)),
    final = r.confirmDemoFinal(r.recordDemoArrival(first, 10000, 4000), 5000);
  for (const locale of ["ru", "uz"]) {
    const t = i.translator(locale),
      firstHtml = render(components.VoyeyReceiptPaper, {
        data: r.receiptFor(first),
        locale,
        t,
      }),
      finalHtml = render(components.VoyeyReceiptPaper, {
        data: r.receiptFor(final, "SETTLEMENT"),
        locale,
        t,
      });
    assert.ok(firstHtml.includes(t("receiptPrepaid")));
    assert.ok(firstHtml.includes(t("receiptUnknownCargo")));
    assert.ok(!firstHtml.includes(t("receiptSettled")));
    assert.ok(finalHtml.includes(t("receiptSettled")));
    assert.ok(finalHtml.includes(t("receiptFinalPayment")));
    assert.ok(!finalHtml.includes(t("receiptUnknownCargo")));
    assert.doesNotMatch(
      firstHtml + finalHtml,
      /Demo User|Demo location|\+998000000000/,
    );
  }
});
test("receipt never exists for unpaid, pending, rejected, expired or legacy approval without snapshot", () => {
  const o = make();
  assert.equal(r.receiptFor(o), null);
  assert.equal(r.receiptFor(pending(o)), null);
  assert.equal(
    r.receiptFor(d.reviewReceipt(pending(o), "REJECTED", o.expiresAt + 1)),
    null,
  );
  const paid = approved(o);
  assert.equal(r.receiptFor({ ...paid, payments: undefined }), null);
  assert.equal(r.receiptFor({ ...paid, claims: [] }), null);
});
test("IN_STOCK receipt uses confirmed immutable amount, discount, date and only this order", () => {
  const state = d.applyPromo(d.initialState(), "IN_STOCK", "READY10"),
    o = approved(
      d.checkout(state, "IN_STOCK", recipient, "pickup", 100, true, 1000).order,
    ),
    receipt = r.receiptFor(o);
  assert.equal(receipt.status, "receiptPaid");
  assert.equal(receipt.orderId, o.id);
  assert.equal(receipt.subtotal, 138000);
  assert.equal(receipt.discount, 13800);
  assert.equal(receipt.paidAmount, 124200);
  assert.equal(receipt.remaining, 0);
  assert.equal(receipt.confirmedAt, 3000);
  assert.equal(receipt.payments.length, 1);
  assert.equal(receipt.lines.length, 2);
  assert.equal(r.receiptFor(o, "SETTLEMENT"), null);
  receipt.lines[0].nameRu = "changed copy";
  assert.notEqual(o.lines[0].nameRu, receipt.lines[0].nameRu);
});
test("PREORDER 50% odd amount, product/variant/name snapshots survive catalog changes", () => {
  const p = f.products.find((p) => p.id === "markers"),
    price = p.price,
    name = p.nameRu;
  let o;
  try {
    p.price = 101;
    o = approved(make());
    p.price = 1000000;
    p.nameRu = "new catalog name";
    const receipt = r.receiptFor(o);
    assert.equal(receipt.goodsTotal, 101);
    assert.equal(receipt.paidAmount, 51);
    assert.equal(receipt.remaining, 50);
    assert.equal(receipt.cargo, null);
    assert.equal(receipt.total, null);
    assert.equal(receipt.lines[0].nameRu, name);
    assert.equal(receipt.lines[0].unitPrice, 101);
    assert.equal(receipt.status, "receiptPrepaid");
  } finally {
    p.price = price;
    p.nameRu = name;
  }
});
test("PREORDER FIRST100 keeps unknown CARGO and never claims full settlement", () => {
  const receipt = r.receiptFor(approved(make("PREORDER", 100)));
  assert.equal(receipt.status, "receiptPrepaid");
  assert.equal(receipt.remaining, 0);
  assert.equal(receipt.cargo, null);
  assert.equal(receipt.total, null);
  assert.equal(receipt.paidAmount, 72000);
});
test("FINAL with actual CARGO includes only confirmed FIRST and FINAL; old FIRST stays unchanged", () => {
  const o = approved(make()),
    first = JSON.stringify(r.receiptFor(o)),
    arrived = r.recordDemoArrival(o, 17000, 4000);
  assert.equal(r.receiptFor(arrived, "SETTLEMENT"), null);
  const settled = r.confirmDemoFinal(arrived, 5000),
    receipt = r.receiptFor(settled, "SETTLEMENT");
  assert.equal(receipt.status, "receiptSettled");
  assert.equal(receipt.cargo, 17000);
  assert.equal(receipt.total, 89000);
  assert.equal(receipt.paidAmount, 89000);
  assert.equal(receipt.remaining, 0);
  assert.equal(receipt.payments[1].amount, 53000);
  assert.equal(receipt.confirmedAt, 5000);
  assert.equal(JSON.stringify(r.receiptFor(settled)), first);
  assert.equal(r.confirmDemoFinal(settled, 6000), settled);
});
test("FIRST100 and CARGO0 closes without a fictitious zero FINAL", () => {
  const o = r.confirmDemoFinal(
      r.recordDemoArrival(approved(make("PREORDER", 100)), 0, 4000),
      5000,
    ),
    receipt = r.receiptFor(o, "SETTLEMENT");
  assert.equal(o.payments.length, 1);
  assert.equal(receipt.paidAmount, 72000);
  assert.equal(receipt.total, 72000);
  assert.equal(receipt.cargo, 0);
  assert.equal(receipt.remaining, 0);
  assert.equal(receipt.status, "receiptSettled");
});
test("FIRST100 with positive CARGO has only the real simulated positive balance", () => {
  const o = r.confirmDemoFinal(
    r.recordDemoArrival(approved(make("PREORDER", 100)), 10000, 4000),
    5000,
  );
  assert.equal(o.payments[1].amount, 10000);
  assert.equal(r.receiptFor(o, "SETTLEMENT").paidAmount, 82000);
});
test("invalid arrival/settlement does not partially mutate an order", () => {
  const o = approved(make()),
    before = JSON.stringify(o);
  for (const cargo of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
    assert.throws(
      () => r.recordDemoArrival(o, cargo, 4000),
      (e) => e.code === "settlement",
    );
  assert.throws(() => r.recordDemoArrival(o, 0, NaN));
  assert.throws(() => r.recordDemoArrival(make(), 0, 4000));
  assert.throws(() =>
    r.recordDemoArrival(approved(make("IN_STOCK", 100)), 0, 4000),
  );
  assert.throws(() => r.confirmDemoFinal(o, 5000));
  assert.equal(JSON.stringify(o), before);
  const arrived = r.recordDemoArrival(o, 100, 4000);
  assert.equal(r.recordDemoArrival(arrived, 100, 5000), arrived);
  assert.throws(() => r.recordDemoArrival(arrived, 101, 5000));
});
test("forged amounts, mismatched approvals, timestamps and unsettled money are rejected", () => {
  const o = approved(make());
  for (const amount of [0, NaN, Infinity, -1, o.firstAmount + 1])
    assert.equal(
      r.receiptFor({ ...o, payments: [{ ...o.payments[0], amount }] }),
      null,
    );
  assert.equal(
    r.receiptFor({ ...o, payments: [{ ...o.payments[0], confirmedAt: NaN }] }),
    null,
  );
  assert.equal(
    r.receiptFor({ ...o, claims: [{ ...o.claims[0], amount: 1 }] }),
    null,
  );
  assert.equal(r.receiptFor({ ...o, firstAmount: o.firstAmount + 1 }), null);
  assert.equal(
    r.receiptFor({
      ...o,
      claims: [...o.claims, { ...o.claims[0], key: "duplicate" }],
    }),
    null,
  );
  const settled = r.confirmDemoFinal(r.recordDemoArrival(o, 100, 4000), 5000);
  assert.equal(
    r.receiptFor(
      { ...settled, payments: settled.payments.slice(0, 1) },
      "SETTLEMENT",
    ),
    null,
  );
  assert.equal(
    r.receiptFor(
      { ...settled, settlement: { ...settled.settlement, completedAt: NaN } },
      "SETTLEMENT",
    ),
    null,
  );
});
test("FIRST retry rules remain 24h, three accepted attempts, pending hold and one 2h extension", () => {
  let o = pending(make());
  const old = o.expiresAt;
  o = d.reviewReceipt(o, "REJECTED", old + 1);
  assert.equal(d.deadline(o), old + 1 + 7200000);
  o = d.submitReceipt(o, "two", file, old + 2);
  o = d.reviewReceipt(o, "REJECTED", old + 3);
  assert.equal(d.deadline(o), old + 1 + 7200000);
  o = d.submitReceipt(o, "three", file, old + 4);
  o = d.reviewReceipt(o, "REJECTED", old + 5);
  assert.throws(
    () => d.submitReceipt(o, "four", file, old + 6),
    (e) => e.code === "attempts",
  );
  assert.equal(r.receiptFor(o), null);
  assert.equal(o.payments, undefined);
});
test("receipt localization, order identity and summaries do not merge orders or invent CARGO", () => {
  const a = r.receiptFor(approved(make())),
    b = r.receiptFor(approved({ ...make("IN_STOCK", 100), id: "DEMO-OTHER" }));
  assert.notEqual(a.orderId, b.orderId);
  for (const locale of ["ru", "uz"]) {
    const rows = r.receiptAmounts(a, i.translator(locale));
    assert.equal(rows.find((x) => x.id === "cargo").amount, undefined);
    assert.ok(rows.find((x) => x.id === "cargo").text);
    assert.match(r.receiptDate(a.confirmedAt, locale), /1970/);
    assert.match(
      i.translator(locale)("receiptDisclaimer"),
      locale === "ru" ? /фискальным/ : /Fiskal/,
    );
    assert.equal(
      i.translator(locale)("receiptSettled"),
      i.dictionaries[locale].receiptSettled,
    );
  }
});

function exportHarness(navigator = {}) {
  const calls = [],
    canvas = {
      width: 0,
      height: 0,
      toBlob: (callback) =>
        callback(new Blob(["unit-test-render"], { type: "image/png" })),
      getContext: () => ctx,
    },
    ctx = {
      measureText: (s) => ({ width: [...s].length * 7 }),
      scale: () => {},
      fillRect: () => {},
      drawImage: (...args) => calls.push({ image: args.slice(1) }),
      setLineDash: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fillText: (text) => calls.push({ text }),
    },
    anchor = {
      style: {},
      click: () => calls.push({ download: anchor.download }),
      remove: () => calls.push({ removed: true }),
    },
    globals = {
      document: {
        fonts: { ready: Promise.resolve() },
        body: { append: () => {} },
        createElement: (tag) => (tag === "canvas" ? canvas : anchor),
      },
      Image: class {
        naturalWidth = 1448;
        naturalHeight = 1086;
        decode() {
          return Promise.resolve();
        }
      },
      navigator,
      URL: {
        createObjectURL: () => "blob:demo",
        revokeObjectURL: (url) => calls.push({ revoked: url }),
      },
      setTimeout: (fn) => fn(),
    };
  return { api: loader(globals)("receipt-export.ts"), calls, canvas, ctx };
}
test("PNG renderer draws a static paper, original logo and the same snapshot amounts in RU/UZ", async () => {
  for (const locale of ["ru", "uz"]) {
    const h = exportHarness(),
      receipt = r.receiptFor(approved(make())),
      blob = await h.api.receiptPng(receipt, locale, i.translator(locale));
    assert.equal(blob.type, "image/png");
    assert.equal(h.canvas.width, 720);
    assert.ok(h.canvas.height > 1200);
    const texts = h.calls
      .filter((c) => c.text)
      .map((c) => c.text)
      .join(" ");
    assert.ok(texts.includes(receipt.orderId));
    assert.ok(texts.includes(i.translator(locale)("receiptConfirmation")));
    assert.match(texts, /36/);
    assert.doesNotMatch(texts, /Demo User|Demo location|Поделиться|Ulashish/);
    assert.equal(h.calls.filter((c) => c.image).length, 1);
  }
});
test("PNG export fails visibly if Canvas cannot render", async () => {
  const h = exportHarness();
  h.canvas.getContext = () => null;
  await assert.rejects(
    h.api.receiptPng(r.receiptFor(approved(make())), "ru", i.translator("ru")),
    /Canvas unavailable/,
  );
});
test("Save downloads PNG; unsupported Share and throwing canShare fall back to download", async () => {
  for (const nav of [
    {},
    {
      share: async () => {},
      canShare: () => {
        throw Error("unsupported");
      },
    },
  ]) {
    const h = exportHarness(nav);
    assert.equal(
      await h.api.deliverReceipt(new Blob(["png"]), "DEMO-1", "FIRST", true),
      "receiptFallback",
    );
    assert.equal(h.calls.filter((c) => c.download).length, 1);
    assert.equal(
      h.calls.find((c) => c.download).download,
      "VOYEY-DEMO-1-FIRST.png",
    );
    assert.equal(h.calls.filter((c) => c.revoked).length, 1);
  }
  const h = exportHarness();
  assert.equal(
    await h.api.deliverReceipt(new Blob(["png"]), "DEMO-1", "FIRST"),
    "receiptSaved",
  );
});
test("native file Share sends only selected paper, cancellation does not force a download", async () => {
  let sent;
  const h = exportHarness({
    canShare: () => true,
    share: async (data) => {
      sent = data;
    },
  });
  assert.equal(
    await h.api.deliverReceipt(new Blob(["png"]), "DEMO-2", "SETTLEMENT", true),
    "receiptShared",
  );
  assert.equal(sent.files.length, 1);
  assert.equal(sent.files[0].name, "VOYEY-DEMO-2-SETTLEMENT.png");
  assert.equal(h.calls.filter((c) => c.download).length, 0);
  const cancelled = exportHarness({
    canShare: () => true,
    share: async () => {
      const e = Error("cancel");
      e.name = "AbortError";
      throw e;
    },
  });
  assert.equal(
    await cancelled.api.deliverReceipt(
      new Blob(["png"]),
      "DEMO-2",
      "FIRST",
      true,
    ),
    "cancelled",
  );
  assert.equal(cancelled.calls.length, 0);
});
test("failed native share recovers through local PNG download", async () => {
  const h = exportHarness({
    canShare: () => true,
    share: async () => {
      throw Error("not allowed");
    },
  });
  assert.equal(
    await h.api.deliverReceipt(new Blob(["png"]), "DEMO-2", "FIRST", true),
    "receiptShareFailed",
  );
  assert.equal(h.calls.filter((c) => c.download).length, 1);
});
test("long RU/UZ export labels wrap, animation and protected production boundaries stay isolated", () => {
  const h = exportHarness();
  for (const text of [
    "Подтверждённая оплата",
    "Tasdiqlangan to‘lov",
    "Оченьдлинноеназваниетовара",
  ]) {
    const lines = h.api.wrapReceiptText(text, 70, (s) => [...s].length * 7);
    assert.ok(lines.length > 1);
    assert.ok(lines.every((s) => [...s].length <= 10));
  }
  const css = readFileSync(resolve(base, "styles.css"), "utf8"),
    app = readFileSync(resolve(base, "App.tsx"), "utf8"),
    motion = readFileSync(resolve(base, "motion.tsx"), "utf8");
  assert.doesNotMatch(css, /(linear|radial|conic)-gradient\s*\(/i);
  assert.match(css, /--vy-nav-height:\s*78px/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(app, /VoyeyPurchasePortal/);
  assert.match(motion, /MotionConfig/);
  for (const file of ["receipt.ts", "receipt-export.ts", "ReceiptScreen.tsx"])
    assert.doesNotMatch(
      readFileSync(resolve(base, file), "utf8"),
      /\bfetch\s*\(|XMLHttpRequest|sendBeacon|api-client|PaymentLedger|PromoReservation/,
    );
});
