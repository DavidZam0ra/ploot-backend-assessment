# HANDOFF — Ploot, prueba técnica de backend

Documento de traspaso para continuar en Cursor (u otra herramienta) si se corta la sesión de
Claude Code. Se actualiza después de cada pieza terminada — la fecha de la última actualización
está al final. Pega esto entero al empezar el chat nuevo; es autocontenido, no necesita el PDF
original para seguir (aunque si lo tienes, adjúntalo también).

## Repo

- **URL**: `git@github.com:DavidZam0ra/ploot-backend-assessment.git` (público)
- **Rama de trabajo**: `assessment` — todo el código va ahí; al final se abre un PR `assessment`
  contra `main` y **no se mergea** (así lo pide el enunciado)
- **Gestor de paquetes: pnpm**, monorepo con `pnpm-workspace.yaml` (`app`, `app/mock-provider`,
  `worker`, `packages/*`)
- **Todos los commits están hechos, ninguno con push** (convención acordada: commit al cerrar
  cada pieza, push solo si se pide explícitamente). En este PC (`D:\ploot-backend-assessment`) el
  working tree está limpio.

## Cómo levantar el entorno de trabajo (en cualquier PC con Docker)

```bash
git clone git@github.com:DavidZam0ra/ploot-backend-assessment.git
cd ploot-backend-assessment
git checkout assessment
pnpm install
docker compose up -d postgres provider-mock
```

Si el puerto 5432 ya está ocupado por otro Postgres local (pasó en este PC: un Postgres nativo de
Windows), crea `docker-compose.override.yml` (gitignorado) con:

```yaml
services:
  postgres:
    ports:
      - "5433:5432"
```

y usa el puerto que corresponda en las `DATABASE_URL` de abajo.

Aplicar el esquema (primera vez, o si se recreó el volumen):

```bash
PORT=5433  # o 5432 si no hiciste el override
psql "postgres://ploot:ploot@localhost:$PORT/ploot" -f db/migrations/0001_init.sql
psql "postgres://ploot:ploot@localhost:$PORT/ploot" \
  -v app_role_password="app_role_test_password" \
  -v worker_role_password="worker_role_test_password" \
  -f db/bootstrap-roles.sql
```

(`db/bootstrap-roles.sql` le da contraseña real a `app_role`/`worker_role` — sin esto, los tests
de aislamiento de tenant no pueden conectarse como `app_role` para probar RLS de verdad; un
superusuario se salta RLS.)

Correr toda la suite de tests (usa la raíz, no cada paquete suelto — ver por qué en
`DECISIONS.md` #14):

```bash
TEST_DATABASE_URL="postgres://ploot:ploot@localhost:5433/ploot" \
TEST_APP_ROLE_DATABASE_URL="postgres://app_role:app_role_test_password@localhost:5433/ploot" \
pnpm test
```

Debería dar **72/72 tests en verde** (12 mock-provider + 22 app + 38 worker) y `tsc --noEmit`
limpio en `app/`, `worker/`, `app/mock-provider/`.

Arrancar el worker de verdad (bucle de publicación):

```bash
cd worker
cp .env.example .env   # y rellena TOKEN_ENCRYPTION_KEY con:
                        # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
                        # y DATABASE_URL con el puerto correcto (5433 si hiciste el override)
pnpm start
```

Arrancar la API (`app/`, Next.js dev server):

```bash
cd app
cp .env.example .env   # DATABASE_URL con app_role + el puerto correcto, y JWT_SECRET (cualquier
                        # string en local, ver src/auth/jwt.ts)
pnpm dev
```

No hay IdP: los JWT de prueba se firman a mano con `signTestToken` (`app/src/auth/jwt.ts`) —
desde un script/REPL de Node con `tsx`, o añadiendo un endpoint de test temporal si hace falta
probar por `curl` sin escribir código. El claim `tenant_id` del token, no el body, es lo que
decide a qué tenant pertenece cada request.

## Qué hay hecho (todo commiteado, ver `git log --oneline` para el detalle exacto de cada uno)

1. **Esquema Postgres + `packages/core`** (dominio y puertos hexagonales, sin Next.js ni
   Postgres): `Post`, `Profile`, `OAuthTokenMeta`, taxonomía de errores tipados, y los puertos
   `PostRepositoryPort`, `SchedulerRepositoryPort`, `ProviderPort`, `TokenVaultPort`,
   `RateLimiterPort`, `IdempotencyPort`, `ClockPort`.
2. **Worker — scheduler**: `PostgresSchedulerRepository` (`claimBatch`/`markPublished`/
   `markFailed`/`requeueStale`) sobre `worker_role` (BYPASSRLS), con `FOR UPDATE SKIP LOCKED` +
   `row_number() OVER (PARTITION BY tenant_id ...)` para repartir de forma justa entre tenants.
   Test de N réplicas + crash en verde contra Postgres real.
3. **Mock del proveedor** (`app/mock-provider/`): servicio HTTP standalone (`node:http` puro,
   cero deps), implementa `POST /provider/publish` y `POST /provider/oauth/refresh` según el
   contrato del PDF. Estado del token codificado en el propio string (`mock_<state>_<uuid>`).
   Header `X-Mock-Force` para forzar desenlaces deterministas en tests. Dado de alta en
   `docker-compose.yml` (servicio `provider-mock`, puerto 4000), build/arranque verificado.
4. **`HttpProviderAdapter`** (worker): implementa `ProviderPort` contra el mock, traduce status
   HTTP a errores tipados (429→`ProviderRateLimitedError`, 401→`TokenExpiredError`,
   403→`TokenRevokedError`, resto→`ProviderServerError`).
5. **`PostgresTokenVault`** (worker): cifrado AES-256-GCM de tokens OAuth
   (`worker/src/crypto/token-cipher.ts`), cada secreto con su propio nonce embebido (no
   compartido — reutilizar nonce en AES-GCM rompe la confidencialidad, era un bug del esquema
   original, ya arreglado). Refresca automáticamente si el token expiró; si el refresh también
   falla (revocado), marca la fila `revoked` y lanza `TokenRevokedError` sin quemar reintentos.
6. **`PostgresRateLimiter`** (worker): ventana fija en Postgres (tabla `rate_limit_windows`,
   scope `'app'` o `'profile:<uuid>'`), atómico con un único `UPSERT` (sin carrera entre N
   réplicas).
7. **`PublishOrchestrator`** (worker, `worker/src/publish-orchestrator.ts`): el bucle principal.
   Conecta `claimBatch → rate limiter (app, luego profile) → token vault → provider.publish →
   markPublished/markFailed`. Dos semáforos en memoria (global y por Embajador) para respetar los
   caps de concurrencia. Política de errores: revocado → sin reintentos; 429 → respeta el
   `Retry-After` exacto; 5xx/desconocido → backoff exponencial con jitter, tope `maxAttempts`.
   `worker/src/main.ts` es el entrypoint real (bucle de polling + barrido de `requeueStale`),
   probado en caliente con `pnpm start` contra Postgres y el mock reales — publicó un post
   sembrado a mano de punta a punta.
8. **Aislamiento de tenant a nivel SQL** (`app/`): `PostgresPostRepository` implementa
   `PostRepositoryPort` contra `app_role`, con `SET LOCAL app.tenant_id` por transacción. La
   garantía real la da RLS (`db/migrations/0001_init.sql`). 22 tests, 6 de ellos probando
   rechazo cross-tenant a nivel SQL de verdad (incluido un `INSERT` con `tenant_id` ajeno
   rechazado por Postgres mismo, y "sin tenant fijado no se ve nada").
9. **Corrección DST para `Europe/Madrid`** (`packages/core/src/time/zoned-time.ts`, sobre
   `luxon`): 12 tests, incluidos los dos bordes ambiguos del cambio de hora (hueco de primavera
   rechazado, hora ambigua de otoño resuelta a la primera ocurrencia) y round-trip completo.
10. **API HTTP** (`app/`, Next.js App Router scaffolded): Route Handlers
    `POST/GET /api/v1/posts`, `PATCH/DELETE /api/v1/posts/:id`, `POST /api/v1/posts/:id/publish`.
    Auth JWT HS256 de prueba (`jose`, sin IdP) con `tenant_id`/`profile_id` como claims —
    `src/auth/`. "Publicar ahora" solo adelanta `scheduled_at` a `now()`, nunca llama al
    proveedor directamente (eso lo sigue haciendo solo el worker). Probado de punta a punta por
    HTTP real contra `next dev`: crear, listar, publicar ahora, cancelar, y aislamiento
    cross-tenant confirmado (404 sin filtrar que el post existe).
11. **Idempotencia en `POST /publish`**: `PostgresIdempotencyStore` implementa `IdempotencyPort`
    contra `app_role` (`INSERT ... ON CONFLICT DO NOTHING RETURNING` como primitiva atómica). 4
    tests de integración, incluida una prueba de dos `reserve()` concurrentes con la misma clave.

**Bugs reales encontrados y arreglados al conectar piezas** (ver `DECISIONS.md` #11 para el
detalle — vale la pena leerlo, ilustra por qué los tests de integración de extremo a extremo
importan más que los unitarios aislados):
- La CTE `ranked` de `claimBatch` no proyectaba `scheduled_at`, y la CTE `claimable` lo
  necesitaba para su `ORDER BY`.
- `markFailed` nunca se había ejercitado en un test hasta que el orquestador lo llamó de
  verdad: su `CASE WHEN ... THEN 'scheduled' ELSE 'failed' END` resolvía a `text`, no al enum
  `post_status`.
- `@ploot/core` necesitaba `"type": "module"` para que `tsx` resolviera bien sus exports en
  runtime, lo que a su vez obligó a añadir extensión `.js` a los imports relativos internos del
  paquete (exigencia de `moduleResolution: NodeNext`).

**Decisiones de arquitectura**: todas documentadas con su alternativa descartada y su coste en
[`DECISIONS.md`](./DECISIONS.md) — es la tabla que pide la Parte E del PDF, ya bastante rellena
(14 filas). Léelo antes de tomar decisiones nuevas, para no contradecir algo ya razonado.

## Qué falta, en el orden de prioridad que marca el propio PDF

1. **Despliegue público** — no empezado. Elegir host (Vercel para `app/`, un contenedor para
   `worker/` y `provider-mock/`, Postgres gestionado — Neon/Supabase tienen capa gratuita),
   justificar en el PDF con coste de orden de magnitud a 5k tenants. `worker/` corre con
   `tsx src/main.ts` (ver `DECISIONS.md` #12) — cualquier host de contenedores vale, no necesita
   build compilado.
2. **`docker-compose.yml` completo** — de momento solo tiene `postgres` y `provider-mock`
   funcionando. Faltan los servicios `app` y `worker` (hay placeholders comentados en el
   fichero). El objetivo del enunciado es `docker compose up` completo en <60s en máquina limpia.
3. **UI mínima de demostración** — no empezada (`app/src/app/page.tsx` es solo un placeholder).
   No se evalúa el diseño, solo que sea una ventana real al backend (lista de posts casi en
   tiempo real con polling, crear/programar, botón "publicar ahora", transiciones de estado
   visibles, por qué de los `failed`/esperas). Ya puede consumir la API real de `app/`.
4. **Las partes escritas del PDF** (van en un PDF aparte, no en el repo) — no tocadas en esta
   sesión de código: Parte A (diseño de sistema), Parte B (despliegue y operación), Parte D
   (elige 1 de 3 escenarios de incidente), Parte E (tabla de `DECISIONS.md` trasladada + una
   pregunta de visión de producto + 3 líneas de qué IA se usó). Esto es ~80 de los 180 minutos
   del enunciado y no depende de nada de código — se puede escribir en paralelo, o después,
   independientemente de cuánto código quede terminado.

## Convenciones a seguir si se continúa

- Comentarios en el código: solo cuando el porqué no es obvio — no explicar el qué.
- Cada decisión de diseño relevante va como fila nueva en `DECISIONS.md`, con la alternativa
  descartada y su coste (columnas: # | Componente/Decisión | Qué hice | Por qué | Estado |
  Próximo paso si no está terminado).
- READMEs de carpeta son solo placeholders para que git no descarte carpetas vacías — se borran
  en cuanto la carpeta tiene código real (ya pasó con `app/README.md`).
- Los tests de integración usan Postgres real, nunca mocks de la propia infraestructura que se
  está probando (así se encontraron los 3 bugs reales de la lista de arriba). Cuando dos
  ficheros/paquetes de test comparten la misma Postgres, hace falta forzar ejecución secuencial
  (`fileParallelism: false` en cada `vitest.config.ts`, y `--workspace-concurrency=1` en el
  script raíz) — si se añade un cuarto paquete con tests de integración, revisar que siga
  aplicando.
- Nunca hacer `git push` sin pedirlo explícitamente; sí hacer commit al cerrar cada pieza.

---
Última actualización: piezas completadas hasta idempotencia en `POST /publish` (API HTTP +
auth JWT + idempotencia, ver `DECISIONS.md` #16-17) — 89/89 tests en verde, probado también de
punta a punta por HTTP real contra `next dev` (crear, listar, publicar ahora, cancelar,
aislamiento cross-tenant). Aún sin commitear en el momento de escribir esto. Se sigue
actualizando este documento después de cada pieza nueva.
