// Phase 4 RAG index: builds text summaries for properties-with-permits and
// contractors, embeds them via the Vercel AI Gateway (plain "provider/model"
// string — never a raw provider SDK, per CLAUDE.md), and stores vectors in
// entity_embeddings for semantic retrieval.
//
// Usage: npx tsx scripts/rag/build-embeddings.ts
import { embedMany } from "ai";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "../ingest/db.js";

const {
  properties,
  addresses,
  propertyImprovements,
  companies,
  businessReputationProfiles,
  businessReputationReviews,
  businessReputationComplaints,
  entityEmbeddings,
} = schema;

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const SOURCE_SYSTEM = "rag_index";

function excluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedBatchWithRetry(
  values: string[],
  attempt = 1,
): Promise<number[][]> {
  try {
    const { embeddings } = await embedMany({
      model: EMBEDDING_MODEL,
      values,
      maxRetries: 0,
    });
    return embeddings;
  } catch (error) {
    if (attempt >= 10) throw error;
    const waitMs = 5000 * attempt;
    console.log(`Rate limited, waiting ${waitMs}ms before retry ${attempt}...`);
    await sleep(waitMs);
    return embedBatchWithRetry(values, attempt + 1);
  }
}

async function embedAndStore(
  allRows: {
    entityType: "property" | "contractor" | "business";
    entityId: string;
    content: string;
  }[],
): Promise<void> {
  if (allRows.length === 0) return;
  const now = new Date();

  const existingKeys = new Set(
    (
      await db
        .select({ sourceRecordKey: entityEmbeddings.sourceRecordKey })
        .from(entityEmbeddings)
        .where(eq(entityEmbeddings.sourceSystem, SOURCE_SYSTEM))
    ).map((r) => r.sourceRecordKey),
  );
  const rows = allRows.filter(
    (row) => !existingKeys.has(`${row.entityType}:${row.entityId}`),
  );
  console.log(
    `${allRows.length - rows.length} already embedded, ${rows.length} remaining.`,
  );
  if (rows.length === 0) return;

  const BATCH = 50;
  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH);
    const embeddings = await embedBatchWithRetry(
      batch.map((row) => row.content),
    );
    await sleep(500);

    await db
      .insert(entityEmbeddings)
      .values(
        batch.map((row, index) => ({
          entityEmbeddingId: randomUUID(),
          entityType: row.entityType,
          entityId: row.entityId,
          content: row.content,
          embedding: embeddings[index]!,
          sourceSystem: SOURCE_SYSTEM,
          sourceRecordKey: `${row.entityType}:${row.entityId}`,
          loadedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [
          entityEmbeddings.sourceSystem,
          entityEmbeddings.sourceRecordKey,
        ],
        set: {
          content: excluded("content"),
          embedding: excluded("embedding"),
          loadedAt: excluded("loaded_at"),
        },
      });

    console.log(
      `Embedded ${Math.min(start + BATCH, rows.length)} / ${rows.length}`,
    );
  }
}

async function buildPropertySummaries(): Promise<void> {
  console.log("Building property summaries (properties with permits)...");
  const rows = await db
    .select({
      propertyId: properties.propertyId,
      cityName: addresses.cityName,
      unnormalizedAddress: addresses.unnormalizedAddress,
      propertyType: properties.propertyType,
      permitNumber: propertyImprovements.permitNumber,
      improvementType: propertyImprovements.improvementType,
      projectDescription: propertyImprovements.projectDescription,
      improvementStatus: propertyImprovements.improvementStatus,
      contractorCompanyId: propertyImprovements.contractorCompanyId,
    })
    .from(properties)
    .innerJoin(
      propertyImprovements,
      eq(propertyImprovements.propertyId, properties.propertyId),
    )
    .leftJoin(addresses, eq(properties.addressId, addresses.addressId));

  const byProperty = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = byProperty.get(row.propertyId);
    if (bucket === undefined) byProperty.set(row.propertyId, [row]);
    else bucket.push(row);
  }

  const summaries: {
    entityType: "property";
    entityId: string;
    content: string;
    openCount: number;
    totalCount: number;
  }[] = [];
  for (const [propertyId, permitRows] of byProperty) {
    const first = permitRows[0]!;
    const openCount = permitRows.filter((r) => r.improvementStatus === "open").length;
    // Cap both permit count and per-line length -- a property with 100+
    // permits (exactly the "most active" ones we now prioritize) can produce
    // a text blob past the embedding model's 8192-token input limit
    // otherwise, confirmed live on our own flagship demo property.
    const permitLines = permitRows
      .slice(0, 20)
      .map(
        (r) =>
          `Permit ${r.permitNumber ?? "unknown"}: ${(r.projectDescription ?? r.improvementType ?? "no description").slice(0, 150)} (status: ${r.improvementStatus ?? "unknown"})`,
      )
      .join("; ");
    // State the open-permit count explicitly so semantic search can answer
    // "which properties have multiple open permits" from this text directly,
    // not just infer it from listing every permit's status.
    const content = `Property at ${first.unnormalizedAddress ?? "unknown address"}, ${first.cityName ?? "unknown city"} (${first.propertyType ?? "unknown type"}). ${permitRows.length} total permits, ${openCount} currently open. Permit history (first 20): ${permitLines}.`.slice(0, 6000);
    summaries.push({ entityType: "property", entityId: propertyId, content, openCount, totalCount: permitRows.length });
  }

  // Most active properties first (by open permits, then total permits) --
  // guarantees flagship/high-signal properties land in a bounded embedding
  // slice rather than whatever order they happened to appear in the source.
  summaries.sort((a, b) => b.openCount - a.openCount || b.totalCount - a.totalCount);

  console.log(`${summaries.length} properties with permits to embed.`);
  await embedAndStore(summaries.slice(0, 500));
}

async function buildContractorSummaries(): Promise<void> {
  console.log("Building contractor summaries...");

  const permitRows = await db
    .select({
      companyId: propertyImprovements.contractorCompanyId,
      improvementType: propertyImprovements.improvementType,
      projectDescription: propertyImprovements.projectDescription,
    })
    .from(propertyImprovements)
    .where(sql`${propertyImprovements.contractorCompanyId} IS NOT NULL`);

  const bbbRows = await db
    .select({
      companyId: businessReputationProfiles.companyId,
      name: businessReputationProfiles.name,
      bbbRating: businessReputationProfiles.bbbRating,
      complaintCount: businessReputationProfiles.complaintCount,
      reviewCount: businessReputationProfiles.reviewCount,
      businessReputationProfileId:
        businessReputationProfiles.businessReputationProfileId,
    })
    .from(businessReputationProfiles)
    .where(sql`${businessReputationProfiles.companyId} IS NOT NULL`);

  // Oracle's own complaintCount summary field is frequently null even when
  // real complaint records were scraped -- count the actual rows we loaded.
  const realComplaintCounts = await db
    .select({
      businessReputationProfileId:
        businessReputationComplaints.businessReputationProfileId,
      count: sql<number>`count(*)`,
    })
    .from(businessReputationComplaints)
    .groupBy(businessReputationComplaints.businessReputationProfileId);
  const complaintCountByProfileId = new Map(
    realComplaintCounts.map((r) => [r.businessReputationProfileId, r.count]),
  );

  // Real review/complaint text so semantic search can answer about substance
  // ("what do reviews say"), not just counts.
  const allReviews = await db
    .select({
      businessReputationProfileId:
        businessReputationReviews.businessReputationProfileId,
      reviewRating: businessReputationReviews.reviewRating,
      reviewText: businessReputationReviews.reviewText,
    })
    .from(businessReputationReviews);
  const reviewsByProfileId = new Map<string, typeof allReviews>();
  for (const r of allReviews) {
    const bucket = reviewsByProfileId.get(r.businessReputationProfileId);
    if (bucket === undefined)
      reviewsByProfileId.set(r.businessReputationProfileId, [r]);
    else bucket.push(r);
  }

  const allComplaints = await db
    .select({
      businessReputationProfileId:
        businessReputationComplaints.businessReputationProfileId,
      complaintType: businessReputationComplaints.complaintType,
      complaintStatus: businessReputationComplaints.complaintStatus,
      complaintSummary: businessReputationComplaints.complaintSummary,
    })
    .from(businessReputationComplaints);
  const complaintsByProfileId = new Map<string, typeof allComplaints>();
  for (const c of allComplaints) {
    const bucket = complaintsByProfileId.get(c.businessReputationProfileId);
    if (bucket === undefined)
      complaintsByProfileId.set(c.businessReputationProfileId, [c]);
    else bucket.push(c);
  }

  function truncate(text: string, maxLength: number): string {
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  const companyIds = new Set<string>([
    ...permitRows.map((r) => r.companyId!),
    ...bbbRows.map((r) => r.companyId!),
  ]);

  if (companyIds.size === 0) {
    console.log("No contractors to embed.");
    return;
  }

  const companyRows = await db
    .select({ companyId: companies.companyId, name: companies.name })
    .from(companies)
    .where(inArray(companies.companyId, Array.from(companyIds)));
  const nameByCompanyId = new Map(
    companyRows.map((r) => [r.companyId, r.name]),
  );

  // Pre-grouped once so the per-company loop below is O(1) lookups instead
  // of an O(companies x permits) filter/find/some scan -- with the full
  // county now enriched, companies and permits are both in the tens of
  // thousands, and the naive per-company scan measurably compounds.
  const permitsByCompanyId = new Map<string, typeof permitRows>();
  for (const permit of permitRows) {
    const bucket = permitsByCompanyId.get(permit.companyId!);
    if (bucket === undefined) permitsByCompanyId.set(permit.companyId!, [permit]);
    else bucket.push(permit);
  }
  const bbbByCompanyId = new Map(bbbRows.map((r) => [r.companyId!, r]));

  // BBB-profiled contractors first — tiny in number (a handful) and the ones
  // Required Demo Inquiries specifically ask about (negative ratings,
  // complaints) — must not get crowded out by the arbitrary bulk of
  // permit-only contractors when the embedding slice is bounded.
  const orderedCompanyIds = [...companyIds].sort((a, b) => {
    const aHasBbb = bbbByCompanyId.has(a) ? 1 : 0;
    const bHasBbb = bbbByCompanyId.has(b) ? 1 : 0;
    return bHasBbb - aHasBbb;
  });

  const summaries: {
    entityType: "contractor";
    entityId: string;
    content: string;
  }[] = [];
  for (const companyId of orderedCompanyIds) {
    const name = nameByCompanyId.get(companyId) ?? "Unknown contractor";
    const permits = permitsByCompanyId.get(companyId) ?? [];
    const bbb = bbbByCompanyId.get(companyId);

    const permitSummary =
      permits.length > 0
        ? `Worked on ${permits.length} permit(s): ${permits
            .slice(0, 5)
            .map(
              (p) => p.projectDescription ?? p.improvementType ?? "renovation",
            )
            .join("; ")}.`
        : "No permit history on file.";
    const realComplaintCount =
      bbb !== undefined
        ? (complaintCountByProfileId.get(bbb.businessReputationProfileId) ?? 0)
        : 0;
    const bbbSummary =
      bbb !== undefined
        ? `BBB rating: ${bbb.bbbRating ?? "not rated"}, ${bbb.reviewCount ?? 0} reviews, ${realComplaintCount} complaints.`
        : "No BBB profile on file.";

    const reviewSnippets =
      bbb !== undefined
        ? (reviewsByProfileId.get(bbb.businessReputationProfileId) ?? [])
        : [];
    const reviewText =
      reviewSnippets.length > 0
        ? ` Review excerpts: ${reviewSnippets
            .slice(0, 3)
            .map(
              (r) =>
                `[${r.reviewRating ?? "?"}/5] "${truncate(r.reviewText ?? "", 200)}"`,
            )
            .join(" | ")}`
        : "";

    const complaintSnippets =
      bbb !== undefined
        ? (complaintsByProfileId.get(bbb.businessReputationProfileId) ?? [])
        : [];
    const complaintText =
      complaintSnippets.length > 0
        ? ` Complaint details: ${complaintSnippets
            .slice(0, 3)
            .map(
              (c) =>
                `${c.complaintType ?? "unknown type"} (${c.complaintStatus ?? "unknown status"})${c.complaintSummary !== null ? `: ${truncate(c.complaintSummary, 150)}` : ""}`,
            )
            .join(" | ")}`
        : "";

    summaries.push({
      entityType: "contractor",
      entityId: companyId,
      content: `Contractor: ${name}. ${permitSummary} ${bbbSummary}${reviewText}${complaintText}`,
    });
  }

  console.log(`${summaries.length} contractors to embed.`);
  await embedAndStore(summaries.slice(0, 300));
}

async function main(): Promise<void> {
  await buildPropertySummaries();
  await buildContractorSummaries();
  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
