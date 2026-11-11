import { sql } from "drizzle-orm";
import { db } from "@/db";

// Idempotent, self-healing application schema.
// The app must never depend on an out-of-band `drizzle-kit push` to be usable:
// on a fresh preview database a missing `sessions` table previously caused
// every login/signup to 500 before the session cookie was issued.
let bootstrapPromise: Promise<void> | null = null;

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(320) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL,
  slug varchar(120) NOT NULL UNIQUE,
  plan varchar(40) NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(30) NOT NULL DEFAULT 'developer',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_members_org_idx ON organization_members (org_id);
CREATE INDEX IF NOT EXISTS org_members_user_idx ON organization_members (user_id);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  description text,
  default_engine varchar(20) NOT NULL DEFAULT 'postgres',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_org_idx ON projects (org_id);
CREATE TABLE IF NOT EXISTS database_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  engine varchar(20) NOT NULL,
  host text,
  port integer,
  database text,
  username text,
  secret_ref text,
  secret_ciphertext text,
  masked_connection text,
  ssl_mode varchar(30) NOT NULL DEFAULT 'prefer',
  schema_selection text NOT NULL DEFAULT 'public',
  read_only boolean NOT NULL DEFAULT true,
  status varchar(30) NOT NULL DEFAULT 'created',
  last_tested_at timestamptz,
  last_test_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE database_connections ADD COLUMN IF NOT EXISTS secret_ciphertext text;
CREATE INDEX IF NOT EXISTS connections_project_idx ON database_connections (project_id);
CREATE TABLE IF NOT EXISTS schema_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES database_connections(id) ON DELETE SET NULL,
  engine varchar(20) NOT NULL,
  source varchar(30) NOT NULL DEFAULT 'upload',
  status varchar(30) NOT NULL DEFAULT 'created',
  progress integer NOT NULL DEFAULT 0,
  current_stage text,
  error text,
  stats jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scans_project_idx ON schema_scans (project_id);
CREATE INDEX IF NOT EXISTS scans_created_idx ON schema_scans (created_at);
CREATE TABLE IF NOT EXISTS schema_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES schema_scans(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version integer NOT NULL,
  label varchar(200),
  engine varchar(20) NOT NULL,
  model jsonb NOT NULL,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  entity_count integer NOT NULL DEFAULT 0,
  field_count integer NOT NULL DEFAULT 0,
  index_count integer NOT NULL DEFAULT 0,
  relationship_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS versions_project_idx ON schema_versions (project_id);
CREATE INDEX IF NOT EXISTS versions_scan_idx ON schema_versions (scan_id);
CREATE TABLE IF NOT EXISTS analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES schema_scans(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analysis_scan_idx ON analysis_runs (scan_id);
CREATE TABLE IF NOT EXISTS analysis_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  scan_id uuid NOT NULL REFERENCES schema_scans(id) ON DELETE CASCADE,
  rule_id varchar(40) NOT NULL,
  category varchar(30) NOT NULL,
  severity varchar(20) NOT NULL,
  title text NOT NULL,
  object_name text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation text NOT NULL DEFAULT '',
  recommendation text NOT NULL DEFAULT '',
  confidence integer NOT NULL DEFAULT 50,
  requires_workload boolean NOT NULL DEFAULT false,
  limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_level varchar(30) NOT NULL DEFAULT 'schema',
  status varchar(20) NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS findings_analysis_idx ON analysis_findings (analysis_id);
CREATE INDEX IF NOT EXISTS findings_scan_idx ON analysis_findings (scan_id);
CREATE INDEX IF NOT EXISTS findings_severity_idx ON analysis_findings (severity);
CREATE TABLE IF NOT EXISTS migration_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_scan_id uuid REFERENCES schema_scans(id),
  target_scan_id uuid REFERENCES schema_scans(id),
  engine varchar(20) NOT NULL,
  diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  up_script text NOT NULL DEFAULT '',
  down_script text NOT NULL DEFAULT '',
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  script_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS migrations_project_idx ON migration_plans (project_id);
CREATE TABLE IF NOT EXISTS diagram_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES schema_scans(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL DEFAULT 'default',
  layout jsonb NOT NULL DEFAULT '{}'::jsonb,
  svg text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS layouts_scan_idx ON diagram_layouts (scan_id);
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  actor varchar(320),
  action varchar(100) NOT NULL,
  entity_type varchar(60),
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_project_idx ON audit_logs (project_id);
`;

export function ensureSchema(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`).catch(() => undefined);
      await db.execute(sql.raw(DDL));
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  return bootstrapPromise;
}
