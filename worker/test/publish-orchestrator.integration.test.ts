import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, issueToken, loadConfig } from "@ploot/mock-provider";
import type { ProviderPort, PublishResult, RefreshedToken } from "@ploot/core";
import { PostgresSchedulerRepository } from "../src/adapters/postgres-scheduler-repository.js";
import { PostgresTokenVault } from "../src/adapters/postgres-token-vault.js";
import { PostgresRateLimiter, type RateLimiterConfig } from "../src/adapters/postgres-rate-limiter.js";
import { HttpProviderAdapter } from "../src/adapters/http-provider-adapter.js";
import { SystemClock } from "../src/adapters/system-clock.js";
import { PublishOrchestrator, type PublishOrchestratorConfig } from "../src/publish-orchestrator.js";
import { createTestPool, seedOAuthToken, seedProfile } from "./setup.js";

// Requiere Postgres real con db/migrations/0001_init.sql aplicado (incluida rate_limit_windows).
const pool = createTestPool();
const key = randomBytes(32);
const clock = new SystemClock();
const mockConfig = loadConfig({
  MOCK_MAX_LATENCY_MS: "0",
  MOCK_RATE_LIMIT_PROBABILITY: "0",
  MOCK_SERVER_ERROR_PROBABILITY: "0",
});
const mockServer = createServer(mockConfig);
let mockBaseUrl: string;

const scheduler = new PostgresSchedulerRepository(pool);
const GENEROUS_LIMITS: RateLimiterConfig = { appLimit: 1000, appWindowMs: 1000, profileLimit: 1000, profileWindowMs: 1000 };

function fetchForcing(force: string): typeof fetch {
  return (input, init) =>
    fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), "x-mock-force": force } });
}

function baseConfig(overrides: Partial<PublishOrchestratorConfig> = {}): PublishOrchestratorConfig {
  return {
    workerId: "orchestrator-test",
    batchSize: 10,
    globalConcurrency: 10,
    profileConcurrency: 1,
    maxAttempts: 5,
    baseBackoffMs: 1,
    maxBackoffMs: 10,
    ...overrides,
  };
}

async function forceScheduledIntoThePast(postId: string): Promise<void> {
  await pool.query("UPDATE posts SET scheduled_at = now() - interval '1 second' WHERE id = $1", [postId]);
}

async function fetchPost(postId: string) {
  const { rows } = await pool.query<{
    status: string;
    attempt_count: number;
    last_error_code: string | null;
    external_id: string | null;
  }>("SELECT status, attempt_count, last_error_code, external_id FROM posts WHERE id = $1", [postId]);
  return rows[0];
}

beforeAll(async () => {
  await new Promise<void>((resolve) => mockServer.listen(0, resolve));
  const { port } = mockServer.address() as AddressInfo;
  mockBaseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  mockServer.close();
  await pool.end();
});

beforeEach(async () => {
  await pool.query("TRUNCATE posts, oauth_tokens, profiles, tenants CASCADE");
  await pool.query("TRUNCATE rate_limit_windows");
});

describe("PublishOrchestrator — camino feliz", () => {
  it("token válido + proveedor OK -> published con externalId", async () => {
    const { profileId, tenantId } = await seedProfile(pool);
    await seedOAuthToken(pool, key, {
      profileId,
      tenantId,
      status: "valid",
      accessToken: issueToken("valid"),
      refreshToken: issueToken("valid"),
    });
    const {
      rows: [post],
    } = await pool.query(
      `INSERT INTO posts (tenant_id, profile_id, status, content, scheduled_at)
       VALUES ($1, $2, 'scheduled', 'hola mundo', now() - interval '1 minute') RETURNING id`,
      [tenantId, profileId]
    );

    const provider = new HttpProviderAdapter(mockBaseUrl);
    const vault = new PostgresTokenVault(pool, provider, key);
    const rateLimiter = new PostgresRateLimiter(pool, GENEROUS_LIMITS, clock);
    const orchestrator = new PublishOrchestrator(scheduler, rateLimiter, vault, provider, baseConfig());

    const claimed = await orchestrator.runOnce();
    expect(claimed).toBe(1);

    const row = await fetchPost(post.id);
    expect(row.status).toBe("published");
    expect(row.external_id).toMatch(/^mock-ext-/);
  });
});

describe("PublishOrchestrator — presupuesto de rate limit", () => {
  it("presupuesto de 'app' agotado -> no llama al proveedor, reintentable con el retryAfterMs del limiter", async () => {
    const { profileId, tenantId } = await seedProfile(pool);
    await seedOAuthToken(pool, key, {
      profileId,
      tenantId,
      status: "valid",
      accessToken: issueToken("valid"),
      refreshToken: issueToken("valid"),
    });
    const {
      rows: [post],
    } = await pool.query(
      `INSERT INTO posts (tenant_id, profile_id, status, content, scheduled_at)
       VALUES ($1, $2, 'scheduled', 'hola', now() - interval '1 minute') RETURNING id`,
      [tenantId, profileId]
    );

    const provider = new HttpProviderAdapter(mockBaseUrl);
    const vault = new PostgresTokenVault(pool, provider, key);
    const rateLimiter = new PostgresRateLimiter(
      pool,
      { appLimit: 1, appWindowMs: 60_000, profileLimit: 1000, profileWindowMs: 1000 },
      clock
    );
    await rateLimiter.tryAcquire({ type: "app" }); // agota el único slot de 'app' antes de que corra el worker

    const orchestrator = new PublishOrchestrator(scheduler, rateLimiter, vault, provider, baseConfig());
    await orchestrator.runOnce();

    const row = await fetchPost(post.id);
    expect(row.status).toBe("scheduled"); // sigue en cola, no se marcó failed definitivo
    expect(row.attempt_count).toBe(1);
    expect(row.last_error_code).toBe("RATE_LIMIT_BUDGET_EXCEEDED");
  });

  it("presupuesto de un Embajador agotado no afecta a otros Embajadores", async () => {
    const noisy = await seedProfile(pool);
    const quiet = await seedProfile(pool);
    for (const { profileId, tenantId } of [noisy, quiet]) {
      await seedOAuthToken(pool, key, {
        profileId,
        tenantId,
        status: "valid",
        accessToken: issueToken("valid"),
        refreshToken: issueToken("valid"),
      });
    }
    const {
      rows: [quietPost],
    } = await pool.query(
      `INSERT INTO posts (tenant_id, profile_id, status, content, scheduled_at)
       VALUES ($1, $2, 'scheduled', 'hola', now() - interval '1 minute') RETURNING id`,
      [quiet.tenantId, quiet.profileId]
    );

    const provider = new HttpProviderAdapter(mockBaseUrl);
    const vault = new PostgresTokenVault(pool, provider, key);
    const rateLimiter = new PostgresRateLimiter(
      pool,
      { appLimit: 1000, appWindowMs: 1000, profileLimit: 1, profileWindowMs: 60_000 },
      clock
    );
    await rateLimiter.tryAcquire({ type: "profile", profileId: noisy.profileId }); // agota solo su propio cupo

    const orchestrator = new PublishOrchestrator(scheduler, rateLimiter, vault, provider, baseConfig());
    await orchestrator.runOnce();

    expect((await fetchPost(quietPost.id)).status).toBe("published");
  });
});

describe("PublishOrchestrator — tokens", () => {
  it("token revocado -> failed con TOKEN_REVOKED, sin llamar al proveedor", async () => {
    const { profileId, tenantId } = await seedProfile(pool);
    await seedOAuthToken(pool, key, {
      profileId,
      tenantId,
      status: "revoked",
      accessToken: "mock_revoked_x",
      refreshToken: "mock_revoked_x",
    });
    const {
      rows: [post],
    } = await pool.query(
      `INSERT INTO posts (tenant_id, profile_id, status, content, scheduled_at)
       VALUES ($1, $2, 'scheduled', 'hola', now() - interval '1 minute') RETURNING id`,
      [tenantId, profileId]
    );

    const provider = new HttpProviderAdapter(mockBaseUrl);
    const vault = new PostgresTokenVault(pool, provider, key);
    const rateLimiter = new PostgresRateLimiter(pool, GENEROUS_LIMITS, clock);
    const orchestrator = new PublishOrchestrator(scheduler, rateLimiter, vault, provider, baseConfig());
    await orchestrator.runOnce();

    const row = await fetchPost(post.id);
    expect(row.status).toBe("failed");
    expect(row.last_error_code).toBe("TOKEN_REVOKED");
  });

  it("el proveedor revoca a mitad de lote (403 en publish pese a token 'válido') -> marca el token revocado y el post failed", async () => {
    const { profileId, tenantId } = await seedProfile(pool);
    await seedOAuthToken(pool, key, {
      profileId,
      tenantId,
      status: "valid",
      accessToken: issueToken("valid"),
      refreshToken: issueToken("valid"),
    });
    const {
      rows: [post],
    } = await pool.query(
      `INSERT INTO posts (tenant_id, profile_id, status, content, scheduled_at)
       VALUES ($1, $2, 'scheduled', 'hola', now() - interval '1 minute') RETURNING id`,
      [tenantId, profileId]
    );

    const provider = new HttpProviderAdapter(mockBaseUrl, fetchForcing("token_revoked"));
    const vault = new PostgresTokenVault(pool, provider, key);
    const rateLimiter = new PostgresRateLimiter(pool, GENEROUS_LIMITS, clock);
    const orchestrator = new PublishOrchestrator(scheduler, rateLimiter, vault, provider, baseConfig());
    await orchestrator.runOnce();

    expect((await fetchPost(post.id)).status).toBe("failed");
    const { rows } = await pool.query<{ status: string }>("SELECT status FROM oauth_tokens WHERE profile_id = $1", [
      profileId,
    ]);
    expect(rows[0].status).toBe("revoked");
  });
});

describe("PublishOrchestrator — 5xx del proveedor", () => {
  it("agota maxAttempts con backoff y termina en failed", async () => {
    const { profileId, tenantId } = await seedProfile(pool);
    await seedOAuthToken(pool, key, {
      profileId,
      tenantId,
      status: "valid",
      accessToken: issueToken("valid"),
      refreshToken: issueToken("valid"),
    });
    const {
      rows: [post],
    } = await pool.query(
      `INSERT INTO posts (tenant_id, profile_id, status, content, scheduled_at)
       VALUES ($1, $2, 'scheduled', 'hola', now() - interval '1 minute') RETURNING id`,
      [tenantId, profileId]
    );

    const provider = new HttpProviderAdapter(mockBaseUrl, fetchForcing("server_error"));
    const vault = new PostgresTokenVault(pool, provider, key);
    const rateLimiter = new PostgresRateLimiter(pool, GENEROUS_LIMITS, clock);
    const orchestrator = new PublishOrchestrator(scheduler, rateLimiter, vault, provider, baseConfig({ maxAttempts: 2 }));

    await orchestrator.runOnce();
    expect((await fetchPost(post.id)).status).toBe("scheduled"); // primer fallo: aún reintentable

    await forceScheduledIntoThePast(post.id);
    await orchestrator.runOnce();

    const row = await fetchPost(post.id);
    expect(row.status).toBe("failed");
    expect(row.attempt_count).toBe(2);
    expect(row.last_error_code).toBe("PROVIDER_SERVER_ERROR");
  });
});

describe("PublishOrchestrator — caps de concurrencia", () => {
  class TrackingProvider implements ProviderPort {
    concurrent = 0;
    maxConcurrent = 0;
    async publish(profileId: string): Promise<PublishResult> {
      this.concurrent++;
      this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
      await new Promise((resolve) => setTimeout(resolve, 30));
      this.concurrent--;
      return { externalId: `ext-${profileId}` };
    }
    async refresh(): Promise<RefreshedToken> {
      throw new Error("no debería llamarse en este test");
    }
  }

  it("cap por Embajador: dos posts del mismo perfil nunca se publican a la vez", async () => {
    const { profileId, tenantId } = await seedProfile(pool);
    await seedOAuthToken(pool, key, {
      profileId,
      tenantId,
      status: "valid",
      accessToken: issueToken("valid"),
      refreshToken: issueToken("valid"),
    });
    for (let i = 0; i < 2; i++) {
      await pool.query(
        `INSERT INTO posts (tenant_id, profile_id, status, content, scheduled_at)
         VALUES ($1, $2, 'scheduled', 'hola', now() - interval '1 minute')`,
        [tenantId, profileId]
      );
    }

    const provider = new TrackingProvider();
    const vault = new PostgresTokenVault(pool, provider, key);
    const rateLimiter = new PostgresRateLimiter(pool, GENEROUS_LIMITS, clock);
    const orchestrator = new PublishOrchestrator(
      scheduler,
      rateLimiter,
      vault,
      provider,
      baseConfig({ profileConcurrency: 1, globalConcurrency: 10 })
    );

    expect(await orchestrator.runOnce()).toBe(2);
    expect(provider.maxConcurrent).toBe(1);
  });

  it("cap global: dos posts de perfiles distintos respetan el límite global de concurrencia", async () => {
    const a = await seedProfile(pool);
    const b = await seedProfile(pool);
    for (const { profileId, tenantId } of [a, b]) {
      await seedOAuthToken(pool, key, {
        profileId,
        tenantId,
        status: "valid",
        accessToken: issueToken("valid"),
        refreshToken: issueToken("valid"),
      });
      await pool.query(
        `INSERT INTO posts (tenant_id, profile_id, status, content, scheduled_at)
         VALUES ($1, $2, 'scheduled', 'hola', now() - interval '1 minute')`,
        [tenantId, profileId]
      );
    }

    const provider = new TrackingProvider();
    const vault = new PostgresTokenVault(pool, provider, key);
    const rateLimiter = new PostgresRateLimiter(pool, GENEROUS_LIMITS, clock);
    const orchestrator = new PublishOrchestrator(
      scheduler,
      rateLimiter,
      vault,
      provider,
      baseConfig({ profileConcurrency: 10, globalConcurrency: 1 })
    );

    expect(await orchestrator.runOnce()).toBe(2);
    expect(provider.maxConcurrent).toBe(1);
  });
});
