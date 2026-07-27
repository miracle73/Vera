/**
 * Seed the database with sample products and discounts.
 *
 * Usage:
 *   npx ts-node scripts/seed.ts
 *   npx ts-node scripts/seed.ts --clear   (drops all products/discounts first)
 */

import * as dotenv from "dotenv";
dotenv.config();

import { Pool } from "pg";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://vera:vera_secret@localhost:5432/vera",
});

const SAMPLE_PRODUCTS = [
  {
    name: "Classic White T-Shirt",
    sku: "TS-WHT-001",
    price: 29.99,
    stock: 150,
    description: "100% cotton crew-neck t-shirt. Available in S, M, L, XL.",
  },
  {
    name: "Classic Black T-Shirt",
    sku: "TS-BLK-001",
    price: 29.99,
    stock: 120,
    description: "100% cotton crew-neck t-shirt. Available in S, M, L, XL.",
  },
  {
    name: "Slim Fit Jeans",
    sku: "JNS-SLM-001",
    price: 79.99,
    stock: 80,
    description: "Stretch denim slim-fit jeans. Dark indigo wash.",
  },
  {
    name: "Running Shoes - Ultra Boost",
    sku: "SH-RUN-001",
    price: 129.99,
    stock: 60,
    description: "Lightweight running shoes with responsive cushioning.",
  },
  {
    name: "Leather Crossbody Bag",
    sku: "BAG-CRS-001",
    price: 89.99,
    stock: 40,
    description: "Genuine leather crossbody bag with adjustable strap.",
  },
  {
    name: "Wireless Earbuds Pro",
    sku: "EARB-PRO-001",
    price: 59.99,
    stock: 100,
    description: "Bluetooth 5.3 earbuds with active noise cancellation.",
  },
  {
    name: "Organic Coffee Beans (1kg)",
    sku: "CF-BEAN-001",
    price: 24.99,
    stock: 200,
    description: "Single-origin Arabica beans. Medium roast. Fair trade certified.",
  },
  {
    name: "Stainless Steel Water Bottle",
    sku: "BTL-SS-001",
    price: 18.99,
    stock: 180,
    description: "Double-walled vacuum insulated bottle. 750ml capacity.",
  },
];

const SAMPLE_DISCOUNTS = [
  {
    code: "WELCOME10",
    type: "percentage",
    value: 10,
    expires_at: null,
  },
  {
    code: "SAVE20",
    type: "fixed",
    value: 20,
    expires_at: null,
  },
  {
    code: "SUMMER25",
    type: "percentage",
    value: 25,
    expires_at: "2026-09-30T23:59:59Z",
  },
];

async function seed(clear = false) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (clear) {
      console.log("Clearing existing products and discounts...");
      await client.query("DELETE FROM order_items");
      await client.query("DELETE FROM orders");
      await client.query("DELETE FROM products");
      await client.query("DELETE FROM discounts");
    }

    console.log("Seeding products...");
    for (const p of SAMPLE_PRODUCTS) {
      await client.query(
        `INSERT INTO products (name, sku, price, stock, description)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (sku) DO UPDATE SET
           name = EXCLUDED.name,
           price = EXCLUDED.price,
           stock = EXCLUDED.stock,
           description = EXCLUDED.description,
           updated_at = NOW()`,
        [p.name, p.sku, p.price, p.stock, p.description]
      );
      console.log(`  + ${p.name} ($${p.price})`);
    }

    console.log("\nSeeding discounts...");
    for (const d of SAMPLE_DISCOUNTS) {
      await client.query(
        `INSERT INTO discounts (code, type, value, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET
           type = EXCLUDED.type,
           value = EXCLUDED.value,
           expires_at = EXCLUDED.expires_at`,
        [d.code.toUpperCase(), d.type, d.value, d.expires_at || null]
      );
      console.log(`  + ${d.code} (${d.type} ${d.value})`);
    }

    await client.query("COMMIT");
    console.log("\nSeed complete!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", (err as Error).message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

const clear = process.argv.includes("--clear");
seed(clear);
