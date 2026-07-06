"use client";

import { useParams } from "next/navigation";

import { trpc } from "@/lib/trpc";

export default function ContractorDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, isError } = trpc.contractors.detail.useQuery({ companyId: params.id });

  if (isLoading) return <div className="p-6">Loading...</div>;
  if (isError || data === undefined) return <div className="p-6">Failed to load contractor.</div>;

  const { company, permits, bbbProfile, reviews, complaints, projects } = data;

  return (
    <div className="space-y-6 p-6 text-sm">
      <h1 className="text-xl font-semibold">{company?.name ?? "Unknown contractor"}</h1>

      <section>
        <h2 className="mb-2 font-semibold">BBB rating</h2>
        {bbbProfile === undefined ? (
          <p className="text-zinc-500">No BBB profile on file.</p>
        ) : (
          <p>
            Rating: <span className="font-medium">{bbbProfile.bbbRating ?? "not rated"}</span> &middot; Accredited:{" "}
            {bbbProfile.isAccredited === true ? "yes" : "no"} &middot; {bbbProfile.reviewCount ?? 0} reviews &middot;{" "}
            {bbbProfile.complaintCount ?? 0} complaints
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">BBB complaints ({complaints.length})</h2>
        <ul className="space-y-1">
          {complaints.map((c, i) => (
            <li key={i}>
              {c.complaintDate ?? "unknown date"} — {c.complaintType ?? "unknown type"} — {c.complaintStatus ?? "unknown status"}
              {c.complaintSummary !== null && ` — ${c.complaintSummary}`}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Review summaries ({reviews.length})</h2>
        <ul className="space-y-1">
          {reviews.map((r, i) => (
            <li key={i}>
              {r.reviewDate ?? "unknown date"} — rating {r.reviewRating ?? "n/a"}
              {r.reviewText !== null && ` — ${r.reviewText}`}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Permit history ({permits.length})</h2>
        <ul className="space-y-1">
          {permits.map((p) => (
            <li key={p.propertyImprovementId}>
              {p.permitNumber ?? "unknown #"} — {p.improvementType ?? "unknown type"} — {p.improvementStatus ?? "unknown status"} —{" "}
              {p.unnormalizedAddress ?? "unknown address"}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Projects ({projects.length})</h2>
        <ul className="space-y-1">
          {projects.map((p) => (
            <li key={p.projectId}>{p.projectType}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
