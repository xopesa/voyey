"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePreferences } from "./PreferencesProvider";
import { BottomNavigation } from "./BottomNavigation";
import { Brand } from "./Brand";
import { TelegramBootstrap } from "./TelegramBootstrap";
import { TelegramViewport } from "./TelegramViewport";
import { ProductLaunch } from "./ProductLaunch";
import { Page } from "./ui/foundation";
import { Icon } from "./ui/Icon";
import { ProductBackButton } from "./product/ProductBackButton";
import { CheckoutBackButton } from "./checkout/CheckoutBackButton";
import { PaymentBackButton } from "./payment/PaymentBackButton";
import { OrderBackButton } from "./orders/OrderBackButton";

export function AppShell({
  children,
  cartCount,
}: {
  children: ReactNode;
  cartCount?: number;
}) {
  const { t, ready } = usePreferences();
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isProduct = /^\/catalog\/[^/]+$/.test(pathname);
  const isCart = pathname === "/cart";
  const isOrderDetail = /^\/orders\/[^/]+$/.test(pathname);
  const isPayment = /^\/orders\/[^/]+\/payment$/.test(pathname);
  const isCheckout = pathname === "/checkout" || isPayment;
  useEffect(() => {
    if (isProduct || isCart || isCheckout || isOrderDetail)
      document.querySelector(".app-shell__scroll")?.scrollTo({ top: 0 });
  }, [pathname, isProduct, isCart, isCheckout, isOrderDetail]);
  return (
    <div
      className="app-shell"
      data-ready={ready}
      data-product={isProduct}
      data-cart={isCart}
      data-checkout={isCheckout}
      data-payment={isPayment}
      data-order-detail={isOrderDetail}
    >
      <TelegramViewport />
      <ProductLaunch />
      <a className="skip-link" href="#main-content">
        {t("shell.skip")}
      </a>
      <div className="app-shell__scroll">
        <header className="app-shell__header" data-home={isHome}>
          <Page
            className={
              isHome
                ? "home-header"
                : isProduct || isCheckout || isOrderDetail
                  ? "product-header"
                  : undefined
            }
          >
            {isProduct && <ProductBackButton />}
            {isOrderDetail && <OrderBackButton />}
            {isCheckout &&
              (isPayment ? <PaymentBackButton /> : <CheckoutBackButton />)}
            <Brand />
            {isHome && (
              <Link
                href="/catalog"
                className="ui-icon-button"
                aria-label={t("home.search")}
              >
                <Icon name="search" />
              </Link>
            )}
          </Page>
        </header>
        <main id="main-content" tabIndex={-1} className="app-shell__content">
          {children}
        </main>
        <Page className="app-shell__session">
          <TelegramBootstrap />
        </Page>
      </div>
      {!isCheckout && !isOrderDetail && (
        <BottomNavigation cartCount={cartCount} />
      )}
    </div>
  );
}
