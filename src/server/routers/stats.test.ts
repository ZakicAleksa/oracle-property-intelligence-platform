import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "../db";
import { appRouter } from "./_app";

describe("stats.summary", () => {
  it("matches a direct SQL count of properties (ground truth, not a cached/stale number)", async () => {
    const caller = appRouter.createCaller({});
    const result = await caller.stats.summary();

    const groundTruth = await db.execute<{ n: string }>(
      sql`select count(*) as n from properties`,
    );
    expect(result.properties).toBe(Number(groundTruth.rows[0]?.n));
  });

  it("returns non-zero counts across every field once the dataset is loaded", async () => {
    const caller = appRouter.createCaller({});
    const result = await caller.stats.summary();

    expect(result.properties).toBeGreaterThan(0);
    expect(result.propertiesWithPermits).toBeGreaterThan(0);
    expect(result.totalPermits).toBeGreaterThan(0);
    expect(result.propertiesWithTenants).toBeGreaterThan(0);
    expect(result.bbbProfiles).toBeGreaterThan(0);
    expect(result.derivedProjects).toBeGreaterThan(0);
  });
});
