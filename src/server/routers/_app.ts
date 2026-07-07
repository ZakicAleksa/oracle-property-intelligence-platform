import { publicProcedure, router } from "../trpc";
import { businessesRouter } from "./businesses";
import { contractorsRouter } from "./contractors";
import { propertiesRouter } from "./properties";
import { ragRouter } from "./rag";
import { statsRouter } from "./stats";
import { tenantsRouter } from "./tenants";

export const appRouter = router({
  health: publicProcedure.query(() => ({
    status: "ok" as const,
    checkedAt: new Date().toISOString(),
  })),
  properties: propertiesRouter,
  contractors: contractorsRouter,
  businesses: businessesRouter,
  tenants: tenantsRouter,
  rag: ragRouter,
  stats: statsRouter,
});

export type AppRouter = typeof appRouter;
