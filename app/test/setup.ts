import { Pool } from "pg";

/**
 * Dos pools a propósito: `admin` (superusuario, salta RLS) para sembrar datos de prueba, y
 * `appRole` (app_role, RLS activo) para las operaciones bajo test. Si el repositorio usara el
 * pool admin no probaríamos nada — un superusuario ignora RLS por completo.
 */
export function createAdminPool(): Pool {
  return new Pool({
    connectionString: process.env.TEST_DATABASE_URL ?? "postgres://ploot:ploot@localhost:5432/ploot",
  });
}

export function createAppRolePool(): Pool {
  return new Pool({
    connectionString:
      process.env.TEST_APP_ROLE_DATABASE_URL ??
      "postgres://app_role:app_role_test_password@localhost:5432/ploot",
  });
}

export async function seedTenant(pool: Pool, name = "Test tenant"): Promise<string> {
  const {
    rows: [tenant],
  } = await pool.query("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name]);
  return tenant.id as string;
}

export async function seedProfile(pool: Pool, tenantId: string): Promise<string> {
  const {
    rows: [profile],
  } = await pool.query(
    `INSERT INTO profiles (tenant_id, display_name, provider_account_id)
     VALUES ($1, 'Test embajador', 'ext-' || gen_random_uuid()) RETURNING id`,
    [tenantId]
  );
  return profile.id as string;
}

export async function seedPost(
  pool: Pool,
  params: { tenantId: string; profileId: string; status?: string; content?: string }
): Promise<string> {
  const {
    rows: [post],
  } = await pool.query(
    `INSERT INTO posts (tenant_id, profile_id, status, content, scheduled_at)
     VALUES ($1, $2, $3::post_status, $4, CASE WHEN $3::text = 'scheduled' THEN now() ELSE NULL END) RETURNING id`,
    [params.tenantId, params.profileId, params.status ?? "draft", params.content ?? "hola mundo"]
  );
  return post.id as string;
}
