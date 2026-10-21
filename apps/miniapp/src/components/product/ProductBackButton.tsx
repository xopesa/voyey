"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  productReturnHref,
  readProductReturn,
} from "../../lib/product-navigation";
import { usePreferences } from "../PreferencesProvider";
import { IconButton } from "../ui/foundation";
import { Icon } from "../ui/Icon";

export function ProductBackButton() {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = usePreferences();
  const back = useCallback(() => {
    const saved = readProductReturn();
    if (
      saved &&
      pathname === `/catalog/${encodeURIComponent(saved.slug)}` &&
      history.length > saved.historyLength
    )
      router.back();
    else
      router.push(
        productReturnHref(
          new URLSearchParams(window.location.search).get("from"),
        ),
      );
  }, [router, pathname]);
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
      label={t("product.back")}
      onClick={back}
      className="product-back"
    >
      <Icon name="arrow" />
    </IconButton>
  );
}
