import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, issueToken, loadConfig } from "@ploot/mock-provider";
import { TokenRevokedError } from "@ploot/core";
import { HttpProviderAdapter } from "../src/adapters/http-provider-adapter.js";
import { PostgresTokenVault } from "../src/adapters/postgres-token-vault.js";
import { open } from "../src/crypto/token-cipher.js";
import { createTestPool, seedOAuthToken, seedProfile } from "./setup.js";

// Requiere Postgres real (docker compose up postgres) con db/migrations/0001_init.sql aplicado.
// Reutiliza el mock del proveedor real (mismo que HttpProviderAdapter): sus tokens ya usan el
// formato mock_<state>_<uuid>, así que sirven tal cual como el "secreto" que este vault cifra.

const pool = createTestPool();
const key = randomBytes(32);
const mockConfig = loadConfig({ MOCK_MAX_LATENCY_MS: "0" });
const mockServer = createServer(mockConfig);
let provider: HttpProviderAdapter;
let vault: PostgresTokenVault;

beforeAll(async () => {
  await new Promise<void>((resolve) => mockServer.listen(0, resolve));
  const { port } = mockServer.address() as AddressInfo;
  provider = new HttpProviderAdapter(`http://127.0.0.1:${port}`);
  vault = new PostgresTokenVault(pool, provider, key);
});

afterAll(async () => {
  mockServer.close();
  await pool.end();
});

beforeEach(async () => {
  await pool.query("TRUNCATE posts, oauth_tokens, profiles, tenants CASCADE");
});

describe("PostgresTokenVault.getValidAccessToken", () => {
  it("token válido y no caducado -> lo descifra y lo devuelve sin llamar al proveedor", async () => {
    const { profileId, tenantId } = await seedProfile(pool);
    await seedOAuthToken(pool, key, {
      profileId,
      tenantId,
      status: "valid",
      accessToken: "mock_valid_original-access",
      refreshToken: "mock_valid_original-refresh",
    });

    const token = await vault.getValidAccessToken(profileId);
    expect(token).toBe("mock_valid_original-access");
  });

  it("token caducado (expires_at en el pasado) -> lo refresca contra el proveedor y persiste el nuevo", async () => {
    const { profileId, tenantId } = await seedProfile(pool);
    await seedOAuthToken(pool, key, {
      profileId,
      tenantId,
      status: "valid",
      accessToken: "mock_valid_viejo",
      refreshToken: issueToken("valid"),
      expiresAt: new Date(Date.now() - 1000),
    });

    const token = await vault.getValidAccessToken(profileId);
    expect(token).toMatch(/^mock_valid_/);
    expect(token).not.toBe("mock_valid_viejo");

    const { rows } = await pool.query<{
      status: string;
      encrypted_access_token: Buffer;
      expires_at: Date;
    }>("SELECT status, encrypted_access_token, expires_at FROM oauth_tokens WHERE profile_id = $1", [profileId]);
    expect(rows[0].status).toBe("valid");
    expect(open(rows[0].encrypted_access_token, key)).toBe(token);
    expect(rows[0].expires_at.getTime()).toBeGreaterThan(Date.now());
  });

  it("status='expired' explícito (aunque expires_at no haya pasado) también dispara el refresh", async () => {
    const { profileId, tenantId } = await seedProfile(pool);
    await seedOAuthToken(pool, key, {
      profileId,
      tenantId,
      status: "expired",
      accessToken: "mock_expired_viejo",
      refreshToken: issueToken("valid"),
    });

    const token = await vault.getValidAccessToken(profileId);
    expect(token).toMatch(/^mock_valid_/);
  });

  it("token revocado -> TokenRevokedError sin llamar al proveedor", async () => {
    const { profileId, tenantId } = await seedProfile(pool);
    await seedOAuthToken(pool, key, {
      profileId,
      tenantId,
      status: "revoked",
      accessToken: "mock_revoked_x",
      refreshToken: "mock_revoked_x",
    });

    await expect(vault.getValidAccessToken(profileId)).rejects.toThrow(TokenRevokedError);
  });

  it("el refresh token también es rechazado por el proveedor -> marca la fila revoked y lanza TokenRevokedError", async () => {
    const { profileId, tenantId } = await seedProfile(pool);
    await seedOAuthToken(pool, key, {
      profileId,
      tenantId,
      status: "valid",
      accessToken: "mock_valid_viejo",
      refreshToken: issueToken("revoked"), // el propio proveedor rechazará este refresh
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(vault.getValidAccessToken(profileId)).rejects.toThrow(TokenRevokedError);

    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM oauth_tokens WHERE profile_id = $1",
      [profileId]
    );
    expect(rows[0].status).toBe("revoked");
  });

  it("perfil sin fila de token -> TokenRevokedError (falla cerrado)", async () => {
    const { profileId } = await seedProfile(pool);
    await expect(vault.getValidAccessToken(profileId)).rejects.toThrow(TokenRevokedError);
  });
});

describe("PostgresTokenVault.markRevoked", () => {
  it("pone status='revoked' aunque el token estuviera válido", async () => {
    const { profileId, tenantId } = await seedProfile(pool);
    await seedOAuthToken(pool, key, {
      profileId,
      tenantId,
      status: "valid",
      accessToken: "mock_valid_x",
      refreshToken: "mock_valid_x",
    });

    await vault.markRevoked(profileId);

    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM oauth_tokens WHERE profile_id = $1",
      [profileId]
    );
    expect(rows[0].status).toBe("revoked");
  });
});
