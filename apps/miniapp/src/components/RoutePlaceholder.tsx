"use client";

import type { TranslationKey } from "../lib/i18n";
import { usePreferences } from "./PreferencesProvider";
import { Page, Section } from "./ui/foundation";

export function RoutePlaceholder({ titleKey }: { titleKey: TranslationKey }) {
  const { t } = usePreferences();
  return (
    <Page className="route-placeholder">
      <Section>
        <p className="ui-eyebrow">{t("placeholder.eyebrow")}</p>
        <h1 className="ui-heading">{t(titleKey)}</h1>
        <p className="ui-copy">{t("placeholder.message")}</p>
      </Section>
    </Page>
  );
}
