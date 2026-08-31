# Contexto de build: la raíz del repo (necesita el workspace de pnpm completo para instalar).
# docker compose ya lo invoca así — ver el servicio `worker` en docker-compose.yml.

FROM node:22-alpine AS build
WORKDIR /repo
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile --filter worker...

# Sin paso de compilación: worker corre con tsx directamente sobre TypeScript en runtime (ver
# DECISIONS.md #12) — la imagen final solo necesita node_modules del workspace instalado arriba
# más el propio código fuente, nunca un `dist/` compilado.
FROM node:22-alpine
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/worker ./worker
WORKDIR /repo/worker
CMD ["node", "--import", "tsx", "src/main.ts"]
