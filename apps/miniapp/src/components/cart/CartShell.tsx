"use client";
import type { ReactNode } from "react";
import { AppShell } from "../AppShell";
import { cartItemCount } from "../../lib/cart";
import { useCart } from "./useCart";

export function CartShell({ children }: { children: ReactNode }) {
  const { state } = useCart();
  return <AppShell cartCount={cartItemCount(state.cart)}>{children}</AppShell>;
}
