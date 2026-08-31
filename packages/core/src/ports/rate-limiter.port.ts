export type RateLimitScope = { type: "app" } | { type: "profile"; profileId: string };

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Presupuesto interno (por app compartido entre todos los tenants, y por Embajador) que el
 * worker consulta ANTES de llamar al proveedor — para no depender solo de reaccionar a los 429
 * reales, que ya sería demasiado tarde para evitar ráfagas que arriesguen la cuenta.
 */
export interface RateLimiterPort {
  tryAcquire(scope: RateLimitScope): Promise<RateLimitDecision>;
}
