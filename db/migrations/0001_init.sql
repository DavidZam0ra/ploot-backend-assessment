-- Extensiones
create extension if not exists pgcrypto; -- gen_random_uuid()

-- Enums
create type post_status as enum ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled');
create type token_status as enum ('valid', 'expired', 'revoked');

-- Tenants
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Embajadores (los únicos perfiles que publican; los Cazadores quedan fuera de este slice).
create table profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  display_name text not null,
  provider_account_id text not null, -- identidad del Embajador en el proveedor externo
  created_at timestamptz not null default now(),
  unique (tenant_id, provider_account_id)
);

create index profiles_tenant_idx on profiles (tenant_id);

-- Tokens OAuth por Embajador. Cifrado a nivel de aplicación (AES-256-GCM): esta tabla solo
-- guarda ciphertext + nonce, nunca texto plano. La clave de cifrado vive fuera de Postgres
-- (env/KMS) para que un dump de la BD no exponga tokens por sí solo.
create table oauth_tokens (
  profile_id uuid primary key references profiles(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  status token_status not null default 'valid',
  encrypted_access_token bytea not null,
  encrypted_refresh_token bytea not null,
  encryption_nonce bytea not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index oauth_tokens_tenant_idx on oauth_tokens (tenant_id);
create index oauth_tokens_expiring_idx on oauth_tokens (expires_at) where status = 'valid';

-- Posts
create table posts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  status post_status not null default 'draft',
  content text not null,
  scheduled_at timestamptz,
  claimed_at timestamptz,      -- cuándo lo reclamó un worker (para detectar reclamos obsoletos)
  claimed_by text,             -- id del worker que lo reclamó (observabilidad)
  published_at timestamptz,
  external_id text,            -- id devuelto por el proveedor al publicar
  attempt_count int not null default 0,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_at_required_when_scheduled
    check (status <> 'scheduled' or scheduled_at is not null)
);

create index posts_tenant_status_idx on posts (tenant_id, status);

-- Query caliente del worker: "posts vencidos, repartidos de forma justa entre tenants".
-- Parcial (solo status='scheduled') para que se mantenga pequeño aunque la tabla crezca a
-- millones de filas con un tenant grande dentro. tenant_id incluido para soportar el
-- row_number() OVER (PARTITION BY tenant_id ...) que usa el worker para intercalar tenants
-- en vez de vaciar primero la cola del tenant más grande.
create index posts_claim_idx on posts (scheduled_at, tenant_id) where status = 'scheduled';

-- Sweep de reclamos obsoletos: si un worker muere entre "reclamar" y "publicar", el post se
-- queda en 'publishing'. Este índice soporta el barrido periódico que lo devuelve a 'scheduled'.
create index posts_stale_publishing_idx on posts (claimed_at) where status = 'publishing';

-- Idempotencia genérica para POST .../publish vía header Idempotency-Key. Se modela como su
-- propia tabla (no una columna en posts) porque el patrón es reutilizable para cualquier
-- endpoint mutante futuro, no solo publish.
create table idempotency_keys (
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null,
  result jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

-- ── Aislamiento de tenant a nivel SQL (no en el Route Handler) ─────────────────────────────
-- app_role  -> usado por la API Next.js. RLS activo siempre; el tenant se fija con
--              `SET LOCAL app.tenant_id = '<uuid>'` al inicio de cada transacción (compatible
--              con PgBouncer en transaction mode, porque SET LOCAL vive solo dentro de la tx).
-- worker_role -> proceso interno de confianza (no expuesto a requests externos), necesita ver
--              todos los tenants a la vez para repartir la cola de forma justa: BYPASSRLS.
--
-- Las contraseñas de estos roles se fijan en el arranque del contenedor (docker-entrypoint /
-- script de bootstrap) a partir de variables de entorno — nunca en este archivo versionado.
create role app_role login;
create role worker_role login bypassrls;

alter table profiles enable row level security;
alter table oauth_tokens enable row level security;
alter table posts enable row level security;
alter table idempotency_keys enable row level security;

create policy tenant_isolation on profiles
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy tenant_isolation on oauth_tokens
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy tenant_isolation on posts
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy tenant_isolation on idempotency_keys
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on tenants, profiles, oauth_tokens, posts, idempotency_keys
  to app_role, worker_role;
