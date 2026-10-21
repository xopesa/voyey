export class PaymentNotFoundError extends Error {
  public constructor() {
    super("Payment not found");
    this.name = "PaymentNotFoundError";
  }
}

export class PaymentSubmissionNotAllowedError extends Error {
  public constructor() {
    super("Payment submission is not allowed for the current order status");
    this.name = "PaymentSubmissionNotAllowedError";
  }
}

export class PaymentReviewNotAllowedError extends Error {
  public constructor() {
    super(
      "Payment has already been reviewed or no longer matches the order state",
    );
    this.name = "PaymentReviewNotAllowedError";
  }
}

export class PaymentAmountMismatchError extends Error {
  public constructor() {
    super("Payment amount no longer matches the order amount due");
    this.name = "PaymentAmountMismatchError";
  }
}

export class PaymentConflictError extends Error {
  public constructor() {
    super("Payment state changed concurrently");
    this.name = "PaymentConflictError";
  }
}

export class PaymentInvalidCursorError extends Error {
  public constructor() {
    super("Invalid payment cursor");
    this.name = "PaymentInvalidCursorError";
  }
}

export class FinalPaymentRequestNotAllowedError extends Error {
  public constructor() {
    super("Final payment can only be requested after weighing");
    this.name = "FinalPaymentRequestNotAllowedError";
  }
}

export class FinalPaymentAmountTooLargeError extends Error {
  public constructor() {
    super("Remaining goods plus CARGO exceeds the supported payment amount");
    this.name = "FinalPaymentAmountTooLargeError";
  }
}
