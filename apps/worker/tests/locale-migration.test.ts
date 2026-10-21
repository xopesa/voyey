import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

test("sequential locale migration defaults existing users to UZ and enforces allowed locales", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync(
      new URL("../migrations/", import.meta.url),
    ).sort()) {
      if (file === "0004_user_preferred_locale.sql") {
        sqlite.exec(
          "INSERT INTO User(id, telegramId, languageCode, updatedAt) VALUES('legacy-test', '91003', 'ru', 1)",
        );
      }
      sqlite.exec(
        readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
      );
    }
    assert.equal(
      sqlite
        .prepare("SELECT preferredLocale FROM User WHERE id='legacy-test'")
        .get()!.preferredLocale,
      "uz",
    );
    assert.throws(
      () => sqlite.exec("UPDATE User SET preferredLocale='en'"),
      /CHECK constraint/,
    );
    assert.throws(
      () => sqlite.exec("UPDATE User SET preferredLocale=NULL"),
      /NOT NULL/,
    );
    sqlite.exec("UPDATE User SET preferredLocale='ru'");
    assert.equal(
      sqlite.prepare("SELECT preferredLocale FROM User").get()!.preferredLocale,
      "ru",
    );
  } finally {
    sqlite.close();
  }
});
