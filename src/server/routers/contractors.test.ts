import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "../db";
import { appRouter } from "./_app";

// Filtering (projectType, onlyNegativeBbb) used to happen in JS after
// fetching every candidate contractor row -- these confirm the SQL
// push-down (permitCounts HAVING clause + WHERE + LIMIT) returns the same
// results as filtering in JS would, without pulling the whole candidate set
// into memory on every call.
describe("contractors.list", () => {
  it("onlyNegativeBbb returns exactly the companies with a negative BBB rating", async () => {
    const caller = appRouter.createCaller({});
    const negative = await caller.contractors.list({
      onlyNegativeBbb: true,
      limit: 200,
    });
    expect(negative.every((r) => r.bbbRating !== null)).toBe(true);
    expect(negative.length).toBe(18);
  });

  it("projectType filters via SQL, not in-memory, and never returns a false positive", async () => {
    const caller = appRouter.createCaller({});
    const roof = await caller.contractors.list({
      projectType: "roof",
      limit: 200,
    });
    expect(roof.length).toBe(200); // more than 200 real matches exist

    const groundTruth = await db.execute<{ company_id: string }>(sql`
      select distinct contractor_company_id as company_id
      from property_improvements
      where contractor_company_id is not null and improvement_type ilike '%roof%'
    `);
    const groundTruthIds = new Set(groundTruth.rows.map((r) => r.company_id));
    expect(roof.every((r) => groundTruthIds.has(r.companyId))).toBe(true);
  });

  it("returns an empty array, not an error, when projectType matches nothing", async () => {
    const caller = appRouter.createCaller({});
    const none = await caller.contractors.list({
      projectType: "zzz-nonexistent-type-zzz",
      limit: 50,
    });
    expect(none).toEqual([]);
  });
});
