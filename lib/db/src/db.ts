import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Cloud Postgres providers (Railway, Heroku, Supabase, Render, etc.) require
// SSL. Detect non-local URLs and enable SSL with rejectUnauthorized:false so
// self-signed / managed certificates are accepted. Local Postgres (localhost /
// 127.0.0.1) skips SSL so dev environments work without extra setup.
function getSsl(): false | { rejectUnauthorized: false } {
  const url = process.env["DATABASE_URL"] ?? "";
  if (!url) return false;
  if (url.includes("localhost") || url.includes("127.0.0.1")) return false;
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env["DATABASE_URL"] ?? undefined,
  ssl: getSsl() || undefined,
});

export const db = drizzle(pool, { schema });
