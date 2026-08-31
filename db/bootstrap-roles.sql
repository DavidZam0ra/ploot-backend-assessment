-- Fija las contraseñas de app_role/worker_role fuera de las migraciones versionadas (ver el
-- comentario en 0001_init.sql: "nunca en este archivo versionado"). Parametrizado con variables
-- de psql, no valores hardcodeados — ejecutar así:
--
--   psql "$SUPERUSER_DATABASE_URL" \
--     -v app_role_password="$APP_ROLE_PASSWORD" \
--     -v worker_role_password="$WORKER_ROLE_PASSWORD" \
--     -f db/bootstrap-roles.sql
--
-- En producción esto lo dispara el arranque del contenedor a partir de secretos del entorno,
-- nunca a mano. Pendiente: automatizarlo como script de docker-entrypoint-initdb.d.
alter role app_role with password :'app_role_password';
alter role worker_role with password :'worker_role_password';
