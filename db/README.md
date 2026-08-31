# db/

Fuente de verdad del esquema. Una sola carpeta de migraciones que consumen tanto `app/` como `worker/` (evita que se desincronicen dos esquemas).

## Aplicar en local

```bash
psql "$DATABASE_URL" -f db/migrations/0001_init.sql
```

TODO: ejecutar esto automáticamente al `docker compose up` (contenedor de migración de un solo uso antes de arrancar `app`/`worker`) y fijar las contraseñas de `app_role`/`worker_role` desde variables de entorno en el bootstrap del contenedor de Postgres.

## Seed (`seed/`)

Pendiente: script que crea tenants, Embajadores, tokens en los tres estados (`valid`/`expired`/`revoked`) y posts en varios estados, para poder probar la UI y el worker sin depender de un proveedor real.
