import "server-only";

import { randomUUID } from "node:crypto";
import { embedMany } from "ai";
import { eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "./db";

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
): Promise<{ alreadyEmbedded: number; embedded: number }> {
  if (allRows.length === 0) return { alreadyEmbedded: 0, embedded: 0 };
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
  if (rows.length === 0) {
    return { alreadyEmbedded: allRows.length, embedded: 0 };
  }

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
  }

  return { alreadyEmbedded: allRows.length - rows.length, embedded: rows.length };
}

async function buildPropertySummaries(): Promise<{
  candidates: number;
  alreadyEmbedded: number;
  embedded: number;
}> {
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
    const openCount = permitRows.filter(
      (r) => r.improvementStatus === "open",
    ).length;
    const permitLines = permitRows
      .slice(0, 20)
      .map(
        (r) =>
          `Permit ${r.permitNumber ?? "unknown"}: ${(r.projectDescription ?? r.improvementType ?? "no description").slice(0, 150)} (status: ${r.improvementStatus ?? "unknown"})`,
      )
      .join("; ");
    const content =
      `Property at ${first.unnormalizedAddress ?? "unknown address"}, ${first.cityName ?? "unknown city"} (${first.propertyType ?? "unknown type"}). ${permitRows.length} total permits, ${openCount} currently open. Permit history (first 20): ${permitLines}.`.slice(
        0,
        6000,
      );
    summaries.push({
      entityType: "property",
      entityId: propertyId,
      content,
      openCount,
      totalCount: permitRows.length,
    });
  }

  summaries.sort(
    (a, b) => b.openCount - a.openCount || b.totalCount - a.totalCount,
  );

  const selected = summaries.slice(0, 500);
  const { alreadyEmbedded, embedded } = await embedAndStore(selected);
  return { candidates: summaries.length, alreadyEmbedded, embedded };
}

async function buildContractorSummaries(): Promise<{
  candidates: number;
  alreadyEmbedded: number;
  embedded: number;
}> {
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
    if (bucket === undefined) reviewsByProfileId.set(r.businessReputationProfileId, [r]);
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
    if (bucket === undefined) complaintsByProfileId.set(c.businessReputationProfileId, [c]);
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
    return { candidates: 0, alreadyEmbedded: 0, embedded: 0 };
  }

  const companyRows = await db
    .select({ companyId: companies.companyId, name: companies.name })
    .from(companies)
    .where(inArray(companies.companyId, Array.from(companyIds)));
  const nameByCompanyId = new Map(companyRows.map((r) => [r.companyId, r.name]));

  const permitsByCompanyId = new Map<string, typeof permitRows>();
  for (const permit of permitRows) {
    const bucket = permitsByCompanyId.get(permit.companyId!);
    if (bucket === undefined) permitsByCompanyId.set(permit.companyId!, [permit]);
    else bucket.push(permit);
  }
  const bbbByCompanyId = new Map(bbbRows.map((r) => [r.companyId!, r]));

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
            .map((p) => p.projectDescription ?? p.improvementType ?? "renovation")
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
      bbb !== undefined ? (reviewsByProfileId.get(bbb.businessReputationProfileId) ?? []) : [];
    const reviewText =
      reviewSnippets.length > 0
        ? ` Review excerpts: ${reviewSnippets
            .slice(0, 3)
            .map((r) => `[${r.reviewRating ?? "?"}/5] "${truncate(r.reviewText ?? "", 200)}"`)
            .join(" | ")}`
        : "";

    const complaintSnippets =
      bbb !== undefined ? (complaintsByProfileId.get(bbb.businessReputationProfileId) ?? []) : [];
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

  const selected = summaries.slice(0, 300);
  const { alreadyEmbedded, embedded } = await embedAndStore(selected);
  return { candidates: summaries.length, alreadyEmbedded, embedded };
}

export async function rebuildEmbeddings(): Promise<{
  properties: { candidates: number; alreadyEmbedded: number; embedded: number };
  contractors: { candidates: number; alreadyEmbedded: number; embedded: number };
}> {
  const propertyResult = await buildPropertySummaries();
  const contractorResult = await buildContractorSummaries();
  return { properties: propertyResult, contractors: contractorResult };
}
