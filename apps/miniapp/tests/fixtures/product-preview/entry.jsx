// Isolated browser fixture. This entry is never imported by the Next application.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { CartShell as AppShell } from "../../../src/components/cart/CartShell";
import { TelegramSessionProvider } from "../../../src/components/TelegramSession";
import {
  PreferencesProvider,
  usePreferences,
} from "../../../src/components/PreferencesProvider";
import { ProductView } from "../../../src/components/product/ProductView";
import { Page } from "../../../src/components/ui/foundation";
import "../../../src/app/globals.css";
import "../../../src/styles/catalog.css";
import "../../../src/styles/product-detail.css";

const baseProduct = {
  id: "fixture-only",
  slug: "fixture-only",
  nameRu: "Тестовое худи / STENZO",
  nameUz: "Test hudi / STENZO",
  descriptionRu:
    "Изолированный fixture для проверки интерфейса. Это не реальный товар.",
  descriptionUz:
    "Interfeysni tekshirish uchun alohida fixture. Bu haqiqiy mahsulot emas.",
  category: {
    id: "fixture-category",
    nameRu: "Тестовая категория",
    nameUz: "Test toifa",
    slug: "test",
    sortOrder: 0,
  },
  price: 285000,
  currency: "UZS",
  images: [1, 2, 3].map((n) => ({
    id: `photo-${n}`,
    url: `/photo-${n}.svg`,
    sortOrder: n,
    isPrimary: n === 1,
  })),
  variants: [
    {
      id: "s-black",
      sku: "TEST-S",
      size: "S",
      color: "Black",
      stock: 0,
      isAvailable: false,
    },
    {
      id: "m-black",
      sku: "TEST-M",
      size: "M",
      color: "Black",
      stock: 2,
      isAvailable: true,
    },
    {
      id: "l-white",
      sku: "TEST-L",
      size: "L",
      color: "White",
      stock: null,
      isAvailable: true,
    },
  ],
};
window.fixtureControl = {
  response: "success",
  calls: [],
  navigation: "",
  token: true,
};

function Preview() {
  const { setLocale, setThemeMode } = usePreferences();
  const [scenario, setScenario] = useState("normal");
  const [generation, setGeneration] = useState(0);
  const product =
    scenario === "sold-out"
      ? {
          ...baseProduct,
          variants: baseProduct.variants.map((v) => ({
            ...v,
            stock: 0,
            isAvailable: false,
          })),
        }
      : scenario === "no-image"
        ? { ...baseProduct, images: [] }
        : scenario === "broken-image"
          ? {
              ...baseProduct,
              images: [{ ...baseProduct.images[0], url: "/missing-image.svg" }],
            }
          : baseProduct;
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
            value={scenario}
            onChange={(e) => {
              setScenario(e.target.value);
              setGeneration((v) => v + 1);
            }}
          >
            <option value="normal">Normal</option>
            <option value="sold-out">Sold out</option>
            <option value="no-image">No image</option>
            <option value="broken-image">Broken image</option>
          </select>
          <select
            aria-label="Fixture cart response"
            onChange={(e) => {
              window.fixtureControl.response = e.target.value;
            }}
          >
            <option value="success">Success</option>
            <option value="409">409</option>
            <option value="401">401</option>
            <option value="invalid">Invalid confirmation</option>
            <option value="network">Network failure</option>
          </select>
          <button
            onClick={() => {
              window.fixtureControl.token = !window.fixtureControl.token;
              document.getElementById("fixture-token").textContent = window
                .fixtureControl.token
                ? "Token on"
                : "Token off";
            }}
            id="fixture-token"
          >
            Token on
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
        <Page className="product-page">
          <ProductView
            key={`${scenario}-${generation}`}
            product={product}
            reload={() => setGeneration((v) => v + 1)}
          />
        </Page>
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
