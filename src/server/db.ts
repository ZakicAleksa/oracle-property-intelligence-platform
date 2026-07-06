import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema/index";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
  throw new Error(
    "DATABASE_URL is required to query the property intelligence database",
  );
}

const neonSql = neon(databaseUrl);

export const db = drizzle(neonSql, { schema });
export type Db = typeof db;
export { schema };
