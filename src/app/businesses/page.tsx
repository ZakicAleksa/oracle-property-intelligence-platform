"use client";

import Link from "next/link";
import { useState } from "react";

import { trpc } from "@/lib/trpc";

export default function BusinessesPage() {
  const [name, setName] = useState("");
  const { data, isLoading, isError } = trpc.businesses.list.useQuery({
    name: name.length > 0 ? name : undefined,
    limit: 100,
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <p className="eyebrow mb-2">Business View</p>
      <h1 className="mb-6 text-2xl font-semibold">Businesses</h1>

      <input
        placeholder="Business name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="mb-6 border border-line bg-paper-raised px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-stamp-closed"
      />

      {isLoading && <p className="text-ink-muted">Loading records...</p>}
      {isError && <p className="text-stamp-open">Couldn&apos;t load businesses.</p>}

      {data !== undefined && (
        <div className="border-t border-line">
          {data.map((row) => (
            <Link
              key={row.businessRegistrationId}
              href={`/businesses/${row.businessRegistrationId}`}
              className="ledger-row flex items-center justify-between gap-4 px-1 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{row.entityName ?? "Unknown"}</p>
                <p className="eyebrow">{row.filingType ?? "unknown filing type"}</p>
              </div>
              <span className={`stamp shrink-0 ${row.status === "ACTIVE" ? "stamp-closed" : "stamp-neutral"}`}>
                {row.status ?? "unknown"}
              </span>
            </Link>
          ))}
          {data.length === 0 && <p className="py-6 text-ink-muted">No businesses match this filter.</p>}
        </div>
      )}
    </div>
  );
}
