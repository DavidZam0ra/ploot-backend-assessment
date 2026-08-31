# Ploot · Prueba técnica de Backend

Scheduler de publicación para una plataforma de signal-based selling. Next.js (App Router, TypeScript) + worker separado + PostgreSQL.

> Repo en construcción para la prueba técnica de [ploot.ai](https://www.ploot.ai/). Ver el PDF del enunciado para el contrato completo.

## URL pública

- `app/`: https://ploot-backend-assessment-git-assessment-dzamora.vercel.app — Next.js en
  Vercel, enlazado a este repo (`main` es la rama de producción, intacta; este es el preview de
  la rama `assessment`, que es la que no se mergea según el enunciado — una Preview deployment
  de Vercel es tan pública y funcional como una de producción). Verificado con tráfico HTTP real
  de punta a punta contra Postgres real (crear post, listar) — ver `DECISIONS.md` #19.
- Postgres: Supabase (Frankfurt, `eu-central-1`), esquema + roles (`app_role`/`worker_role`)
  aplicados contra la conexión real, vía el pooler (Supavisor) en modo transacción — compatible
  con el `SET LOCAL app.tenant_id` por transacción que usa `PostgresPostRepository`.
- `worker/` + `provider-mock/`: pendiente (ver `HANDOFF.md`).

## Repositorio

https://github.com/DavidZam0ra/ploot-backend-assessment

## Cómo levantarlo en local

```bash
cp .env.example .env   # ver comentarios dentro; los defaults ya sirven para local
docker compose up --build
```

Levanta Postgres (esquema + roles `app_role`/`worker_role` aplicados solos al crear el volumen)
+ el mock del proveedor + `app` (Next.js) + `worker`, verificado en frío en ~40 s. `app` queda en
`http://localhost:3000`, el mock del proveedor en `http://localhost:4000`. Sin JWT válido (no hay
IdP, ver `app/src/auth/jwt.ts`) y sin datos sembrados, la API responde pero no hay tenants/posts
todavía — falta el script de seed (ver `HANDOFF.md`).

## Estructura del repo

- `app/` — Route Handlers de Next.js + UI mínima de demostración (adaptador HTTP sobre `packages/core`).
- `worker/` — proceso separado que publica los posts programados (no vive en una función serverless de Next.js; adaptador de cola sobre `packages/core`).
- `packages/core/` — dominio y puertos hexagonales, sin dependencia de Next.js ni de Postgres. Ver [Arquitectura](#arquitectura).
- `db/` — esquema de Postgres (fuente de verdad única para `app/` y `worker/`) y datos de seed.
- `infra/` — configuración de despliegue público.
- `.github/workflows/` — definición del pipeline CI/CD.
- `docker-compose.yml` — app + worker + Postgres + mock, listo para local.

## Arquitectura

Hexagonal: `packages/core` define entidades y puertos (`PostRepositoryPort`, `SchedulerRepositoryPort`, `ProviderPort`, `TokenVaultPort`, `RateLimiterPort`, `IdempotencyPort`, `ClockPort`) sin depender de Next.js ni de Postgres. `app/` y `worker/` implementan los adaptadores concretos (Postgres+RLS, el mock del proveedor, etc.) e inyectan esos puertos. Así el mock del proveedor es intercambiable por uno real, y Postgres+`FOR UPDATE SKIP LOCKED` sería intercambiable por BullMQ sin tocar el dominio.

Aislamiento de tenant resuelto **a nivel SQL** con Row-Level Security (no confiando en que el Route Handler filtre bien) — ver `db/migrations/0001_init.sql` para las políticas y los dos roles de BD (`app_role` con RLS, `worker_role` con `BYPASSRLS` porque necesita ver todos los tenants para repartir la cola de forma justa).

TODO — enlazar aquí el diagrama de la Parte A.1 (edge, runtime Node vs Edge, cola+DLQ, rate limiter, bóveda de tokens, plano de datos, observabilidad).

## Tabla de decisiones

Ver [DECISIONS.md](./DECISIONS.md) — se va rellenando según se avanza; al final se traslada a la Parte E del PDF.
