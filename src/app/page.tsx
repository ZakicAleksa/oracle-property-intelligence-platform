"use client";

import { trpc } from "@/lib/trpc";

export default function Home() {
  const health = trpc.health.useQuery();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 p-16 font-sans dark:bg-black">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Oracle Property Intelligence Platform
      </h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        {health.isLoading && "Checking API..."}
        {health.data &&
          `API ${health.data.status} as of ${health.data.checkedAt}`}
        {health.isError && "API health check failed."}
      </p>
    </div>
  );
}
