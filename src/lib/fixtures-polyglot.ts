// A realistic polyglot system used by the demo workspace and the test suite:
//   commerce-core     PostgreSQL · one database, eight schemas, cross-schema FKs
//   commerce-content  MongoDB    · reviews, carts, events and a duplicated product catalog
//   commerce-cache    Redis      · sessions, caches, rate limits, queues
// The flaws are deliberate so every analysis layer has something real to find.

export const FIXTURE_MULTISCHEMA_SQL = `-- commerce_core · PostgreSQL · one database, many schemas
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS sales;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS support;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(320) NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  primary_subscription_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON auth.sessions (user_id);
CREATE TABLE auth.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{}',
  last_used_at timestamptz
);

CREATE TABLE catalog.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES catalog.categories(id),
  name text NOT NULL,
  slug text NOT NULL UNIQUE
);
CREATE TABLE catalog.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  attributes jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE catalog.product_categories (
  product_id uuid NOT NULL REFERENCES catalog.products(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES catalog.categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);
CREATE TABLE catalog.inventory (
  product_id uuid PRIMARY KEY REFERENCES catalog.products(id) ON DELETE CASCADE,
  on_hand integer NOT NULL DEFAULT 0,
  reserved integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending',
  total_cents integer NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'USD',
  placed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_idx ON sales.orders (user_id);
CREATE INDEX orders_user_id_idx ON sales.orders (user_id);
CREATE TABLE sales.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES sales.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES catalog.products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL
);
CREATE INDEX order_items_order_idx ON sales.order_items (order_id);
CREATE TABLE sales.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES sales.orders(id),
  provider text NOT NULL,
  amount_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  captured_at timestamptz
);

CREATE TABLE billing.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  plan text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  renews_at timestamptz
);
CREATE TABLE billing.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  order_id uuid REFERENCES sales.orders(id),
  subscription_id uuid REFERENCES billing.subscriptions(id),
  total numeric(12,2) NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing.invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES billing.invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL
);
ALTER TABLE auth.users ADD CONSTRAINT users_primary_subscription_fk FOREIGN KEY (primary_subscription_id) REFERENCES billing.subscriptions(id);

CREATE TABLE support.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  order_id uuid REFERENCES sales.orders(id),
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE support.ticket_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support.tickets(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE analytics.events (
  id bigserial PRIMARY KEY,
  user_id uuid,
  product_id uuid,
  event_type text NOT NULL,
  payload jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE analytics.daily_revenue (
  day date PRIMARY KEY,
  orders integer NOT NULL,
  revenue double precision NOT NULL
);

CREATE TABLE audit.change_log (
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  actor_id uuid,
  change jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  rollout integer NOT NULL DEFAULT 0
);
CREATE TABLE public.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
`;

const uuid = (n: number) => `0f8fad5b-d9cb-469f-a165-${String(n).padStart(12, "0")}`;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export const FIXTURE_COMMERCE_MONGO_JSON = JSON.stringify(
  {
    database: "commerce_content",
    collections: [
      {
        name: "products",
        indexes: [{ name: "_id_", key: { _id: 1 } }, { name: "sku_1", key: { sku: 1 }, unique: true }],
        sample: [
          { _id: uuid(1), sku: "SKU-1000", name: "Trail shoe", description: "Light trail runner", priceCents: 12900, attributes: { color: "red", sizes: [40, 41, 42] }, status: "active", media: [{ url: "https://cdn.example.com/1000.jpg", kind: "image" }] },
          { _id: uuid(2), sku: "SKU-1001", name: "Rain shell", description: "Packable jacket", priceCents: 18900, attributes: { color: "navy" }, status: "active", media: [] },
          { _id: uuid(3), sku: "SKU-1002", name: "Wool sock", priceCents: 1900, attributes: { pack: 3 }, status: "archived" },
        ],
      },
      {
        name: "product_reviews",
        indexes: [{ name: "_id_", key: { _id: 1 } }, { name: "productId_1_createdAt_-1", key: { productId: 1, createdAt: -1 } }],
        sample: [
          { _id: "rv1", productId: uuid(1), userId: uuid(11), rating: 5, body: "Great grip", helpfulVotes: 12, createdAt: "2024-05-01T10:00:00Z" },
          { _id: "rv2", productId: uuid(1), userId: uuid(12), rating: 3, body: "Runs small", helpfulVotes: 2, createdAt: "2024-05-03T08:30:00Z" },
          { _id: "rv3", productId: uuid(2), userId: uuid(11), rating: 4, createdAt: "2024-05-09T19:12:00Z" },
        ],
      },
      {
        name: "carts",
        indexes: [{ name: "_id_", key: { _id: 1 } }],
        sample: [
          { _id: "c1", userId: 4211, items: [{ productId: uuid(1), quantity: 2 }, { productId: uuid(3), quantity: 1 }], updatedAt: "2024-06-01T09:00:00Z" },
          { _id: "c2", userId: 4212, items: [{ productId: uuid(2), quantity: 1 }], updatedAt: "2024-06-01T09:05:00Z" },
        ],
      },
      {
        name: "activity_events",
        indexes: [{ name: "_id_", key: { _id: 1 } }],
        sample: [
          { _id: "e1", userId: uuid(11), type: "view", productId: uuid(1), payload: { referrer: "search" }, ts: "2024-06-01T09:00:01Z" },
          { _id: "e2", userId: uuid(12), type: "add_to_cart", productId: uuid(2), payload: { quantity: 1 }, ts: "2024-06-01T09:00:07Z" },
          { _id: "e3", userId: uuid(11), type: "checkout", orderId: uuid(501), payload: {}, ts: "2024-06-01T09:02:44Z" },
        ],
      },
    ],
  },
  null,
  2
);

export const FIXTURE_REDIS_JSON = JSON.stringify(
  {
    engine: "redis",
    database: "commerce_cache",
    db: 0,
    version: "7.2.4",
    maxmemoryPolicy: "noeviction",
    totalKeys: 184000,
    keys: [
      ...range(8).map((i) => ({ key: `session:${uuid(900 + i)}`, type: "hash", ttl: 1800 - i * 120, memory: 312, size: 5, fields: { user_id: uuid(11 + i), ip: "203.0.113.7", user_agent: "Mozilla/5.0", csrf: "x", created_at: "2024-06-01T10:00:00Z" } })),
      ...range(6).map((i) => ({ key: `user:${uuid(11 + i)}`, type: "hash", ttl: 900, memory: 420, size: 4, fields: { email: "a@example.com", display_name: "Ada", plan: "pro", cached_at: "2024-06-01T10:00:00Z" } })),
      ...range(6).map((i) => ({ key: `cache:product:${uuid(1 + i)}`, type: "string", ttl: 300, memory: 2100, size: 1840, json: true, fields: { sku: "SKU-1000", name: "Trail shoe", price_cents: 12900, status: "active" } })),
      ...range(5).map((i) => ({ key: `user:${uuid(11 + i)}:recent_views`, type: "list", ttl: 86400, memory: 640, size: 20 })),
      ...range(5).map((i) => ({ key: `cart:${7000 + i}`, type: "hash", ttl: -1, memory: 980, size: 6, fields: { user_id: uuid(11 + i), items: "[{\"product_id\":1}]", updated_at: "2024-06-01T09:00:00Z" } })),
      ...range(4).map((i) => ({ key: `wishlist:${uuid(11 + i)}`, type: "set", ttl: -1, memory: 510, size: 14 })),
      ...range(4).map((i) => ({ key: `otp:${uuid(11 + i)}`, type: "string", ttl: -1, memory: 72, size: 6 })),
      ...range(4).map((i) => ({ key: `rate:login:203.0.113.${10 + i}`, type: "string", ttl: 60, memory: 64, size: 2 })),
      ...range(3).map((i) => ({ key: `lock:order:${uuid(500 + i)}`, type: "string", ttl: 30, memory: 80, size: 36 })),
      ...range(3).map((i) => ({ key: `leaderboard:daily:2024-06-0${i + 1}`, type: "zset", ttl: -1, memory: 1_480_000, size: 15000 })),
      { key: "queue:emails", type: "list", ttl: -1, memory: 9_600_000, size: 48211 },
      { key: "feature_flags", type: "hash", ttl: -1, memory: 900, size: 22, fields: { new_checkout: "true", dark_mode: "false" } },
    ],
  },
  null,
  2
);
