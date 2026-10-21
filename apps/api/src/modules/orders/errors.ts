export class OrderNotFoundError extends Error {
  public constructor() {
    super("Order not found");
    this.name = "OrderNotFoundError";
  }
}

export class OrderInvalidCursorError extends Error {
  public constructor() {
    super("Invalid order cursor");
    this.name = "OrderInvalidCursorError";
  }
}

export class InvalidOrderStatusTransitionError extends Error {
  public constructor(from: string, to: string) {
    super(`Order status transition ${from} -> ${to} is not allowed`);
    this.name = "InvalidOrderStatusTransitionError";
  }
}

export class OrderTransitionConflictError extends Error {
  public constructor() {
    super("Order status changed concurrently");
    this.name = "OrderTransitionConflictError";
  }
}
