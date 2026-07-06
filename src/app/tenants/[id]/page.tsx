"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { trpc } from "@/lib/trpc";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="eyebrow mb-3 border-b border-line pb-2">{label}</p>
      {children}
    </section>
  );
}

export default function TenantDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, isError } = trpc.tenants.detail.useQuery({ tenantId: params.id });

  if (isLoading) return <div className="mx-auto max-w-3xl px-6 py-10 text-ink-muted">Loading record...</div>;
  if (isError || data === undefined || data.tenant === undefined)
    return <div className="mx-auto max-w-3xl px-6 py-10 text-stamp-open">Couldn&apos;t load this tenant.</div>;

  const { tenant, permits, projects } = data;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-10 text-sm">
      <div className="fade-in border border-line bg-paper-raised p-5">
        <p className="eyebrow mb-1">Tenant occupancy record</p>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{tenant.businessName}</h1>
          <span className="stamp stamp-neutral shrink-0">{tenant.occupancyStatus}</span>
        </div>
        <p className="mt-1 text-ink-muted">
          <Link href={`/properties/${tenant.propertyId}`} className="hover:underline">
            {tenant.unnormalizedAddress ?? "Unknown address"}
          </Link>
        </p>
      </div>

      <Section label={`Associated permits (${permits.length})`}>
        {permits.length === 0 && <p className="text-ink-muted">No permits on file.</p>}
        <ul className="space-y-2">
          {permits.map((p, i) => (
            <li key={i} className="ledger-row px-1 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs">{p.permitNumber ?? "unknown #"}</span>
                <span className={`stamp ${p.improvementStatus === "open" ? "stamp-open" : "stamp-closed"}`}>
                  {p.improvementStatus ?? "unknown"}
                </span>
              </div>
              <p className="mt-1">{p.improvementType ?? "No description"}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section label={`Associated projects (${projects.length})`}>
        {projects.length === 0 && <p className="text-ink-muted">No derived projects.</p>}
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.projectId} className="ledger-row px-1 py-2 capitalize">
              {p.projectType}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
