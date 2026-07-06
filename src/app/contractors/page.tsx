"use client";

import Link from "next/link";
import { useState } from "react";

import { trpc } from "@/lib/trpc";

export default function ContractorsPage() {
  const [name, setName] = useState("");
  const [projectType, setProjectType] = useState("");
  const [onlyNegativeBbb, setOnlyNegativeBbb] = useState(false);

  const { data, isLoading, isError } = trpc.contractors.list.useQuery({
    name: name.length > 0 ? name : undefined,
    projectType: projectType.length > 0 ? projectType : undefined,
    onlyNegativeBbb: onlyNegativeBbb || undefined,
    limit: 100,
  });

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold">Contractor View</h1>
      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <input
          placeholder="Filter by name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          placeholder="Filter by work type (roof, electrical...)"
          value={projectType}
          onChange={(e) => setProjectType(e.target.value)}
          className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={onlyNegativeBbb} onChange={(e) => setOnlyNegativeBbb(e.target.checked)} />
          Negative BBB rating only
        </label>
      </div>

      {isLoading && <p>Loading...</p>}
      {isError && <p>Failed to load contractors.</p>}
      {data !== undefined && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-300 text-left dark:border-zinc-700">
              <th className="py-1">Name</th>
              <th>Permits</th>
              <th>BBB rating</th>
              <th>Complaints</th>
              <th>Reviews</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.companyId} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-1">
                  <Link href={`/contractors/${row.companyId}`} className="text-blue-600 hover:underline dark:text-blue-400">
                    {row.name ?? "Unknown"}
                  </Link>
                </td>
                <td>{row.permitCount}</td>
                <td>{row.bbbRating ?? "-"}</td>
                <td>{row.complaintCount ?? "-"}</td>
                <td>{row.reviewCount ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data !== undefined && data.length === 0 && <p>No contractors match these filters.</p>}
    </div>
  );
}
