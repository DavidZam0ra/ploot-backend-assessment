import type { Pool } from "pg";
import type { Post, SchedulerRepositoryPort } from "@ploot/core";
import { toPost, type PostRow } from "../mappers/post-row.js";

/**
 * Implementación de SchedulerRepositoryPort. Se conecta como worker_role (BYPASSRLS): necesita
 * ver posts de todos los tenants a la vez para poder repartir la cola de forma justa entre
 * ellos, cosa que el aislamiento por RLS de app_role impediría.
 */
export class PostgresSchedulerRepository implements SchedulerRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async claimBatch(limit: number, workerId: string): Promise<Post[]> {
    // 1) `ranked`: numera los posts vencidos dentro de cada tenant por antigüedad
    //    (row_number PARTITION BY tenant_id) — así "el primero de cada tenant" entra antes que
    //    "el segundo de cualquier tenant", intercalando en vez de vaciar primero al más grande.
    // 2) `claimable`: ordena por (rn, scheduled_at) y aplica FOR UPDATE SKIP LOCKED — dos
    //    réplicas que compiten no se bloquean entre sí, cada una salta las filas que la otra ya
    //    está bloqueando y coge las siguientes disponibles.
    // 3) El UPDATE final repite `status = 'scheduled'` como defensa en profundidad: aunque el
    //    camino normal ya lo garantiza SKIP LOCKED, así una fila nunca se reclama dos veces
    //    aunque cambiara el plan de ejecución (p. ej. si Postgres dejara de inlinear el CTE).
    const { rows } = await this.pool.query<PostRow>(
      `
      WITH ranked AS (
        SELECT id, scheduled_at, row_number() OVER (PARTITION BY tenant_id ORDER BY scheduled_at) AS rn
        FROM posts
        WHERE status = 'scheduled' AND scheduled_at <= now()
      ),
      claimable AS (
        SELECT id FROM ranked ORDER BY rn, scheduled_at LIMIT $1 FOR UPDATE SKIP LOCKED
      )
      UPDATE posts
      SET status = 'publishing', claimed_at = now(), claimed_by = $2, updated_at = now()
      FROM claimable
      WHERE posts.id = claimable.id AND posts.status = 'scheduled'
      RETURNING posts.*
      `,
      [limit, workerId]
    );
    return rows.map(toPost);
  }

  async markPublished(postId: string, externalId: string): Promise<void> {
    // El WHERE status='publishing' hace la operación idempotente: si por lo que sea se llama
    // dos veces para el mismo post (bug, replay), la segunda no pisa el external_id ya guardado.
    await this.pool.query(
      `UPDATE posts
       SET status = 'published', published_at = now(), external_id = $2, updated_at = now()
       WHERE id = $1 AND status = 'publishing'`,
      [postId, externalId]
    );
  }

  async markFailed(
    postId: string,
    errorCode: string,
    errorMessage: string,
    opts: { retryable: boolean; retryDelayMs?: number }
  ): Promise<void> {
    const retryDelayMs = opts.retryDelayMs ?? 0;
    await this.pool.query(
      `UPDATE posts
       SET status = CASE WHEN $4 THEN 'scheduled' ELSE 'failed' END,
           scheduled_at = CASE WHEN $4 THEN now() + ($5 || ' milliseconds')::interval ELSE scheduled_at END,
           attempt_count = attempt_count + 1,
           last_error_code = $2,
           last_error_message = $3,
           claimed_at = NULL,
           claimed_by = NULL,
           updated_at = now()
       WHERE id = $1 AND status = 'publishing'`,
      [postId, errorCode, errorMessage, opts.retryable, retryDelayMs]
    );
  }

  async requeueStale(olderThanMs: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE posts
       SET status = 'scheduled', claimed_at = NULL, claimed_by = NULL, updated_at = now()
       WHERE status = 'publishing' AND claimed_at < now() - ($1 || ' milliseconds')::interval`,
      [olderThanMs]
    );
    return rowCount ?? 0;
  }
}
