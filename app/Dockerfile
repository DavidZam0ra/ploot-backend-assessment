# Contexto de build: la raíz del repo (necesita el workspace de pnpm completo para instalar).
# docker compose ya lo invoca así — ver el servicio `app` en docker-compose.yml.

FROM node:22-alpine AS build
WORKDIR /repo
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile --filter app...
# DATABASE_URL/JWT_SECRET reales no hacen falta para compilar: los Route Handlers los leen en
# runtime (process.env), nunca en build time.
RUN pnpm --filter app run build

# `output: "standalone"` (app/next.config.mjs) traza justo las dependencias que el server
# necesita en runtime (incluido @ploot/core del workspace) y las copia podadas — la imagen final
# no lleva pnpm ni el resto del monorepo, solo lo que Next dice que hace falta para arrancar.
FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/app/.next/standalone ./
COPY --from=build /repo/app/.next/static ./app/.next/static
EXPOSE 3000
CMD ["node", "app/server.js"]
