"use client";

import Link from "next/link";

import { trpc } from "@/lib/trpc";

export default function TenantsPage() {
  const { data, isLoading, isError } = trpc.tenants.list.useQuery({ limit: 100 });

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold">Tenant View</h1>

      {isLoading && <p>Loading...</p>}
      {isError && <p>Failed to load tenants.</p>}
      {data !== undefined && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-300 text-left dark:border-zinc-700">
              <th className="py-1">Business</th>
              <th>Property</th>
              <th>City</th>
              <th>Occupancy status</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.tenantId} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-1">
                  <Link href={`/tenants/${row.tenantId}`} className="text-blue-600 hover:underline dark:text-blue-400">
                    {row.businessName}
                  </Link>
                </td>
                <td>
                  <Link href={`/properties/${row.propertyId}`} className="text-blue-600 hover:underline dark:text-blue-400">
                    {row.unnormalizedAddress ?? "Unknown address"}
                  </Link>
                </td>
                <td>{row.cityName ?? "-"}</td>
                <td>{row.occupancyStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data !== undefined && data.length === 0 && <p>No tenant occupancy records derived yet.</p>}
    </div>
  );
}
