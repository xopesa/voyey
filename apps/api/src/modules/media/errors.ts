export class UnsupportedImageTypeError extends Error {
  public constructor() {
    super("Only JPEG, PNG and WebP images are allowed");
    this.name = "UnsupportedImageTypeError";
  }
}

export class ImageTypeMismatchError extends Error {
  public constructor() {
    super("Uploaded image content does not match its MIME type");
    this.name = "ImageTypeMismatchError";
  }
}

export class ImageTooLargeError extends Error {
  public constructor(public readonly maxBytes: number) {
    super(`Image exceeds the ${maxBytes} byte upload limit`);
    this.name = "ImageTooLargeError";
  }
}

export class InvalidStorageKeyError extends Error {
  public constructor() {
    super("Invalid storage key");
    this.name = "InvalidStorageKeyError";
  }
}

export class MediaStorageError extends Error {
  public constructor(
    message = "Media storage operation failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MediaStorageError";
  }
}

export class MediaStorageUnavailableError extends Error {
  public constructor() {
    super("Image storage is not configured");
    this.name = "MediaStorageUnavailableError";
  }
}
