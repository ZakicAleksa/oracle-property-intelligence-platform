"use client";

import Link from "next/link";

import { trpc } from "@/lib/trpc";

const links = [
  { href: "/properties", label: "Property View", description: "Ownership, permits, contractors, occupancy" },
  { href: "/tenants", label: "Tenant View", description: "Business occupancy relationships" },
  { href: "/businesses", label: "Business View", description: "Sunbiz registrations, officers, related properties" },
  { href: "/contractors", label: "Contractor View", description: "Permit history, BBB ratings, complaints, reviews" },
  { href: "/search", label: "Semantic Search", description: "Ask natural-language questions with cited sources" },
];

export default function Home() {
  const health = trpc.health.useQuery();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 p-16 font-sans dark:bg-black">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Oracle Property Intelligence Platform
      </h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        {health.isLoading && "Checking API..."}
        {health.data &&
          `API ${health.data.status} as of ${health.data.checkedAt}`}
        {health.isError && "API health check failed."}
      </p>
      <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded border border-zinc-300 p-4 hover:border-black dark:border-zinc-700 dark:hover:border-white"
          >
            <div className="font-semibold">{link.label}</div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">{link.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
