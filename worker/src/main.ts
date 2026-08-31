import { Pool } from "pg";
import { PostgresSchedulerRepository } from "./adapters/postgres-scheduler-repository.js";
import { PostgresTokenVault } from "./adapters/postgres-token-vault.js";
import { PostgresRateLimiter } from "./adapters/postgres-rate-limiter.js";
import { HttpProviderAdapter } from "./adapters/http-provider-adapter.js";
import { SystemClock } from "./adapters/system-clock.js";
import { loadEncryptionKey } from "./crypto/token-cipher.js";
import { PublishOrchestrator } from "./publish-orchestrator.js";

const env = process.env;
const pool = new Pool({ connectionString: env.DATABASE_URL ?? "postgres://ploot:ploot@localhost:5432/ploot" });
const provider = new HttpProviderAdapter(env.PROVIDER_BASE_URL ?? "http://localhost:4000");
const key = loadEncryptionKey(env);
const clock = new SystemClock();

const scheduler = new PostgresSchedulerRepository(pool);
const vault = new PostgresTokenVault(pool, provider, key);
const rateLimiter = new PostgresRateLimiter(
  pool,
  {
    appLimit: Number(env.RATE_LIMIT_APP_MAX ?? 50),
    appWindowMs: Number(env.RATE_LIMIT_APP_WINDOW_MS ?? 1000),
    profileLimit: Number(env.RATE_LIMIT_PROFILE_MAX ?? 1),
    profileWindowMs: Number(env.RATE_LIMIT_PROFILE_WINDOW_MS ?? 2000),
  },
  clock
);
const orchestrator = new PublishOrchestrator(scheduler, rateLimiter, vault, provider, {
  workerId: env.WORKER_ID ?? `worker-${process.pid}`,
  batchSize: Number(env.CLAIM_BATCH_SIZE ?? 20),
  globalConcurrency: Number(env.GLOBAL_CONCURRENCY ?? 10),
  profileConcurrency: Number(env.PROFILE_CONCURRENCY ?? 1),
  maxAttempts: Number(env.MAX_ATTEMPTS ?? 5),
  baseBackoffMs: Number(env.BASE_BACKOFF_MS ?? 1000),
  maxBackoffMs: Number(env.MAX_BACKOFF_MS ?? 30_000),
});

const pollIntervalMs = Number(env.POLL_INTERVAL_MS ?? 2000);
const staleAfterMs = Number(env.STALE_CLAIM_AFTER_MS ?? 60_000);
const staleSweepIntervalMs = Number(env.STALE_SWEEP_INTERVAL_MS ?? 30_000);

let shuttingDown = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollLoop(): Promise<void> {
  while (!shuttingDown) {
    try {
      const claimed = await orchestrator.runOnce();
      if (claimed === 0) await sleep(pollIntervalMs);
    } catch (err) {
      console.error("[worker] fallo en el ciclo de publicación", err);
      await sleep(pollIntervalMs);
    }
  }
}

// Recupera posts atascados en 'publishing' si el worker que los reclamó murió a mitad de
// publicación — sin esto, un crash dejaría esos posts huérfanos para siempre (ver el test de
// seguridad con N réplicas en postgres-scheduler-repository.integration.test.ts).
async function staleSweepLoop(): Promise<void> {
  while (!shuttingDown) {
    await sleep(staleSweepIntervalMs);
    try {
      const recovered = await scheduler.requeueStale(staleAfterMs);
      if (recovered > 0) console.log(`[worker] recuperados ${recovered} posts con reclamo obsoleto`);
    } catch (err) {
      console.error("[worker] fallo en el barrido de reclamos obsoletos", err);
    }
  }
}

async function shutdown(): Promise<void> {
  shuttingDown = true;
  await pool.end();
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

console.log("[worker] arrancando ciclo de publicación");
await Promise.all([pollLoop(), staleSweepLoop()]);
