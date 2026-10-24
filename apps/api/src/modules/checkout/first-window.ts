import { database } from "@stenzo/database";
import { HttpError } from "../auth/errors.js";

export const FIRST_WINDOW_MS = 24 * 60 * 60 * 1000;
export const FIRST_EXTENSION_MS = 2 * 60 * 60 * 1000;
export const FIRST_MAX_ATTEMPTS = 3;

/** Do not retrofit new deadlines onto pre-0028 historical orders. */
export async function hasPromoLifecycle() {
  return !!(await database()
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='CheckoutFirstWindow'",
    )
    .first());
}
export async function readFirstWindow(orderId: string) {
  if (!(await hasPromoLifecycle())) return null;
  return database()
    .prepare(
      `SELECT w.orderId,w.checkoutGroupId,w.createdAt,w.expiresAt,
      COALESCE(x.expiresAt,w.expiresAt) effectiveExpiresAt,
      x.decisionAt extensionGrantedAt,
      (SELECT COUNT(*) FROM CheckoutPayment p WHERE p.orderId=w.orderId AND p.phase='FIRST') attempts,
      (SELECT id FROM CheckoutPayment p WHERE p.orderId=w.orderId AND p.phase='FIRST' AND p.status='SUBMITTED') pendingPaymentId
     FROM CheckoutFirstWindow w LEFT JOIN CheckoutFirstExtension x ON x.orderId=w.orderId WHERE w.orderId=?`,
    )
    .bind(orderId)
    .first<{
      orderId: string;
      checkoutGroupId: string;
      createdAt: number;
      expiresAt: number;
      effectiveExpiresAt: number;
      extensionGrantedAt: number | null;
      attempts: number;
      pendingPaymentId: string | null;
    }>();
}
export async function assertFirstSubmission(orderId: string, now: number) {
  const window = await readFirstWindow(orderId);
  if (!window) return;
  if (window.attempts >= FIRST_MAX_ATTEMPTS)
    throw new HttpError(
      409,
      "FIRST receipt limit: maximum three accepted submissions",
    );
  if (
    !Number.isSafeInteger(now) ||
    now < window.createdAt ||
    now >= window.effectiveExpiresAt
  )
    throw new HttpError(409, "FIRST payment window has closed");
}
