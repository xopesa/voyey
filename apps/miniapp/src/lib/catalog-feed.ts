import type {
  CatalogProduct,
  CatalogProductsResponse,
  CatalogQuery,
} from "./catalog";

export interface CatalogFeedState {
  status: "loading" | "success" | "error";
  products: CatalogProduct[];
  nextCursor: string | null;
  loadingMore: boolean;
  moreError: boolean;
}

type Loader = (
  query: CatalogQuery,
  signal: AbortSignal,
) => Promise<CatalogProductsResponse>;

// Each filter selection owns one feed. Cancelling it prevents old requests from committing.
export class CatalogFeed {
  private state: CatalogFeedState = {
    status: "loading",
    products: [],
    nextCursor: null,
    loadingMore: false,
    moreError: false,
  };
  private listeners = new Set<() => void>();
  private version = 0;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private query: CatalogQuery,
    private load: Loader,
    private timeoutMs = 15_000,
  ) {}

  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(state: CatalogFeedState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  cancel = () => {
    this.version++;
    this.controller?.abort();
    clearTimeout(this.timer);
    this.controller = undefined;
  };

  start = async () => {
    this.cancel();
    await this.request();
  };

  more = async () => {
    if (
      this.controller ||
      this.state.status !== "success" ||
      !this.state.nextCursor
    )
      return;
    await this.request(this.state.nextCursor);
  };

  private async request(cursor?: string) {
    const version = ++this.version;
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    this.timer = timer;
    this.publish(
      cursor
        ? { ...this.state, loadingMore: true, moreError: false }
        : {
            status: "loading",
            products: [],
            nextCursor: null,
            loadingMore: false,
            moreError: false,
          },
    );
    try {
      const result = await this.load(
        { ...this.query, ...(cursor ? { cursor } : {}) },
        controller.signal,
      );
      if (version !== this.version) return;
      if (cursor && result.nextCursor === cursor)
        throw new Error("Catalog cursor did not advance");
      const products = new Map(
        (cursor ? this.state.products : []).map((product) => [
          product.id,
          product,
        ]),
      );
      result.products.forEach((product) => products.set(product.id, product));
      this.publish({
        status: "success",
        products: [...products.values()],
        nextCursor: result.nextCursor,
        loadingMore: false,
        moreError: false,
      });
    } catch {
      if (version !== this.version) return;
      this.publish(
        cursor
          ? { ...this.state, loadingMore: false, moreError: true }
          : {
              status: "error",
              products: [],
              nextCursor: null,
              loadingMore: false,
              moreError: false,
            },
      );
    } finally {
      clearTimeout(timer);
      if (version === this.version) this.controller = undefined;
    }
  }
}
