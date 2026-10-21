export type BotLocale = "uz" | "ru";
type BotTexts = {
  welcome: string;
  openShop: string;
  language: string;
  chooseLanguage: string;
  languageChanged: string;
  unknown: string;
  error: string;
};
export const texts: Record<BotLocale, BotTexts> = {
  uz: {
    welcome:
      "STENZO Wear’ga xush kelibsiz! Do‘konni ochish yoki tilni tanlash uchun quyidagi tugmalardan foydalaning.",
    openShop: "🛍 Do‘konni ochish",
    language: "🌐 Til / Язык",
    chooseLanguage: "Tilni tanlang:",
    languageChanged: "Til o‘zbek tiliga o‘zgartirildi.",
    unknown:
      "Do‘konni ochish yoki tilni tanlash uchun quyidagi tugmalardan foydalaning.",
    error: "Hozircha so‘rovni bajarib bo‘lmadi. Iltimos, qayta urinib ko‘ring.",
  },
  ru: {
    welcome:
      "Добро пожаловать в STENZO Wear! Откройте магазин или выберите язык с помощью кнопок ниже.",
    openShop: "🛍 Открыть магазин",
    language: "🌐 Til / Язык",
    chooseLanguage: "Выберите язык:",
    languageChanged: "Язык изменён на русский.",
    unknown: "Откройте магазин или выберите язык с помощью кнопок ниже.",
    error: "Сейчас не удалось выполнить запрос. Попробуйте ещё раз.",
  },
};
