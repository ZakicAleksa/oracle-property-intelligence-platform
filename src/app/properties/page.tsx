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
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold">Property View</h1>
      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <input
          placeholder="Filter by city"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          placeholder="Filter by permit type (roof, electrical...)"
          value={permitType}
          onChange={(e) => setPermitType(e.target.value)}
          className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={onlyMultipleOpenPermits}
            onChange={(e) => setOnlyMultipleOpenPermits(e.target.checked)}
          />
          Multiple open permits only
        </label>
      </div>

      {isLoading && <p>Loading...</p>}
      {isError && <p>Failed to load properties.</p>}
      {data !== undefined && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-300 text-left dark:border-zinc-700">
              <th className="py-1">Address</th>
              <th>City</th>
              <th>Type</th>
              <th>Open permits</th>
              <th>Permit types</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.propertyId} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-1">
                  <Link href={`/properties/${row.propertyId}`} className="text-blue-600 hover:underline dark:text-blue-400">
                    {row.unnormalizedAddress ?? "Unknown address"}
                  </Link>
                </td>
                <td>{row.cityName ?? "-"}</td>
                <td>{row.propertyType ?? "-"}</td>
                <td>{row.openPermitCount}</td>
                <td>{row.permitTypes.filter(Boolean).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data !== undefined && data.length === 0 && <p>No properties match these filters.</p>}
    </div>
  );
}
