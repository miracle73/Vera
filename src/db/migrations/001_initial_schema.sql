-- Vera Database Schema
-- Run this manually or via the migration runner

BEGIN;

-- ── Calls ──
CREATE TABLE IF NOT EXISTS calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vapi_call_id    VARCHAR(255) UNIQUE NOT NULL,
  phone_number    VARCHAR(50),
  customer_name   VARCHAR(255),
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'completed', 'transferred', 'failed')),
  outcome         VARCHAR(255),
  transcript      TEXT,
  duration_seconds INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_calls_vapi_call_id ON calls(vapi_call_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at);

-- ── Orders ──
CREATE TABLE IF NOT EXISTS orders (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id                 UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  shopify_order_id        VARCHAR(255),
  shopify_draft_order_id  VARCHAR(255),
  status                  VARCHAR(20) NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'pending', 'confirmed', 'paid', 'fulfilled', 'cancelled')),
  subtotal                DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount_amount         DECIMAL(10,2) NOT NULL DEFAULT 0,
  total                   DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount_code           VARCHAR(100),
  shipping_method         VARCHAR(255),
  shipping_address        JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_call_id ON orders(call_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_shopify_order_id ON orders(shopify_order_id);

-- ── Order Items ──
CREATE TABLE IF NOT EXISTS order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shopify_variant_id  VARCHAR(255) NOT NULL,
  title               VARCHAR(500) NOT NULL,
  quantity            INTEGER NOT NULL DEFAULT 1,
  unit_price          DECIMAL(10,2) NOT NULL,
  sku                 VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- ── Transfers ──
CREATE TABLE IF NOT EXISTS transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id         UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  reason          VARCHAR(500) NOT NULL,
  target          VARCHAR(255) NOT NULL,
  context_summary TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfers_call_id ON transfers(call_id);

-- ── Migration Tracking ──
CREATE TABLE IF NOT EXISTS migrations (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) UNIQUE NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
