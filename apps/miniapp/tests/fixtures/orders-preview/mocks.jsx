import React, { useEffect, useSyncExternalStore } from "react";
import { useTelegramSession } from "../../../src/components/TelegramSession";
export { default } from "../cart-preview/mocks.jsx";
const listeners = new Set();
function navigate(path) {
  window.ordersFixtureControl.path = path;
  listeners.forEach((fn) => fn());
  document.getElementById("fixture-result").textContent = `Navigation: ${path}`;
}
export function usePathname() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => window.ordersFixtureControl.path.split("?")[0],
  );
}
export function useRouter() {
  return { push: navigate, replace: navigate };
}
export function Link({ href, children, ...props }) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        props.onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
export function TelegramBootstrap() {
  const { setStatus } = useTelegramSession();
  useEffect(() => setStatus("authenticated"), [setStatus]);
  return <span>TEST SESSION · no real Telegram</span>;
}
export function readAccessToken() {
  return window.ordersFixtureControl.session === "authenticated"
    ? "test-token"
    : null;
}
export class ApiRequestError extends Error {
  constructor(status) {
    super("Fixture request");
    this.status = status;
  }
}
async function wait(signal, cursor) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 500);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(Error("aborted"));
      },
      { once: true },
    );
  });
  const mode = window.ordersFixtureControl.mode;
  if (["401", "404", "500"].includes(mode))
    throw new ApiRequestError(Number(mode));
  if (mode === "more-error" && cursor) throw new ApiRequestError(500);
}
export async function getUserOrders(token, cursor, signal) {
  await wait(signal, cursor);
  const c = window.ordersFixtureControl;
  const offset = cursor ? Number(cursor.split("-")[1]) : 0;
  const data = c.empty ? [] : c.data;
  const orders = data
    .slice(offset, offset + 3)
    .map((d) => structuredClone(d.order));
  document.getElementById("fixture-result").textContent =
    `GET orders · cursor=${cursor ?? "none"} · read-only`;
  return {
    orders,
    nextCursor: offset + 3 < data.length ? `cursor-${offset + 3}` : null,
  };
}
export async function getUserOrder(id, token, signal) {
  await wait(signal);
  const data = window.ordersFixtureControl.data.find(
    (d) => d.order.publicId === id,
  );
  if (!data) throw new ApiRequestError(404);
  return structuredClone(data.order);
}
export const getPaymentOrder = getUserOrder;
export async function getPaymentInstructions(id, token, signal) {
  await wait(signal);
  const data = window.ordersFixtureControl.data.find(
    (d) => d.order.publicId === id,
  );
  if (!data) throw new ApiRequestError(404);
  return structuredClone(data.instructions);
}
export async function submitPaymentProof(id, file, key, token, signal) {
  await wait(signal);
  const c = window.ordersFixtureControl,
    data = c.data.find((d) => d.order.publicId === id),
    { order: o, instructions: i } = data;
  if (!i.canSubmit) throw new ApiRequestError(409);
  const payment = {
    id: `fixture-proof-${++c.posts}`,
    orderPublicId: id,
    type: i.phase,
    status: "SUBMITTED",
    expectedAmount: i.amount,
    rejectionReason: null,
    submittedAt: new Date().toISOString(),
    reviewedAt: null,
  };
  i.latestPayment = payment;
  i.latestPaymentStatus = "SUBMITTED";
  i.canSubmit = false;
  o.status =
    i.phase === "FINAL" ? "FINAL_PAYMENT_SUBMITTED" : "PREPAYMENT_SUBMITTED";
  o.payment.latestStatus = "SUBMITTED";
  document.getElementById("fixture-result").textContent =
    `TEST POST proof · posts=${c.posts} · no real payment`;
  return structuredClone(payment);
}

// Test-only locale API adapter: never contacts a server or database.
export async function updateUserLocale(locale) {
  return { user: { preferredLocale: locale } };
}
