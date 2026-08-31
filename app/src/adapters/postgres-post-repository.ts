import type { Pool, PoolClient } from "pg";
import {
  PostNotEditableError,
  PostNotFoundError,
  type CreatePostInput,
  type ListPostsQuery,
  type ListPostsResult,
  type Post,
  type PostRepositoryPort,
  type UpdatePostInput,
} from "@ploot/core";
import { toPost, type PostRow } from "../mappers/post-row";
import { decodeCursor, encodeCursor } from "./cursor";

/**
 * Implementación de PostRepositoryPort contra app_role. Cada operación abre su propia
 * transacción y fija `SET LOCAL app.tenant_id` antes de tocar la tabla (compatible con PgBouncer
 * en transaction mode: SET LOCAL vive solo dentro de la transacción). El aislamiento real de
 * tenant lo da la política RLS de db/migrations/0001_init.sql, no el `tenantId` que recibe cada
 * método — ese parámetro es defensa en profundidad, no la garantía. Si este código tuviera un
 * bug y omitiera un WHERE, Postgres seguiría rechazando filas de otro tenant.
 */
export class PostgresPostRepository implements PostRepositoryPort {
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

  private async loadOrThrow(client: PoolClient, postId: string): Promise<PostRow> {
    const { rows } = await client.query<PostRow>("SELECT * FROM posts WHERE id = $1", [postId]);
    if (!rows[0]) throw new PostNotFoundError(postId);
    return rows[0];
  }

  async create(input: CreatePostInput): Promise<Post> {
    return this.withTenant(input.tenantId, async (client) => {
      const status = input.scheduledAt ? "scheduled" : "draft";
      const { rows } = await client.query<PostRow>(
        `INSERT INTO posts (tenant_id, profile_id, status, content, scheduled_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [input.tenantId, input.profileId, status, input.content, input.scheduledAt]
      );
      return toPost(rows[0]);
    });
  }

  async findById(tenantId: string, postId: string): Promise<Post | null> {
    return this.withTenant(tenantId, async (client) => {
      const { rows } = await client.query<PostRow>("SELECT * FROM posts WHERE id = $1", [postId]);
      return rows[0] ? toPost(rows[0]) : null;
    });
  }

  async update(tenantId: string, postId: string, input: UpdatePostInput): Promise<Post> {
    return this.withTenant(tenantId, async (client) => {
      const hasScheduledAt = "scheduledAt" in input;
      const { rows } = await client.query<PostRow>(
        `UPDATE posts
         SET content = COALESCE($2, content),
             scheduled_at = CASE WHEN $3 THEN $4 ELSE scheduled_at END,
             status = CASE WHEN $3 AND $4 IS NOT NULL AND status = 'draft' THEN 'scheduled'::post_status ELSE status END,
             updated_at = now()
         WHERE id = $1 AND status <> 'published'
         RETURNING *`,
        [postId, input.content ?? null, hasScheduledAt, input.scheduledAt ?? null]
      );
      if (rows[0]) return toPost(rows[0]);
      const existing = await this.loadOrThrow(client, postId);
      throw new PostNotEditableError(postId, existing.status);
    });
  }

  async cancel(tenantId: string, postId: string): Promise<Post> {
    return this.withTenant(tenantId, async (client) => {
      const { rows } = await client.query<PostRow>(
        `UPDATE posts SET status = 'cancelled'::post_status, updated_at = now()
         WHERE id = $1 AND status <> 'published'
         RETURNING *`,
        [postId]
      );
      if (rows[0]) return toPost(rows[0]);
      const existing = await this.loadOrThrow(client, postId);
      throw new PostNotEditableError(postId, existing.status);
    });
  }

  async list(query: ListPostsQuery): Promise<ListPostsResult> {
    return this.withTenant(query.tenantId, async (client) => {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (query.status) {
        params.push(query.status);
        conditions.push(`status = $${params.length}`);
      }
      if (query.cursor) {
        const { createdAt, id } = decodeCursor(query.cursor);
        params.push(createdAt, id);
        conditions.push(`(created_at, id) < ($${params.length - 1}, $${params.length})`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      params.push(query.limit + 1);

      const { rows } = await client.query<PostRow>(
        `SELECT * FROM posts ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
        params
      );

      const hasMore = rows.length > query.limit;
      const items = rows.slice(0, query.limit).map(toPost);
      return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null };
    });
  }
}
