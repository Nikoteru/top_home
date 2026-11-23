CREATE SCHEMA IF NOT EXISTS top_home;
SET LOCAL search_path TO top_home, pg_catalog;

CREATE TABLE IF NOT EXISTS site_content (
  singleton boolean PRIMARY KEY CHECK (singleton),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  revision bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS estimate_templates (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  position bigint NOT NULL,
  title_key text COLLATE "C" NOT NULL UNIQUE,
  revision bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS estimate_runs (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  position bigint NOT NULL,
  title_key text COLLATE "C" NOT NULL UNIQUE,
  revision bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND data->>'id' IS NOT DISTINCT FROM id),
  position bigint NOT NULL,
  estimate_run_id text GENERATED ALWAYS AS (NULLIF(data->>'estimateRunId', '')) STORED
    REFERENCES estimate_runs (id)
);

CREATE TABLE IF NOT EXISTS estimate_archive (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  position bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS estimate_materials (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  position bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS estimate_units (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  position bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  position bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_accounts (
  id text PRIMARY KEY CHECK (id IN ('admin', 'superadmin')),
  data jsonb NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_accounts_username_idx ON admin_accounts ((data->>'username') COLLATE "C");
