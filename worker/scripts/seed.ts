/**
 * Seed de demo: 2 tenants, 1 Embajador por tenant, sus tokens OAuth (uno válido, uno revocado)
 * y posts en varios estados. Corre contra worker_role (BYPASSRLS, ve todos los tenants) porque
 * necesita escribir en varios tenants a la vez — nada que un tenant real pudiera hacer por sí
 * mismo, por eso vive en worker/ y no en app/.
 *
 * Uso: cd worker && pnpm exec tsx scripts/seed.ts
 * Requiere DATABASE_URL (worker_role) y TOKEN_ENCRYPTION_KEY en el entorno (mismas que .env).
 */
import { Pool } from "pg";
import { loadEncryptionKey, seal } from "../src/crypto/token-cipher.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const key = loadEncryptionKey(process.env);

async function upsertTenant(name: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name) VALUES ($1) RETURNING id`,
    [name]
  );
  return rows[0].id;
}

async function upsertProfile(tenantId: string, displayName: string, accountId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO profiles (tenant_id, display_name, provider_account_id) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, provider_account_id) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [tenantId, displayName, accountId]
  );
  return rows[0].id;
}

async function upsertToken(profileId: string, tenantId: string, status: "valid" | "expired" | "revoked") {
  const access = seal(`mock_valid_${profileId}`, key);
  const refresh = seal(`mock_valid_refresh_${profileId}`, key);
  const expiresAt = status === "expired" ? new Date(Date.now() - 3_600_000) : new Date(Date.now() + 3_600_000);
  await pool.query(
    `INSERT INTO oauth_tokens (profile_id, tenant_id, status, encrypted_access_token, encrypted_refresh_token, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (profile_id) DO UPDATE SET status = EXCLUDED.status, expires_at = EXCLUDED.expires_at`,
    [profileId, tenantId, status, access, refresh, expiresAt]
  );
}

async function insertPost(
  tenantId: string,
  profileId: string,
  content: string,
  status: "draft" | "scheduled" | "published" | "failed",
  scheduledAt: Date | null
) {
  await pool.query(
    `INSERT INTO posts (tenant_id, profile_id, content, status, scheduled_at, published_at, last_error_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      tenantId,
      profileId,
      content,
      status,
      scheduledAt,
      status === "published" ? new Date() : null,
      status === "failed" ? "PROVIDER_SERVER_ERROR" : null,
    ]
  );
}

async function main() {
  const tenantA = await upsertTenant("Ploot Demo — Tenant A");
  const tenantB = await upsertTenant("Ploot Demo — Tenant B");

  const profileA = await upsertProfile(tenantA, "Embajador A1 (token válido)", "demo-a1");
  const profileB = await upsertProfile(tenantB, "Embajador B1 (token revocado)", "demo-b1");

  await upsertToken(profileA, tenantA, "valid");
  await upsertToken(profileB, tenantB, "revoked");

  const now = Date.now();
  await insertPost(tenantA, profileA, "Post ya publicado (demo)", "published", null);
  await insertPost(tenantA, profileA, "Post programado en 2 minutos", "scheduled", new Date(now + 120_000));
  await insertPost(tenantA, profileA, "Borrador sin programar todavía", "draft", null);
  await insertPost(tenantB, profileB, "Post fallido (token revocado)", "failed", new Date(now - 60_000));

  console.log("Seed OK");
  console.log("tenantA:", tenantA, "profileA:", profileA);
  console.log("tenantB:", tenantB, "profileB:", profileB);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
