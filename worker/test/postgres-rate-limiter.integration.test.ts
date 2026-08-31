import { beforeEach, describe, expect, it } from "vitest";
import { PostgresRateLimiter } from "../src/adapters/postgres-rate-limiter.js";
import { createTestPool, FakeClock } from "./setup.js";

// Requiere Postgres real (docker compose up postgres) con db/migrations/0001_init.sql aplicado.
const pool = createTestPool();

function makeLimiter(clock: FakeClock) {
  return new PostgresRateLimiter(
    pool,
    { appLimit: 2, appWindowMs: 1000, profileLimit: 1, profileWindowMs: 1000 },
    clock
  );
}

beforeEach(async () => {
  await pool.query("TRUNCATE rate_limit_windows");
});

describe("PostgresRateLimiter.tryAcquire", () => {
  it("admite hasta el límite dentro de la misma ventana y luego lo niega", async () => {
    const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
    const limiter = makeLimiter(clock);

    const first = await limiter.tryAcquire({ type: "app" });
    const second = await limiter.tryAcquire({ type: "app" });
    const third = await limiter.tryAcquire({ type: "app" });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBeGreaterThan(0);
  });

  it("una vez pasada la ventana, el presupuesto se resetea", async () => {
    const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
    const limiter = makeLimiter(clock);

    await limiter.tryAcquire({ type: "app" });
    await limiter.tryAcquire({ type: "app" });
    expect((await limiter.tryAcquire({ type: "app" })).allowed).toBe(false);

    clock.advanceMs(1000); // siguiente ventana
    expect((await limiter.tryAcquire({ type: "app" })).allowed).toBe(true);
  });

  it("el presupuesto de 'app' y el de un perfil concreto son independientes", async () => {
    const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
    const limiter = makeLimiter(clock);

    await limiter.tryAcquire({ type: "app" });
    await limiter.tryAcquire({ type: "app" }); // agota el presupuesto de app (límite 2)

    const profileDecision = await limiter.tryAcquire({ type: "profile", profileId: "profile-a" });
    expect(profileDecision.allowed).toBe(true); // su propio contador, no comparte con 'app'
  });

  it("dos Embajadores distintos no comparten presupuesto entre sí", async () => {
    const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
    const limiter = makeLimiter(clock);

    const a = await limiter.tryAcquire({ type: "profile", profileId: "profile-a" });
    const b = await limiter.tryAcquire({ type: "profile", profileId: "profile-b" });

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true); // límite de perfil es 1, pero son perfiles distintos
  });

  it("un tenant/perfil ruidoso no agota el presupuesto de 'app' para los demás: dos llamadas concurrentes al límite conjunto solo admiten una", async () => {
    const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
    const limiter = new PostgresRateLimiter(
      pool,
      { appLimit: 1, appWindowMs: 1000, profileLimit: 100, profileWindowMs: 1000 },
      clock
    );

    const [a, b] = await Promise.all([limiter.tryAcquire({ type: "app" }), limiter.tryAcquire({ type: "app" })]);
    const allowedCount = [a, b].filter((d) => d.allowed).length;
    expect(allowedCount).toBe(1); // el UPSERT atómico evita que dos réplicas concurrentes admitan ambas
  });
});
