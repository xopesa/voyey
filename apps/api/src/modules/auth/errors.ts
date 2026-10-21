export class InvalidTelegramAuthError extends Error {
  public constructor(message = "Invalid or expired Telegram authentication data") {
    super(message);
    this.name = "InvalidTelegramAuthError";
  }
}

export class InvalidTokenError extends Error {
  public constructor(message = "Invalid access token") {
    super(message);
    this.name = "InvalidTokenError";
  }
}

export class AccountUnavailableError extends Error {
  public constructor() {
    super("User account is unavailable");
    this.name = "AccountUnavailableError";
  }
}

export class HttpError extends Error {
  public readonly statusCode: number;

  public constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}
