export class DomainError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class PostNotFoundError extends DomainError {
  constructor(postId: string) {
    super(`Post ${postId} not found`, "POST_NOT_FOUND");
  }
}

export class PostNotEditableError extends DomainError {
  constructor(postId: string, status: string) {
    super(`Post ${postId} cannot be modified in status ${status}`, "POST_NOT_EDITABLE");
  }
}

/** El proveedor devolvió 429. El worker debe respetar retryAfterMs y no avanzar la cola de ese Embajador. */
export class ProviderRateLimitedError extends DomainError {
  constructor(public readonly retryAfterMs: number) {
    super(`Provider rate limited, retry after ${retryAfterMs}ms`, "PROVIDER_RATE_LIMITED");
  }
}

/** El proveedor devolvió 5xx. Reintentable con backoff exponencial + jitter. */
export class ProviderServerError extends DomainError {
  constructor(message: string) {
    super(message, "PROVIDER_SERVER_ERROR");
  }
}

/** Token expirado pero recuperable: hay que refrescarlo antes del siguiente intento. */
export class TokenExpiredError extends DomainError {
  constructor(profileId: string) {
    super(`Token for profile ${profileId} expired`, "TOKEN_EXPIRED");
  }
}

/** Token revocado de forma irrecuperable. No se reintenta: el post pasa a failed. */
export class TokenRevokedError extends DomainError {
  constructor(profileId: string) {
    super(`Token for profile ${profileId} revoked`, "TOKEN_REVOKED");
  }
}

/** Presupuesto interno de rate limit (por app o por Embajador) agotado antes de llamar al proveedor. */
export class RateLimitBudgetExceededError extends DomainError {
  constructor(scope: string, public readonly retryAfterMs: number) {
    super(`Rate limit budget exceeded for ${scope}`, "RATE_LIMIT_BUDGET_EXCEEDED");
  }
}
