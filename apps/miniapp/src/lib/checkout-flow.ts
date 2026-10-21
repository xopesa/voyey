import type { Cart } from "./cart";
import type { CartResource } from "./cart-resource";
import {
  checkoutCartIssue,
  checkoutCartVersion,
  checkoutFailure,
  type CheckoutAttempt,
  type AttemptStore,
  type CheckoutOrder,
  type CheckoutInput,
  type CheckoutFailure,
} from "./checkout";
export interface CheckoutState {
  phase: "idle" | "checking" | "submitting" | "error" | "success";
  failure?: CheckoutFailure;
  recoverable: boolean;
  promoCode?: string;
  order?: CheckoutOrder;
}
export class CheckoutFlow {
  private state: CheckoutState = { phase: "idle", recoverable: false };
  private listeners = new Set<() => void>();
  private attempt?: CheckoutAttempt;
  private locked = false;
  private generation = 0;
  private controller?: AbortController;
  constructor(
    private cart: CartResource,
    private post: (
      recipient: CheckoutInput,
      key: string,
      token: string,
      signal: AbortSignal,
    ) => Promise<CheckoutOrder>,
    private token: () => string | null,
    private store: AttemptStore,
    private key: () => string,
    private timeout = 15_000,
  ) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: CheckoutState) {
    this.state = {
      ...state,
      ...(state.recoverable && this.attempt?.promoCode
        ? { promoCode: this.attempt.promoCode }
        : {}),
    };
    this.listeners.forEach((listener) => listener());
  }
  restore = (cartId: string) => {
    if (this.attempt || this.locked || this.state.phase === "success") return;
    const saved = this.store.read(cartId);
    if (saved) {
      this.attempt = saved;
      this.publish({ phase: "idle", recoverable: saved.uncertain });
    }
  };
  cancel = () => {
    this.generation++;
    this.controller?.abort();
    this.locked = false;
  };
  submit = async (
    shown: Cart,
    recipient: CheckoutInput,
  ): Promise<CheckoutOrder | undefined> => {
    if (
      this.locked ||
      this.state.phase === "success" ||
      this.cart.snapshot().operation ||
      this.cart.snapshot().refreshing
    )
      return;
    this.restore(shown.id);
    const replaying = !!this.attempt?.uncertain;
    this.locked = true;
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    try {
      const token = this.token();
      if (!token) {
        this.publish({
          phase: "error",
          failure: "auth",
          recoverable: !!this.attempt?.uncertain,
        });
        return;
      }
      // An uncertain POST may already have emptied the cart. Replay its key rather
      // than trying to create another order from the current cart.
      if (!this.attempt?.uncertain) {
        this.publish({ phase: "checking", recoverable: false });
        const loaded = await this.cart.load();
        if (!current()) return;
        const fresh = this.cart.snapshot().cart;
        if (!loaded || !fresh) {
          this.publish({
            phase: "error",
            failure:
              this.cart.snapshot().failure?.kind === "auth"
                ? "auth"
                : "request",
            recoverable: false,
          });
          return;
        }
        const issue = checkoutCartIssue(fresh);
        if (issue) {
          this.publish({
            phase: "error",
            failure: issue === "unavailable" ? "stock" : issue,
            recoverable: false,
          });
          return;
        }
        if (checkoutCartVersion(fresh) !== checkoutCartVersion(shown)) {
          this.publish({
            phase: "error",
            failure: "changed",
            recoverable: false,
          });
          return;
        }
        this.attempt ??= {
          key: this.key(),
          cartId: shown.id,
          uncertain: false,
        };
      }
      if (!this.attempt) throw Error("Missing checkout attempt");
      if (!replaying) {
        const code = recipient.promoCode?.trim().toUpperCase();
        if (code) this.attempt.promoCode = code;
        else delete this.attempt.promoCode;
      }
      this.attempt.uncertain = true;
      this.store.write(this.attempt);
      this.publish({ phase: "submitting", recoverable: true });
      const controller = new AbortController();
      this.controller = controller;
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const payload = { ...recipient };
        if (this.attempt.promoCode) payload.promoCode = this.attempt.promoCode;
        else delete payload.promoCode;
        const order = await this.post(
          payload,
          this.attempt.key,
          token,
          controller.signal,
        );
        if (!current()) return;
        if (controller.signal.aborted) throw Error("Checkout timed out");
        this.store.clear();
        this.attempt = undefined;
        this.publish({ phase: "success", order, recoverable: false });
        return order;
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      if (!current()) return;
      const failure = checkoutFailure(error);
      const definite = failure !== "request" && failure !== "conflict";
      // A rejected replay (e.g. an expired JWT) says nothing about whether the
      // earlier uncertain POST committed. Preserve recovery until an Order is confirmed.
      // The commerce gate rejects this POST before checkout executes. Keep its
      // key (including on replays), but do not claim this refusal is uncertain.
      if (
        this.attempt &&
        definite &&
        (!replaying || failure === "unavailable")
      ) {
        this.attempt.uncertain = false;
        this.store.write(this.attempt);
      }
      this.publish({
        phase: "error",
        failure,
        recoverable: !!this.attempt?.uncertain,
      });
      if (definite && failure !== "auth" && failure !== "access")
        await this.cart.load();
    } finally {
      if (current()) {
        this.locked = false;
        this.controller = undefined;
      }
    }
  };
}
