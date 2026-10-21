import assert from "node:assert/strict";
import { test } from "node:test";

import type { Transformer } from "grammy";

import { createStenzoBot } from "../src/bot.js";
import { MemoryBotUsers } from "./helpers.js";

test("/start returns the STENZO greeting and configured Mini App button", async () => {
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const bot = createStenzoBot(
    {
      token: "123456:test-token",
      miniAppUrl: "https://miniapp.stenzo.example",
      users: new MemoryBotUsers(),
    },
    {
      botInfo: {
        id: 123456,
        is_bot: true,
        first_name: "STENZO",
        username: "stenzo_test_bot",
        can_join_groups: false,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: true,
        has_topics_enabled: false,
        allows_users_to_create_topics: false,
        can_manage_bots: false,
        supports_join_request_queries: false,
      },
    },
  );
  const transformer: Transformer = async (_previous, method, payload) => {
    calls.push({
      method,
      payload: payload as unknown as Record<string, unknown>,
    });
    return {
      ok: true,
      result: {
        message_id: 1,
        date: 1,
        chat: { id: 101, type: "private", first_name: "Ali" },
        text: String((payload as { text?: unknown }).text ?? ""),
      },
    } as never;
  };
  bot.api.config.use(transformer);

  await bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: 1,
      chat: { id: 101, type: "private", first_name: "Ali" },
      from: { id: 101, is_bot: false, first_name: "Ali" },
      text: "/start",
      entities: [{ offset: 0, length: 6, type: "bot_command" }],
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "sendMessage");
  assert.match(String(calls[0]!.payload.text), /STENZO Wear/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0]!.payload.reply_markup)), {
    inline_keyboard: [
      [
        {
          text: "🛍 Do‘konni ochish",
          web_app: { url: "https://miniapp.stenzo.example" },
        },
      ],
      [{ text: "🌐 Til / Язык", callback_data: "lang:menu" }],
    ],
  });
});
