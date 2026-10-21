"use client";
import { useEffect, useState } from "react";
import { usePreferences } from "../Preferences";
export function PaymentProof({ paymentId }: { paymentId: string }) {
  const { t } = usePreferences();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setUrl(null);
    setError(false);
    fetch(`/api/admin/payments/${encodeURIComponent(paymentId)}/proof`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) window.location.replace("/admin/login");
        if (
          !response.ok ||
          !["image/jpeg", "image/png", "image/webp"].includes(
            response.headers.get("content-type")?.split(";")[0] ?? "",
          )
        )
          throw new Error("Private proof unavailable");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [paymentId, revision]);
  return (
    <div className="payment-proof">
      <p className="muted">{t("proofPrivate")}</p>
      {error ? (
        <p className="error" role="alert">
          {t("proofError")}{" "}
          <button
            className="quiet"
            onClick={() => setRevision((value) => value + 1)}
          >
            {t("retry")}
          </button>
        </p>
      ) : url ? (
        <img src={url} alt={t("viewProof")} onError={() => setError(true)} />
      ) : (
        <p className="section-empty" role="status">
          {t("proofLoading")}
        </p>
      )}
    </div>
  );
}
