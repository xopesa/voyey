"use client";
import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePreferences } from "../PreferencesProvider";
import { IconButton } from "../ui/foundation";
import { Icon } from "../ui/Icon";
export function CheckoutBackButton() {
  const router = useRouter();
  const { t } = usePreferences();
  const back = useCallback(() => router.push("/cart"), [router]);
  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    const button = webApp?.BackButton;
    if (!button || webApp?.isVersionAtLeast?.("6.1") === false) return;
    button.show();
    button.onClick(back);
    return () => {
      button.offClick(back);
      button.hide();
    };
  }, [back]);
  return (
    <IconButton
      label={t("checkout.back")}
      onClick={back}
      className="product-back"
    >
      <Icon name="arrow" />
    </IconButton>
  );
}
