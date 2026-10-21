import {
  ordersError,
  type CustomerOrder,
  type OrdersError,
  type OrdersPage,
} from "./orders";
export interface OrdersSnapshot {
  orders: CustomerOrder[];
  nextCursor: string | null;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error?: OrdersError;
  moreError?: OrdersError;
}
export class OrdersFeed {
  private state: OrdersSnapshot = {
    orders: [],
    nextCursor: null,
    loading: true,
    refreshing: false,
    loadingMore: false,
  };
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private cursors = new Set<string>();
  public constructor(
    private load: (
      cursor: string | undefined,
      signal: AbortSignal,
    ) => Promise<OrdersPage>,
  ) {}
  public snapshot = () => this.state;
  public subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit(patch: Partial<OrdersSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  public cancel = () => {
    this.controller?.abort();
    this.controller = undefined;
  };
  public async start() {
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    this.emit({
      loading: this.state.orders.length === 0,
      refreshing: true,
      loadingMore: false,
      error: undefined,
      moreError: undefined,
    });
    try {
      const page = await this.load(undefined, controller.signal);
      if (this.controller === controller && !controller.signal.aborted) {
        this.cursors.clear();
        if (page.nextCursor) this.cursors.add(page.nextCursor);
        this.emit({
          orders: page.orders,
          nextCursor: page.nextCursor,
          loading: false,
          refreshing: false,
        });
      }
    } catch (error) {
      if (this.controller === controller)
        this.emit({
          loading: false,
          refreshing: false,
          error: ordersError(error),
        });
    } finally {
      clearTimeout(timer);
    }
  }
  public async more() {
    const cursor = this.state.nextCursor;
    if (
      !cursor ||
      this.state.loading ||
      this.state.refreshing ||
      this.state.loadingMore ||
      this.state.error
    )
      return;
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    this.emit({ loadingMore: true, moreError: undefined });
    try {
      const page = await this.load(cursor, controller.signal);
      if (page.nextCursor && this.cursors.has(page.nextCursor))
        throw Error("Repeated orders cursor");
      if (this.controller !== controller || controller.signal.aborted) return;
      const merged = new Map(
        this.state.orders.map((order) => [order.publicId, order]),
      );
      page.orders.forEach((order) => merged.set(order.publicId, order));
      if (page.nextCursor) this.cursors.add(page.nextCursor);
      this.emit({
        orders: [...merged.values()],
        nextCursor: page.nextCursor,
        loadingMore: false,
      });
    } catch (error) {
      if (this.controller === controller)
        this.emit({
          loadingMore: false,
          ...(ordersError(error) === "auth"
            ? { error: "auth" as const, moreError: undefined }
            : { moreError: ordersError(error) }),
        });
    } finally {
      clearTimeout(timer);
    }
  }
}
