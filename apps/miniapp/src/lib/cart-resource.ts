import type { Cart, CartItemPatch } from "./cart";
import type { CartItemInput } from "./product";

export type CartFailure = "auth" | "access" | "stock" | "missing" | "request";
export type CartOperation = {
  type: "add" | "update" | "remove" | "clear";
  itemId?: string;
};
export interface CartState {
  status: "loading" | "success" | "error";
  cart?: Cart;
  refreshing: boolean;
  operation?: CartOperation;
  failure?: { kind: CartFailure; operation?: CartOperation };
  success?: CartOperation;
}
interface CartTransport {
  add(input: CartItemInput, token: string, signal: AbortSignal): Promise<Cart>;
  get(token: string, signal: AbortSignal): Promise<Cart>;
  update(
    id: string,
    patch: CartItemPatch,
    token: string,
    signal: AbortSignal,
  ): Promise<Cart>;
  remove(id: string, token: string, signal: AbortSignal): Promise<Cart>;
  clear(token: string, signal: AbortSignal): Promise<Cart>;
}
export function cartFailure(error: unknown): CartFailure {
  const status =
    error && typeof error === "object" && "status" in error
      ? error.status
      : undefined;
  return status === 401
    ? "auth"
    : status === 403
      ? "access"
      : status === 409
        ? "stock"
        : status === 404
          ? "missing"
          : "request";
}

// Serialise mutations because every response contains the entire cart. Keep the
// last confirmed snapshot while a request is pending or fails; never optimistic.
export class CartResource {
  private state: CartState = { status: "loading", refreshing: false };
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private version = 0;
  constructor(
    private transport: CartTransport,
    private token: () => string | null,
    private timeout = 15_000,
  ) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: CartState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  cancel = () => {
    this.version++;
    this.controller?.abort();
    this.controller = undefined;
    clearTimeout(this.timer);
  };
  sessionFailure = () => {
    this.cancel();
    this.publish({
      status: "error",
      refreshing: false,
      failure: { kind: "auth" },
    });
  };
  load = () => this.run();
  add = (input: CartItemInput) => this.run({ type: "add" }, undefined, input);
  update = (id: string, patch: CartItemPatch) =>
    this.run({ type: "update", itemId: id }, patch);
  remove = (id: string) => this.run({ type: "remove", itemId: id });
  clear = () => this.run({ type: "clear" });
  private async run(
    operation?: CartOperation,
    patch?: CartItemPatch,
    item?: CartItemInput,
  ): Promise<boolean> {
    if (
      this.controller ||
      (operation && operation.type !== "add" && !this.state.cart)
    )
      return false;
    let token: string | null;
    try {
      token = this.token();
    } catch {
      token = null;
    }
    if (!token) {
      this.sessionFailure();
      return false;
    }
    const controller = new AbortController();
    this.controller = controller;
    const version = ++this.version;
    const timer = setTimeout(() => controller.abort(), this.timeout);
    this.timer = timer;
    this.publish({
      ...this.state,
      status: this.state.cart ? "success" : "loading",
      refreshing: !operation,
      operation,
      failure: undefined,
      success: undefined,
    });
    try {
      const cart =
        operation?.type === "add"
          ? await this.transport.add(item!, token, controller.signal)
          : operation?.type === "update"
            ? await this.transport.update(
                operation.itemId!,
                patch!,
                token,
                controller.signal,
              )
            : operation?.type === "remove"
              ? await this.transport.remove(
                  operation.itemId!,
                  token,
                  controller.signal,
                )
              : operation?.type === "clear"
                ? await this.transport.clear(token, controller.signal)
                : await this.transport.get(token, controller.signal);
      if (version !== this.version) return false;
      if (controller.signal.aborted) throw new Error("Cart request timed out");
      this.publish({
        status: "success",
        cart,
        refreshing: false,
        success: operation?.type === "add" ? undefined : operation,
      });
      return true;
    } catch (error) {
      if (version !== this.version) return false;
      this.publish({
        ...this.state,
        status: this.state.cart ? "success" : "error",
        refreshing: false,
        operation: undefined,
        failure: { kind: cartFailure(error), operation },
        success: undefined,
      });
      return false;
    } finally {
      clearTimeout(timer);
      if (version === this.version) this.controller = undefined;
    }
  }
}
