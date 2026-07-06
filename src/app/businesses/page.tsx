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
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold">Business View</h1>
      <input
        placeholder="Filter by business name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="mb-4 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />

      {isLoading && <p>Loading...</p>}
      {isError && <p>Failed to load businesses.</p>}
      {data !== undefined && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-300 text-left dark:border-zinc-700">
              <th className="py-1">Entity name</th>
              <th>Status</th>
              <th>Filing type</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.businessRegistrationId} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-1">
                  <Link href={`/businesses/${row.businessRegistrationId}`} className="text-blue-600 hover:underline dark:text-blue-400">
                    {row.entityName ?? "Unknown"}
                  </Link>
                </td>
                <td>{row.status ?? "-"}</td>
                <td>{row.filingType ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data !== undefined && data.length === 0 && <p>No businesses match this filter.</p>}
    </div>
  );
}
