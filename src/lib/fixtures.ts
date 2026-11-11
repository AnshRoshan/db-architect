// Golden fixtures: e-commerce (PG), SaaS multi-tenant (PG), social (Mongo)
export const FIXTURE_ECOMMERCE_SQL = `-- Golden fixture: simple e-commerce (postgres)
CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  email varchar(320) NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.products (
  id uuid PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  total_cents integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  qty integer NOT NULL DEFAULT 1,
  price_cents integer NOT NULL,
  UNIQUE (order_id, product_id)
);
CREATE INDEX idx_orders_user ON public.orders USING btree (user_id);
CREATE INDEX idx_orders_user_dup ON public.orders USING btree (user_id);
CREATE INDEX idx_orders_user_status ON public.orders USING btree (user_id, status);
CREATE INDEX idx_flag_active ON public.orders USING btree (status) WHERE status = 'active';
`;

export const FIXTURE_SAAS_YAML = `engine: postgres
database: saas_demo
namespaces: [public]
entities:
  - name: public.tenants
    kind: table
    fields:
      - { name: id, type: uuid, primaryKey: true }
      - { name: slug, type: text, nullable: false, unique: true }
      - { name: plan, type: text, nullable: false, default: "'free'" }
    constraints:
      - { name: tenants_pkey, kind: primary_key, columns: [id] }
      - { name: tenants_slug_uq, kind: unique, columns: [slug] }
  - name: public.memberships
    kind: table
    fields:
      - { name: id, type: uuid, primaryKey: true }
      - { name: tenant_id, type: uuid, nullable: false }
      - { name: user_email, type: text, nullable: false }
      - { name: role, type: text, nullable: false, default: "'viewer'" }
    constraints:
      - { name: memberships_pkey, kind: primary_key, columns: [id] }
      - { name: fk_memberships_tenant, kind: foreign_key, columns: [tenant_id], references: public.tenants, referencedColumns: [id], onDelete: CASCADE }
    indexes:
      - { name: idx_memberships_tenant, columns: [tenant_id] }
  - name: public.audit_log
    kind: table
    fields:
      - { name: id, type: bigint, nullable: true }
      - { name: tenant_id, type: text, nullable: true }
      - { name: action, type: text, nullable: true }
      - { name: created_at, type: timestamp, nullable: true }
    constraints:
      - { name: fk_audit_tenant, kind: foreign_key, columns: [tenant_id], references: public.tenants, referencedColumns: [id] }
`;

export const FIXTURE_MONGO_JSON = JSON.stringify(
  {
    database: "social_demo",
    collections: [
      {
        name: "users",
        indexes: [{ name: "_id_", key: { _id: 1 } }, { name: "email_1", key: { email: 1 }, unique: true }],
        sample: [
          { _id: "u1", email: "a@x.com", name: "A", role: "admin", createdAt: "2024-01-01" },
          { _id: "u2", email: "b@x.com", name: "B", createdAt: "2024-02-01" },
        ],
      },
      {
        name: "posts",
        indexes: [{ name: "_id_", key: { _id: 1 } }, { name: "authorId_1_createdAt_-1", key: { authorId: 1, createdAt: -1 } }, { name: "authorId_1", key: { authorId: 1 } }],
        sample: [
          { _id: "p1", authorId: "u1", title: "Hello", tags: ["intro"], comments: [{ by: "u2", text: "hi" }], views: 10 },
          { _id: "p2", authorId: "u1", title: "Second", tags: "intro", views: "many", comments: [] },
          { _id: "p3", authorId: "u2", activityLog: [1, 2, 3], views: 5 },
        ],
      },
    ],
  },
  null,
  2
);

export const FIXTURE_TARGET_SQL = `-- Proposed target: fix orders FK index dup + add missing bits
CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  email varchar(320) NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.products (
  id uuid PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  total_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  currency text NOT NULL DEFAULT 'USD'
);
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  qty integer NOT NULL DEFAULT 1,
  price_cents integer NOT NULL,
  UNIQUE (order_id, product_id)
);
CREATE INDEX idx_orders_user_status ON public.orders USING btree (user_id, status);
CREATE INDEX idx_orders_created ON public.orders USING btree (created_at);
`;

export const FIXTURE_MYSQL_SQL = `-- MySQL dump · shop (golden fixture)
/*!40101 SET NAMES utf8mb4 */;
CREATE DATABASE IF NOT EXISTS \`shop\`;
USE \`shop\`;
DROP TABLE IF EXISTS \`customers\`;
CREATE TABLE \`customers\` (
  \`id\` int unsigned NOT NULL AUTO_INCREMENT,
  \`email\` varchar(255) NOT NULL,
  \`full_name\` varchar(120) NOT NULL,
  \`is_active\` tinyint(1) NOT NULL DEFAULT '1',
  \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_customers_email\` (\`email\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE \`orders\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`customer_id\` int unsigned NOT NULL,
  \`status\` varchar(20) NOT NULL DEFAULT 'pending',
  \`total\` float NOT NULL DEFAULT 0,
  \`placed_at\` datetime NOT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_orders_customer\` (\`customer_id\`),
  KEY \`idx_orders_customer_status\` (\`customer_id\`,\`status\`),
  CONSTRAINT \`fk_orders_customer\` FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=100 DEFAULT CHARSET=utf8mb4;
CREATE TABLE \`order_items\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`order_id\` bigint NOT NULL,
  \`sku\` varchar(40) NOT NULL,
  \`qty\` int NOT NULL DEFAULT '1',
  \`price_cents\` int NOT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_items_order\` (\`order_id\`),
  CONSTRAINT \`fk_items_order\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE CASCADE
) ENGINE=MyISAM DEFAULT CHARSET=utf8;
INSERT INTO \`customers\` VALUES (1,'ada@example.com','Ada',1,'2024-01-01 00:00:00');
`;

export const FIXTURE_SQLITE_SQL = `PRAGMA foreign_keys=ON;
BEGIN TRANSACTION;
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  pinned BOOLEAN NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE note_tags (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX idx_notes_pinned ON notes(pinned);
COMMIT;
`;
