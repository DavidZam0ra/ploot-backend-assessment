import { Pool } from "pg";

/**
 * Test de integración: necesita Postgres real arriba con el esquema de db/migrations aplicado.
 * Usa el usuario del docker-compose local (superusuario del contenedor), no worker_role, para
 * no depender de que el bootstrap de contraseñas ya se haya ejecutado en esta máquina.
 */
export function createTestPool(): Pool {
  const connectionString =
    process.env.TEST_DATABASE_URL ?? "postgres://ploot:ploot@localhost:5432/ploot";
  return new Pool({ connectionString });
}

export async function seedTenantWithScheduledPost(
  pool: Pool,
  overrides: { scheduledAt?: Date } = {}
) {
  const {
    rows: [tenant],
  } = await pool.query("INSERT INTO tenants (name) VALUES ('Test tenant') RETURNING id");
  const {
    rows: [profile],
  } = await pool.query(
    `INSERT INTO profiles (tenant_id, display_name, provider_account_id)
     VALUES ($1, 'Test embajador', 'ext-' || gen_random_uuid()) RETURNING id`,
    [tenant.id]
  );
  const scheduledAt = overrides.scheduledAt ?? new Date(Date.now() - 60_000);
  const {
    rows: [post],
  } = await pool.query(
    `INSERT INTO posts (tenant_id, profile_id, status, content, scheduled_at)
     VALUES ($1, $2, 'scheduled', 'hola mundo', $3) RETURNING id`,
    [tenant.id, profile.id, scheduledAt]
  );

  return {
    tenantId: tenant.id as string,
    profileId: profile.id as string,
    postId: post.id as string,
  };
}
