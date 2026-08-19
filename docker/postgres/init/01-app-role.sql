-- Local dev only (docker-compose.yml). Fresh Compose volumes only.
-- Production: nova_app is created by Prisma migration; password is set by Dockerfile.migrate.
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
