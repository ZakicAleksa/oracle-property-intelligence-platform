"use client";

import Link from "next/link";
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

export default function BusinessDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, isError } = trpc.businesses.detail.useQuery({
    businessRegistrationId: params.id,
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
        Couldn&apos;t load this business.
      </div>
    );

  const { registration, addresses, parties, relatedProperties } = data;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-10 text-sm">
      <div className="fade-in border border-line bg-paper-raised p-5">
        <p className="eyebrow mb-1">Business registration</p>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">
            {registration?.entityName ?? "Unknown business"}
          </h1>
          <span
            className={`stamp shrink-0 ${registration?.status === "ACTIVE" ? "stamp-closed" : "stamp-neutral"}`}
          >
            {registration?.status ?? "unknown"}
          </span>
        </div>
        <p className="mt-1 text-ink-muted">
          {registration?.filingType ?? "unknown filing type"} &middot; filed{" "}
          {registration?.filedDate ?? "unknown"}
        </p>
      </div>

      <Section label="Registered addresses">
        <ul className="space-y-2">
          {addresses.map((a, i) => (
            <li key={i} className="ledger-row px-1 py-2">
              <span className="stamp stamp-neutral mr-2">{a.addressRole}</span>
              {a.line1}, {a.city}, {a.state} {a.zip}
            </li>
          ))}
        </ul>
      </Section>

      <Section label="Ownership / officers">
        <ul className="space-y-2">
          {parties.map((p, i) => (
            <li key={i} className="ledger-row px-1 py-2">
              <span className="stamp stamp-neutral mr-2">{p.partyRole}</span>
              {p.name} {p.title !== null && `(${p.title})`}
            </li>
          ))}
        </ul>
      </Section>

      <Section label="Related properties">
        {relatedProperties.length === 0 && (
          <p className="text-ink-muted">No occupied properties on file.</p>
        )}
        <ul className="space-y-2">
          {relatedProperties.map((p) => (
            <li
              key={p.propertyId}
              className="ledger-row flex items-center justify-between px-1 py-2"
            >
              <Link
                href={`/properties/${p.propertyId}`}
                className="hover:underline"
              >
                {p.unnormalizedAddress ?? "Unknown address"}
              </Link>
              <span className="stamp stamp-neutral">{p.occupancyStatus}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
