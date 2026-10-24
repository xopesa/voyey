import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  VoyeyButton,
  VoyeyEmptyState,
  VoyeyIcon,
  VoyeyLogo,
  VoyeyPrice,
} from "./components";
import { localizedText, type Locale, type Translator } from "./messages";
import { motionTokens, useVoyeyMotion } from "./motion";
import type { DemoOrder } from "./domain";
import {
  receiptAmounts,
  receiptDate,
  receiptFor,
  receiptTitle,
  type ReceiptData,
  type ReceiptKind,
} from "./receipt";

export function VoyeyReceiptPaper({
  data: r,
  locale,
  t,
}: {
  data: ReceiptData;
  locale: Locale;
  t: Translator;
}) {
  return (
    <>
      <header className="vy-receipt-brand">
        <VoyeyLogo />
        <p className="vy-eyebrow">{t("receiptMock")}</p>
        <h2>{t(receiptTitle(r.kind))}</h2>
        <span className="vy-receipt-status">
          <VoyeyIcon name="check" size={16} />
          {t(r.status)}
        </span>
      </header>
      <dl className="vy-receipt-meta">
        <div>
          <dt>{t("receiptOrder")}</dt>
          <dd>{r.orderId}</dd>
        </div>
        <div>
          <dt>{t("receiptDate")}</dt>
          <dd>{receiptDate(r.confirmedAt, locale)}</dd>
        </div>
        <div>
          <dt>{t("saleMode")}</dt>
          <dd>{t(r.saleMode === "IN_STOCK" ? "inStock" : "preorder")}</dd>
        </div>
      </dl>
      <div className="vy-receipt-items">
        {r.lines.map((l) => (
          <div className="vy-receipt-item" key={l.id}>
            <strong>
              {localizedText(locale, { ru: l.nameRu, uz: l.nameUz })}
            </strong>
            <p>{localizedText(locale, { ru: l.variantRu, uz: l.variantUz })}</p>
            <div>
              <span>
                {l.quantity} ×{" "}
                <VoyeyPrice amount={l.unitPrice} locale={locale} />
              </span>
              <VoyeyPrice amount={l.unitPrice * l.quantity} locale={locale} />
            </div>
          </div>
        ))}
      </div>
      <dl className="vy-receipt-amounts">
        {receiptAmounts(r, t).map((row) => (
          <div key={row.id} className={row.strong ? "is-strong" : ""}>
            <dt>{row.label}</dt>
            <dd>
              {row.text ?? (
                <>
                  {row.negative ? "− " : ""}
                  <VoyeyPrice amount={row.amount!} locale={locale} />
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {r.cargo === null && (
        <p className="vy-receipt-note">{t("receiptUnknownCargo")}</p>
      )}
      <footer className="vy-receipt-footer">
        <strong>{t("receiptThanks")}</strong>
        <p>{t("receiptDisclaimer")}</p>
      </footer>
    </>
  );
}
export function VoyeyReceiptScreen({
  data,
  locale,
  t,
  onExport,
  exporting,
}: {
  data: ReceiptData | null;
  locale: Locale;
  t: Translator;
  onExport: (share: boolean) => void;
  exporting: boolean;
}) {
  const { reduced } = useVoyeyMotion(),
    [ready, setReady] = useState(reduced);
  useEffect(() => {
    if (reduced) setReady(true);
  }, [reduced]);
  if (!data)
    return (
      <VoyeyEmptyState
        icon="receipt"
        title={t("receiptUnavailable")}
        text={t("receiptUnavailableText")}
        t={t}
      />
    );
  return (
    <section
      className="vy-receipt-screen"
      aria-label={t("receiptTitle")}
      data-print-state={ready ? "ready" : "printing"}
      data-reduced={reduced}
    >
      <div className="vy-printer-stage">
        <div className="vy-printer-body" aria-hidden="true">
          <div className="vy-printer-top">
            <span />
            <span />
            <span />
          </div>
          <div className="vy-printer-slot" />
        </div>
        <div className="vy-print-window">
          <motion.article
            className="vy-receipt-paper"
            aria-busy={!ready}
            initial={
              reduced
                ? { opacity: 0.3 }
                : { y: -24, clipPath: "inset(0% 0% 100% 0%)", opacity: 1 }
            }
            animate={{ y: 0, clipPath: "inset(0% 0% 0% 0%)", opacity: 1 }}
            transition={{
              duration: reduced ? 0.08 : motionTokens.receipt,
              ease: motionTokens.ease,
            }}
            onAnimationComplete={() => setReady(true)}
          >
            <VoyeyReceiptPaper data={data} locale={locale} t={t} />
          </motion.article>
        </div>
      </div>
      <div className="vy-receipt-actions-host">
        <AnimatePresence initial={false}>
          {ready && (
            <motion.div
              className="vy-receipt-actions"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0.08 : 0.16 }}
            >
              <VoyeyButton loading={exporting} onClick={() => onExport(false)}>
                <VoyeyIcon name="download" />
                {t("receiptSave")}
              </VoyeyButton>
              <VoyeyButton
                secondary
                disabled={exporting}
                onClick={() => onExport(true)}
              >
                <VoyeyIcon name="share" />
                {t("receiptShare")}
              </VoyeyButton>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
export function VoyeyOrderDetails({
  order: o,
  locale,
  t,
  onPayment,
  onReceipt,
  onArrival,
  onFinal,
}: {
  order: DemoOrder;
  locale: Locale;
  t: Translator;
  onPayment: () => void;
  onReceipt: (kind: ReceiptKind) => void;
  onArrival: (cargo: number) => void;
  onFinal: () => void;
}) {
  const [cargo, setCargo] = useState("0"),
    first = receiptFor(o),
    final = receiptFor(o, "SETTLEMENT"),
    pending = o.claims.find((c) => c.status === "SUBMITTED"),
    last = o.claims.at(-1),
    s = o.settlement;
  return (
    <div className="vy-narrow vy-order-details">
      <p className="vy-eyebrow">{t("demoOrder", { id: o.id })}</p>
      <section className="vy-panel">
        <h2>{t("goods")}</h2>
        {o.lines.map((l) => (
          <div key={l.id} className="vy-checkout-line">
            <span>
              {localizedText(locale, { ru: l.nameRu, uz: l.nameUz })}
              <small>
                {localizedText(locale, { ru: l.variantRu, uz: l.variantUz })} ×{" "}
                {l.quantity}
              </small>
            </span>
            <VoyeyPrice amount={l.unitPrice * l.quantity} locale={locale} />
          </div>
        ))}
      </section>
      {pending ? (
        <section className="vy-payment-status" role="status">
          <VoyeyIcon name="clock" />
          <h3>{t("receiptPending")}</h3>
          <p>
            {t("receiptSubmitted", {
              date: receiptDate(pending.submittedAt, locale),
              n: o.claims.indexOf(pending) + 1,
            })}
          </p>
          <VoyeyPrice amount={pending.amount} locale={locale} />
        </section>
      ) : last?.status === "REJECTED" ? (
        <p className="vy-error">{t("rejected")}</p>
      ) : null}
      <VoyeyButton secondary onClick={onPayment}>
        {t("orderPayment")}
        <VoyeyIcon name="arrow" size={18} />
      </VoyeyButton>
      <section className="vy-panel vy-form">
        <h2>{t("orderReceipts")}</h2>
        {first ? (
          <VoyeyButton onClick={() => onReceipt("FIRST")}>
            <VoyeyIcon name="receipt" />
            {t("receiptFirst")}
          </VoyeyButton>
        ) : (
          <p className="vy-caption">{t("receiptUnavailableText")}</p>
        )}
        {final && (
          <VoyeyButton secondary onClick={() => onReceipt("SETTLEMENT")}>
            {t("receiptFinal")}
          </VoyeyButton>
        )}
      </section>
      {first && o.saleMode === "PREORDER" && (
        <details className="vy-simulator">
          <summary>{t("demoArrival")}</summary>
          <p>{t("demoSettlementHint")}</p>
          <div className="vy-form">
            <label>
              {t("demoCargo")}
              <input
                type="number"
                min="0"
                max="1000000000"
                inputMode="numeric"
                value={s ? s.cargo : cargo}
                disabled={!!s}
                onChange={(e) => setCargo(e.target.value)}
              />
            </label>
            {!s ? (
              <VoyeyButton
                secondary
                onClick={() => onArrival(Number(cargo))}
                disabled={!cargo.trim()}
              >
                {t("demoRecordArrival")}
              </VoyeyButton>
            ) : (
              <>
                <p className="vy-caption">{t("demoArrivalRecorded")}</p>
                {s.completedAt === null ? (
                  <>
                    <VoyeyPrice
                      amount={o.goodsTotal + s.cargo - first.paidAmount}
                      locale={locale}
                    />
                    <VoyeyButton onClick={onFinal}>
                      {t(
                        o.goodsTotal + s.cargo - first.paidAmount === 0
                          ? "demoCompleteZero"
                          : "demoConfirmFinal",
                      )}
                    </VoyeyButton>
                  </>
                ) : (
                  <p className="vy-success">
                    <VoyeyIcon name="check" size={17} />
                    {t("demoFinalDone")}
                  </p>
                )}
              </>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
