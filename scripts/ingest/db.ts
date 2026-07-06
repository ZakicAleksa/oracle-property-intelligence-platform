// Standalone DB client for ingestion scripts. Deliberately does NOT import
// "server-only" (unlike src/server/db.ts) — these scripts run outside the
// Next.js app entirely, as one-off/re-runnable Node processes, so the
// client-bundle guard doesn't apply and would just get in the way.
import { existsSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "../../src/server/schema/index.js";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
  throw new Error("DATABASE_URL is required to run ingestion scripts");
}

export const db = drizzle(neon(databaseUrl), { schema });
export { schema };
