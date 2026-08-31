import {
  ProviderRateLimitedError,
  ProviderServerError,
  TokenExpiredError,
  TokenRevokedError,
  type ProviderPort,
  type PublishResult,
  type RefreshedToken,
} from "@ploot/core";

const DEFAULT_RETRY_AFTER_MS = 5_000;

/** `Retry-After` es en segundos por spec HTTP; si el mock (o el proveedor real) no lo manda, no nos quedamos sin valor. */
function retryAfterMsFrom(headers: Headers): number {
  const raw = headers.get("retry-after");
  const seconds = raw ? Number(raw) : NaN;
  return Number.isFinite(seconds) ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;
}

/**
 * Adaptador de ProviderPort contra el mock HTTP de app/mock-provider (mismo contrato que tendría
 * el proveedor real). Traduce cada respuesta a los errores tipados del dominio — el resto del
 * worker nunca ve un status code crudo.
 */
export class HttpProviderAdapter implements ProviderPort {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async publish(profileId: string, accessToken: string, content: string): Promise<PublishResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/provider/publish`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content }),
    });

    if (res.status === 200) {
      const body = (await res.json()) as { externalId: string };
      return { externalId: body.externalId };
    }
    if (res.status === 429) throw new ProviderRateLimitedError(retryAfterMsFrom(res.headers));
    if (res.status === 401) throw new TokenExpiredError(profileId);
    if (res.status === 403) throw new TokenRevokedError(profileId);
    throw new ProviderServerError(`Provider publish respondió ${res.status}`);
  }

  async refresh(profileId: string, refreshToken: string): Promise<RefreshedToken> {
    const res = await this.fetchImpl(`${this.baseUrl}/provider/oauth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (res.status === 200) {
      const body = (await res.json()) as { accessToken: string; refreshToken: string; expiresIn: number };
      return {
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        expiresAt: new Date(Date.now() + body.expiresIn * 1000),
      };
    }
    if (res.status === 403 || res.status === 401) throw new TokenRevokedError(profileId);
    throw new ProviderServerError(`Provider refresh respondió ${res.status}`);
  }
}
