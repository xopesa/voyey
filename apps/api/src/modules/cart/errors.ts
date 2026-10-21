export class CartItemNotFoundError extends Error {
  public constructor() {
    super("Cart item not found");
    this.name = "CartItemNotFoundError";
  }
}

export class CartProductUnavailableError extends Error {
  public constructor() {
    super("Product is unavailable");
    this.name = "CartProductUnavailableError";
  }
}

export class CartVariantUnavailableError extends Error {
  public constructor() {
    super("Product variant is unavailable");
    this.name = "CartVariantUnavailableError";
  }
}

export class CartVariantProductMismatchError extends Error {
  public constructor() {
    super("Variant does not belong to the selected product");
    this.name = "CartVariantProductMismatchError";
  }
}

export class CartStockExceededError extends Error {
  public constructor(public readonly availableStock: number) {
    super(`Requested quantity exceeds available stock (${availableStock})`);
    this.name = "CartStockExceededError";
  }
}

export class CartQuantityLimitError extends Error {
  public constructor() {
    super("Cart item quantity must be between 1 and 99");
    this.name = "CartQuantityLimitError";
  }
}
