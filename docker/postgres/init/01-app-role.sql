-- Fresh Compose volumes only (docker-entrypoint-initdb.d).
-- Existing volumes: applied via Prisma migration 20260811093000_nova_app_role.
CREATE ROLE nova_app WITH
  LOGIN
  PASSWORD 'nova_dev_password'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS;

GRANT CONNECT ON DATABASE nova_crm TO nova_app;
GRANT USAGE ON SCHEMA public TO nova_app;
ALTER DEFAULT PRIVILEGES FOR ROLE nova IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nova_app;
