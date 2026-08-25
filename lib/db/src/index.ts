import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * Lore has long-lived pollers and background enrichment alongside listener
 * requests. The node-postgres default of ten connections lets those workers
 * monopolize every slot during a busy boot, leaving simple home reads (Stack,
 * first-play history) queued indefinitely. Keep the pool bounded, but leave
 * enough capacity for interactive reads and fail a checkout explicitly rather
 * than holding an HTTP request open forever.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Reserve the listenerReadPool's four connections below rather than letting
  // background work occupy every available PostgreSQL slot.
  max: 12,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

/**
 * A small, dedicated read pool for listener-facing fast lanes. Background
 * pollers and enrichment use `pool`; surfaces such as the home discovery rail
 * can still obtain a connection while that shared worker pool is busy.
 */
export const listenerReadPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});
export const db = drizzle(pool, { schema });
export const listenerReadDb = drizzle(listenerReadPool, { schema });

export * from "./schema";
