# db/

Fuente de verdad del esquema. Una sola carpeta de migraciones que consumen tanto `app/` como `worker/` (evita que se desincronicen dos esquemas).

## Aplicar en local

```bash
psql "$DATABASE_URL" -f db/migrations/0001_init.sql
```

Con Docker esto ya es automático: `docker-compose.yml` monta `db/migrations/0001_init.sql` y `db/docker-init-roles.sh` como `docker-entrypoint-initdb.d/*` del propio contenedor de Postgres, que fija la contraseña de `app_role`/`worker_role` desde `APP_ROLE_PASSWORD`/`WORKER_ROLE_PASSWORD` (ver `.env.example` en la raíz) la primera vez que se crea el volumen. El comando de arriba (`psql -f db/migrations/0001_init.sql`) solo hace falta si usas una Postgres fuera de Docker.

## Seed (`seed/`)

Pendiente: script que crea tenants, Embajadores, tokens en los tres estados (`valid`/`expired`/`revoked`) y posts en varios estados, para poder probar la UI y el worker sin depender de un proveedor real.
