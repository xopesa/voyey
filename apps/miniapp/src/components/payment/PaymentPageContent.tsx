"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getPaymentOrder,
  getPaymentInstructions,
  submitPaymentProof,
} from "../../lib/api-client";
import { readAccessToken } from "../../lib/auth-storage";
import {
  PaymentResource,
  readPaymentAttempt,
  writePaymentAttempt,
} from "../../lib/payment-resource";
import { useTelegramSession } from "../TelegramSession";
import { PaymentView, PaymentLoading, PaymentFailure } from "./PaymentView";
function ActivePayment({ publicId }: { publicId: string }) {
  const [resource] = useState(
    () =>
      new PaymentResource(publicId, {
        order: getPaymentOrder,
        instructions: getPaymentInstructions,
        submit: submitPaymentProof,
        token: readAccessToken,
        key: () => crypto.randomUUID(),
        read: readPaymentAttempt,
        write: writePaymentAttempt,
      }),
  );
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  useEffect(() => {
    resource.activate();
    void resource.refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void resource.refresh(true);
    }, 30000);
    return () => {
      clearInterval(timer);
      resource.dispose();
    };
  }, [resource]);
  if (state.loading) return <PaymentLoading />;
  if (!state.data || state.error === "auth" || state.error === "missing")
    return (
      <PaymentFailure
        error={state.error ?? "network"}
        retry={() => void resource.refresh()}
      />
    );
  return (
    <PaymentView
      state={state}
      submit={(file) => resource.submit(file)}
      refresh={() => void resource.refresh()}
    />
  );
}
export function PaymentPageContent({ publicId }: { publicId: string }) {
  const { status } = useTelegramSession();
  if (status === "loading") return <PaymentLoading />;
  if (status !== "authenticated")
    return (
      <PaymentFailure error="auth" retry={() => window.location.reload()} />
    );
  return <ActivePayment key={publicId} publicId={publicId} />;
}
