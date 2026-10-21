import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Update, UserFromGetMe } from "grammy/types";
import { createStenzoBot } from "../src/bot.js";
import { MemoryBotUsers } from "./helpers.js";
import { texts } from "../src/texts.js";

function fixture() {
  const users = new MemoryBotUsers(),
    calls: { method: string; payload: Record<string, unknown> }[] = [];
  const roles = new Map<
    string,
    { isActive: boolean; notifyNewOrders: boolean; notifyPayments: boolean }
  >();
  const checked: string[] = [];
  let failed = false;
  const bot = createStenzoBot(
    {
      token: "123456:" + randomBytes(32).toString("base64url"),
      users,
      miniAppUrl: "https://preview.invalid",
      adminPanelUrl: "https://admin.preview.invalid/admin/",
      telegramAdmins: {
        async getByTelegramId(id) {
          checked.push(id);
          if (failed) throw new Error("db down");
          return roles.get(id) ?? null;
        },
      },
    },
    {
      botInfo: {
        id: 123456,
        is_bot: true,
        first_name: "Test",
        username: "test_bot",
      } as UserFromGetMe,
    },
  );
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({
      method,
      payload: payload as unknown as Record<string, unknown>,
    });
    return {
      ok: true,
      result:
        method === "answerCallbackQuery"
          ? true
          : {
              message_id: calls.length,
              date: 1,
              chat: { id: 101, type: "private" },
            },
    } as never;
  });
  let seq = 0;
  const from = {
    id: 101,
    is_bot: false,
    first_name: "Test",
    username: "admin_name",
    language_code: "ru",
  };
  const message = (text: string) =>
    bot.handleUpdate({
      update_id: ++seq,
      message: {
        message_id: seq,
        date: 1,
        from,
        chat: { id: 101, type: "private" },
        text,
        entities: [{ offset: 0, length: text.length, type: "bot_command" }],
      },
    } as Update);
  const callback = (data: string) =>
    bot.handleUpdate({
      update_id: ++seq,
      callback_query: {
        id: String(seq),
        from,
        chat_instance: "test",
        data,
        message: { message_id: 1, date: 1, chat: { id: 101, type: "private" } },
      },
    } as Update);
  return {
    users,
    roles,
    calls,
    checked,
    message,
    callback,
    fail: () => {
      failed = true;
    },
  };
}
test("non-admin /admin and forged callback reveal no internals, normal client start remains UZ", async () => {
  const f = fixture();
  f.roles.set("999", {
    isActive: true,
    notifyNewOrders: true,
    notifyPayments: true,
  });
  await f.message("/admin");
  await f.callback("admin:notifications:999");
  assert.ok(f.calls.every((c) => c.method === "answerCallbackQuery"));
  assert.deepEqual(f.checked, ["101", "101"]);
  await f.message("/start");
  assert.equal(f.calls.at(-1)!.payload.text, texts.uz.welcome);
});
test("active admin gets only panel URL and notification status; every action rereads role", async () => {
  const f = fixture();
  const row = { isActive: true, notifyNewOrders: true, notifyPayments: false };
  f.roles.set("101", row);
  await f.message("/admin");
  const sent = f.calls.at(-1)!.payload;
  assert.equal(sent.text, "STENZO Admin");
  const markup = sent.reply_markup as {
    inline_keyboard: { url?: string; callback_data?: string }[][];
  };
  assert.equal(
    markup.inline_keyboard[0]![0]!.url,
    "https://admin.preview.invalid/admin/",
  );
  assert.equal(
    markup.inline_keyboard[1]![0]!.callback_data,
    "admin:notifications",
  );
  await f.callback("admin:notifications");
  assert.match(String(f.calls.at(-1)!.payload.text), /To‘lovlar: o‘chirilgan/);
  row.isActive = false;
  const sends = () => f.calls.filter((c) => c.method === "sendMessage").length;
  const count = sends();
  await f.message("/admin");
  await f.callback("admin:notifications");
  assert.equal(sends(), count);
  row.isActive = true;
  await f.message("/admin");
  assert.equal(sends(), count + 1);
  assert.equal(f.checked.length, 5);
});
test("unknown admin callbacks cannot mutate anything and role database failure denies safely", async () => {
  const f = fixture();
  f.roles.set("101", {
    isActive: true,
    notifyNewOrders: true,
    notifyPayments: true,
  });
  await f.callback("admin:approve:payment-123");
  assert.equal(f.calls.filter((c) => c.method === "sendMessage").length, 0);
  f.fail();
  await f.message("/admin");
  await f.callback("admin:notifications");
  assert.equal(f.calls.filter((c) => c.method === "sendMessage").length, 0);
});
