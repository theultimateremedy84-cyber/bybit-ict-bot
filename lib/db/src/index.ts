import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const databaseUrl = process.env["DATABASE_URL"];

if (!databaseUrl) {
  console.warn(
    "[db] WARNING: DATABASE_URL is not set. " +
    "Database operations will fail at runtime. " +
    "Provision a PostgreSQL database and set DATABASE_URL."
  );
}

// Pool is always created so TypeScript types remain clean.
// When DATABASE_URL is absent the placeholder connection string is used;
// any query will fail and the route's try/catch will return HTTP 500.
export const pool = new Pool({
  connectionString: databaseUrl ?? "postgresql://localhost/unconfigured",
});

export const db = drizzle(pool, { schema });

export * from "./schema";
