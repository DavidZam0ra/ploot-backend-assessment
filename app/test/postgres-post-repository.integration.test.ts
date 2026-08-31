import { beforeEach, describe, expect, it } from "vitest";
import { PostNotEditableError, PostNotFoundError } from "@ploot/core";
import { PostgresPostRepository } from "../src/adapters/postgres-post-repository.js";
import { createAdminPool, createAppRolePool, seedPost, seedProfile, seedTenant } from "./setup.js";

// Requiere Postgres real con db/migrations/0001_init.sql Y db/bootstrap-roles.sql aplicados
// (app_role necesita contraseña real para poder conectarse — un superusuario se salta RLS).
const admin = createAdminPool();
const appRolePool = createAppRolePool();
const repo = new PostgresPostRepository(appRolePool);

beforeEach(async () => {
  await admin.query("TRUNCATE posts, oauth_tokens, profiles, tenants CASCADE");
});

async function seedTwoTenants() {
  const tenantA = await seedTenant(admin, "Tenant A");
  const tenantB = await seedTenant(admin, "Tenant B");
  const profileA = await seedProfile(admin, tenantA);
  const profileB = await seedProfile(admin, tenantB);
  return { tenantA, tenantB, profileA, profileB };
}

describe("PostgresPostRepository — dentro del propio tenant", () => {
  it("create + findById funcionan con normalidad", async () => {
    const tenantId = await seedTenant(admin);
    const profileId = await seedProfile(admin, tenantId);

    const created = await repo.create({ tenantId, profileId, content: "hola", scheduledAt: null });
    expect(created.status).toBe("draft");

    const found = await repo.findById(tenantId, created.id);
    expect(found?.id).toBe(created.id);
  });

  it("update() en un post published lanza PostNotEditableError", async () => {
    const tenantId = await seedTenant(admin);
    const profileId = await seedProfile(admin, tenantId);
    const postId = await seedPost(admin, { tenantId, profileId, status: "published" });

    await expect(repo.update(tenantId, postId, { content: "editado" })).rejects.toThrow(PostNotEditableError);
  });

  it("cancel() en un post published lanza PostNotEditableError", async () => {
    const tenantId = await seedTenant(admin);
    const profileId = await seedProfile(admin, tenantId);
    const postId = await seedPost(admin, { tenantId, profileId, status: "published" });

    await expect(repo.cancel(tenantId, postId)).rejects.toThrow(PostNotEditableError);
  });

  it("list() sí ve los posts de su propio tenant", async () => {
    const tenantId = await seedTenant(admin);
    const profileId = await seedProfile(admin, tenantId);
    await seedPost(admin, { tenantId, profileId });
    await seedPost(admin, { tenantId, profileId });

    const result = await repo.list({ tenantId, limit: 10 });
    expect(result.items).toHaveLength(2);
  });
});

describe("PostgresPostRepository — aislamiento cross-tenant (a nivel SQL, vía RLS)", () => {
  it("findById no devuelve el post de otro tenant (ni error, ni datos: invisible)", async () => {
    const { tenantA, tenantB, profileA } = await seedTwoTenants();
    const postOfA = await seedPost(admin, { tenantId: tenantA, profileId: profileA });

    const result = await repo.findById(tenantB, postOfA);
    expect(result).toBeNull();
  });

  it("update() sobre el post de otro tenant falla como 'no encontrado', no revela que existe", async () => {
    const { tenantA, tenantB, profileA } = await seedTwoTenants();
    const postOfA = await seedPost(admin, { tenantId: tenantA, profileId: profileA });

    await expect(repo.update(tenantB, postOfA, { content: "intento hostil" })).rejects.toThrow(PostNotFoundError);

    // Y el contenido real no cambió — la RLS rechazó el UPDATE a nivel de fila, no fue un no-op de la app.
    const stillIntact = await repo.findById(tenantA, postOfA);
    expect(stillIntact?.content).not.toBe("intento hostil");
  });

  it("cancel() sobre el post de otro tenant también falla como 'no encontrado'", async () => {
    const { tenantA, tenantB, profileA } = await seedTwoTenants();
    const postOfA = await seedPost(admin, { tenantId: tenantA, profileId: profileA });

    await expect(repo.cancel(tenantB, postOfA)).rejects.toThrow(PostNotFoundError);

    const stillScheduled = await repo.findById(tenantA, postOfA);
    expect(stillScheduled?.status).not.toBe("cancelled");
  });

  it("list() de un tenant nunca incluye posts de otro, aunque el otro tenga muchos más", async () => {
    const { tenantA, tenantB, profileA, profileB } = await seedTwoTenants();
    await seedPost(admin, { tenantId: tenantB, profileId: profileB });
    await seedPost(admin, { tenantId: tenantB, profileId: profileB });
    await seedPost(admin, { tenantId: tenantB, profileId: profileB });
    const postOfA = await seedPost(admin, { tenantId: tenantA, profileId: profileA });

    const result = await repo.list({ tenantId: tenantA, limit: 10 });
    expect(result.items.map((p) => p.id)).toEqual([postOfA]);
  });

  it("crear un post con un tenant_id distinto al de la sesión lo rechaza Postgres (RLS WITH CHECK), no solo la app", async () => {
    const { tenantA, tenantB, profileB } = await seedTwoTenants();
    // Ataca directamente por debajo del repositorio: fija la sesión en tenantA pero intenta
    // insertar una fila con tenant_id de tenantB. Si esto se colase, sería un bypass real de RLS.
    const client = await appRolePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await expect(
        client.query(
          `INSERT INTO posts (tenant_id, profile_id, status, content) VALUES ($1, $2, 'draft', 'colado')`,
          [tenantB, profileB]
        )
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("sin app.tenant_id fijado en la sesión, ninguna fila es visible (falla cerrado, no abierto)", async () => {
    const { tenantA, profileA } = await seedTwoTenants();
    await seedPost(admin, { tenantId: tenantA, profileId: profileA });

    const client = await appRolePool.connect();
    try {
      const { rows } = await client.query("SELECT count(*)::int AS n FROM posts");
      expect(rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });
});
