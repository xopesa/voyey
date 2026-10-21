export class AdminCatalogDuplicateSlugError extends Error {
  public constructor() {
    super("Slug already exists");
    this.name = "AdminCatalogDuplicateSlugError";
  }
}

export class AdminCatalogDuplicateSkuError extends Error {
  public constructor() {
    super("SKU already exists");
    this.name = "AdminCatalogDuplicateSkuError";
  }
}

export class AdminCatalogCategoryNotFoundError extends Error {
  public constructor() {
    super("Category not found");
    this.name = "AdminCatalogCategoryNotFoundError";
  }
}

export class AdminCatalogProductNotFoundError extends Error {
  public constructor() {
    super("Product not found");
    this.name = "AdminCatalogProductNotFoundError";
  }
}

export class AdminCatalogImageNotFoundError extends Error {
  public constructor() {
    super("Product image not found");
    this.name = "AdminCatalogImageNotFoundError";
  }
}

export class AdminCatalogVariantNotFoundError extends Error {
  public constructor() {
    super("Product variant not found");
    this.name = "AdminCatalogVariantNotFoundError";
  }
}

export class AdminCatalogInvalidCursorError extends Error {
  public constructor() {
    super("Invalid admin catalog cursor");
    this.name = "AdminCatalogInvalidCursorError";
  }
}

export class AdminCatalogPrimaryImageConflictError extends Error {
  public constructor() {
    super("A primary image already exists for this product");
    this.name = "AdminCatalogPrimaryImageConflictError";
  }
}

export class AdminCatalogManagedImageUrlError extends Error {
  public constructor() {
    super("The URL of a storage-managed image cannot be changed directly");
    this.name = "AdminCatalogManagedImageUrlError";
  }
}
