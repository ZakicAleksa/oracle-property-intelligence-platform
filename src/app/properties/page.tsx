"use client";

import Link from "next/link";
import { useState } from "react";

import { trpc } from "@/lib/trpc";

export default function PropertiesPage() {
  const [city, setCity] = useState("");
  const [permitType, setPermitType] = useState("");
  const [onlyMultipleOpenPermits, setOnlyMultipleOpenPermits] = useState(false);

  const { data, isLoading, isError } = trpc.properties.list.useQuery({
    city: city.length > 0 ? city : undefined,
    permitType: permitType.length > 0 ? permitType : undefined,
    onlyMultipleOpenPermits: onlyMultipleOpenPermits || undefined,
    limit: 100,
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <p className="eyebrow mb-2">Property View</p>
      <h1 className="mb-6 text-2xl font-semibold">Properties</h1>

      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <input
          placeholder="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="border border-line bg-paper-raised px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-stamp-closed"
        />
        <input
          placeholder="Permit type (roof, electrical...)"
          value={permitType}
          onChange={(e) => setPermitType(e.target.value)}
          className="border border-line bg-paper-raised px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-stamp-closed"
        />
        <label className="flex items-center gap-2 text-ink-muted">
          <input
            type="checkbox"
            checked={onlyMultipleOpenPermits}
            onChange={(e) => setOnlyMultipleOpenPermits(e.target.checked)}
          />
          Multiple open permits only
        </label>
      </div>

      {isLoading && <p className="text-ink-muted">Loading records...</p>}
      {isError && <p className="text-stamp-open">Couldn&apos;t load properties.</p>}

      {data !== undefined && (
        <div className="border-t border-line">
          {data.map((row) => (
            <Link
              key={row.propertyId}
              href={`/properties/${row.propertyId}`}
              className="ledger-row flex items-center justify-between gap-4 px-1 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{row.unnormalizedAddress ?? "Unknown address"}</p>
                <p className="eyebrow">
                  {row.cityName ?? "unknown city"} &middot; {row.propertyType ?? "unknown type"}
                </p>
              </div>
              <span className={`stamp shrink-0 ${Number(row.openPermitCount) > 0 ? "stamp-open" : "stamp-neutral"}`}>
                {row.openPermitCount} open
              </span>
            </Link>
          ))}
          {data.length === 0 && <p className="py-6 text-ink-muted">No properties match these filters.</p>}
        </div>
      )}
    </div>
  );
}
