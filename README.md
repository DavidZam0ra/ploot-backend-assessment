# Ploot · Prueba técnica de Backend

Scheduler de publicación para una plataforma de signal-based selling. Next.js (App Router, TypeScript) + worker separado + PostgreSQL.

> Repo en construcción para la prueba técnica de [ploot.ai](https://www.ploot.ai/). Ver el PDF del enunciado para el contrato completo.

## URL pública

TODO — pendiente de despliegue (ver Parte C del enunciado).

## Repositorio

https://github.com/DavidZam0ra/ploot-backend-assessment

## Cómo levantarlo en local

```bash
docker compose up
```

Levanta app + worker + Postgres + mock del proveedor con seed en < 60 s.

TODO — completar cuando el `docker-compose.yml` esté implementado.

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
