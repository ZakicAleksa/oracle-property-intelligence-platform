"use client";

import { useParams } from "next/navigation";

import { trpc } from "@/lib/trpc";

const NEGATIVE_RATINGS = ["F", "D-", "D", "D+", "C-"];

function ratingStamp(rating: string | null) {
  if (rating === null) return "stamp-neutral";
  return NEGATIVE_RATINGS.includes(rating) ? "stamp-open" : "stamp-closed";
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="eyebrow mb-3 border-b border-line pb-2">{label}</p>
      {children}
    </section>
  );
}

export default function ContractorDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, isError } = trpc.contractors.detail.useQuery({ companyId: params.id });

  if (isLoading) return <div className="mx-auto max-w-3xl px-6 py-10 text-ink-muted">Loading record...</div>;
  if (isError || data === undefined)
    return <div className="mx-auto max-w-3xl px-6 py-10 text-stamp-open">Couldn&apos;t load this contractor.</div>;

  const { company, permits, bbbProfile, reviews, complaints, projects } = data;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-10 text-sm">
      <div className="fade-in border border-line bg-paper-raised p-5">
        <p className="eyebrow mb-1">Contractor record</p>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{company?.name ?? "Unknown contractor"}</h1>
          {bbbProfile !== undefined && (
            <span className={`stamp shrink-0 ${ratingStamp(bbbProfile.bbbRating)}`}>
              {bbbProfile.bbbRating ?? "not rated"}
            </span>
          )}
        </div>
        {bbbProfile !== undefined && (
          <p className="mt-1 text-ink-muted">
            {bbbProfile.isAccredited === true ? "BBB accredited" : "Not BBB accredited"} &middot;{" "}
            {bbbProfile.reviewCount ?? 0} reviews &middot; {bbbProfile.complaintCount ?? 0} complaints
          </p>
        )}
        {bbbProfile === undefined && <p className="mt-1 text-ink-muted">No BBB profile on file.</p>}
      </div>

      <Section label={`BBB complaints (${complaints.length})`}>
        {complaints.length === 0 && <p className="text-ink-muted">No complaints on file.</p>}
        <ul className="space-y-2">
          {complaints.map((c, i) => (
            <li key={i} className="ledger-row px-1 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{c.complaintType ?? "Unknown type"}</span>
                <span className="stamp stamp-open">{c.complaintStatus ?? "unknown"}</span>
              </div>
              <p className="eyebrow mt-1">{c.complaintDate ?? "unknown date"}</p>
              {c.complaintSummary !== null && <p className="mt-1">{c.complaintSummary}</p>}
            </li>
          ))}
        </ul>
      </Section>

      <Section label={`Review summaries (${reviews.length})`}>
        {reviews.length === 0 && <p className="text-ink-muted">No reviews on file.</p>}
        <ul className="space-y-2">
          {reviews.map((r, i) => (
            <li key={i} className="ledger-row px-1 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs">{r.reviewDate ?? "unknown date"}</span>
                <span className="stamp stamp-closed">{r.reviewRating ?? "n/a"} / 5</span>
              </div>
              {r.reviewText !== null && <p className="mt-1">{r.reviewText}</p>}
            </li>
          ))}
        </ul>
      </Section>

      <Section label={`Permit history (${permits.length})`}>
        {permits.length === 0 && <p className="text-ink-muted">No permits on file.</p>}
        <ul className="space-y-2">
          {permits.map((p) => (
            <li key={p.propertyImprovementId} className="ledger-row px-1 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs">{p.permitNumber ?? "unknown #"}</span>
                <span className={`stamp ${p.improvementStatus === "open" ? "stamp-open" : "stamp-closed"}`}>
                  {p.improvementStatus ?? "unknown"}
                </span>
              </div>
              <p className="mt-1">{p.improvementType ?? "No description"}</p>
              <p className="eyebrow">{p.unnormalizedAddress ?? "unknown address"}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section label={`Projects (${projects.length})`}>
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
