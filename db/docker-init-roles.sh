#!/bin/sh
# Se monta en /docker-entrypoint-initdb.d/ (ver docker-compose.yml, servicio postgres) y lo
# ejecuta la propia imagen oficial de Postgres tras aplicar las migraciones, solo la primera vez
# que se crea el volumen. Sustituye al paso manual descrito en db/bootstrap-roles.sql: aquí las
# contraseñas salen de las variables de entorno del contenedor (APP_ROLE_PASSWORD /
# WORKER_ROLE_PASSWORD, ver .env.example en la raíz), nunca hardcodeadas.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_role_password="$APP_ROLE_PASSWORD" \
  -v worker_role_password="$WORKER_ROLE_PASSWORD" \
  -f /opt/ploot/bootstrap-roles.sql
