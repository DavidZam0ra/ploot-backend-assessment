export interface PublishResult {
  externalId: string;
}

export interface RefreshedToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Adaptador contra el proveedor externo (o su mock, mismo contrato). Implementaciones deben
 * lanzar los errores tipados de ../errors — nunca dejar pasar un status HTTP crudo hacia el
 * dominio: ProviderRateLimitedError (429, con Retry-After), ProviderServerError (5xx),
 * TokenExpiredError / TokenRevokedError según corresponda.
 */
export interface ProviderPort {
  publish(accessToken: string, content: string): Promise<PublishResult>;
  refresh(refreshToken: string): Promise<RefreshedToken>;
}
