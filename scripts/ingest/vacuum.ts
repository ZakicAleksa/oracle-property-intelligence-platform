// Reclaims storage after bulk upserts. Postgres MVCC means every
// ON CONFLICT DO UPDATE writes a new row version rather than updating in
// place — the old version becomes dead space until VACUUMed. Re-running the
// (idempotent) backbone/enrichment scripts without this can silently eat the
// free tier's 0.5GB budget even when the row count never changes — confirmed
// live: re-running the backbone load unchanged grew the DB from 288MB to
// 353MB; VACUUM FULL brought it down to 249MB, lower than the original
// baseline (also compacts physical storage more efficiently than the
// original incremental inserts did).
//
// VACUUM FULL takes an exclusive lock per table — fine for this offline
// ingestion pipeline, not something to run against a table serving live
// traffic.
//
// Usage: npx tsx scripts/ingest/vacuum.ts
import { sql } from "drizzle-orm";

import { db } from "./db.js";

const TABLES = [
  "properties",
  "addresses",
  "parcels",
  "ownerships",
  "sales_histories",
  "public_records",
  "property_improvements",
  "permit_contacts",
  "permit_events",
  "permit_fees",
  "permit_links",
  "permit_custom_fields",
  "companies",
  "tenants",
  "business_reputation_profiles",
  "business_reputation_reviews",
  "business_reputation_complaints",
  "contractor_quality_scores",
  "business_registrations",
  "business_registration_addresses",
  "business_registration_parties",
] as const;

async function main(): Promise<void> {
  for (const table of TABLES) {
    await db.execute(sql.raw(`VACUUM FULL ${table}`));
    console.log(`Vacuumed ${table}`);
  }

  const sizeRows = await db.execute(
    sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size, pg_database_size(current_database()) AS bytes`,
  );
  console.log("DB size after vacuum:", JSON.stringify(sizeRows.rows));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
