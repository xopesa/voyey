import type { Locale } from "./i18n";

export function createLocaleSync(dependencies: {
  apply: (locale: Locale) => void;
  save: (locale: Locale) => Promise<Locale>;
  onError: (failed: boolean) => void;
}) {
  let serverLocale: Locale = "uz";
  let revision = 0;
  let queue = Promise.resolve();
  return {
    applyServerLocale(locale: Locale) {
      serverLocale = locale;
      dependencies.apply(locale);
    },
    changeLocale(locale: Locale, authenticated: boolean): Promise<void> {
      const version = ++revision;
      dependencies.apply(locale);
      dependencies.onError(false);
      if (!authenticated) return Promise.resolve();
      // Serialize rapid switches so an older PATCH cannot overwrite the last choice.
      queue = queue.then(async () => {
        try {
          serverLocale = await dependencies.save(locale);
          if (version === revision) dependencies.apply(serverLocale);
        } catch {
          if (version === revision) {
            dependencies.apply(serverLocale);
            dependencies.onError(true);
          }
        }
      });
      return queue;
    },
  };
}
