# Partes escritas del PDF (A, B, D, E)

Borrador para pegar en el PDF final de la prueba. Se apoya en lo ya construido y documentado en
`DECISIONS.md` y `HANDOFF.md` — aquí solo se sintetiza en la forma que pide cada parte.

## Parte A — Diseño de sistema

**Modelo de datos** (`db/migrations/0001_init.sql`): `tenants` → `profiles` (Embajadores) →
`posts` / `oauth_tokens`, más `idempotency_keys` y `rate_limit_windows` como tablas de soporte
técnico (no de dominio). Todo `timestamptz` (instante absoluto en UTC); la hora de pared del
Embajador solo existe en el borde de entrada/salida (`packages/core/src/time/zoned-time.ts`,
sobre `luxon`, corrige DST en `Europe/Madrid`).

**Aislamiento multi-tenant**: Row-Level Security en Postgres, no solo `WHERE tenant_id = $1` en
el código de aplicación. `app_role` (usado por la API) tiene RLS activo y fija el tenant con
`SET LOCAL app.tenant_id` al inicio de cada transacción (claim del JWT, nunca del body/URL);
`worker_role` (proceso interno de confianza, nunca expuesto a una request externa) tiene
`BYPASSRLS` porque necesita ver todos los tenants a la vez para repartir la cola de forma justa.
Verificado con tests que insertan por debajo del repositorio con un `tenant_id` ajeno a la
sesión: Postgres los rechaza aunque el código de aplicación tuviera un bug y se olvidara del
`WHERE`.

**Cola de publicación**: sin Redis/BullMQ — Postgres con `FOR UPDATE SKIP LOCKED` y
`row_number() OVER (PARTITION BY tenant_id ORDER BY scheduled_at)` para que un tenant con miles
de posts vencidos no acapare todos los reclamos de un ciclo de polling. Índice parcial
(`WHERE status = 'scheduled'`) para la query caliente, y un segundo índice + barrido periódico
(`requeueStale`) para posts que se quedaron en `publishing` porque el worker murió a mitad de
camino — sin este barrido, un crash deja posts huérfanos para siempre.

**Publicación** (`worker/src/publish-orchestrator.ts`): por cada post reclamado, rate limiter
(scope `'app'`, luego `'profile:<id>'`) → vault de tokens (refresca si expiró, marca `revoked` si
el refresh también falla) → llamada al proveedor → `markPublished`/`markFailed` con política de
reintento según el tipo de error (revocado: sin reintentos; 429: respeta el `Retry-After` exacto;
5xx/desconocido: backoff exponencial con jitter y tope de intentos). Concurrencia acotada con dos
semáforos en memoria (global y por Embajador) para no convertir un lote grande en una ráfaga
contra el proveedor externo.

**API** (`app/`, Next.js Route Handlers): `POST/GET /api/v1/posts`, `PATCH/DELETE
/api/v1/posts/:id`, `POST /api/v1/posts/:id/publish`. Auth JWT HS256 de prueba (sin IdP real) con
`tenant_id`/`profile_id` como claims. "Publicar ahora" nunca llama al proveedor desde el ciclo de
request de Next.js — solo adelanta `scheduled_at` a `now()`; el proveedor externo solo se llama
desde el worker, con su rate limiter y sus reintentos ya construidos, evitando además los
timeouts/cold-starts de una función serverless hablando directo con un tercero.

**Idempotencia**: `POST /publish` exige un header `Idempotency-Key`, resuelto con
`INSERT ... ON CONFLICT DO NOTHING RETURNING` (atómico ante dos requests concurrentes con la
misma clave — sin lock explícito, el índice único hace de árbitro).

**Cifrado de secretos**: tokens OAuth cifrados a nivel de aplicación (AES-256-GCM) antes de
persistir, clave fuera de Postgres (env/KMS), nonce propio por columna (nunca compartido entre
access y refresh token de la misma fila — reusar nonce en AES-GCM rompe la confidencialidad).

## Parte B — Despliegue y operación

**Dónde vive cada pieza (público)**:
- `app/` (API + UI mínima): Vercel, rama `assessment` como *Preview deployment* (no se mergea a
  `main`, según el enunciado) — `https://ploot-backend-assessment-git-assessment-dzamora.vercel.app`
- Postgres: Supabase (`eu-central-1`), gestionado, con el mismo esquema/roles que en local (cero
  SQL nuevo para producción — una sola fuente de verdad).
- `worker/` + `provider-mock/`: Fly.io — `provider-mock` en `https://ploot-provider-mock.fly.dev`
  y `ploot-worker` corriendo su ciclo de polling contra la Postgres de Supabase, ambos estables
  (sin crash loop, sin errores de conexión en logs).

**Cómo se levanta en local**: `docker compose up --build` — Postgres + roles + esquema se
bootstrapean solos vía `docker-entrypoint-initdb.d` (ya no hace falta `psql` a mano), los 4
contenedores (`app`, `worker`, `postgres`, `provider-mock`) arriba en ~40s, dentro del objetivo de
<60s.

**Observabilidad mínima que ya existe**: `attempt_count`, `last_error_code`,
`last_error_message` por post (para saber *por qué* falló sin mirar logs), y `claimed_by`/
`claimed_at` para saber qué worker tiene (o tuvo) un post en vuelo. El log de cada worker
(`worker-<id>`) permite correlacionar reclamos con fallos.

**Justificación de coste a 5.000 tenants**: el diseño no cambia con la escala, solo el
dimensionamiento:
- Postgres es el único componente con estado — con RLS + índices parciales ya construidos, el
  cuello de botella real a 5k tenants es el volumen de `posts` en `scheduled`, no el número de
  tenants en sí (el índice `posts_claim_idx` es parcial e independiente del total de filas
  históricas). Un plan gestionado de gama media (Supabase Pro / RDS `db.t4g.medium` equivalente)
  cubre esto sin sharding: la carga de escritura de "programar/publicar un post" es baja por
  Embajador (es justo lo que el rate limiter está limitando).
- El worker escala horizontalmente sin coordinación adicional: `FOR UPDATE SKIP LOCKED` ya reparte
  el trabajo entre N réplicas sin un líder ni locks distribuidos propios — añadir una réplica más
  en Fly.io es solo más capacidad de polling, no un cambio de diseño.
- La API (`app/`) es *stateless* por request (el pool de conexiones es el único estado en
  proceso) — escala en Vercel de forma automática por tráfico HTTP, sin relación con el número de
  tenants.
- El coste que sí crece linealmente con tenants es el número de llamadas al proveedor externo
  (fuera de nuestro control) y el volumen de filas en `posts`/`oauth_tokens` — mitigado con los
  índices parciales ya existentes y, si hiciera falta más adelante, particionado de `posts` por
  rango de fecha (no necesario a 5k tenants con el volumen típico de publicaciones por Embajador).

## Parte D — Escenario de incidente

**Escenario elegido**: el worker muere (OOM, deploy, crash) mientras tiene posts reclamados en
`publishing`.

**Detección**: el índice parcial `posts_stale_publishing_idx` (`WHERE status = 'publishing'`)
soporta un barrido periódico (`requeueStale`, ya implementado y corriendo en el bucle de
`worker/src/main.ts`) que busca posts en `publishing` con `claimed_at` más viejo que un umbral
(mayor que el tiempo máximo razonable de una llamada al proveedor) y los devuelve a `scheduled`.
No depende de que el propio worker se dé cuenta de que va a morir — cualquier worker vivo (el
mismo u otro tras el redeploy) puede recuperarlos en su siguiente ciclo.

**Por qué no basta con reintentar sin más**: si dos workers reclamaran el mismo post "obsoleto" a
la vez sin cuidado, podría publicarse dos veces. `claimBatch` usa `FOR UPDATE SKIP LOCKED` así
que dos workers nunca reclaman la misma fila en paralelo, y `requeueStale` solo toca filas en
`publishing` (nunca las que ya llegaron a `published`) — el peor caso posible es un intento de
publicación duplicado si el proveedor real *sí* procesó la llamada pero el worker murió antes de
poder escribir `markPublished`. Mitigación real: el `Idempotency-Key` ya existe en el endpoint
`/publish` de la API pero no llega hasta la llamada al proveedor externo — el siguiente paso
natural (no implementado en esta prueba por tiempo) sería pasar un id determinista
(`post.id` + `attempt_count`) al proveedor como su propia idempotency key, si el proveedor real la
soporta (el mock actual no la exige).

**Runbook mínimo** si el reaper no fuera suficiente en producción: alerta sobre
`count(posts WHERE status='publishing' AND claimed_at < now() - interval '10 minutes')` > 0
sostenido (indica que ningún worker vivo está corriendo el barrido, no solo un post lento) →
comprobar salud de los contenedores del worker en Fly.io → si están caídos, redeploy; el barrido
del primer worker que vuelva a arrancar recupera la cola sin intervención manual adicional.

## Parte E — Tabla de decisiones, visión de producto y uso de IA

**Tabla de decisiones**: ver [`DECISIONS.md`](./DECISIONS.md) completa (19 filas), con
alternativa descartada, coste y estado de cada una — no se repite aquí para no duplicar la fuente
de verdad.

**Pregunta de visión de producto** (borrador — completar/editar con la pregunta exacta del PDF):
Si Ploot creciera para soportar además "Cazadores" (el otro tipo de perfil ya mencionado en el
esquema pero fuera de alcance de este slice) publicando en nombre de un Embajador con permisos
delegados, el cambio de más impacto en este diseño sería introducir un tercer claim en el JWT
(`acting_as_profile_id` distinto de `profile_id`) y una tabla de permisos explícita, en vez de
extender `oauth_tokens`/`posts` con más columnas — mantiene el aislamiento de tenant intacto
(sigue siendo RLS por `tenant_id`) y aísla la nueva regla de negocio ("quién puede publicar por
quién") en una sola tabla auditable, en vez de esparcirla por los repositorios existentes.

**Qué IA se usó** (3 líneas): Claude Code (y luego Cursor, tras cortarse la sesión por límite)
para diseño, implementación y tests de todo el sistema, en pares con revisión humana constante de
cada decisión antes de aceptarla — no autocompletado suelto. Cada decisión de arquitectura se
razonó explícitamente con su alternativa descartada (`DECISIONS.md`) antes de escribir código,
no se aceptó la primera sugerencia sin justificarla. Los bugs reales que aparecieron (documentados
en `DECISIONS.md` #11) salieron de tests de integración contra Postgres/mock real, no de
inspección manual del código generado — la IA no sustituye la verificación de extremo a extremo.
