import { describe, expect, it } from "vitest";

import { appRouter } from "./_app";

describe("appRouter.health", () => {
  it("reports ok status with an ISO timestamp", async () => {
    const caller = appRouter.createCaller({});
    const result = await caller.health();

    expect(result.status).toBe("ok");
    expect(() => new Date(result.checkedAt).toISOString()).not.toThrow();
  });
});
