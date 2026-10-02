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

/** The account was closed by an operator at the customer's request. Only support and the data export stay open. */
export class AccountClosedError extends HttpError {
  constructor(message = "This account is closed. Contact support if you need help.") { super(403, "account_closed", message); this.name = "AccountClosedError"; }
}

/** The customer hasn't accepted the current terms and privacy notice (`/api/terms`); the app shows them again. */
export class TermsRequiredError extends HttpError {
  constructor(message = "Review and accept the current terms to continue.") { super(403, "terms_required", message); this.name = "TermsRequiredError"; }
}

/** Accepting the terms needs an email on the Privy account, so security notices always reach the customer. */
export class EmailRequiredError extends HttpError {
  constructor(message = "Add an email to your account to continue.") { super(403, "email_required", message); this.name = "EmailRequiredError"; }
}

export class MfaRequiredError extends HttpError {
  constructor(message = "Add a passkey before you move money.") { super(403, "mfa_required", message); this.name = "MfaRequiredError"; }
}

/** An asset outside the registry, not allowed for this use, or paused by an operator. */
export class AssetUnavailableError extends HttpError {
  constructor(code: "unsupported_asset" | "asset_paused", message: string) { super(code === "asset_paused" ? 503 : 422, code, message); this.name = "AssetUnavailableError"; }
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
