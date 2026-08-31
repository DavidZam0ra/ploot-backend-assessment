export interface ReserveResult<T> {
  isNew: boolean;
  existingResult: T | null;
}

/**
 * Usado por POST /api/v1/posts/:id/publish vía header Idempotency-Key. reserve() debe ser
 * atómico: dos requests concurrentes con la misma clave no deben producir dos publicaciones.
 */
export interface IdempotencyPort {
  reserve<T>(tenantId: string, key: string): Promise<ReserveResult<T>>;
  complete<T>(tenantId: string, key: string, result: T): Promise<void>;
}
