"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { usePreferences } from "../Preferences";
export function ConfirmAction({
  title,
  children,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = usePreferences();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="confirmation-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="confirmation-title">{title}</h2>
      <div className="confirmation-body">{children}</div>
      <div className="form-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={onCancel}
          autoFocus
        >
          {t("cancel")}
        </button>
        <button className="primary" disabled={busy} onClick={onConfirm}>
          {t(busy ? "working" : "confirm")}
        </button>
      </div>
    </dialog>
  );
}
