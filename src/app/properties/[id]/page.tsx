"use client";

import { useParams } from "next/navigation";

import { trpc } from "@/lib/trpc";

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p className="eyebrow mb-3 border-b border-line pb-2">{label}</p>
      {children}
    </section>
  );
}

export default function PropertyDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, isError } = trpc.properties.detail.useQuery({
    propertyId: params.id,
  });

  if (isLoading)
    return (
      <div className="mx-auto max-w-3xl px-6 py-10 text-ink-muted">
        Loading record...
      </div>
    );
  if (isError || data === undefined)
    return (
      <div className="mx-auto max-w-3xl px-6 py-10 text-stamp-open">
        Couldn&apos;t load this property.
      </div>
    );

  const { property, ownershipHistory, permits, occupancy, projects } = data;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-10 text-sm">
      <div className="fade-in border border-line bg-paper-raised p-5">
        <p className="eyebrow mb-1">Property record</p>
        <h1 className="text-2xl font-semibold">
          {property?.unnormalizedAddress ?? "Unknown address"}
        </h1>
        <p className="mt-1 text-ink-muted">
          {property?.cityName} &middot; {property?.propertyType} &middot;{" "}
          {property?.propertyUsageType}
        </p>
      </div>

      <Section label="Ownership history">
        {ownershipHistory.length === 0 && (
          <p className="text-ink-muted">No ownership records.</p>
        )}
        <ul className="space-y-2">
          {ownershipHistory.map((o) => (
            <li
              key={o.ownershipId}
              className="ledger-row flex items-center justify-between px-1 py-2"
            >
              <span>{o.ownedBy ?? "Unknown owner"}</span>
              <span className="eyebrow">
                {o.dateAcquired ?? "unknown"}
                {o.dateSold !== null && ` → ${o.dateSold}`}
                {o.ownerOccupiedIndicator === true && " · owner-occupied"}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section label={`Permit history (${permits.length})`}>
        {permits.length === 0 && (
          <p className="text-ink-muted">No permits on file.</p>
        )}
        <ul className="space-y-2">
          {permits.map((p) => (
            <li key={p.propertyImprovementId} className="ledger-row px-1 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs">
                  {p.permitNumber ?? "unknown #"}
                </span>
                <span
                  className={`stamp ${p.improvementStatus === "open" ? "stamp-open" : "stamp-closed"}`}
                >
                  {p.improvementStatus ?? "unknown"}
                </span>
              </div>
              <p className="mt-1">
                {p.projectDescription ??
                  p.improvementType ??
                  "No description on file"}
              </p>
              {p.contractorName !== null && (
                <p className="text-ink-muted">Contractor: {p.contractorName}</p>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section label="Business occupancy / tenants">
        {occupancy.length === 0 && (
          <p className="text-ink-muted">No occupancy records.</p>
        )}
        <ul className="space-y-2">
          {occupancy.map((t) => (
            <li
              key={t.tenantId}
              className="ledger-row flex items-center justify-between px-1 py-2"
            >
              <span>{t.businessName}</span>
              <span className="stamp stamp-neutral">{t.occupancyStatus}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section label="Major improvement projects">
        {projects.length === 0 && (
          <p className="text-ink-muted">No derived projects.</p>
        )}
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.projectId} className="ledger-row px-1 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium capitalize">{p.projectType}</span>
                <span className="eyebrow">
                  {p.startDate ?? "?"} → {p.endDate ?? "?"}
                </span>
              </div>
              {p.contractorName !== null && (
                <p className="text-ink-muted">{p.contractorName}</p>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
