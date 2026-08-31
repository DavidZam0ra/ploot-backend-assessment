# Ploot · Prueba técnica de Backend

Scheduler de publicación para una plataforma de signal-based selling. Next.js (App Router, TypeScript) + worker separado + PostgreSQL.

> Repo en construcción para la prueba técnica de [ploot.ai](https://www.ploot.ai/). Ver el PDF del enunciado para el contrato completo.

## URL pública

TODO — pendiente de despliegue (ver Parte C del enunciado).

## Cómo levantarlo en local

```bash
docker compose up
```

Levanta app + worker + Postgres + mock del proveedor con seed en < 60 s.

TODO — completar cuando el `docker-compose.yml` esté implementado.

## Estructura del repo

- `app/` — Route Handlers de Next.js + UI mínima de demostración.
- `worker/` — proceso separado que publica los posts programados (no vive en una función serverless de Next.js).
- `infra/` — configuración de despliegue público.
- `.github/workflows/` — definición del pipeline CI/CD.
- `docker-compose.yml` — app + worker + Postgres + mock, listo para local.

## Arquitectura

TODO — enlazar aquí el diagrama de la Parte A.1 y una nota sobre la organización interna del código (puertos/adaptadores).

## Tabla de decisiones

TODO — ver Parte E del PDF, rellenar según se avance.
