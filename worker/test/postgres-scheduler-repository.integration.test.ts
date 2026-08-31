import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresSchedulerRepository } from "../src/adapters/postgres-scheduler-repository.js";
import { createTestPool, seedTenantWithScheduledPost } from "./setup.js";

// Requiere Postgres real con db/migrations/0001_init.sql aplicado (docker compose up postgres).
// TEST_DATABASE_URL sobreescribe la conexión por defecto si hace falta.

const pool = createTestPool();
// Dos instancias sobre el mismo pool de conexiones representan dos réplicas del worker
// compitiendo por el mismo trabajo — es lo que estas pruebas necesitan simular.
const repoA = new PostgresSchedulerRepository(pool);
const repoB = new PostgresSchedulerRepository(pool);

beforeEach(async () => {
  await pool.query("TRUNCATE posts, oauth_tokens, profiles, tenants CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("PostgresSchedulerRepository — seguro con N réplicas", () => {
  it("un post vencido lo reclama como máximo una réplica, aunque compitan en paralelo", async () => {
    const { postId } = await seedTenantWithScheduledPost(pool);

    const [batchA, batchB] = await Promise.all([
      repoA.claimBatch(10, "worker-A"),
      repoB.claimBatch(10, "worker-B"),
    ]);

    const claimedIds = [...batchA, ...batchB].map((p) => p.id);
    expect(claimedIds.filter((id) => id === postId)).toHaveLength(1);
  });

  it("markPublished es un no-op si el post ya no está en publishing (no hay doble publicación)", async () => {
    const { postId } = await seedTenantWithScheduledPost(pool);
    const [claimed] = await repoA.claimBatch(10, "worker-A");
    expect(claimed.id).toBe(postId);

    await repoA.markPublished(postId, "ext-123");
    // Si por un bug otro worker intentara publicar el mismo post otra vez, no debe pisar el resultado.
    await repoA.markPublished(postId, "ext-456-no-deberia-verse");

    const { rows } = await pool.query<{ status: string; external_id: string }>(
      "SELECT status, external_id FROM posts WHERE id = $1",
      [postId]
    );
    expect(rows[0].status).toBe("published");
    expect(rows[0].external_id).toBe("ext-123");
  });

  it("requeueStale recupera un post cuyo worker murió a mitad de publicación, sin haberlo publicado", async () => {
    const { postId } = await seedTenantWithScheduledPost(pool);
    // La réplica reclama y "muere" antes de llamar a markPublished/markFailed.
    await repoA.claimBatch(10, "worker-A");

    const recovered = await repoA.requeueStale(0); // umbral 0 = cualquier reclamo cuenta como obsoleto en el test
    expect(recovered).toBe(1);

    const { rows } = await pool.query<{
      status: string;
      claimed_at: string | null;
      claimed_by: string | null;
      external_id: string | null;
    }>("SELECT status, claimed_at, claimed_by, external_id FROM posts WHERE id = $1", [postId]);
    expect(rows[0].status).toBe("scheduled");
    expect(rows[0].claimed_at).toBeNull();
    expect(rows[0].claimed_by).toBeNull();
    expect(rows[0].external_id).toBeNull(); // nunca se llegó a publicar de verdad

    // Otra réplica puede reclamarlo y completarlo con normalidad.
    const [reclaimed] = await repoB.claimBatch(10, "worker-B");
    expect(reclaimed.id).toBe(postId);
  });

  it("reparte de forma justa entre tenants: un tenant pequeño no espera detrás de uno grande", async () => {
    const big = await seedTenantWithScheduledPost(pool, {
      scheduledAt: new Date(Date.now() - 120_000),
    });
    // 4 posts más antiguos, todos del mismo tenant grande.
    for (let i = 0; i < 4; i++) {
      await pool.query(
        `INSERT INTO posts (tenant_id, profile_id, status, content, scheduled_at)
         VALUES ($1, $2, 'scheduled', 'post extra', now() - interval '3 minutes')`,
        [big.tenantId, big.profileId]
      );
    }
    const small = await seedTenantWithScheduledPost(pool, {
      scheduledAt: new Date(Date.now() - 30_000),
    });

    // Sin el reparto por tenant, un LIMIT 2 ordenado solo por scheduled_at se llevaría los dos
    // posts más antiguos del tenant grande y dejaría al pequeño esperando.
    const claimed = await repoA.claimBatch(2, "worker-A");
    const tenantIds = claimed.map((p) => p.tenantId);
    expect(tenantIds).toContain(small.tenantId);
  });
});
