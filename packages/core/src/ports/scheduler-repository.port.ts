import { Post } from "../domain/post";

/**
 * Puerto usado por worker/. A diferencia de PostRepositoryPort, opera a través de todos los
 * tenants (necesita worker_role con BYPASSRLS) porque el reparto justo de la cola exige verlos
 * todos a la vez.
 */
export interface SchedulerRepositoryPort {
  /**
   * Reclama hasta `limit` posts vencidos (scheduled_at <= now(), status = scheduled),
   * intercalados de forma justa entre tenants (round-robin por tenant, más antiguo primero
   * dentro de cada tenant — para que un tenant grande no vacíe la cola antes que el resto),
   * y los transiciona a 'publishing' en la misma transacción corta vía FOR UPDATE SKIP LOCKED.
   * Dos workers concurrentes nunca reciben el mismo post.
   */
  claimBatch(limit: number, workerId: string): Promise<Post[]>;

  markPublished(postId: string, externalId: string): Promise<void>;

  markFailed(
    postId: string,
    errorCode: string,
    errorMessage: string,
    opts: { retryable: boolean }
  ): Promise<void>;

  /**
   * Devuelve a 'scheduled' los posts atascados en 'publishing' desde hace más de olderThanMs
   * (el worker que los reclamó murió antes de completar la publicación). Es lo que hace segura
   * la operación con N réplicas frente a un crash a mitad de publicación.
   */
  requeueStale(olderThanMs: number): Promise<number>;
}
