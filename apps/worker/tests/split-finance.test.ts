import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@stenzo/database";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { runtimeUser } from "./helpers/customer-operations.js";
import {
  D1CartRepository,
  D1OrderRepository,
} from "../../api/src/d1/repositories.js";
import { prepareOrder } from "../../api/src/modules/checkout/domain.js";
import { buildSplitCheckoutPlan } from "../../api/src/modules/checkout/split-plan.js";
import {
  calculateSplitFinance,
  calculateOutstanding,
  parseSplitFinanceSelection,
  type ReceiptAllocation,
} from "../../api/src/modules/checkout/finance.js";
import { SplitFinanceQuotes } from "../../api/src/modules/checkout/finance-quote.js";
import { PromoCodeService } from "../../api/src/modules/marketing/promo-codes.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";

const seed = `INSERT INTO User(id,telegramId,updatedAt) VALUES('u',900091,1);
INSERT INTO Category(id,nameRu,nameUz,slug,requiresBuyerMeasurements,updatedAt) VALUES('c','Fixture','Fixture','c',0,1);
INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('p','c','Fixture','Fixture','p',101,'ACTIVE',1);
INSERT INTO ProductVariant(id,productId,sku,size,stock,preorderEnabled,updatedAt) VALUES('v','p','FIXTURE','',5,1,1);`;
const input = (saleMode?: "IN_STOCK" | "PREORDER") => ({
  productId: "p",
  variantId: "v",
  quantity: 1,
  heightCm: null,
  weightKg: null,
  saleMode,
});
function fixture() {
  const f = isolatedD1();
  f.sqlite.exec(seed);
  return f;
}
async function plan(modes: ("IN_STOCK" | "PREORDER")[]) {
  const repo = new D1CartRepository();
  for (const mode of modes) await repo.addItem("u", input(mode));
  return buildSplitCheckoutPlan(await repo.getOrCreate("u"), randomUUID());
}
const ledger = (
  goodsAmount: number,
  cargoAmount = 0,
  id = "receipt",
): ReceiptAllocation[] => [
  {
    id,
    status: "APPROVED",
    amount: goodsAmount + cargoAmount,
    goodsAmount,
    cargoAmount,
  },
];
const totals = async () => [
  await prisma.order.count(),
  await prisma.orderItem.count(),
  await prisma.payment.count(),
  await prisma.promoCodeRedemption.count(),
  await prisma.auditLog.count(),
];

for (const [mode, percent, first, remainder] of [
  ["IN_STOCK", undefined, 101, 0],
  ["PREORDER", 50, 51, 50],
  ["PREORDER", 100, 101, 0],
] as const) {
  test(`${mode} ${percent ?? 100}% schedule conserves odd UZS total`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        const quote = calculateSplitFinance(await plan([mode]), percent);
        const group = quote.groups[0]!;
        assert.equal(group.firstPaymentAmount, first);
        assert.equal(group.goodsRemainderAfterFirstConfirmation, remainder);
        assert.equal(
          group.firstPaymentAmount + group.goodsRemainderAfterFirstConfirmation,
          101,
        );
        const outstanding = calculateOutstanding(group, [], {
          arrived: false,
          amount: null,
        });
        assert.equal(outstanding.goodsPaid, 0);
        assert.equal(outstanding.firstPaymentDue, first);
        assert.equal(
          outstanding.finalAmountDue,
          mode === "PREORDER" ? null : 0,
        );
        assert.deepEqual(await totals(), [0, 0, 0, 0, 0]);
      });
    } finally {
      f.sqlite.close();
    }
  });
}

for (const percent of [50, 100] as const)
  test(`PREORDER ${percent}% confirmed goods are never charged again; absolute CARGO and receipts are idempotent`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        const group = calculateSplitFinance(await plan(["PREORDER"]), percent)
          .groups[0]!;
        const first = ledger(group.firstPaymentAmount);
        const unknown = calculateOutstanding(group, first, {
          arrived: false,
          amount: null,
        });
        assert.equal(unknown.finalAmountDue, null);
        const known = calculateOutstanding(group, first, {
          arrived: true,
          amount: 17,
        });
        assert.equal(
          known.finalAmountDue,
          group.goodsRemainderAfterFirstConfirmation + 17,
        );
        const all = [
          ...first,
          ...ledger(group.goodsRemainderAfterFirstConfirmation, 17, "final"),
        ];
        const paid = calculateOutstanding(group, all, {
          arrived: true,
          amount: 17,
        });
        assert.equal(paid.finalAmountDue, 0);
        assert.deepEqual(
          calculateOutstanding(group, all, { arrived: true, amount: 17 }),
          paid,
        );
        assert.throws(() =>
          calculateOutstanding(group, [...all, all[0]!], {
            arrived: true,
            amount: 17,
          }),
        );
        assert.throws(() =>
          calculateOutstanding(group, [...all, ...ledger(1, 0, "overpay")], {
            arrived: true,
            amount: 17,
          }),
        );
        assert.throws(() =>
          calculateOutstanding(group, [...all, ...ledger(0, 1, "overcargo")], {
            arrived: true,
            amount: 17,
          }),
        );
        assert.throws(() =>
          calculateOutstanding(group, first, { arrived: false, amount: 17 }),
        );
      });
    } finally {
      f.sqlite.close();
    }
  });

test("submitted/rejected proofs do not count as money and zero CARGO creates no fake payment", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const group = calculateSplitFinance(await plan(["PREORDER"]), 100)
        .groups[0]!;
      assert.throws(
        () =>
          calculateOutstanding(group, [{ ...ledger(101)[0]!, amount: 100 }], {
            arrived: false,
            amount: null,
          }),
        /allocation mismatch/,
      );
      for (const status of ["SUBMITTED", "REJECTED"] as const) {
        const result = calculateOutstanding(
          group,
          [
            {
              id: status,
              status,
              amount: 101,
              goodsAmount: 101,
              cargoAmount: 0,
            },
          ],
          { arrived: false, amount: null },
        );
        assert.equal(result.goodsPaid, 0);
        assert.equal(result.firstPaymentDue, 101);
      }
      assert.equal(
        calculateOutstanding(group, ledger(101), { arrived: true, amount: 0 })
          .finalAmountDue,
        0,
      );
      assert.equal(await prisma.payment.count(), 0);
    });
  } finally {
    f.sqlite.close();
  }
});

test("mixed discount is allocated once, deterministic, conserves money and binds financial selection", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const p = await plan(["IN_STOCK", "PREORDER"]);
      const quote = calculateSplitFinance(p, 50, 3);
      assert.deepEqual(
        quote.groups.map((g) => g.discountAmount),
        [2, 1],
      );
      assert.equal(quote.goodsTotal, 199);
      assert.equal(
        quote.groups.reduce((n, g) => n + g.goodsTotal, 0),
        199,
      );
      const reverse = calculateSplitFinance(
        { ...p, orders: [...p.orders].reverse() },
        50,
        3,
      );
      for (const g of quote.groups)
        assert.deepEqual(
          reverse.groups.find((r) => r.saleMode === g.saleMode),
          g,
        );
      assert.notEqual(
        calculateSplitFinance(p, 100, 3).financialFingerprint,
        quote.financialFingerprint,
      );
      assert.equal(calculateSplitFinance(p, 50, 202).goodsTotal, 0);
      assert.throws(() => calculateSplitFinance(p, 50, 203));
    });
  } finally {
    f.sqlite.close();
  }
});

for (const invalid of [-1, 1.5, NaN, Infinity, 2147483648])
  test(`rejects unsafe money ${invalid}`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        const p = await plan(["IN_STOCK"]);
        assert.throws(() => calculateSplitFinance(p, undefined, invalid));
        const group = calculateSplitFinance(p, undefined).groups[0]!;
        assert.throws(() =>
          calculateOutstanding(group, ledger(invalid), {
            arrived: false,
            amount: null,
          }),
        );
      });
    } finally {
      f.sqlite.close();
    }
  });

test("invalid percentages, client totals, stale line totals and overflow fail closed", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const p = await plan(["IN_STOCK", "PREORDER"]);
      for (const value of [
        { preorderPercent: 75 },
        { firstPaymentAmount: 1 },
        { discountAmount: 100 },
        { goodsPaid: 101 },
        { cargoAmount: 1 },
        { preorderPercent: "50" },
        { preorderPercent: 50, paidAmount: 1 },
      ])
        assert.throws(() => parseSplitFinanceSelection(value));
      assert.throws(() => calculateSplitFinance(p, undefined));
      assert.throws(() =>
        calculateSplitFinance(
          { ...p, orders: [p.orders[0]!], subtotal: 101 },
          50,
        ),
      );
      const broken = structuredClone(p);
      broken.orders[0]!.items[0]!.lineTotal = 1;
      assert.throws(() => calculateSplitFinance(broken, 50));
      const overflow = structuredClone(p);
      overflow.orders[0]!.items[0]!.unitPrice = 2147483647;
      overflow.orders[0]!.items[0]!.quantity = 2;
      assert.throws(() => calculateSplitFinance(overflow, 50));
      const pre = calculateSplitFinance(p, 50).groups[1]!;
      assert.throws(() =>
        calculateOutstanding(pre, [], { arrived: true, amount: 2147483647 }),
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("internal promo quote uses existing limits without redemption; legacy retains 50%", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const repo = new D1CartRepository();
      await repo.addItem("u", input("IN_STOCK"));
      await repo.addItem("u", input("PREORDER"));
      const promos = new PromoCodeService();
      await promos.save(WEB_ADMIN_ACTOR, {
        code: "PLAN10",
        type: "PERCENT",
        value: 10,
        isActive: true,
      });
      const baseline = await totals(),
        key = randomUUID(),
        service = new SplitFinanceQuotes(true);
      const a = await service.quote("u", key, {
        preorderPercent: 50,
        promoCode: "plan10",
      });
      assert.equal(a.finance.discountAmount, 20);
      assert.equal(a.finance.goodsTotal, 182);
      assert.equal(
        a.finance.groups.reduce((n, g) => n + g.discountAmount, 0),
        20,
      );
      assert.deepEqual(
        await service.quote("u", key, {
          preorderPercent: 50,
          promoCode: "PLAN10",
        }),
        a,
      );
      assert.deepEqual(await totals(), baseline);
      await assert.rejects(
        service.quote("u", key, { preorderPercent: 50, promoCode: "MISSING" }),
      );
      await repo.clear("u");
      await repo.addItem("u", input());
      const legacy = await new D1OrderRepository().checkout({
        userId: "u",
        publicId: randomUUID(),
        idempotencyKey: randomUUID(),
        promoCode: "PLAN10",
        recipient: {
          fullName: "Synthetic buyer",
          phone: "+998900000000",
          city: "Fixture",
          address: "Fixture street",
          apartment: null,
          comment: null,
        },
        prepare: prepareOrder,
      });
      assert.equal(legacy.order.total, 91);
      assert.equal(legacy.order.requiredPrepayment, 46);
      await repo.addItem("u", input("PREORDER"));
      const after = await totals();
      await assert.rejects(
        service.quote("u", key, { preorderPercent: 50, promoCode: "PLAN10" }),
        /PROMO_USER_LIMIT/,
      );
      assert.deepEqual(await totals(), after);
    });
  } finally {
    f.sqlite.close();
  }
});

test("new financial write actions stay blocked regardless of Admin access; quote default is disabled", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      for (const enabled of [false, true]) {
        const service = new SplitFinanceQuotes(enabled);
        assert.throws(() => service.confirmPayment(), /Owner identity/);
        assert.throws(() => service.commit(), /blocked/);
      }
      await assert.rejects(
        new SplitFinanceQuotes().quote("u", randomUUID(), {}),
        /disabled/,
      );
      assert.deepEqual(await totals(), [0, 0, 0, 0, 0]);
    });
  } finally {
    f.sqlite.close();
  }
});

test("actual Worker exposes no new financial quote/approval endpoint even to signed Admin", async () => {
  const f = await marketingRuntime();
  try {
    await f.db.exec(seed);
    const user = await runtimeUser(f, 900092);
    for (const [path, headers, origin] of [
      [
        "/checkout/finance",
        { authorization: "Bearer " + user.token },
        "https://preview.invalid",
      ],
      [
        "/admin/split-finance/approve",
        f.signed,
        "https://admin.preview.invalid",
      ],
    ] as const)
      assert.equal(
        (await f.call(path, "POST", { paidAmount: 101 }, headers, origin))
          .status,
        path.startsWith("/admin") ? 403 : 404,
      );
    assert.equal(
      (await f.db
        .prepare("SELECT COUNT(*) n FROM Payment")
        .first<{ n: number }>())!.n,
      0,
    );
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});
