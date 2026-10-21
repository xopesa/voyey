"use client";

import type { ReactNode } from "react";
import { ShellActionBar } from "../ui/ShellActionBar";

// The shell owns the viewport. Portal outside its scrolling content keeps this
// bar above the existing navigation, including Telegram insets and resizing.
export function ProductActions({ children }: { children: ReactNode }) {
  return (
    <ShellActionBar
      className="product-actions"
      reserveProperty="--product-action-height"
    >
      {children}
    </ShellActionBar>
  );
}
