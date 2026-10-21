"use client";
import { useEffect, useRef } from "react";
import { usePreferences } from "../PreferencesProvider";
import { Button } from "../ui/foundation";

export function CartClearDialog({
  pending,
  error,
  cancel,
  confirm,
}: {
  pending: boolean;
  error?: string;
  cancel: () => void;
  confirm: () => void;
}) {
  const { t } = usePreferences();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="cart-clear-dialog ui-card"
      aria-labelledby="cart-clear-title"
      aria-describedby="cart-clear-hint"
      aria-busy={pending}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) cancel();
      }}
    >
      <h2 id="cart-clear-title">{t("cart.clearTitle")}</h2>
      <p id="cart-clear-hint" className="ui-copy">
        {t("cart.clearHint")}
      </p>
      {error && (
        <p role="alert" className="cart-error">
          {error}
        </p>
      )}
      <div className="cart-clear-dialog__buttons">
        <Button variant="secondary" disabled={pending} onClick={cancel}>
          {t("cart.cancel")}
        </Button>
        <Button disabled={pending} onClick={confirm}>
          {t(pending ? "cart.clearing" : "cart.clearConfirm")}
        </Button>
      </div>
    </dialog>
  );
}
