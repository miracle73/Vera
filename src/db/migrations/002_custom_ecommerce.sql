-- Vera Custom E-Commerce Schema
-- Replaces Shopify-dependent tables with self-contained product/order system

BEGIN;

-- 001 creates Shopify-shaped orders/order_items; replace them so the
-- CREATE TABLE IF NOT EXISTS statements below take effect.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'orders' AND column_name = 'shopify_order_id') THEN
    DROP TABLE IF EXISTS order_items;
    DROP TABLE IF EXISTS orders CASCADE;
  END IF;
END $$;

-- ── Products ──
CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(500) NOT NULL,
  sku         VARCHAR(255) UNIQUE,
  price       DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  description TEXT,
  stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_name ON products USING gin(to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);

-- ── Discounts ──
CREATE TABLE IF NOT EXISTS discounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(100) UNIQUE NOT NULL,
  type        VARCHAR(20) NOT NULL CHECK (type IN ('percentage', 'fixed')),
  value       DECIMAL(10,2) NOT NULL CHECK (value > 0),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discounts_code ON discounts(code);
CREATE INDEX IF NOT EXISTS idx_discounts_active ON discounts(active);

-- ── Orders (rewritten) ──
CREATE TABLE IF NOT EXISTS orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id          UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  customer_name    VARCHAR(255),
  phone            VARCHAR(50),
  shipping_address JSONB,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  total            DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_provider VARCHAR(20) CHECK (payment_provider IN ('stripe', 'paystack')),
  payment_ref      VARCHAR(255),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_call_id ON orders(call_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_ref ON orders(payment_ref);

-- ── Order Items (rewritten) ──
CREATE TABLE IF NOT EXISTS order_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id),
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  price       DECIMAL(10,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- ── Drop legacy Shopify columns (safe even if columns don't exist via DO block) ──
DO $$
BEGIN
  ALTER TABLE orders DROP COLUMN IF EXISTS shopify_order_id;
  ALTER TABLE orders DROP COLUMN IF EXISTS shopify_draft_order_id;
  ALTER TABLE orders DROP COLUMN IF EXISTS subtotal;
  ALTER TABLE orders DROP COLUMN IF EXISTS discount_amount;
  ALTER TABLE orders DROP COLUMN IF EXISTS discount_code;
  ALTER TABLE orders DROP COLUMN IF EXISTS shipping_method;
  ALTER TABLE order_items DROP COLUMN IF EXISTS shopify_variant_id;
  ALTER TABLE order_items DROP COLUMN IF EXISTS title;
  ALTER TABLE order_items DROP COLUMN IF EXISTS unit_price;
  ALTER TABLE order_items DROP COLUMN IF EXISTS sku;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

COMMIT;
