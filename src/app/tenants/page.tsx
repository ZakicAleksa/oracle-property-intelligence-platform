"use client";

import Link from "next/link";

import { trpc } from "@/lib/trpc";

export default function TenantsPage() {
  const { data, isLoading, isError } = trpc.tenants.list.useQuery({
    limit: 100,
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <p className="eyebrow mb-2">Tenant View</p>
      <h1 className="mb-6 text-2xl font-semibold">Tenants</h1>

      {isLoading && <p className="text-ink-muted">Loading records...</p>}
      {isError && (
        <p className="text-stamp-open">Couldn&apos;t load tenants.</p>
      )}

      {data !== undefined && (
        <div className="border-t border-line">
          {data.map((row) => (
            <Link
              key={row.tenantId}
              href={`/tenants/${row.tenantId}`}
              className="ledger-row flex items-center justify-between gap-4 px-1 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{row.businessName}</p>
                <p className="eyebrow">
                  {row.unnormalizedAddress ?? "unknown address"} &middot;{" "}
                  {row.cityName ?? "unknown city"}
                </p>
              </div>
              <span className="stamp stamp-neutral shrink-0">
                {row.occupancyStatus}
              </span>
            </Link>
          ))}
          {data.length === 0 && (
            <p className="py-6 text-ink-muted">
              No tenant occupancy records derived yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
