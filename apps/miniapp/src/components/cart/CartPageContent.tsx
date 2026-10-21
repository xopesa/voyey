"use client";
import { useCart } from "./useCart";
import { CartView } from "./CartView";
export function CartPageContent() {
  const { state, resource } = useCart();
  return <CartView state={state} resource={resource} />;
}
