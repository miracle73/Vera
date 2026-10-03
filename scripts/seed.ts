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
    name: "Daily Glow Multivitamin",
    sku: "VIT-GLW-001",
    price: 18500,
    stock: 200,
    category: "vitamins",
    tagline: "Your everyday foundation",
    color: "#d9e4b8",
    description:
      "A complete women's multivitamin with iron, folate, B12 and vitamin D3 to support energy, immunity and skin. 60 easy-swallow capsules - a two-month supply.",
  },
  {
    name: "Deep Sleep Magnesium",
    sku: "VIT-SLP-001",
    price: 14000,
    stock: 150,
    category: "vitamins",
    tagline: "Calm nights, clear mornings",
    color: "#cfd8ea",
    description:
      "Magnesium glycinate with L-theanine and chamomile to help you unwind and sleep through the night. Non-habit forming. 60 capsules.",
  },
  {
    name: "Gut Balance Probiotic",
    sku: "VIT-GUT-001",
    price: 21000,
    stock: 120,
    category: "vitamins",
    tagline: "Feel lighter, every day",
    color: "#f1dcc4",
    description:
      "10 strains and 30 billion CFU to ease bloating and support digestion. Shelf-stable, no refrigeration needed. 30 capsules.",
  },
  {
    name: "Hair, Skin & Nails Gummies",
    sku: "VIT-HSN-001",
    price: 16500,
    stock: 180,
    category: "hair",
    tagline: "Stronger strands from within",
    color: "#f3cfd4",
    description:
      "Biotin, zinc and vitamin C in a low-sugar berry gummy to support thicker hair and stronger nails. 60 gummies.",
  },
  {
    name: "Thickening Hair Serum",
    sku: "HR-SRM-001",
    price: 24000,
    stock: 90,
    category: "hair",
    tagline: "Fuller-looking hair in 12 weeks",
    color: "#e8d6bf",
    description:
      "Lightweight scalp serum with rosemary oil, caffeine and peptides. Apply nightly to thinning areas. 50ml dropper bottle.",
  },
  {
    name: "Hydrating Barrier Cream",
    sku: "SK-CRM-001",
    price: 19500,
    stock: 110,
    category: "skin",
    tagline: "Soft, dewy, protected",
    color: "#e6ece0",
    description:
      "Ceramides, squalane and niacinamide restore your skin barrier for all-day moisture. Fragrance-free and fine for sensitive skin. 50ml.",
  },
  {
    name: "Brightening Vitamin C Serum",
    sku: "SK-VTC-001",
    price: 22500,
    stock: 100,
    category: "skin",
    tagline: "Even tone, real glow",
    color: "#f5e3a8",
    description:
      "15% stabilised vitamin C with ferulic acid fades dark spots and boosts radiance. Use every morning under sunscreen. 30ml.",
  },
  {
    name: "Daily Mineral Sunscreen SPF 50",
    sku: "SK-SPF-001",
    price: 15500,
    stock: 160,
    category: "skin",
    tagline: "No white cast, all day",
    color: "#f2e7d5",
    description:
      "A tinted zinc-oxide sunscreen that disappears into deeper skin tones. Water resistant for 80 minutes. 50ml.",
  },
  {
    name: "Metabolism Support Blend",
    sku: "WL-MET-001",
    price: 26000,
    stock: 80,
    category: "weight",
    tagline: "Fuel your weight goals",
    color: "#c9d9a8",
    description:
      "Green tea extract, chromium and glucomannan fibre to support healthy metabolism and steady appetite alongside a balanced diet. 90 capsules.",
  },
  {
    name: "Plant Protein Shake - Vanilla",
    sku: "WL-PRO-001",
    price: 28500,
    stock: 70,
    category: "weight",
    tagline: "20g protein, 110 calories",
    color: "#ede1c8",
    description:
      "A creamy pea-and-rice protein with added fibre to keep you full for longer. No added sugar. 14 servings.",
  },
  {
    name: "Cycle Comfort Tea",
    sku: "WL-TEA-001",
    price: 8500,
    stock: 220,
    category: "wellness",
    tagline: "Soothing support for your cycle",
    color: "#e9cdb8",
    description:
      "Ginger, raspberry leaf and peppermint herbal tea to ease cramps and bloating. Caffeine free. 20 tea bags.",
  },
  {
    name: "Stress Relief Ashwagandha",
    sku: "WL-ASH-001",
    price: 17000,
    stock: 130,
    category: "wellness",
    tagline: "Find your calm",
    color: "#d6cfe6",
    description:
      "KSM-66 ashwagandha with holy basil to lower everyday stress and support balanced mood. 60 capsules.",
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
    value: 2000,
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
    if (process.argv.includes("--if-empty")) {
      const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM products");
      if (rows[0].n > 0) {
        console.log("Products already exist, skipping seed.");
        return;
      }
    }

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
        `INSERT INTO products (name, sku, price, stock, description, category, tagline, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (sku) DO UPDATE SET
           name = EXCLUDED.name,
           price = EXCLUDED.price,
           stock = EXCLUDED.stock,
           description = EXCLUDED.description,
           category = EXCLUDED.category,
           tagline = EXCLUDED.tagline,
           color = EXCLUDED.color,
           updated_at = NOW()`,
        [p.name, p.sku, p.price, p.stock, p.description, p.category, p.tagline, p.color]
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
