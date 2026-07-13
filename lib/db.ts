import postgres from "postgres";

/**
 * Singleton Postgres client. Connections are capped low because every route
 * that touches the ladder is a short single query and the app runs on
 * serverless instances.
 */
declare global {
  var __ladderSql: ReturnType<typeof postgres> | undefined;
}

export function getSql(): ReturnType<typeof postgres> {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!globalThis.__ladderSql) {
    globalThis.__ladderSql = postgres(url, {
      max: 2,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }

  return globalThis.__ladderSql;
}
