import type { Pool } from "pg";
import { TokenRevokedError, type ProviderPort, type TokenVaultPort } from "@ploot/core";
import { open, seal } from "../crypto/token-cipher.js";

interface TokenRow {
  status: "valid" | "expired" | "revoked";
  encrypted_access_token: Buffer;
  encrypted_refresh_token: Buffer;
  expires_at: Date;
}

/**
 * Implementación de TokenVaultPort. El descifrado ocurre solo aquí dentro — nada fuera de este
 * adaptador ve nunca un token en claro. Un token ausente se trata igual que uno revocado: falla
 * cerrado, no hay ningún estado en el que "no tengo credencial" deba dejar seguir publicando.
 */
export class PostgresTokenVault implements TokenVaultPort {
  constructor(
    private readonly pool: Pool,
    private readonly provider: ProviderPort,
    private readonly key: Buffer
  ) {}

  async getValidAccessToken(profileId: string): Promise<string> {
    const { rows } = await this.pool.query<TokenRow>(
      `SELECT status, encrypted_access_token, encrypted_refresh_token, expires_at
       FROM oauth_tokens WHERE profile_id = $1`,
      [profileId]
    );
    const row = rows[0];
    if (!row || row.status === "revoked") {
      throw new TokenRevokedError(profileId);
    }

    const isExpired = row.status === "expired" || row.expires_at.getTime() <= Date.now();
    if (!isExpired) {
      return open(row.encrypted_access_token, this.key);
    }

    return this.refreshAndPersist(profileId, open(row.encrypted_refresh_token, this.key));
  }

  private async refreshAndPersist(profileId: string, refreshToken: string): Promise<string> {
    try {
      const refreshed = await this.provider.refresh(profileId, refreshToken);
      await this.pool.query(
        `UPDATE oauth_tokens
         SET status = 'valid', encrypted_access_token = $2, encrypted_refresh_token = $3,
             expires_at = $4, updated_at = now()
         WHERE profile_id = $1`,
        [
          profileId,
          seal(refreshed.accessToken, this.key),
          seal(refreshed.refreshToken, this.key),
          refreshed.expiresAt,
        ]
      );
      return refreshed.accessToken;
    } catch (err) {
      // El refresh token también fue rechazado: irrecuperable, no tiene sentido reintentar.
      if (err instanceof TokenRevokedError) await this.markRevoked(profileId);
      throw err;
    }
  }

  async markRevoked(profileId: string): Promise<void> {
    await this.pool.query(
      `UPDATE oauth_tokens SET status = 'revoked', updated_at = now() WHERE profile_id = $1`,
      [profileId]
    );
  }
}
