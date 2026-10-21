import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../../../src/components/AppShell";
import {
  PreferencesProvider,
  usePreferences,
} from "../../../src/components/PreferencesProvider";
import {
  TelegramSessionProvider,
  useTelegramSession,
} from "../../../src/components/TelegramSession";
import { CheckoutPageContent } from "../../../src/components/checkout/CheckoutPageContent";
import { CartPageContent } from "../../../src/components/cart/CartPageContent";
import { PaymentPlaceholder } from "../../../src/components/checkout/PaymentPlaceholder";
import { usePathname, useRouter } from "./mocks.jsx";
import { scenarioCart } from "../cart-preview/data.mjs";
import "../../../src/app/globals.css";
import "../../../src/styles/product-detail.css";
import "../../../src/styles/cart.css";
import "../../../src/styles/checkout.css";
window.checkoutFixtureControl = {
  cart: scenarioCart("normal"),
  mode: "success",
  session: "authenticated",
  path: "/cart",
  orders: new Map(),
  postCount: 0,
};
window.Telegram = {
  WebApp: {
    initData: "",
    platform: "unknown",
    isVersionAtLeast: () => true,
    BackButton: {
      show() {},
      hide() {},
      onClick(handler) {
        window.checkoutFixtureControl.back = handler;
      },
      offClick(handler) {
        if (window.checkoutFixtureControl.back === handler)
          window.checkoutFixtureControl.back = undefined;
      },
    },
  },
};
function Preview() {
  const { setLocale, setThemeMode } = usePreferences();
  const { status, setStatus } = useTelegramSession();
  const [generation, setGeneration] = useState(0);
  const path = usePathname();
  const router = useRouter();
  return (
    <>
      <div className="fixture-toolbar">
        <strong>TEST FIXTURE · no real orders / database writes</strong>
        <div>
          <button onClick={() => setLocale("ru")}>RU</button>
          <button onClick={() => setLocale("uz")}>UZ</button>
          <button onClick={() => setThemeMode("light")}>Light</button>
          <button onClick={() => setThemeMode("dark")}>Dark</button>
          <button onClick={() => setThemeMode("system")}>System</button>
          <select
            aria-label="Fixture scenario"
            onChange={(event) => {
              window.checkoutFixtureControl.cart = scenarioCart(
                event.target.value,
              );
              window.checkoutFixtureControl.orders.clear();
              sessionStorage.removeItem("stenzo.checkout-attempt");
              setGeneration((value) => value + 1);
              router.push("/checkout");
            }}
          >
            <option value="normal">Missing measurements</option>
            <option value="empty">Empty</option>
            <option value="sold-out">Unavailable</option>
          </select>
          <select
            aria-label="Fixture response"
            onChange={(event) =>
              (window.checkoutFixtureControl.mode = event.target.value)
            }
          >
            <option value="success">Success</option>
            <option value="lost">Lost reply</option>
            <option value="stock">Stock conflict</option>
            <option value="variant">Inactive variant</option>
            <option value="product">Inactive product</option>
            <option value="401">401</option>
            <option value="500">500</option>
          </select>
          <select
            aria-label="Fixture session"
            value={status}
            onChange={(event) => {
              window.checkoutFixtureControl.session = event.target.value;
              setStatus(event.target.value);
            }}
          >
            <option value="authenticated">Authenticated</option>
            <option value="outside-telegram">Outside Telegram</option>
            <option value="loading">Pending session</option>
          </select>
          <button onClick={() => window.checkoutFixtureControl.back?.()}>
            Telegram Back
          </button>
          <button
            onClick={() => {
              router.push("/cart");
              setGeneration((value) => value + 1);
            }}
          >
            Cart
          </button>
          <button
            onClick={() => {
              const control = window.checkoutFixtureControl;
              control.cart.items[0].unitPrice += 5000;
              control.cart.items[0].lineTotal =
                control.cart.items[0].unitPrice *
                control.cart.items[0].quantity;
              control.cart.subtotal = control.cart.items.reduce(
                (sum, item) => sum + item.lineTotal,
                0,
              );
            }}
          >
            Change price
          </button>
          <button
            onClick={() => {
              document.documentElement.style.setProperty(
                "--tg-safe-area-inset-top",
                "20px",
              );
              document.documentElement.style.setProperty(
                "--tg-content-safe-area-inset-top",
                "30px",
              );
              document.documentElement.style.setProperty(
                "--tg-safe-area-inset-bottom",
                "34px",
              );
            }}
          >
            Insets
          </button>
        </div>
        <output id="fixture-result" />
      </div>
      <AppShell>
        {path === "/cart" ? (
          <CartPageContent key={generation} />
        ) : path.includes("/payment") ? (
          <PaymentPlaceholder publicId={path.split("/")[2]} />
        ) : (
          <CheckoutPageContent key={generation} />
        )}
      </AppShell>
    </>
  );
}
createRoot(document.getElementById("root")).render(
  <TelegramSessionProvider>
    <PreferencesProvider>
      <Preview />
    </PreferencesProvider>
  </TelegramSessionProvider>,
);
