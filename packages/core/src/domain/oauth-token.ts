export type TokenStatus = "valid" | "expired" | "revoked";

/**
 * Representación en el dominio de un token OAuth. Nunca contiene el secreto en claro —
 * el descifrado ocurre solo dentro del adaptador que implementa TokenVaultPort.
 */
export interface OAuthTokenMeta {
  profileId: string;
  tenantId: string;
  status: TokenStatus;
  expiresAt: Date;
  updatedAt: Date;
}
