"use client";

import { usePreferences } from "./PreferencesProvider";
import { Card, Divider, Page, Section } from "./ui/foundation";
import { ChoiceGroup } from "./ui/ChoiceGroup";
import type { Locale } from "../lib/i18n";
import type { ThemeMode } from "../lib/preferences";

export function ProfileSettings() {
  const { locale, themeMode, setLocale, setThemeMode, t, localeSaveError } =
    usePreferences();
  return (
    <Page className="profile-settings">
      <h1 className="ui-heading">{t("nav.profile")}</h1>
      <Card>
        <Section title={t("settings.title")}>
          <ChoiceGroup<Locale>
            label={t("settings.language")}
            value={locale}
            onChange={setLocale}
            options={[
              {
                value: "ru",
                label: "RU",
                accessibleLabel: t("settings.russian"),
              },
              {
                value: "uz",
                label: "UZ",
                accessibleLabel: t("settings.uzbek"),
              },
            ]}
          />
          {localeSaveError && (
            <p role="alert">{t("settings.localeSaveError")}</p>
          )}
          <Divider />
          <ChoiceGroup<ThemeMode>
            label={t("settings.appearance")}
            value={themeMode}
            onChange={setThemeMode}
            options={[
              { value: "light", label: t("settings.light") },
              { value: "dark", label: t("settings.dark") },
              { value: "system", label: t("settings.system") },
            ]}
          />
          <p className="ui-copy">{t("settings.systemHint")}</p>
        </Section>
      </Card>
    </Page>
  );
}
