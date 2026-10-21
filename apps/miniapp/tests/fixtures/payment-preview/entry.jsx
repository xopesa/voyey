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
import { PaymentPageContent } from "../../../src/components/payment/PaymentPageContent";
import { paymentFixture } from "./data.mjs";
import { usePathname, useRouter } from "./mocks.jsx";
import "../../../src/app/globals.css";
import "../../../src/styles/product-detail.css";
import "../../../src/styles/cart.css";
import "../../../src/styles/checkout.css";
import "../../../src/styles/payment.css";
window.paymentFixtureControl = {
  data: paymentFixture(),
  mode: "success",
  session: "authenticated",
  path: "/orders/STZ-FIXTURE-001/payment",
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
        window.paymentFixtureControl.back = fn;
      },
      offClick(fn) {
        if (window.paymentFixtureControl.back === fn)
          window.paymentFixtureControl.back = undefined;
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
        <strong>TEST FIXTURE · no real payments / database writes</strong>
        <div>
          <button onClick={() => setLocale("ru")}>RU</button>
          <button onClick={() => setLocale("uz")}>UZ</button>
          <button onClick={() => setThemeMode("light")}>Light</button>
          <button onClick={() => setThemeMode("dark")}>Dark</button>
          <button onClick={() => setThemeMode("system")}>System</button>
          <select
            aria-label="Fixture scenario"
            onChange={(e) => {
              window.paymentFixtureControl.data = paymentFixture(
                e.target.value,
              );
              sessionStorage.removeItem("stenzo.payment-attempt");
              setGeneration((g) => g + 1);
              router.push("/orders/STZ-FIXTURE-001/payment");
            }}
          >
            {[
              "waiting",
              "pending",
              "rejected",
              "approved",
              "final-waiting",
              "final-pending",
              "final-rejected",
              "final-approved",
              "cancelled",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="Fixture response"
            onChange={(e) =>
              (window.paymentFixtureControl.mode = e.target.value)
            }
          >
            {[
              "success",
              "lost",
              "401",
              "404",
              "409",
              "413",
              "415",
              "500",
              "502",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="Fixture session"
            value={status}
            onChange={(e) => {
              window.paymentFixtureControl.session = e.target.value;
              setStatus(e.target.value);
            }}
          >
            {["authenticated", "outside-telegram", "loading"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button onClick={() => window.paymentFixtureControl.back?.()}>
            Telegram Back
          </button>
          <button
            onClick={() => {
              window.paymentFixtureControl.data.instructions.amount += 5000;
              window.paymentFixtureControl.data.order.payment.amountDue += 5000;
            }}
          >
            Change amount
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
        {path.includes("/payment") ? (
          <PaymentPageContent key={generation} publicId="STZ-FIXTURE-001" />
        ) : (
          <p>TECHNICAL ORDERS ROUTE · {path}</p>
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
