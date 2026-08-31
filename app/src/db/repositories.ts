import { PostgresPostRepository } from "../adapters/postgres-post-repository";
import { PostgresIdempotencyStore } from "../adapters/postgres-idempotency";
import { getPool } from "./pool";

let postRepository: PostgresPostRepository | undefined;
let idempotencyStore: PostgresIdempotencyStore | undefined;

export function getPostRepository(): PostgresPostRepository {
  if (!postRepository) postRepository = new PostgresPostRepository(getPool());
  return postRepository;
}

export function getIdempotencyStore(): PostgresIdempotencyStore {
  if (!idempotencyStore) idempotencyStore = new PostgresIdempotencyStore(getPool());
  return idempotencyStore;
}
