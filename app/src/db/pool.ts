import { Pool } from "pg";

// Un solo Pool por proceso: los Route Handlers de Next.js son funciones cortas, no un servidor
// de larga vida, pero dentro del mismo proceso (dev, o un contenedor en producción) reutilizar
// conexiones es lo correcto — abrir un Pool nuevo por request agotaría max_connections rápido.
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? "postgres://app_role:app_role_test_password@localhost:5432/ploot",
    });
  }
  return pool;
}
