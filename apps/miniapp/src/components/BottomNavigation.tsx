"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./ui/Icon";
import { usePreferences } from "./PreferencesProvider";
import type { TranslationKey } from "../lib/i18n";

const items: ReadonlyArray<{
  href: string;
  labelKey: TranslationKey;
  icon: IconName;
}> = [
  { href: "/", labelKey: "nav.home", icon: "home" },
  { href: "/catalog", labelKey: "nav.catalog", icon: "catalog" },
  { href: "/cart", labelKey: "nav.cart", icon: "cart" },
  { href: "/orders", labelKey: "nav.orders", icon: "orders" },
  { href: "/profile", labelKey: "nav.profile", icon: "profile" },
];

export function BottomNavigation({ cartCount = 0 }: { cartCount?: number }) {
  const pathname = usePathname();
  const { t } = usePreferences();
  const count = Number.isFinite(cartCount)
    ? Math.max(0, Math.floor(cartCount))
    : 0;
  return (
    <nav className="bottom-navigation" aria-label={t("nav.label")}>
      {items.map(({ href, labelKey, icon }) => {
        const label = t(labelKey);
        const active =
          href === "/"
            ? pathname === "/"
            : pathname === href || pathname.startsWith(`${href}/`);
        const showBadge = icon === "cart" && count > 0;
        return (
          <Link
            key={href}
            href={href}
            className="bottom-navigation__link"
            data-active={active}
            aria-current={active ? "page" : undefined}
            aria-label={
              showBadge ? t("nav.cartCount", { label, count }) : label
            }
          >
            <span className="bottom-navigation__icon">
              <Icon name={icon} />
              {showBadge && (
                <span className="bottom-navigation__badge" aria-hidden="true">
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </span>
            <span className="bottom-navigation__label" aria-hidden="true">
              <span>{label}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
