import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Update, UserFromGetMe } from "grammy/types";
import { createStenzoBot } from "../src/bot.js";
import { texts } from "../src/texts.js";
import { MemoryBotUsers } from "./helpers.js";

function fixture() {
  const users = new MemoryBotUsers();
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const bot = createStenzoBot(
    {
      token: "123456:" + randomBytes(32).toString("base64url"),
      miniAppUrl: "https://preview.invalid",
      users,
    },
    {
      botInfo: {
        id: 123456,
        is_bot: true,
        first_name: "STENZO test",
        username: "stenzo_test_bot",
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
              text: "test",
            },
    } as never;
  });
  let update = 0;
  const from = {
    id: 101,
    is_bot: false,
    first_name: "Test",
    language_code: "ru",
  };
  const message = (text: string, chatType = "private") =>
    bot.handleUpdate({
      update_id: ++update,
      message: {
        message_id: update,
        date: 1,
        from,
        chat: { id: 101, type: chatType },
        text,
        entities: text.startsWith("/")
          ? [{ offset: 0, length: text.length, type: "bot_command" }]
          : [],
      },
    } as Update);
  const callback = (data: string) =>
    bot.handleUpdate({
      update_id: ++update,
      callback_query: {
        id: String(update),
        from,
        chat_instance: "test",
        data,
        message: { message_id: 1, date: 1, chat: { id: 101, type: "private" } },
      },
    } as Update);
  return { users, calls, message, callback };
}

test("new /start with Telegram RU metadata defaults to UZ; repeated /start is idempotent", async () => {
  const f = fixture();
  await f.message("/start");
  await f.message("/start");
  assert.equal(f.users.profiles.size, 1);
  assert.equal(f.users.profiles.get(101n)!.languageCode, "ru");
  assert.equal(f.users.profiles.get(101n)!.preferredLocale, "uz");
  assert.equal(f.calls.at(-1)!.payload.text, texts.uz.welcome);
});
test("bot UZ/RU selection persists, re-renders menu and survives metadata upsert", async () => {
  const f = fixture();
  await f.message("/language");
  assert.equal(f.calls.at(-1)!.payload.text, texts.uz.chooseLanguage);
  await f.callback("lang:ru");
  assert.equal(f.users.profiles.get(101n)!.preferredLocale, "ru");
  assert.equal(f.calls.at(-1)!.payload.text, texts.ru.languageChanged);
  await f.message("/start");
  assert.equal(f.calls.at(-1)!.payload.text, texts.ru.welcome);
  await f.callback("lang:menu");
  assert.equal(f.calls.at(-1)!.payload.text, texts.ru.chooseLanguage);
  await f.callback("lang:uz");
  assert.equal(f.calls.at(-1)!.payload.text, texts.uz.languageChanged);
  assert.equal(f.users.profiles.get(101n)!.preferredLocale, "uz");
  assert.equal(f.users.profiles.size, 1);
});
test("invalid callback cannot choose a locale or target someone else's User", async () => {
  const f = fixture();
  await f.callback("lang:en");
  await f.callback("lang:ru:other-user");
  assert.equal(f.users.profiles.get(101n)!.preferredLocale, "uz");
  assert.equal(
    f.calls.filter((c) => c.method === "answerCallbackQuery").length,
    2,
  );
});
test("group updates and blocked users cannot change preferences or open personal Web Apps", async () => {
  const f = fixture();
  await f.message("/start", "group");
  assert.equal(f.users.profiles.size, 0);
  await f.message("/start");
  f.users.profiles.get(101n)!.status = "BLOCKED";
  f.calls.length = 0;
  await f.callback("lang:ru");
  assert.equal(f.users.profiles.get(101n)!.preferredLocale, "uz");
  assert.equal(f.calls.filter((c) => c.method === "sendMessage").length, 0);
});
