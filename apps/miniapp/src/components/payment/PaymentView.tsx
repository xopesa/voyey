"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../PreferencesProvider";
import { Brand } from "../Brand";
import { CartPhoto } from "../cart/CartItemCard";
import { Button, Card, Page, Skeleton } from "../ui/foundation";
import { ShellActionBar } from "../ui/ShellActionBar";
import { formatCartAmount } from "../../lib/cart";
import { paymentState, proofError, type PaymentError } from "../../lib/payment";
import type { PaymentSnapshot } from "../../lib/payment-resource";
import { orderHref as detailHref } from "../../lib/orders";
export function PaymentLoading() {
  const { t } = usePreferences();
  return (
    <Page
      className="payment-page"
      role="status"
      aria-label={t("payment.loading")}
    >
      <Skeleton className="payment-skeleton" />
      <Skeleton className="payment-skeleton payment-skeleton--small" />
    </Page>
  );
}
export function PaymentFailure({
  error,
  retry,
}: {
  error: PaymentError;
  retry: () => void;
}) {
  const { t } = usePreferences();
  return (
    <Page className="payment-page">
      <Card className="cart-state" role="alert">
        <h1>{t(error === "auth" ? "cart.authTitle" : "payment.errorTitle")}</h1>
        <p>{t(`payment.error.${error}`)}</p>
        <Button onClick={retry}>{t("home.retry")}</Button>
        <Link className="ui-button ui-button--secondary" href="/orders">
          {t("nav.orders")}
        </Link>
      </Card>
    </Page>
  );
}
export function PaymentView({
  state,
  submit,
  refresh,
}: {
  state: PaymentSnapshot;
  submit: (file: File) => Promise<boolean>;
  refresh: () => void;
}) {
  const { t, locale, localizedText } = usePreferences();
  const data = state.data!;
  const { order, instructions } = data;
  const mode = paymentState(data),
    pending = mode === "pending",
    approved = mode === "approvedPrepayment" || mode === "approvedFinal";
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [fileIssue, setFileIssue] = useState<PaymentError>();
  const [copy, setCopy] = useState<"done" | "error">();
  const [retryProof, setRetryProof] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const errorBlock = useRef<HTMLDivElement>(null);
  const statusBlock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state.error) return;
    errorBlock.current?.focus({ preventScroll: true });
    errorBlock.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state.error]);
  useEffect(() => {
    if (state.sent)
      statusBlock.current?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
  }, [state.sent]);
  const format = (value: number) => formatCartAmount(value, t("cart.currency"));
  const identity = `${instructions.phase}:${instructions.amount}:${instructions.latestPayment?.id ?? ""}:${instructions.latestPaymentStatus ?? ""}`;
  useEffect(() => {
    setFile(undefined);
    setFileIssue(undefined);
    setRetryProof(false);
  }, [identity]);
  useEffect(() => {
    if (!file) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!copy) return;
    const timer = setTimeout(() => setCopy(undefined), 3500);
    return () => clearTimeout(timer);
  }, [copy]);
  const showForm =
    instructions.canSubmit &&
    (mode === "waiting" || (mode === "rejected" && retryProof));
  const phaseLabel =
    (instructions.phase ?? instructions.latestPayment?.type) === "FINAL"
      ? "payment.final"
      : "payment.prepayment";
  const max = instructions.maxProofUploadSize / (1024 * 1024);
  const orderHref = detailHref(order.publicId);
  return (
    <Page className="payment-page">
      <header className="payment-heading">
        <p className="ui-eyebrow">{t("payment.eyebrow")}</p>
        <h1>{t("payment.title")}</h1>
      </header>
      <Card className="payment-receipt">
        <div className="payment-receipt__brand">
          <Brand />
          <span>{t("payment.receipt")}</span>
        </div>
        <div className="payment-receipt__meta">
          <span>{order.publicId}</span>
          <time dateTime={order.createdAt}>
            {new Intl.DateTimeFormat(locale === "uz" ? "uz-Latn-UZ" : "ru-RU", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            }).format(new Date(order.createdAt))}
          </time>
        </div>
        <div className="payment-receipt__amount">
          <p>{t(phaseLabel)}</p>
          <span>{t(approved ? "payment.confirmedAmount" : "payment.due")}</span>
          <strong>
            {format(
              approved
                ? instructions.latestPayment!.expectedAmount
                : instructions.amount,
            )}
          </strong>
        </div>
        <dl className="payment-breakdown">
          <div>
            <dt>{t("cart.fullTotal")}</dt>
            <dd>{format(order.total)}</dd>
          </div>
          <div>
            <dt>{t("payment.paid")}</dt>
            <dd>{format(order.paidAmount)}</dd>
          </div>
          {(instructions.phase === "FINAL" || mode === "approvedFinal") && (
            <>
              <div>
                <dt>{t("checkout.remaining")}</dt>
                <dd>{format(order.remainingAmount)}</dd>
              </div>
              <div>
                <dt>{t("payment.cargo")}</dt>
                <dd>
                  {order.cargoAmount === null
                    ? t("payment.notSet")
                    : format(order.cargoAmount)}
                </dd>
              </div>
              <div>
                <dt>{t("payment.cargoPaid")}</dt>
                <dd>{format(order.cargoPaidAmount)}</dd>
              </div>
            </>
          )}
        </dl>
        <div
          ref={statusBlock}
          className="payment-status"
          data-state={mode}
          role="status"
        >
          <div className="payment-status__steps" aria-hidden="true">
            <span data-active="true">1</span>
            <i />
            <span data-active={pending || approved}>2</span>
            <i />
            <span data-active={approved}>{approved ? "✓" : "3"}</span>
          </div>
          <h2>{t(`payment.state.${mode}`)}</h2>
          {pending && (
            <>
              <p className="payment-review-label">{t("payment.review")}</p>
              <p>{t("payment.pendingHint")}</p>
            </>
          )}
          {approved && <p>{t(`payment.orderStatus.${order.status}`)}</p>}
          {mode === "rejected" && (
            <>
              <p>
                {instructions.latestPayment?.rejectionReason ||
                  t("payment.rejectedHint")}
              </p>
              <Button
                variant="secondary"
                disabled={state.busy}
                onClick={() => setRetryProof(true)}
              >
                {t("payment.newProof")}
              </Button>
            </>
          )}
          {mode === "unavailable" && (
            <p>{t(`payment.orderStatus.${order.status}`)}</p>
          )}
        </div>
      </Card>
      {state.error && (
        <div ref={errorBlock} tabIndex={-1}>
          <Card className="payment-error" role="alert">
            <p>{t(`payment.error.${state.error}`)}</p>
            <Button variant="secondary" disabled={state.busy} onClick={refresh}>
              {t("payment.refresh")}
            </Button>
          </Card>
        </div>
      )}
      {showForm && (
        <>
          <Card className="payment-bank">
            <h2>{t("payment.details")}</h2>
            <p className="payment-bank__number">
              {instructions.cardNumber || t("payment.notSet")}
            </p>
            <p className="payment-bank__holder">
              {instructions.cardHolder || t("payment.notSet")}
            </p>
            <Button
              variant="secondary"
              disabled={!instructions.cardNumber || state.busy}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    instructions.cardNumber.replace(/\s/g, ""),
                  );
                  setCopy("done");
                } catch {
                  setCopy("error");
                }
              }}
            >
              {t("payment.copyCard")}
            </Button>
            <span role="status">
              {copy
                ? t(copy === "done" ? "payment.copied" : "payment.copyError")
                : ""}
            </span>
            <p>
              {localizedText({
                ru: instructions.instructionsRu,
                uz: instructions.instructionsUz,
              })}
            </p>
            <div className="payment-bank__due">
              <span>{t("payment.due")}</span>
              <strong>{format(instructions.amount)}</strong>
            </div>
          </Card>
          <Card className="payment-proof">
            <h2>{t("payment.uploadTitle")}</h2>
            <p>
              {t("payment.fileHint", {
                max: new Intl.NumberFormat(
                  locale === "uz" ? "uz-Latn-UZ" : "ru-RU",
                  { maximumFractionDigits: 2 },
                ).format(max),
              })}
            </p>
            <input
              ref={input}
              type="file"
              hidden
              accept="image/jpeg,image/png,image/webp"
              aria-label={t("payment.choose")}
              disabled={state.busy}
              onChange={(event) => {
                const candidate = event.target.files?.[0];
                event.target.value = "";
                if (!candidate) return;
                const issue = proofError(
                  candidate,
                  instructions.maxProofUploadSize,
                );
                setFileIssue(issue ?? undefined);
                setFile(issue ? undefined : candidate);
              }}
            />
            {preview && (
              <div className="payment-proof__preview">
                {/* Local blob only; proof never receives a public storage URL. */}
                <img src={preview} alt={t("payment.preview")} />
              </div>
            )}
            {file && <p className="payment-proof__filename">{file.name}</p>}
            {fileIssue && (
              <p className="payment-error__text" role="alert">
                {t(`payment.error.${fileIssue}`)}
              </p>
            )}
            <Button
              variant="secondary"
              disabled={state.busy}
              onClick={() => input.current?.click()}
            >
              {t(file ? "payment.replace" : "payment.choose")}
            </Button>
            <p className="payment-proof__privacy">
              {t("payment.proofPrivacy")}
            </p>
          </Card>
          <ShellActionBar
            className="checkout-actions payment-actions"
            reserveProperty="--checkout-action-height"
          >
            <Button
              disabled={
                !file ||
                state.busy ||
                !instructions.cardNumber ||
                !instructions.cardHolder
              }
              onClick={() => {
                if (file) void submit(file);
              }}
              aria-busy={state.busy}
            >
              {t(state.busy ? "payment.sending" : "payment.send")}
            </Button>
          </ShellActionBar>
        </>
      )}
      <Card className="payment-context">
        <div className="payment-context__photos">
          {order.items.slice(0, 2).map((item, index) => (
            <div key={index}>
              <CartPhoto
                src={item.imageUrl ?? undefined}
                name={localizedText({
                  ru: item.productNameRu,
                  uz: item.productNameUz,
                })}
              />
            </div>
          ))}
        </div>
        <div>
          <h2>{t("payment.orderContext")}</h2>
          <p>{t("cart.count", { count: order.items.length })}</p>
          <strong>{format(order.total)}</strong>
        </div>
      </Card>
      <div className="payment-links">
        <Button variant="secondary" disabled={state.busy} onClick={refresh}>
          {t("payment.refresh")}
        </Button>
        <Link
          href={orderHref}
          className="ui-button ui-button--secondary"
          aria-disabled={state.busy}
          onClick={(event) => {
            if (state.busy) event.preventDefault();
          }}
        >
          {t("payment.toOrder")}
        </Link>
      </div>
    </Page>
  );
}
