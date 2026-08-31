import { Post, PostStatus } from "../domain/post.js";

export interface CreatePostInput {
  tenantId: string;
  profileId: string;
  content: string;
  /** null => draft. Con valor => scheduled. */
  scheduledAt: Date | null;
}

export interface UpdatePostInput {
  content?: string;
  scheduledAt?: Date | null;
}

export interface ListPostsQuery {
  tenantId: string;
  status?: PostStatus;
  limit: number;
  cursor?: string;
}

export interface ListPostsResult {
  items: Post[];
  nextCursor: string | null;
}

/**
 * Puerto usado por la API (app/). Todos los métodos exigen tenantId explícito como defensa en
 * profundidad, pero la garantía real de aislamiento la da RLS en la capa de datos (ver
 * db/migrations/0001_init.sql) — este puerto solo no puede depender de que el Route Handler
 * lo filtre correctamente.
 */
export interface PostRepositoryPort {
  create(input: CreatePostInput): Promise<Post>;
  findById(tenantId: string, postId: string): Promise<Post | null>;
  update(tenantId: string, postId: string, input: UpdatePostInput): Promise<Post>;
  /** Rechazado si status = published (regla de negocio, no solo de datos). */
  cancel(tenantId: string, postId: string): Promise<Post>;
  list(query: ListPostsQuery): Promise<ListPostsResult>;
}
