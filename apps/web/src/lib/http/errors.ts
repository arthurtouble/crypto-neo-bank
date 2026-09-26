/** An error whose status, code, and message are safe to return to the caller. */
export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly headers: Record<string, string> = {}) {
    super(message);
    this.name = "HttpError";
  }
}

export class AuthenticationError extends HttpError {
  constructor(message = "A valid Privy session is required.") { super(401, "unauthorized", message); this.name = "AuthenticationError"; }
}

export class AuthorizationError extends HttpError {
  constructor(message = "Operations access is restricted.") { super(403, "forbidden", message); this.name = "AuthorizationError"; }
}

export class WalletOwnershipError extends HttpError {
  constructor(message = "This wallet is not linked to your account.") { super(403, "wallet_not_linked", message); this.name = "WalletOwnershipError"; }
}

export class MfaRequiredError extends HttpError {
  constructor(message = "Add a passkey before you move money.") { super(403, "mfa_required", message); this.name = "MfaRequiredError"; }
}

export class RateLimitError extends HttpError {
  constructor(public readonly retryAfterSeconds: number) {
    super(429, "rate_limited", "Too many requests. Try again shortly.", { "Retry-After": String(retryAfterSeconds) });
    this.name = "RateLimitError";
  }
}

export class FeatureUnavailableError extends HttpError {
  constructor(public readonly feature: string) { super(503, "feature_unavailable", "This feature is temporarily unavailable."); this.name = "FeatureUnavailableError"; }
}
