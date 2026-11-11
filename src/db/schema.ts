import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  varchar,
  index,
} from "drizzle-orm/pg-core";

// ── Identity & tenancy ──────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expiry_idx").on(t.expiresAt)]
);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  plan: varchar("plan", { length: 40 }).notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 30 }).notNull().default("developer"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("org_members_org_idx").on(t.orgId), index("org_members_user_idx").on(t.userId)]
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    defaultEngine: varchar("default_engine", { length: 20 }).notNull().default("postgres"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("projects_org_idx").on(t.orgId)]
);

// ── Connections (credentials stored as reference + masked meta) ─────
export const databaseConnections = pgTable(
  "database_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    engine: varchar("engine", { length: 20 }).notNull(), // postgres | mongodb
    host: text("host"),
    port: integer("port"),
    database: text("database"),
    username: text("username"),
    // AES-256-GCM envelope. The key is derived server-side from the deployment
    // secret; ciphertext is never selected into API responses.
    secretRef: text("secret_ref"),
    secretCiphertext: text("secret_ciphertext"),
    maskedConnection: text("masked_connection"),
    sslMode: varchar("ssl_mode", { length: 30 }).notNull().default("prefer"),
    schemaSelection: text("schema_selection").notNull().default("public"),
    readOnly: boolean("read_only").notNull().default(true),
    status: varchar("status", { length: 30 }).notNull().default("created"),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    lastTestResult: jsonb("last_test_result"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("connections_project_idx").on(t.projectId)]
);

// ── Scans & versions ────────────────────────────────────────────────
export const schemaScans = pgTable(
  "schema_scans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").references(() => databaseConnections.id, {
      onDelete: "set null",
    }),
    engine: varchar("engine", { length: 20 }).notNull(),
    source: varchar("source", { length: 30 }).notNull().default("upload"), // upload | introspection | dsl
    status: varchar("status", { length: 30 }).notNull().default("created"),
    // created → queued → connecting → introspecting → normalizing → analyzing → generating_diagrams → completed
    // failed | cancelled | partial
    progress: integer("progress").notNull().default(0),
    currentStage: text("current_stage"),
    error: text("error"),
    stats: jsonb("stats"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("scans_project_idx").on(t.projectId),
    index("scans_created_idx").on(t.createdAt),
  ]
);

export const schemaVersions = pgTable(
  "schema_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => schemaScans.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    label: varchar("label", { length: 200 }),
    engine: varchar("engine", { length: 20 }).notNull(),
    model: jsonb("model").notNull(),
    warnings: jsonb("warnings").notNull().default([]),
    entityCount: integer("entity_count").notNull().default(0),
    fieldCount: integer("field_count").notNull().default(0),
    indexCount: integer("index_count").notNull().default(0),
    relationshipCount: integer("relationship_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("versions_project_idx").on(t.projectId),
    index("versions_scan_idx").on(t.scanId),
  ]
);

// ── Analysis ────────────────────────────────────────────────────────
export const analysisRuns = pgTable(
  "analysis_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => schemaScans.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    summary: jsonb("summary").notNull().default({}),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("analysis_scan_idx").on(t.scanId)]
);

export const analysisFindings = pgTable(
  "analysis_findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "cascade" }),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => schemaScans.id, { onDelete: "cascade" }),
    ruleId: varchar("rule_id", { length: 40 }).notNull(),
    category: varchar("category", { length: 30 }).notNull(),
    severity: varchar("severity", { length: 20 }).notNull(),
    title: text("title").notNull(),
    objectName: text("object_name"),
    evidence: jsonb("evidence").notNull().default({}),
    explanation: text("explanation").notNull().default(""),
    recommendation: text("recommendation").notNull().default(""),
    confidence: integer("confidence").notNull().default(50),
    requiresWorkload: boolean("requires_workload").notNull().default(false),
    limitations: jsonb("limitations").notNull().default([]),
    evidenceLevel: varchar("evidence_level", { length: 30 }).notNull().default("schema"),
    status: varchar("status", { length: 20 }).notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("findings_analysis_idx").on(t.analysisId),
    index("findings_scan_idx").on(t.scanId),
    index("findings_severity_idx").on(t.severity),
  ]
);

// ── Migrations & diffs ──────────────────────────────────────────────
export const migrationPlans = pgTable(
  "migration_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceScanId: uuid("source_scan_id").references(() => schemaScans.id),
    targetScanId: uuid("target_scan_id").references(() => schemaScans.id),
    engine: varchar("engine", { length: 20 }).notNull(),
    diff: jsonb("diff").notNull().default({}),
    upScript: text("up_script").notNull().default(""),
    downScript: text("down_script").notNull().default(""),
    risks: jsonb("risks").notNull().default([]),
    validation: jsonb("validation").notNull().default({}),
    scriptHash: text("script_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("migrations_project_idx").on(t.projectId)]
);

export const diagramLayouts = pgTable(
  "diagram_layouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => schemaScans.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull().default("default"),
    layout: jsonb("layout").notNull().default({}),
    svg: text("svg"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("layouts_scan_idx").on(t.scanId)]
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    actor: varchar("actor", { length: 320 }),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 60 }),
    entityId: text("entity_id"),
    detail: jsonb("detail").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_project_idx").on(t.projectId)]
);
