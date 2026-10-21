import React, { useEffect, useSyncExternalStore } from "react";
import { useTelegramSession } from "../../../src/components/TelegramSession";
export { default } from "../cart-preview/mocks.jsx";
const listeners = new Set();
function navigate(path) {
  window.paymentFixtureControl.path = path;
  listeners.forEach((fn) => fn());
  document.getElementById("fixture-result").textContent = `Navigation: ${path}`;
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
export function usePathname() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => window.paymentFixtureControl.path,
  );
}
export function useRouter() {
  return { push: navigate, replace: navigate };
}
export function readAccessToken() {
  return window.paymentFixtureControl.session === "authenticated"
    ? "fixture-token"
    : null;
}
export function TelegramBootstrap() {
  const { setStatus } = useTelegramSession();
  useEffect(() => setStatus("authenticated"), [setStatus]);
  return <span>TEST SESSION · no real Telegram authentication</span>;
}
export class ApiRequestError extends Error {
  constructor(status) {
    super("Fixture error");
    this.status = status;
  }
}
async function wait(signal, write = false) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 650);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(Error("Aborted"));
      },
      { once: true },
    );
  });
  const mode = window.paymentFixtureControl.mode;
  if (
    mode === "401" ||
    mode === "404" ||
    mode === "500" ||
    (write && ["409", "413", "415", "502"].includes(mode))
  )
    throw new ApiRequestError(Number(mode));
}
export async function getPaymentOrder(id, token, signal) {
  await wait(signal);
  return structuredClone(window.paymentFixtureControl.data.order);
}
export async function getPaymentInstructions(id, token, signal) {
  await wait(signal);
  return structuredClone(window.paymentFixtureControl.data.instructions);
}
export async function submitPaymentProof(id, file, key, token, signal) {
  await wait(signal, true);
  const c = window.paymentFixtureControl;
  c.posts++;
  const { order: o, instructions: i } = c.data;
  if (!i.canSubmit) throw new ApiRequestError(409);
  const payment = {
    id: `fixture-proof-${c.posts}`,
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
    `Confirmed fixture multipart: ${file.type}, ${file.size} bytes · posts=${c.posts}`;
  if (c.mode === "lost") throw Error("Lost fixture reply");
  return structuredClone(payment);
}

// Test-only locale API adapter: never contacts a server or database.
export async function updateUserLocale(locale) {
  return { user: { preferredLocale: locale } };
}
