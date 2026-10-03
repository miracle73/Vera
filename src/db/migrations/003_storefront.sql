-- Storefront: product presentation fields + web (non-call) orders

BEGIN;

ALTER TABLE products ADD COLUMN IF NOT EXISTS category  VARCHAR(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tagline   VARCHAR(255);
ALTER TABLE products ADD COLUMN IF NOT EXISTS color     VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- Web orders have no associated phone call
ALTER TABLE orders ALTER COLUMN call_id DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS email  VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'voice';

COMMIT;
