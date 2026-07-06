import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { NextRequest } from "next/server";

import { appRouter } from "@/server/routers/_app";

export const runtime = "nodejs";

function handler(request: NextRequest): Promise<Response> {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: () => ({}),
  });
}

export { handler as GET, handler as POST };
