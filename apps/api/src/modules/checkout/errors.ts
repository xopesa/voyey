export class CheckoutMeasurementsError extends Error {
  public constructor() {
    super(
      "Every cart item requires height (100–250 cm) and weight (30–300 kg)",
    );
    this.name = "CheckoutMeasurementsError";
  }
}

export class CheckoutEmptyCartError extends Error {
  public constructor() {
    super("Cart is empty");
    this.name = "CheckoutEmptyCartError";
  }
}

export class CheckoutAmountLimitError extends Error {
  public constructor() {
    super("Order total exceeds the supported UZS amount");
    this.name = "CheckoutAmountLimitError";
  }
}

export class CheckoutConflictError extends Error {
  public constructor() {
    super("Checkout could not be completed safely");
    this.name = "CheckoutConflictError";
  }
}
