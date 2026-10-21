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
import { CartPageContent } from "../../../src/components/cart/CartPageContent";
import { scenarioCart } from "./data.mjs";
import "../../../src/app/globals.css";
import "../../../src/styles/catalog.css";
import "../../../src/styles/product-detail.css";
import "../../../src/styles/cart.css";
window.cartFixtureControl = {
  cart: scenarioCart("normal"),
  mode: "success",
  session: "authenticated",
};

function Preview() {
  const { setLocale, setThemeMode } = usePreferences();
  const { status, setStatus } = useTelegramSession();
  const [generation, setGeneration] = useState(0);
  return (
    <>
      <div className="fixture-toolbar">
        <strong>TEST FIXTURE · no database / real cart writes</strong>
        <div>
          <button onClick={() => setLocale("ru")}>RU</button>
          <button onClick={() => setLocale("uz")}>UZ</button>
          <button onClick={() => setThemeMode("light")}>Light</button>
          <button onClick={() => setThemeMode("dark")}>Dark</button>
          <button onClick={() => setThemeMode("system")}>System</button>
          <select
            aria-label="Fixture scenario"
            onChange={(event) => {
              window.cartFixtureControl.cart = scenarioCart(event.target.value);
              setGeneration((value) => value + 1);
            }}
          >
            <option value="normal">Normal</option>
            <option value="empty">Empty</option>
            <option value="stock-changed">Stock changed</option>
            <option value="sold-out">Sold out</option>
            <option value="broken-image">Broken image</option>
            <option value="invalid">Invalid GET</option>
          </select>
          <select
            aria-label="Fixture response"
            onChange={(event) => {
              window.cartFixtureControl.mode = event.target.value;
            }}
          >
            <option value="success">Success</option>
            <option value="409">409</option>
            <option value="401">401</option>
            <option value="500">500</option>
            <option value="unconfirmed">Unconfirmed</option>
          </select>
          <select
            aria-label="Fixture session"
            value={status}
            onChange={(event) => {
              window.cartFixtureControl.session = event.target.value;
              setStatus(event.target.value);
            }}
          >
            <option value="authenticated">Authenticated</option>
            <option value="loading">Pending session</option>
            <option value="outside-telegram">Outside Telegram</option>
            <option value="error">Session error</option>
          </select>
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
        <CartPageContent key={generation} />
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
