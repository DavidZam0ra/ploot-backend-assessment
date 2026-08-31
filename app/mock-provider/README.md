# @ploot/mock-provider

Simula la red social externa contra la que publica el worker. Servicio HTTP mínimo, sin
dependencias más allá de `node:http` — no hay ninguna API real detrás, el contrato es el que
define este README (tal y como permite el enunciado).

No hay IdP real: el estado de un token (`valid` / `expired` / `revoked`) va codificado en el
propio string del token, formato `mock_<state>_<uuid>`. Así el seed de datos puede fijar el
escenario que quiera sin que este servicio necesite guardar estado. Un token con un formato que
no reconoce se trata como `revoked` (falla cerrado, no abierto).

## `POST /provider/publish`

Headers: `Authorization: Bearer <accessToken>`
Body: `{ "content": string }`

| Condición | Respuesta |
|---|---|
| Sin `Authorization` | `401 { error: "invalid_token" }` |
| Token `expired` | `401 { error: "token_expired" }` |
| Token `revoked` (o formato desconocido) | `403 { error: "token_revoked" }` |
| Token `valid`, dado el azar (`MOCK_RATE_LIMIT_PROBABILITY`) | `429 { error: "rate_limited" }` + header `Retry-After: <segundos>` |
| Token `valid`, dado el azar (`MOCK_SERVER_ERROR_PROBABILITY`) | `500 { error: "server_error" }` |
| Token `valid`, resto de casos | `200 { externalId: string }` |

Toda respuesta espera entre 0 y `MOCK_MAX_LATENCY_MS` antes de enviarse.

## `POST /provider/oauth/refresh`

Body: `{ "refreshToken": string }`

| Condición | Respuesta |
|---|---|
| Sin `refreshToken` | `401 { error: "invalid_token" }` |
| Refresh token `revoked` (o formato desconocido) | `403 { error: "token_revoked" }` — irrecuperable |
| Refresh token `valid` o `expired` | `200 { accessToken, refreshToken, expiresIn }` — un access token expirado sí se recupera, es justo para eso que existe el refresh |

## Header `X-Mock-Force` (solo para tests)

Fuerza un desenlace concreto ignorando el estado real del token y los dados de probabilidad:
`success` | `rate_limited` | `server_error` | `token_expired` | `token_revoked`. Así los tests de
`worker/` pueden ejercitar cada rama del orquestador (backoff, respeto de `Retry-After`, token
revocado a mitad de lote) sin depender de generar un token con el formato exacto o de azar real.

## Variables de entorno

| Variable | Default | Qué hace |
|---|---|---|
| `PORT` | `4000` | Puerto de escucha |
| `MOCK_MAX_LATENCY_MS` | `3000` | Latencia máxima simulada por request (0–N ms, aleatoria) |
| `MOCK_RATE_LIMIT_PROBABILITY` | `0.1` | Probabilidad de 429 orgánico sobre un token válido |
| `MOCK_SERVER_ERROR_PROBABILITY` | `0.05` | Probabilidad de 500 orgánico sobre un token válido |
| `MOCK_RETRY_AFTER_SECONDS` | `5` | Valor del header `Retry-After` en los 429 |
