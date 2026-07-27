import * as fs from "fs";
import * as path from "path";
import { query, getClient } from "./index";
import { logger } from "../middleware/requestLogger";

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(255) UNIQUE NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(): Promise<string[]> {
  const { rows } = await query<{ name: string }>(
    "SELECT name FROM migrations ORDER BY id"
  );
  return rows.map((r) => r.name);
}

async function runMigrations() {
  logger.info("Starting database migrations...");
  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.includes(file)) {
      logger.info(`Migration already applied: ${file}`);
      continue;
    }

    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(filePath, "utf-8");

    const client = await getClient();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      logger.info(`Applied migration: ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      logger.error(`Failed migration: ${file}`, { error: (err as Error).message });
      throw err;
    } finally {
      client.release();
    }
  }

  logger.info("All migrations complete");
  process.exit(0);
}

runMigrations().catch((err) => {
  logger.error("Migration runner failed", { error: err.message });
  process.exit(1);
});
