import type { Pool } from "pg";
import type { ClockPort, RateLimitDecision, RateLimiterPort, RateLimitScope } from "@ploot/core";

export interface RateLimiterConfig {
  /** Presupuesto compartido entre todos los tenants y Embajadores — protege la cuota de la app. */
  appLimit: number;
  appWindowMs: number;
  /** Presupuesto por Embajador — evita que ráfagas de un solo perfil arriesguen su cuenta. */
  profileLimit: number;
  profileWindowMs: number;
}

interface WindowRow {
  count: number;
  window_start: Date;
}

/**
 * Ventana fija por `scope` ('app' o 'profile:<uuid>') en una tabla de Postgres — el worker
 * consulta esto ANTES de llamar al proveedor, no solo reacciona a sus 429 reales (que ya sería
 * tarde para evitar la ráfaga que arriesga la cuenta del Embajador).
 *
 * La atomicidad frente a N réplicas del worker viene del propio UPSERT: `INSERT ... ON CONFLICT
 * DO UPDATE ... WHERE <condición>` toma el lock de fila de Postgres como una sola sentencia, así
 * que dos workers compitiendo por el mismo scope nunca pueden admitir ambos por encima del
 * límite (a diferencia de un "SELECT count, luego UPDATE si count < limit" en dos pasos, que sí
 * tendría una carrera).
 */
export class PostgresRateLimiter implements RateLimiterPort {
  constructor(
    private readonly pool: Pool,
    private readonly config: RateLimiterConfig,
    private readonly clock: ClockPort
  ) {}

  async tryAcquire(scope: RateLimitScope): Promise<RateLimitDecision> {
    const { key, limit, windowMs } = this.resolve(scope);
    const now = this.clock.now().getTime();
    const windowStart = new Date(Math.floor(now / windowMs) * windowMs);

    const { rows } = await this.pool.query<{ count: number }>(
      `
      INSERT INTO rate_limit_windows (scope, window_start, count)
      VALUES ($1, $2, 1)
      ON CONFLICT (scope) DO UPDATE
      SET window_start = $2,
          count = CASE WHEN rate_limit_windows.window_start < $2 THEN 1 ELSE rate_limit_windows.count + 1 END
      WHERE rate_limit_windows.window_start < $2 OR rate_limit_windows.count < $3
      RETURNING count
      `,
      [key, windowStart, limit]
    );

    if (rows.length > 0) return { allowed: true, retryAfterMs: 0 };

    // No se admitió: la ventana actual ya está al límite. Averiguamos cuándo abre la siguiente.
    const { rows: existing } = await this.pool.query<WindowRow>(
      "SELECT window_start FROM rate_limit_windows WHERE scope = $1",
      [key]
    );
    const currentWindowStart = existing[0]?.window_start ?? windowStart;
    const retryAfterMs = Math.max(0, currentWindowStart.getTime() + windowMs - now);
    return { allowed: false, retryAfterMs };
  }

  private resolve(scope: RateLimitScope): { key: string; limit: number; windowMs: number } {
    if (scope.type === "app") {
      return { key: "app", limit: this.config.appLimit, windowMs: this.config.appWindowMs };
    }
    return {
      key: `profile:${scope.profileId}`,
      limit: this.config.profileLimit,
      windowMs: this.config.profileWindowMs,
    };
  }
}
