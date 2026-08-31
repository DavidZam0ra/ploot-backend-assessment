import { beforeEach, describe, expect, it } from "vitest";
import { PostgresIdempotencyStore } from "../src/adapters/postgres-idempotency.js";
import { createAdminPool, createAppRolePool, seedTenant } from "./setup.js";

const admin = createAdminPool();
const appRolePool = createAppRolePool();
const store = new PostgresIdempotencyStore(appRolePool);

beforeEach(async () => {
  await admin.query("TRUNCATE idempotency_keys, tenants CASCADE");
});

describe("PostgresIdempotencyStore", () => {
  it("reserve() es isNew la primera vez, y no lo vuelve a ser con la misma clave", async () => {
    const tenantId = await seedTenant(admin);

    const first = await store.reserve(tenantId, "key-1");
    expect(first.isNew).toBe(true);
    expect(first.existingResult).toBeNull();

    const second = await store.reserve(tenantId, "key-1");
    expect(second.isNew).toBe(false);
  });

  it("complete() persiste el resultado y reserve() posterior lo devuelve", async () => {
    const tenantId = await seedTenant(admin);
    await store.reserve(tenantId, "key-2");
    await store.complete(tenantId, "key-2", { externalId: "mock-ext-123" });

    const result = await store.reserve<{ externalId: string }>(tenantId, "key-2");
    expect(result.isNew).toBe(false);
    expect(result.existingResult).toEqual({ externalId: "mock-ext-123" });
  });

  it("la misma clave en tenants distintos no colisiona (RLS + PK compuesta por tenant)", async () => {
    const tenantA = await seedTenant(admin, "Tenant A");
    const tenantB = await seedTenant(admin, "Tenant B");

    const a = await store.reserve(tenantA, "misma-clave");
    const b = await store.reserve(tenantB, "misma-clave");

    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(true); // tenant distinto: no es un duplicado
  });

  it("dos reserve() concurrentes con la misma clave: solo uno es isNew", async () => {
    const tenantId = await seedTenant(admin);

    const [a, b] = await Promise.all([store.reserve(tenantId, "concurrente"), store.reserve(tenantId, "concurrente")]);
    const newCount = [a, b].filter((r) => r.isNew).length;
    expect(newCount).toBe(1);
  });
});
