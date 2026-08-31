import type { Pool, PoolClient } from "pg";
import type { IdempotencyPort, ReserveResult } from "@ploot/core";

/**
 * Implementación de IdempotencyPort contra app_role, RLS incluido (misma tabla, misma política
 * que posts). La atomicidad de reserve() no depende de ningún lock explícito: un
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING ...` es en sí mismo la primitiva atómica — bajo
 * READ COMMITTED, dos transacciones que compiten por la misma (tenant_id, key) se serializan en
 * el índice único, y como mucho una de ellas obtiene la fila de vuelta.
 */
export class PostgresIdempotencyStore implements IdempotencyPort {
  constructor(private readonly pool: Pool) {}

  private async withTenant<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async reserve<T>(tenantId: string, key: string): Promise<ReserveResult<T>> {
    return this.withTenant(tenantId, async (client) => {
      const inserted = await client.query(
        `INSERT INTO idempotency_keys (tenant_id, key) VALUES ($1, $2)
         ON CONFLICT (tenant_id, key) DO NOTHING
         RETURNING key`,
        [tenantId, key]
      );
      if (inserted.rows.length > 0) return { isNew: true, existingResult: null };

      const { rows } = await client.query<{ result: T | null }>(
        "SELECT result FROM idempotency_keys WHERE tenant_id = $1 AND key = $2",
        [tenantId, key]
      );
      return { isNew: false, existingResult: rows[0]?.result ?? null };
    });
  }

  async complete<T>(tenantId: string, key: string, result: T): Promise<void> {
    await this.withTenant(tenantId, async (client) => {
      await client.query("UPDATE idempotency_keys SET result = $3::jsonb, completed_at = now() WHERE tenant_id = $1 AND key = $2", [
        tenantId,
        key,
        JSON.stringify(result),
      ]);
    });
  }
}
