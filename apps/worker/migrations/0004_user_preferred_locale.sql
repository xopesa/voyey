-- UI language is independent of Telegram language_code metadata.
ALTER TABLE "User" ADD COLUMN "preferredLocale" TEXT NOT NULL DEFAULT 'uz'
  CHECK ("preferredLocale" IN ('uz', 'ru'));
