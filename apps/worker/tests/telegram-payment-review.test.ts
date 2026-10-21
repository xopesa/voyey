import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type {
  Update,
  UserFromGetMe,
  Message,
  InlineKeyboardMarkup,
} from "grammy/types";
import {
  paymentReviewCallback,
  parsePaymentReviewCallback,
  paymentReviewKeyboard,
} from "@stenzo/shared";
import { isolatedD1 } from "./helpers/sqlite.js";
import {
  D1PaymentRepository,
  D1UserRepository,
} from "../../api/src/d1/repositories.js";
import { D1TelegramAdminStore } from "../../api/src/d1/telegram-admins.js";
import { D1NotificationDeliveryStore } from "../../api/src/d1/notification-deliveries.js";
import { D1CustomerNotificationDeliveryStore } from "../../api/src/d1/customer-notification-deliveries.js";
import { PaymentService } from "../../api/src/modules/payments/service.js";
import { PrivateImageStorageService } from "../../api/src/modules/media/service.js";
import { NotificationService } from "../../api/src/modules/notifications/service.js";
import { TelegramNotificationProvider } from "../../api/src/modules/notifications/telegram-provider.js";
import { UserService } from "../../api/src/modules/users/service.js";
import { createStenzoBot } from "../../bot/src/bot.js";
import { png } from "../../api/tests/fixtures/images.js";

type Mode = "success" | "rejected" | "unconfirmed";
async function fixture(
  run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>,
  type: "PREPAYMENT" | "FINAL" = "PREPAYMENT",
  locale: "uz" | "ru" = "uz",
) {
  const db = isolatedD1();
  try {
    await db.run(async () => run(await setup(db, type, locale)));
  } finally {
    db.sqlite.close();
  }
}
async function setup(
  db: ReturnType<typeof isolatedD1>,
  type: "PREPAYMENT" | "FINAL",
  locale: "uz" | "ru",
) {
  const { sqlite } = db;
  sqlite.exec(`INSERT INTO User(id,telegramId,firstName,username,preferredLocale,languageCode,updatedAt) VALUES
    ('buyer','100','Buyer',NULL,'${locale}','${locale === "uz" ? "ru" : "uz"}',1),
    ('admin-one','101','Admin One','same_username','uz','ru',1),
    ('admin-two','102','Admin Two',NULL,'ru','uz',1),
    ('outsider','103','Outsider','same_username','uz','ru',1);
    INSERT INTO TelegramAdmin(id,telegramId,createdBy,createdAt,updatedAt) VALUES('one','101','fixture',1,1),('two','102','fixture',1,1);
    INSERT INTO "Order"(id,publicId,userId,idempotencyKey,status,fullName,phone,city,address,total,subtotal,requiredPrepayment,paidAmount,remainingAmount,cargoAmount,updatedAt)
    VALUES('order','STZ-B32','buyer','fixture-order', '${type === "FINAL" ? "AWAITING_FINAL_PAYMENT" : "AWAITING_PREPAYMENT"}','Buyer','+998900000000','Test','Test',290001,290001,145001,${type === "FINAL" ? 145001 : 0},145000,${type === "FINAL" ? 90000 : "NULL"},1);`);
  const files = new Map<string, Buffer>();
  let readFailure = false,
    reads = 0,
    uploads = 0,
    seq = 0,
    messageId = 0;
  const modes = { admin: "success" as Mode, customer: "success" as Mode };
  const network: {
      method: string;
      chat: string;
      text: string;
      bytes?: Buffer;
      mime?: string;
      keyboard?: InlineKeyboardMarkup;
    }[] = [],
    logs: unknown[] = [];
  const messages = new Map<string, Message.PhotoMessage>();
  const botCalls: { method: string; payload: Record<string, unknown> }[] = [];
  let editFailure = false;
  const provider = new TelegramNotificationProvider(
    "123456:" + randomBytes(32).toString("base64url"),
    async (url, init) => {
      const method = String(url).split("/").at(-1)!;
      let chat: string,
        text: string,
        bytes: Buffer | undefined,
        mime: string | undefined,
        keyboard: InlineKeyboardMarkup | undefined;
      if (method === "sendPhoto") {
        assert.ok(init?.body instanceof FormData);
        chat = String(init.body.get("chat_id"));
        text = String(init.body.get("caption"));
        const file = init.body.get("photo") as File;
        assert.ok(
          file instanceof Blob,
          "Proof must be uploaded as bytes, never a public URL",
        );
        bytes = Buffer.from(await file.arrayBuffer());
        mime = file.type;
        keyboard = JSON.parse(
          String(init.body.get("reply_markup")),
        ) as InlineKeyboardMarkup;
      } else {
        const body = JSON.parse(String(init?.body));
        chat = String(body.chat_id);
        text = body.text;
      }
      network.push({ method, chat, text, bytes, mime, keyboard });
      const mode = chat === "100" ? modes.customer : modes.admin;
      if (mode === "rejected")
        return Response.json(
          { ok: false, error_code: 403, description: "sensitive diagnostic" },
          { status: 403 },
        );
      if (mode === "unconfirmed")
        throw new Error("sensitive transport diagnostic");
      const id = ++messageId;
      if (method === "sendPhoto")
        messages.set(`${chat}:${id}`, {
          message_id: id,
          date: 1,
          chat: { id: Number(chat), type: "private", first_name: "Fixture" },
          caption: text,
          reply_markup: keyboard,
          photo: [
            {
              file_id: "private-upload",
              file_unique_id: "fixture",
              width: 1,
              height: 1,
            },
          ],
        } as Message.PhotoMessage);
      return Response.json({
        ok: true,
        result: { message_id: id, chat: { id: Number(chat) } },
      });
    },
  );
  const notifications = new NotificationService(
    provider,
    new D1TelegramAdminStore(),
    {
      error(...args) {
        logs.push(args);
      },
    },
    {
      deliveryStore: new D1NotificationDeliveryStore(),
      customerDeliveryStore: new D1CustomerNotificationDeliveryStore(),
      adminOrigin: "https://admin.preview.invalid",
    },
  );
  const storage = new PrivateImageStorageService(
    {
      async upload(input) {
        uploads++;
        files.set(input.key, Buffer.from(input.data));
      },
      async delete(key) {
        files.delete(key);
      },
      async read(key) {
        reads++;
        if (readFailure || !files.has(key))
          throw new Error("sensitive private key");
        return files.get(key)!;
      },
    },
    1024,
  );
  const repo = new D1PaymentRepository(),
    service = new PaymentService(
      repo,
      storage,
      {
        cardNumber: "FIXTURE",
        cardHolder: "FIXTURE",
        instructionsRu: "Test",
        instructionsUz: "Test",
      },
      notifications,
    );
  const bot = createStenzoBot(
    {
      token: "123456:" + randomBytes(32).toString("base64url"),
      miniAppUrl: "https://preview.invalid",
      users: new UserService(new D1UserRepository()),
      telegramAdmins: new D1TelegramAdminStore(),
      adminPanelUrl: "https://admin.preview.invalid/admin/",
      paymentReviews: service,
    },
    {
      botInfo: {
        id: 123456,
        is_bot: true,
        first_name: "Test",
        username: "fixture_bot",
      } as UserFromGetMe,
    },
  );
  bot.api.config.use(async (_prev, method, payload) => {
    const body = payload as unknown as Record<string, unknown>;
    botCalls.push({ method, payload: body });
    if (method === "editMessageCaption") {
      if (editFailure) throw new Error("sensitive Telegram edit diagnostic");
      const key = `${body.chat_id}:${body.message_id}`,
        original = messages.get(key)!;
      const updated = {
        ...original,
        caption: String(body.caption),
        reply_markup: body.reply_markup as InlineKeyboardMarkup,
      };
      messages.set(key, updated);
      return { ok: true, result: updated } as never;
    }
    return {
      ok: true,
      result:
        method === "answerCallbackQuery"
          ? true
          : {
              message_id: ++messageId,
              date: 1,
              chat: { id: Number(body.chat_id), type: "private" },
            },
    } as never;
  });
  const submit = () =>
    service.submit("buyer", "STZ-B32", "b32-payment-idempotency-key", {
      data: png,
      declaredMimeType: "image/png",
    });
  const photo = (actor = 101) =>
    [...messages.values()].find((m) => m.chat.id === actor)!;
  const callback = async (
    data: string,
    actor = 101,
    override?: Message.PhotoMessage,
  ) => {
    const message = override ?? photo(actor);
    await bot.handleUpdate({
      update_id: ++seq,
      callback_query: {
        id: String(seq),
        from: {
          id: actor,
          is_bot: false,
          first_name: "Admin",
          username: "same_username",
          language_code: "ru",
        },
        chat_instance: "fixture",
        data,
        message,
      },
    } as Update);
  };
  const click = async (
    action: "a" | "r" | "ca" | "cr" | "b",
    id: string,
    actor = 101,
  ) => callback(paymentReviewCallback(action, id), actor);
  const payment = () => sqlite.prepare("SELECT * FROM Payment").get()!;
  const order = () => sqlite.prepare('SELECT * FROM "Order"').get()!;
  const count = (table: string) =>
    sqlite.prepare(`SELECT count(*) n FROM "${table}"`).get()!.n;
  const receipts = () =>
    sqlite.prepare("SELECT * FROM TelegramNotificationDelivery").all();
  const customer = () => network.filter((n) => n.chat === "100");
  const business = () =>
    ["Payment", "Order", "AuditLog"].map((t) =>
      sqlite.prepare(`SELECT * FROM "${t}" ORDER BY id`).all(),
    );
  return {
    sqlite,
    repo,
    service,
    bot,
    network,
    botCalls,
    modes,
    files,
    logs,
    photo,
    callback,
    click,
    submit,
    payment,
    order,
    count,
    receipts,
    customer,
    business,
    reads: () => reads,
    uploads: () => uploads,
    readFailure: (value: boolean) => {
      readFailure = value;
    },
    editFailure: (value: boolean) => {
      editFailure = value;
    },
  };
}

test("callback format is deterministic, ASCII <64 bytes, strict ID/action parsing", () => {
  for (const action of ["a", "r", "ca", "cr", "b"] as const) {
    const value = paymentReviewCallback(action, "x".repeat(48));
    assert.ok(Buffer.byteLength(value) < 64);
    assert.equal(parsePaymentReviewCallback(value)?.action, action);
  }
  for (const raw of [
    "adm:pay:ca:",
    "adm:pay:ca:../other",
    "adm:pay:a:admin=true",
    "adm:pay:ca:" + "a".repeat(49),
    "adm:pay:approve:id",
    "adm:pay:a:юзер",
    "adm:pay:a:id\n",
  ])
    assert.equal(parsePaymentReviewCallback(raw), null);
});

test("payment submission sends actual private proof photos, UZ/RU captions and keyboards to linked admin locales", async () =>
  fixture(async (f) => {
    const p = await f.submit();
    assert.equal(f.network.length, 2);
    for (const n of f.network) {
      assert.equal(n.method, "sendPhoto");
      assert.deepEqual(n.bytes, png);
      assert.equal(n.mime, "image/png");
      assert.equal(
        (n.keyboard!.inline_keyboard[0]![0]! as { callback_data: string })
          .callback_data,
        paymentReviewCallback("a", p.id),
      );
      assert.equal(
        (n.keyboard!.inline_keyboard[1]![0]! as { url: string }).url,
        "https://admin.preview.invalid/admin/orders/STZ-B32",
      );
      assert.ok(!n.text.includes("payment-proofs/"));
    }
    assert.match(f.network[0]!.text, /To‘lov tasdig‘i olindi/);
    assert.match(f.network[0]!.text, /Oldindan to‘lov/);
    assert.match(f.network[0]!.text, /145 001 UZS/);
    assert.match(f.network[1]!.text, /Получено подтверждение оплаты/);
    assert.match(f.network[1]!.text, /Предоплата/);
    assert.equal(f.receipts().length, 2);
    assert.equal(
      f.reads(),
      1,
      "One saved-proof read is shared by this operation's recipients",
    );
    assert.ok(f.receipts().every((r) => r.status === "SENT"));
  }));

for (const type of ["PREPAYMENT", "FINAL"] as const)
  for (const decision of ["approve", "reject"] as const)
    for (const locale of ["uz", "ru"] as const)
      test(`${type} ${decision} confirmation (${locale}): accounting once, real User reviewer, one customer receipt and audit`, async () =>
        fixture(
          async (f) => {
            const p = await f.submit();
            if (type === "FINAL") {
              for (const n of f.network) {
                assert.match(n.text, /145 000 UZS/);
                assert.match(n.text, /CARGO: 90 000 UZS/);
                assert.match(n.text, /235 000 UZS/);
              }
              assert.match(f.network[0]!.text, /Yakuniy to‘lov/);
              assert.match(f.network[1]!.text, /Финальная оплата/);
            }
            const before = f.business();
            const initial = decision === "approve" ? "a" : "r",
              confirm = decision === "approve" ? "ca" : "cr";
            await f.click(initial, p.id);
            assert.deepEqual(f.business(), before, "first click is read-only");
            assert.ok(
              (
                f.photo().reply_markup!.inline_keyboard[0]![0]! as {
                  callback_data: string;
                }
              ).callback_data === paymentReviewCallback(confirm, p.id),
            );
            if (decision === "approve")
              assert.match(
                f.photo().caption!,
                new RegExp(type === "FINAL" ? "235 000" : "145 001"),
              );
            const confirmation = structuredClone(f.photo());
            await f.click(confirm, p.id);
            assert.equal(
              f.payment().status,
              decision === "approve" ? "APPROVED" : "REJECTED",
            );
            assert.equal(f.payment().reviewedByUserId, "admin-one");
            assert.equal(f.payment().rejectionReason, null);
            assert.equal(
              f.order().status,
              decision === "approve"
                ? type === "FINAL"
                  ? "PAID_FULL"
                  : "AWAITING_PURCHASE"
                : type === "FINAL"
                  ? "AWAITING_FINAL_PAYMENT"
                  : "AWAITING_PREPAYMENT",
            );
            assert.equal(
              f.order().paidAmount,
              decision === "approve"
                ? type === "FINAL"
                  ? 290001
                  : 145001
                : type === "FINAL"
                  ? 145001
                  : 0,
            );
            assert.equal(
              f.order().remainingAmount,
              decision === "approve" && type === "FINAL" ? 0 : 145000,
            );
            assert.equal(
              f.order().cargoPaidAmount,
              decision === "approve" && type === "FINAL" ? 90000 : 0,
            );
            assert.equal(f.customer().length, 1);
            assert.match(
              f.customer()[0]!.text,
              locale === "uz" ? /buyurtmasi/ : /заказ/i,
            );
            assert.equal(f.photo().reply_markup!.inline_keyboard.length, 1);
            assert.ok("url" in f.photo().reply_markup!.inline_keyboard[0]![0]!);
            const audit = f.sqlite
              .prepare("SELECT * FROM AuditLog WHERE action=?")
              .all(
                decision === "approve"
                  ? "payment.approved"
                  : "payment.rejected",
              );
            assert.equal(audit.length, 1);
            assert.equal(audit[0]!.actorId, "admin-one");
            assert.equal(
              f.sqlite
                .prepare(
                  "SELECT count(*) n FROM AuditLog WHERE action='order.status_changed' AND actorId='admin-one'",
                )
                .get()!.n,
              1,
            );
            const after = f.business();
            await f.callback(
              paymentReviewCallback(confirm, p.id),
              101,
              confirmation,
            );
            assert.deepEqual(f.business(), after);
            assert.equal(f.customer().length, 1);
            await f.click(decision === "approve" ? "r" : "a", p.id, 102);
            assert.deepEqual(f.business(), after);
            assert.match(f.photo(102).caption!, /уже обработан/);
            assert.equal(f.photo(102).reply_markup!.inline_keyboard.length, 1);
          },
          type,
          locale,
        ));

for (const action of ["a", "r", "ca", "cr"] as const)
  test(`disabled admin ${action} and matching-username non-admin denied on every callback`, async () =>
    fixture(async (f) => {
      const p = await f.submit(),
        before = f.business();
      const forged = {
        ...f.photo(),
        reply_markup: paymentReviewKeyboard(
          p.id,
          "https://admin.preview.invalid/admin/orders/STZ-B32",
          "uz",
          action === "ca" ? "a" : action === "cr" ? "r" : undefined,
        ),
      };
      await f.callback(paymentReviewCallback(action, p.id), 103, forged);
      assert.deepEqual(f.business(), before);
      f.sqlite.exec(
        "UPDATE TelegramAdmin SET isActive=0 WHERE telegramId='101'",
      );
      await f.callback(paymentReviewCallback(action, p.id), 101, forged);
      assert.deepEqual(f.business(), before);
      assert.equal(
        f.botCalls.filter((c) => c.method === "answerCallbackQuery").length,
        2,
      );
    }));

test("disable between first click and confirmation immediately revokes payment review", async () =>
  fixture(async (f) => {
    const p = await f.submit();
    await f.click("a", p.id);
    f.sqlite.exec("UPDATE TelegramAdmin SET isActive=0 WHERE telegramId='101'");
    const before = f.business();
    await f.click("ca", p.id);
    assert.deepEqual(f.business(), before);
    assert.equal(f.payment().status, "SUBMITTED");
  }));

test("forged ID, unknown payment and confirm not present in message cannot mutate; back restores actions", async () =>
  fixture(async (f) => {
    const p = await f.submit(),
      before = f.business();
    await f.callback("adm:pay:ca:../../invalid");
    await f.click("ca", p.id);
    await f.click("a", "missing-payment");
    assert.deepEqual(f.business(), before);
    await f.click("r", p.id);
    await f.click("b", p.id);
    assert.deepEqual(f.business(), before);
    assert.equal(f.photo().reply_markup!.inline_keyboard[0]!.length, 2);
  }));

test("two admins concurrently confirm opposite decisions: one accounting result and one customer delivery", async () =>
  fixture(async (f) => {
    const p = await f.submit();
    await f.click("a", p.id);
    await f.click("r", p.id, 102);
    await Promise.all([f.click("ca", p.id), f.click("cr", p.id, 102)]);
    assert.ok(["APPROVED", "REJECTED"].includes(String(f.payment().status)));
    assert.equal(f.customer().length, 1);
    assert.equal(
      f.sqlite
        .prepare(
          "SELECT count(*) n FROM AuditLog WHERE action IN ('payment.approved','payment.rejected')",
        )
        .get()!.n,
      1,
    );
    assert.equal(f.photo().reply_markup!.inline_keyboard.length, 1);
    assert.equal(f.photo(102).reply_markup!.inline_keyboard.length, 1);
  }));

for (const mode of ["success", "rejected", "unconfirmed"] as const)
  test(`photo ${mode}: safe replay preserves proof/payment and R3 receipt semantics`, async () =>
    fixture(async (f) => {
      f.modes.admin = mode;
      const p = await f.submit();
      assert.equal(f.count("Payment"), 1);
      assert.equal(f.files.size, 1);
      assert.equal(f.order().status, "PREPAYMENT_SUBMITTED");
      const before = f.business(),
        reads = f.reads();
      f.modes.admin = "success";
      await Promise.all([f.submit(), f.submit()]);
      assert.deepEqual(f.business(), before);
      assert.equal(f.uploads(), 1);
      assert.equal(f.files.size, 1);
      assert.equal(f.network.length, mode === "rejected" ? 4 : 2);
      if (mode === "rejected") {
        // Concurrent replay requests can split recipients between claims;
        // each request reads the saved proof at most once.
        assert.ok(f.reads() > reads && f.reads() <= reads + 2);
      } else assert.equal(f.reads(), reads);
      assert.ok(
        f
          .receipts()
          .every(
            (r) => r.status === (mode === "unconfirmed" ? "FAILED" : "SENT"),
          ),
      );
      assert.ok(
        f.receipts().every((r) => r.eventKey === `payment.submitted:${p.id}`),
      );
      assert.ok(!JSON.stringify(f.logs).includes("sensitive"));
    }));

test("private storage read failure is safely recoverable, never sends text substitute or rolls back committed payment", async () =>
  fixture(async (f) => {
    f.readFailure(true);
    await f.submit();
    assert.equal(f.count("Payment"), 1);
    assert.equal(f.files.size, 1);
    assert.equal(f.network.length, 0);
    assert.ok(
      f
        .receipts()
        .every(
          (r) =>
            r.status === "FAILED" && r.lastErrorCode === "PROOF_UNAVAILABLE",
        ),
    );
    const before = f.business();
    f.readFailure(false);
    await f.submit();
    assert.deepEqual(f.business(), before);
    assert.equal(f.network.length, 2);
    assert.ok(f.network.every((n) => n.method === "sendPhoto"));
    assert.ok(f.receipts().every((r) => r.status === "SENT"));
    assert.ok(!JSON.stringify(f.logs).includes("payment-proofs/"));
  }));

test("post-commit review failure cannot rollback payment and is recovered to the actual processed state", async () =>
  fixture(async (f) => {
    const p = await f.submit();
    await f.click("a", p.id);
    const original = f.service.approve.bind(f.service);
    f.service.approve = async (...args) => {
      const result = await original(...args);
      throw new Error("sensitive post-commit diagnostic " + result.id);
    };
    await f.click("ca", p.id);
    assert.equal(f.payment().status, "APPROVED");
    assert.equal(f.customer().length, 1);
    assert.ok(
      f.botCalls.every((c) => !JSON.stringify(c.payload).includes("sensitive")),
    );
  }));

test("Telegram caption edit failure keeps the review committed and produces only a safe technical reply", async () =>
  fixture(async (f) => {
    const p = await f.submit();
    await f.click("a", p.id);
    f.editFailure(true);
    await f.click("ca", p.id);
    assert.equal(f.payment().status, "APPROVED");
    assert.equal(f.customer().length, 1);
    assert.equal(f.files.size, 1);
    const reply = f.botCalls.filter((c) => c.method === "sendMessage").at(-1)!;
    assert.match(String(reply.payload.text), /Amalni bajarib bo‘lmadi/);
    assert.ok(!String(reply.payload.text).includes("sensitive"));
  }));

test("well-formed nonexistent payment ID never performs a review and returns a safe technical reply", async () =>
  fixture(async (f) => {
    await f.submit();
    const before = f.business();
    const message = {
      ...f.photo(),
      reply_markup: paymentReviewKeyboard(
        "missing-payment",
        "https://admin.preview.invalid/admin/orders/STZ-B32",
        "uz",
      ),
    };
    await f.callback(
      paymentReviewCallback("a", "missing-payment"),
      101,
      message,
    );
    assert.deepEqual(f.business(), before);
    assert.equal(f.customer().length, 0);
    assert.match(
      String(
        f.botCalls.filter((c) => c.method === "sendMessage").at(-1)!.payload
          .text,
      ),
      /Amalni bajarib bo‘lmadi/,
    );
  }));
