"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { trpc } from "@/lib/trpc";

export default function TenantDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, isError } = trpc.tenants.detail.useQuery({ tenantId: params.id });

  if (isLoading) return <div className="p-6">Loading...</div>;
  if (isError || data === undefined || data.tenant === undefined) return <div className="p-6">Failed to load tenant.</div>;

  const { tenant, permits, projects } = data;

  return (
    <div className="space-y-6 p-6 text-sm">
      <h1 className="text-xl font-semibold">{tenant.businessName}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Occupancy: {tenant.occupancyStatus} &middot;{" "}
        <Link href={`/properties/${tenant.propertyId}`} className="text-blue-600 hover:underline dark:text-blue-400">
          {tenant.unnormalizedAddress ?? "Unknown address"}
        </Link>
      </p>

      <section>
        <h2 className="mb-2 font-semibold">Associated permits ({permits.length})</h2>
        <ul className="space-y-1">
          {permits.map((p, i) => (
            <li key={i}>
              {p.permitNumber ?? "unknown #"} — {p.improvementType ?? "unknown type"} — {p.improvementStatus ?? "unknown status"}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Associated projects ({projects.length})</h2>
        <ul className="space-y-1">
          {projects.map((p) => (
            <li key={p.projectId}>{p.projectType}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
