import { sql } from "drizzle-orm";

import { db } from "../db";
import { publicProcedure, router } from "../trpc";

// A live, queryable source of truth for dataset scale -- without this, the
// only way to know how much of the county is actually loaded is to trust
// PLAN.md/CLAUDE.md (which silently went stale relative to a later bulk
// expansion), or to page through the 200-row-capped list endpoints and
// extrapolate. Two independent reviews hit one or the other of those gaps.
export const statsRouter = router({
  summary: publicProcedure.query(async () => {
    const [
      properties,
      permitProperties,
      permits,
      tenantProperties,
      bbbProfiles,
      negativeBbbProfiles,
      projects,
    ] = await Promise.all([
      db.execute(sql`select count(*) as n from properties`),
      db.execute(
        sql`select count(distinct property_id) as n from property_improvements`,
      ),
      db.execute(sql`select count(*) as n from property_improvements`),
      db.execute(sql`select count(distinct property_id) as n from tenants`),
      db.execute(sql`select count(*) as n from business_reputation_profiles`),
      db.execute(
        sql`select count(*) as n from business_reputation_profiles where bbb_rating in ('F','D-','D','D+','C-')`,
      ),
      db.execute(sql`select count(*) as n from projects`),
    ]);

    const asNumber = (rows: { n: unknown }[]): number => Number(rows[0]?.n ?? 0);

    return {
      properties: asNumber(properties.rows as { n: unknown }[]),
      propertiesWithPermits: asNumber(permitProperties.rows as { n: unknown }[]),
      totalPermits: asNumber(permits.rows as { n: unknown }[]),
      propertiesWithTenants: asNumber(tenantProperties.rows as { n: unknown }[]),
      bbbProfiles: asNumber(bbbProfiles.rows as { n: unknown }[]),
      negativeBbbProfiles: asNumber(negativeBbbProfiles.rows as { n: unknown }[]),
      derivedProjects: asNumber(projects.rows as { n: unknown }[]),
    };
  }),
});
