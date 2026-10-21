import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import type { ReactNode } from "react";

import { CartShell } from "../components/cart/CartShell";
import { CartProvider } from "../components/cart/CartProvider";
import { PreferencesProvider } from "../components/PreferencesProvider";
import { preferenceScript } from "../lib/preferences";
import { TelegramSessionProvider } from "../components/TelegramSession";

import "./globals.css";
import "../styles/catalog.css";
import "../styles/product-detail.css";
import "../styles/cart.css";
import "../styles/checkout.css";
import "../styles/payment.css";
import "../styles/orders.css";

const inter = localFont({
  src: "../fonts/InterVariable.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "STENZO Wear",
  description: "STENZO Wear Telegram Mini App",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="uz" className={inter.variable} suppressHydrationWarning>
      <head>
        <script
          id="stenzo-preferences"
          dangerouslySetInnerHTML={{ __html: preferenceScript }}
        />
      </head>
      <body>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        <TelegramSessionProvider>
          <PreferencesProvider>
            <CartProvider>
              <CartShell>{children}</CartShell>
            </CartProvider>
          </PreferencesProvider>
        </TelegramSessionProvider>
      </body>
    </html>
  );
}
