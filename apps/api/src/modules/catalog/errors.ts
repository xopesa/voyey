export class CatalogProductNotFoundError extends Error {
  public constructor() {
    super("Product not found");
    this.name = "CatalogProductNotFoundError";
  }
}

export class CatalogInvalidCursorError extends Error {
  public constructor() {
    super("Invalid catalog cursor");
    this.name = "CatalogInvalidCursorError";
  }
}
