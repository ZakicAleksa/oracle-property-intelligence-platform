"use client";

import Link from "next/link";
import { useState } from "react";

import { trpc } from "@/lib/trpc";

const NEGATIVE_RATINGS = ["F", "D-", "D", "D+", "C-"];

function ratingStamp(rating: string | null) {
  if (rating === null) return "stamp-neutral";
  return NEGATIVE_RATINGS.includes(rating) ? "stamp-open" : "stamp-closed";
}

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
    <div className="mx-auto max-w-5xl px-6 py-10">
      <p className="eyebrow mb-2">Contractor View</p>
      <h1 className="mb-6 text-2xl font-semibold">Contractors</h1>

      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border border-line bg-paper-raised px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-stamp-closed"
        />
        <input
          placeholder="Work type (roof, electrical...)"
          value={projectType}
          onChange={(e) => setProjectType(e.target.value)}
          className="border border-line bg-paper-raised px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-stamp-closed"
        />
        <label className="flex items-center gap-2 text-ink-muted">
          <input type="checkbox" checked={onlyNegativeBbb} onChange={(e) => setOnlyNegativeBbb(e.target.checked)} />
          Negative BBB rating only
        </label>
      </div>

      {isLoading && <p className="text-ink-muted">Loading records...</p>}
      {isError && <p className="text-stamp-open">Couldn&apos;t load contractors.</p>}

      {data !== undefined && (
        <div className="border-t border-line">
          {data.map((row) => (
            <Link
              key={row.companyId}
              href={`/contractors/${row.companyId}`}
              className="ledger-row flex items-center justify-between gap-4 px-1 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{row.name ?? "Unknown"}</p>
                <p className="eyebrow">
                  {row.permitCount} permit{row.permitCount === 1 ? "" : "s"}
                  {row.reviewCount !== null && ` · ${row.reviewCount} reviews`}
                </p>
              </div>
              <span className={`stamp shrink-0 ${ratingStamp(row.bbbRating)}`}>
                {row.bbbRating ?? "not rated"}
              </span>
            </Link>
          ))}
          {data.length === 0 && <p className="py-6 text-ink-muted">No contractors match these filters.</p>}
        </div>
      )}
    </div>
  );
}
