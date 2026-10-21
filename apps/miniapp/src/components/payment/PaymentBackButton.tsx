"use client";
import { useCallback, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { usePreferences } from "../PreferencesProvider";
import { IconButton } from "../ui/foundation";
import { Icon } from "../ui/Icon";
import { orderHref } from "../../lib/orders";
export function PaymentBackButton() {
  const router = useRouter();
  const { t } = usePreferences();
  const publicId = usePathname().split("/")[2] ?? "";
  // Orders already exist here. Never return to a form that can create another order.
  const back = useCallback(
    () => router.push(orderHref(publicId)),
    [router, publicId],
  );
  useEffect(() => {
    const webApp = window.Telegram?.WebApp,
      button = webApp?.BackButton;
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
      label={t("payment.toOrder")}
      onClick={back}
      className="product-back"
    >
      <Icon name="arrow" />
    </IconButton>
  );
}
