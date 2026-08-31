/**
 * Único punto de acceso a tokens OAuth en claro. La implementación descifra, comprueba
 * expiración y llama a ProviderPort.refresh() cuando hace falta, sin exponer nunca el secreto
 * fuera de este adaptador.
 */
export interface TokenVaultPort {
  /**
   * Devuelve un access token válido para el Embajador, refrescándolo primero si estaba
   * expirado. Lanza TokenRevokedError si el refresh falla de forma irrecuperable — el llamador
   * (worker) debe marcar el post failed sin quemar reintentos, no reintentar el token.
   */
  getValidAccessToken(profileId: string): Promise<string>;

  markRevoked(profileId: string): Promise<void>;
}
