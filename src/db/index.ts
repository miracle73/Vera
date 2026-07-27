import { Pool, PoolConfig } from "pg";
import { config } from "../config";
import { logger } from "../middleware/requestLogger";

const poolConfig: PoolConfig = {
  connectionString: config.database.url,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

const pool = new Pool(poolConfig);

pool.on("error", (err) => {
  logger.error("Unexpected database pool error", { error: err.message });
});

pool.on("connect", () => {
  logger.debug("New database connection established");
});

export async function query<T = any>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  logger.debug("Executed query", {
    text: text.substring(0, 80),
    duration,
    rows: result.rowCount,
  });
  return { rows: result.rows, rowCount: result.rowCount };
}

export async function queryWithRetry<T = any>(
  text: string,
  params?: unknown[],
  opts?: { retries?: number; delayMs?: number }
): Promise<{ rows: T[]; rowCount: number | null }> {
  const retries = opts?.retries ?? 2;
  const delayMs = opts?.delayMs ?? 500;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await query<T>(text, params);
    } catch (err) {
      const isLastAttempt = attempt === retries;
      const isRetryable =
        (err as any)?.code === "40001" || // serialization_failure
        (err as any)?.code === "57014" || // query_canceled
        (err as any)?.code === "08006" || // connection_failure
        (err as any)?.code === "08001" || // sqlclient_unable_to_establish_sqlconnection
        (err as any)?.code === "08003";   // connection_does_not_exist

      if (isLastAttempt || !isRetryable) {
        throw err;
      }

      logger.warn("Retrying failed query", {
        attempt: attempt + 1,
        maxRetries: retries,
        error: (err as Error).message,
        code: (err as any)?.code,
      });

      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }

  throw new Error("Unreachable");
}

export async function getClient() {
  const client = await pool.connect();
  return client;
}

export default pool;
