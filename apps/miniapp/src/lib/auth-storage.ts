const accessTokenKey = "stenzo.access-token";

export function readAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(accessTokenKey);
  } catch {
    return null;
  }
}

export function storeAccessToken(token: string): void {
  try {
    window.sessionStorage.setItem(accessTokenKey, token);
  } catch {
    /* Storage may be blocked by the browser. */
  }
}

export function clearAccessToken(): void {
  try {
    window.sessionStorage.removeItem(accessTokenKey);
  } catch {
    /* Storage may be blocked by the browser. */
  }
}
