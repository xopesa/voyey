"use client";
import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePreferences } from "../PreferencesProvider";
import { IconButton } from "../ui/foundation";
import { Icon } from "../ui/Icon";
export function OrderBackButton() {
  const router = useRouter(),
    { t } = usePreferences();
  const back = useCallback(() => router.push("/orders"), [router]);
  useEffect(() => {
    const app = window.Telegram?.WebApp,
      button = app?.BackButton;
    if (!button || app?.isVersionAtLeast?.("6.1") === false) return;
    button.show();
    button.onClick(back);
    return () => {
      button.offClick(back);
      button.hide();
    };
  }, [back]);
  return (
    <IconButton
      label={t("orders.back")}
      className="product-back"
      onClick={back}
    >
      <Icon name="arrow" />
    </IconButton>
  );
}
