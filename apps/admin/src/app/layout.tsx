import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { Preferences, preferenceScript } from "../components/Preferences";

export const metadata: Metadata = {
  title: "STENZO Admin",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: preferenceScript }} />
      </head>
      <body>
        <Preferences>{children}</Preferences>
      </body>
    </html>
  );
}
