import { publicProcedure, router } from "../trpc";

export const appRouter = router({
  health: publicProcedure.query(() => ({
    status: "ok" as const,
    checkedAt: new Date().toISOString(),
  })),
});

export type AppRouter = typeof appRouter;
