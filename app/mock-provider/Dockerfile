# Contexto de build: la raíz del repo (necesita el workspace de pnpm completo para instalar).
# docker compose ya lo invoca así — ver el servicio `provider-mock` en docker-compose.yml.

FROM node:22-alpine AS build
WORKDIR /repo
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile --filter @ploot/mock-provider...
RUN pnpm --filter @ploot/mock-provider run build

# Sin dependencias en runtime (node:http nativo): la imagen final solo lleva el JS compilado.
FROM node:22-alpine
WORKDIR /app
COPY --from=build /repo/app/mock-provider/dist ./dist
EXPOSE 4000
CMD ["node", "dist/main.js"]
