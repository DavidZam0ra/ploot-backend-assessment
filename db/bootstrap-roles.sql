-- Fija las contraseñas de app_role/worker_role fuera de las migraciones versionadas (ver el
-- comentario en 0001_init.sql: "nunca en este archivo versionado"). Parametrizado con variables
-- de psql, no valores hardcodeados — ejecutar así:
--
--   psql "$SUPERUSER_DATABASE_URL" \
--     -v app_role_password="$APP_ROLE_PASSWORD" \
--     -v worker_role_password="$WORKER_ROLE_PASSWORD" \
--     -f db/bootstrap-roles.sql
--
-- Con Docker esto ya corre solo, disparado por db/docker-init-roles.sh como
-- docker-entrypoint-initdb.d/* del contenedor de Postgres (ver docker-compose.yml) — el comando
-- de arriba solo hace falta a mano si usas una Postgres fuera de Docker.
alter role app_role with password :'app_role_password';
alter role worker_role with password :'worker_role_password';
