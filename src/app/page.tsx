"use client";

import Link from "next/link";

import { trpc } from "@/lib/trpc";

const views = [
  { href: "/properties", label: "Property View", description: "Ownership, permits, contractors, occupancy" },
  { href: "/tenants", label: "Tenant View", description: "Business occupancy relationships" },
  { href: "/businesses", label: "Business View", description: "Sunbiz registrations, officers, related properties" },
  { href: "/contractors", label: "Contractor View", description: "Permit history, BBB ratings, complaints, reviews" },
  { href: "/search", label: "Semantic Search", description: "Ask natural-language questions with cited sources" },
];

export default function Home() {
  const health = trpc.health.useQuery();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-16 px-6 py-16">
      <section className="fade-in flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div className="max-w-xl">
          <p className="eyebrow mb-3">Lee County, FL &middot; public records</p>
          <h1 className="text-4xl font-semibold md:text-5xl">Oracle Property Intelligence</h1>
          <p className="mt-4 text-ink-muted">
            Every permit, contractor rating, and business filing here traces back to a source record — click through
            any card and you&apos;ll find the citation, not just the claim.
          </p>
        </div>
        <div className="w-full max-w-xs shrink-0 border border-line bg-paper-raised p-4 text-sm">
          <p className="eyebrow mb-2">Sample record</p>
          <p className="font-medium">16600 MCGREGOR BOULEVARD</p>
          <p className="text-ink-muted">Fort Myers &middot; Manufactured Home</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="stamp stamp-open">Open permit</span>
            <span className="stamp stamp-neutral">33 records</span>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center gap-3">
          <p className="eyebrow">API status</p>
          <p className="text-sm text-ink-muted">
            {health.isLoading && "Checking..."}
            {health.data && `${health.data.status} as of ${health.data.checkedAt}`}
            {health.isError && "Health check failed."}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-px overflow-hidden border border-line bg-line sm:grid-cols-2">
          {views.map((view) => (
            <Link
              key={view.href}
              href={view.href}
              className="group flex flex-col gap-1 bg-paper p-5 transition-colors hover:bg-paper-raised"
            >
              <span className="font-display text-lg font-medium group-hover:underline">{view.label}</span>
              <span className="text-sm text-ink-muted">{view.description}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
