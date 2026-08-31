import {
  DomainError,
  ProviderRateLimitedError,
  ProviderServerError,
  RateLimitBudgetExceededError,
  TokenExpiredError,
  TokenRevokedError,
  type Post,
  type ProviderPort,
  type RateLimiterPort,
  type SchedulerRepositoryPort,
  type TokenVaultPort,
} from "@ploot/core";
import { Semaphore } from "./semaphore.js";

export interface PublishOrchestratorConfig {
  workerId: string;
  batchSize: number;
  /** Cap de concurrencia compartido entre todos los tenants y Embajadores. */
  globalConcurrency: number;
  /** Cap de concurrencia por Embajador: ráfaga = riesgo de baneo, se throttlea, no se retry-storm. */
  profileConcurrency: number;
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

/**
 * Conecta los puertos del dominio en el ciclo claim → rate limit → token → publish → mark*.
 * `runOnce()` reclama un lote y lo procesa entero; el entrypoint (main.ts) decide la cadencia
 * con la que se llama en bucle. Ver DECISIONS.md para el porqué de cada rama de error.
 */
export class PublishOrchestrator {
  private readonly globalSemaphore: Semaphore;
  private readonly profileSemaphores = new Map<string, Semaphore>();

  constructor(
    private readonly scheduler: SchedulerRepositoryPort,
    private readonly rateLimiter: RateLimiterPort,
    private readonly tokenVault: TokenVaultPort,
    private readonly provider: ProviderPort,
    private readonly config: PublishOrchestratorConfig
  ) {
    this.globalSemaphore = new Semaphore(config.globalConcurrency);
  }

  async runOnce(): Promise<number> {
    const posts = await this.scheduler.claimBatch(this.config.batchSize, this.config.workerId);
    await Promise.all(posts.map((post) => this.processWithLimits(post)));
    return posts.length;
  }

  private profileSemaphore(profileId: string): Semaphore {
    let sem = this.profileSemaphores.get(profileId);
    if (!sem) {
      sem = new Semaphore(this.config.profileConcurrency);
      this.profileSemaphores.set(profileId, sem);
    }
    return sem;
  }

  private async processWithLimits(post: Post): Promise<void> {
    const releaseGlobal = await this.globalSemaphore.acquire();
    const releaseProfile = await this.profileSemaphore(post.profileId).acquire();
    try {
      await this.processOne(post);
    } finally {
      releaseProfile();
      releaseGlobal();
    }
  }

  private async processOne(post: Post): Promise<void> {
    // El rate limiter se consulta ANTES de llamar al proveedor — reaccionar solo a sus 429
    // reales ya sería tarde para evitar la ráfaga que arriesga la cuenta del Embajador.
    const appDecision = await this.rateLimiter.tryAcquire({ type: "app" });
    if (!appDecision.allowed) return this.deferForBudget(post, "app", appDecision.retryAfterMs);

    const profileDecision = await this.rateLimiter.tryAcquire({ type: "profile", profileId: post.profileId });
    if (!profileDecision.allowed) {
      return this.deferForBudget(post, `profile:${post.profileId}`, profileDecision.retryAfterMs);
    }

    try {
      const accessToken = await this.tokenVault.getValidAccessToken(post.profileId);
      const result = await this.provider.publish(post.profileId, accessToken, post.content);
      await this.scheduler.markPublished(post.id, result.externalId);
    } catch (err) {
      await this.handleFailure(post, err);
    }
  }

  private async deferForBudget(post: Post, scope: string, retryAfterMs: number): Promise<void> {
    const budgetError = new RateLimitBudgetExceededError(scope, retryAfterMs);
    await this.scheduler.markFailed(post.id, budgetError.code, budgetError.message, {
      retryable: true,
      retryDelayMs: retryAfterMs,
    });
  }

  private async handleFailure(post: Post, err: unknown): Promise<void> {
    // Revocado (por el token vault antes de publicar, o por el proveedor a mitad de lote):
    // irrecuperable, no se queman reintentos. markRevoked también aquí porque un 403 del
    // proveedor en publish() es la señal de que el token cacheado ya no sirve, aunque el vault
    // lo diera por válido segundos antes — dos réplicas pueden leerlo "válido" casi a la vez.
    if (err instanceof TokenRevokedError) {
      await this.tokenVault.markRevoked(post.profileId);
      return this.scheduler.markFailed(post.id, err.code, err.message, { retryable: false });
    }

    if (err instanceof ProviderRateLimitedError) {
      return this.retryOrGiveUp(post, err.code, err.message, err.retryAfterMs);
    }

    // 401 inesperado en publish() pese a que el vault acababa de validar el token: mismo tipo de
    // carrera que el caso anterior, pero recuperable en principio, así que se reintenta con
    // backoff en vez de matar el post a la primera — el siguiente intento vuelve a pasar por el
    // vault, que podría (o no) refrescarlo según lo que diga la fila en ese momento.
    if (err instanceof TokenExpiredError) {
      return this.retryOrGiveUp(post, err.code, err.message, this.backoffMs(post.attemptCount));
    }

    if (err instanceof ProviderServerError) {
      return this.retryOrGiveUp(post, err.code, err.message, this.backoffMs(post.attemptCount));
    }

    if (err instanceof DomainError) {
      // Cualquier otro error de dominio (p. ej. uno que no debería poder llegar hasta aquí) se
      // trata como definitivo: falla cerrado en vez de reintentar algo que no sabemos que es transitorio.
      return this.scheduler.markFailed(post.id, err.code, err.message, { retryable: false });
    }

    const message = err instanceof Error ? err.message : String(err);
    return this.retryOrGiveUp(post, "UNKNOWN_ERROR", message, this.backoffMs(post.attemptCount));
  }

  private async retryOrGiveUp(post: Post, code: string, message: string, retryDelayMs: number): Promise<void> {
    const isLastAttempt = post.attemptCount + 1 >= this.config.maxAttempts;
    await this.scheduler.markFailed(post.id, code, message, {
      retryable: !isLastAttempt,
      retryDelayMs: isLastAttempt ? undefined : retryDelayMs,
    });
  }

  /** Backoff exponencial con "full jitter" (AWS-style): evita que reintentos sincronizados entre posts golpeen el proveedor a la vez. */
  private backoffMs(attemptCount: number): number {
    const capped = Math.min(this.config.maxBackoffMs, this.config.baseBackoffMs * 2 ** attemptCount);
    return Math.floor(Math.random() * capped);
  }
}
