"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { trpc } from "@/lib/trpc";

export default function BusinessDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, isError } = trpc.businesses.detail.useQuery({ businessRegistrationId: params.id });

  if (isLoading) return <div className="p-6">Loading...</div>;
  if (isError || data === undefined) return <div className="p-6">Failed to load business.</div>;

  const { registration, addresses, parties, relatedProperties } = data;

  return (
    <div className="space-y-6 p-6 text-sm">
      <h1 className="text-xl font-semibold">{registration?.entityName ?? "Unknown business"}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Status: {registration?.status ?? "unknown"} &middot; Filing type: {registration?.filingType ?? "unknown"} &middot; Filed:{" "}
        {registration?.filedDate ?? "unknown"}
      </p>

      <section>
        <h2 className="mb-2 font-semibold">Registered addresses</h2>
        <ul className="space-y-1">
          {addresses.map((a, i) => (
            <li key={i}>
              [{a.addressRole}] {a.line1}, {a.city}, {a.state} {a.zip}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Ownership / officers</h2>
        <ul className="space-y-1">
          {parties.map((p, i) => (
            <li key={i}>
              [{p.partyRole}] {p.name} {p.title !== null && `(${p.title})`}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Related properties</h2>
        {relatedProperties.length === 0 && <p className="text-zinc-500">No occupied properties on file.</p>}
        <ul className="space-y-1">
          {relatedProperties.map((p) => (
            <li key={p.propertyId}>
              <Link href={`/properties/${p.propertyId}`} className="text-blue-600 hover:underline dark:text-blue-400">
                {p.unnormalizedAddress ?? "Unknown address"}
              </Link>{" "}
              — {p.occupancyStatus}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
