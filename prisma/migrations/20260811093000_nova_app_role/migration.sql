-- P2.2 follow-up: non-superuser app role so FORCE RLS is actually enforced.
-- Postgres superusers (Compose POSTGRES_USER=nova) always bypass RLS.
-- App runtime must connect as nova_app; migrations keep using nova (MIGRATE_DATABASE_URL).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nova_app') THEN
    -- Password matches local Compose default only (docs/ENVIRONMENTS.md).
    -- Staging/prod: create/alter this role with a secret password before expose.
    CREATE ROLE nova_app WITH
      LOGIN
      PASSWORD 'nova_dev_password'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE nova_crm TO nova_app;
GRANT USAGE ON SCHEMA public TO nova_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organizations, members TO nova_app;

ALTER DEFAULT PRIVILEGES FOR ROLE nova IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nova_app;
