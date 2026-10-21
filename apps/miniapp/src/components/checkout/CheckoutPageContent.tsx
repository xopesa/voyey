"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CheckoutFlow } from "../../lib/checkout-flow";
import { checkoutAttemptStore, paymentHref } from "../../lib/checkout";
import { submitCheckout } from "../../lib/api-client";
import { readAccessToken } from "../../lib/auth-storage";
import { useCart } from "../cart/useCart";
import { CheckoutView } from "./CheckoutView";
export function CheckoutPageContent() {
  const { state, resource } = useCart();
  const router = useRouter();
  const flow = useMemo(
    () =>
      new CheckoutFlow(
        resource,
        submitCheckout,
        readAccessToken,
        checkoutAttemptStore,
        () => crypto.randomUUID(),
      ),
    [resource],
  );
  const checkout = useSyncExternalStore(
    flow.subscribe,
    flow.snapshot,
    flow.snapshot,
  );
  useEffect(() => {
    if (state.cart) flow.restore(state.cart.id);
  }, [flow, state.cart]);
  useEffect(() => flow.cancel, [flow]);
  useEffect(() => {
    if (checkout.order) router.replace(paymentHref(checkout.order.publicId));
  }, [checkout.order, router]);
  return (
    <CheckoutView
      state={state}
      cartResource={resource}
      checkout={checkout}
      flow={flow}
    />
  );
}
