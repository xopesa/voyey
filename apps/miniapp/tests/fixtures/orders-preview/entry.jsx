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
import { OrdersPageContent } from "../../../src/components/orders/OrdersPageContent";
import { OrderDetailContent } from "../../../src/components/orders/OrderDetailContent";
import { PaymentPageContent } from "../../../src/components/payment/PaymentPageContent";
import { orderFixtures, orderFixture, statuses } from "./data.mjs";
import { usePathname, useRouter } from "./mocks.jsx";
import "../../../src/app/globals.css";
import "../../../src/styles/product-detail.css";
import "../../../src/styles/cart.css";
import "../../../src/styles/checkout.css";
import "../../../src/styles/payment.css";
import "../../../src/styles/orders.css";
window.ordersFixtureControl = {
  path: "/orders",
  data: orderFixtures(),
  session: "authenticated",
  mode: "success",
  empty: false,
  posts: 0,
};
window.Telegram = {
  WebApp: {
    initData: "",
    platform: "unknown",
    isVersionAtLeast: () => true,
    BackButton: {
      show() {},
      hide() {},
      onClick(fn) {
        window.ordersFixtureControl.back = fn;
      },
      offClick(fn) {
        if (window.ordersFixtureControl.back === fn)
          window.ordersFixtureControl.back = undefined;
      },
    },
  },
};
function Preview() {
  const { setLocale, setThemeMode } = usePreferences(),
    { status, setStatus } = useTelegramSession();
  const [generation, setGeneration] = useState(0);
  const path = usePathname(),
    router = useRouter();
  return (
    <>
      <div className="fixture-toolbar">
        <strong>TEST FIXTURE · no real orders / payments / DB writes</strong>
        <div>
          <button onClick={() => setLocale("ru")}>RU</button>
          <button onClick={() => setLocale("uz")}>UZ</button>
          <button onClick={() => setThemeMode("light")}>Light</button>
          <button onClick={() => setThemeMode("dark")}>Dark</button>
          <button onClick={() => setThemeMode("system")}>System</button>
          <select
            aria-label="Fixture response"
            onChange={(e) => {
              window.ordersFixtureControl.mode = e.target.value;
              setGeneration((g) => g + 1);
            }}
          >
            {["success", "more-error", "401", "404", "500"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="Fixture session"
            value={status}
            onChange={(e) => {
              window.ordersFixtureControl.session = e.target.value;
              setStatus(e.target.value);
            }}
          >
            {["authenticated", "outside-telegram", "loading"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="Fixture order status"
            onChange={(e) => {
              const id = path.split("/")[2] ?? "STZ-FIXTURE-001",
                c = window.ordersFixtureControl,
                index = c.data.findIndex((d) => d.order.publicId === id);
              c.data[index < 0 ? 0 : index] = orderFixture(e.target.value, id);
              router.push(`/orders/${id}`);
              setGeneration((g) => g + 1);
            }}
          >
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button
            onClick={() => {
              window.ordersFixtureControl.empty =
                !window.ordersFixtureControl.empty;
              router.push("/orders");
              setGeneration((g) => g + 1);
            }}
          >
            Toggle empty
          </button>
          <button onClick={() => window.ordersFixtureControl.back?.()}>
            Telegram Back
          </button>
          <button
            onClick={() => {
              const id = path.split("/")[2],
                c = window.ordersFixtureControl,
                index = c.data.findIndex((d) => d.order.publicId === id);
              if (index >= 0)
                c.data[index] = orderFixture("AWAITING_FINAL_PAYMENT", id);
              document.getElementById("fixture-result").textContent =
                "Backend fixture changed to FINAL; refresh to see it";
            }}
          >
            Server FINAL
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
        {path === "/orders" ? (
          <OrdersPageContent key={generation} />
        ) : path.endsWith("/payment") ? (
          <PaymentPageContent key={generation} publicId={path.split("/")[2]} />
        ) : path.startsWith("/orders/") ? (
          <OrderDetailContent key={generation} publicId={path.split("/")[2]} />
        ) : (
          <p>TECHNICAL ROUTE · {path}</p>
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
