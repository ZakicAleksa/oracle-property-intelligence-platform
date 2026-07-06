"use client";

import { useParams } from "next/navigation";

import { trpc } from "@/lib/trpc";

export default function PropertyDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, isError } = trpc.properties.detail.useQuery({ propertyId: params.id });

  if (isLoading) return <div className="p-6">Loading...</div>;
  if (isError || data === undefined) return <div className="p-6">Failed to load property.</div>;

  const { property, ownershipHistory, permits, occupancy, projects } = data;

  return (
    <div className="space-y-6 p-6 text-sm">
      <h1 className="text-xl font-semibold">{property?.unnormalizedAddress ?? "Unknown address"}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        {property?.cityName} &middot; {property?.propertyType} &middot; {property?.propertyUsageType}
      </p>

      <section>
        <h2 className="mb-2 font-semibold">Ownership history</h2>
        {ownershipHistory.length === 0 && <p className="text-zinc-500">No ownership records.</p>}
        <ul className="space-y-1">
          {ownershipHistory.map((o) => (
            <li key={o.ownershipId}>
              {o.ownedBy ?? "Unknown owner"} — acquired {o.dateAcquired ?? "unknown"}
              {o.dateSold !== null && ` — sold ${o.dateSold}`}
              {o.ownerOccupiedIndicator === true && " (owner-occupied)"}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Permit history ({permits.length})</h2>
        {permits.length === 0 && <p className="text-zinc-500">No permits on file.</p>}
        <ul className="space-y-1">
          {permits.map((p) => (
            <li key={p.propertyImprovementId}>
              <span className="font-medium">{p.permitNumber ?? "unknown #"}</span> — {p.improvementType ?? "unknown type"} —{" "}
              <span className={p.improvementStatus === "open" ? "text-amber-600 dark:text-amber-400" : ""}>
                {p.improvementStatus ?? "unknown status"}
              </span>
              {p.contractorName !== null && ` — contractor: ${p.contractorName}`}
              {p.projectDescription !== null && ` — ${p.projectDescription}`}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Business occupancy / tenants</h2>
        {occupancy.length === 0 && <p className="text-zinc-500">No occupancy records.</p>}
        <ul className="space-y-1">
          {occupancy.map((t) => (
            <li key={t.tenantId}>
              {t.businessName} — {t.occupancyStatus}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Major improvement projects</h2>
        {projects.length === 0 && <p className="text-zinc-500">No derived projects.</p>}
        <ul className="space-y-1">
          {projects.map((p) => (
            <li key={p.projectId}>
              {p.projectType} — {p.startDate ?? "?"} to {p.endDate ?? "?"}
              {p.contractorName !== null && ` — ${p.contractorName}`}
              {p.totalEstimatedValue !== null && ` — $${p.totalEstimatedValue}`}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
