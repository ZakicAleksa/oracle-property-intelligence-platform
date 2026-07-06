import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";

import { resolveCompanyId } from "./contractor.js";
import { db, schema } from "./db.js";
import type { BbbProfile } from "./fetch-property.js";

const { businessReputationProfiles, businessReputationReviews, businessReputationComplaints, contractorQualityScores, publicRecords } =
  schema;

const SOURCE_SYSTEM = "bbb";

function excluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

function toDateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function toNumericString(value: string | number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

/**
 * Loads one property's bbbProfiles[] array into the adopted schema — core
 * tables only (profile, reviews, complaints, contractor quality score).
 * Peripheral sub-tables (alternate names, categories, media, service areas,
 * licenses, contacts, external links, rating reasons) are deliberately
 * skipped: none are required by any Required Demo Inquiry, and building/
 * testing 9 more mappers wasn't worth the time given the priority on speed.
 * Revisit only if a specific demo need surfaces for one of them.
 */
export async function loadBbbForProperty(profiles: BbbProfile[], now: Date): Promise<void> {
  if (profiles.length === 0) return;

  const keyed = profiles
    .map((profile, index) => ({
      profile,
      key: profile.profileUrl ?? (profile.name !== null ? `name:${profile.name}` : null) ?? `idx:${index}`,
    }))
    .filter((entry) => entry.key !== null);
  if (keyed.length === 0) return;

  const keys = keyed.map((entry) => entry.key);

  await db
    .insert(businessReputationProfiles)
    .values(
      keyed.map(({ profile, key }) => ({
        businessReputationProfileId: randomUUID(),
        name: profile.name,
        profileUrl: profile.profileUrl,
        bbbRating: profile.bbbRating,
        isAccredited: profile.isAccredited,
        reviewCount: profile.reviewCount,
        complaintCount: profile.complaintCount,
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: key,
        loadedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [businessReputationProfiles.sourceSystem, businessReputationProfiles.sourceRecordKey],
      set: {
        bbbRating: excluded("bbb_rating"),
        isAccredited: excluded("is_accredited"),
        reviewCount: excluded("review_count"),
        complaintCount: excluded("complaint_count"),
        loadedAt: excluded("loaded_at"),
        updatedAt: now,
      },
    });

  const idRows = await db
    .select({
      key: businessReputationProfiles.sourceRecordKey,
      id: businessReputationProfiles.businessReputationProfileId,
    })
    .from(businessReputationProfiles)
    .where(inArray(businessReputationProfiles.sourceRecordKey, keys));
  const profileIdByKey = new Map(idRows.map((row) => [row.key, row.id]));

  const reviewRows: (typeof businessReputationReviews.$inferInsert)[] = [];
  const complaintRows: (typeof businessReputationComplaints.$inferInsert)[] = [];
  const scoreRows: (typeof contractorQualityScores.$inferInsert)[] = [];

  for (const { profile, key } of keyed) {
    const businessReputationProfileId = profileIdByKey.get(key);
    if (businessReputationProfileId === undefined) continue;

    let companyId: string | null = null;
    if (profile.name !== null) {
      companyId = await resolveCompanyId(profile.name, SOURCE_SYSTEM, now);
      await db
        .update(businessReputationProfiles)
        .set({ companyId })
        .where(eq(businessReputationProfiles.businessReputationProfileId, businessReputationProfileId));
    }

    for (const [index, review] of profile.reviews.entries()) {
      reviewRows.push({
        businessReputationProfileId,
        reviewDate: toDateOnly(review.reviewDate),
        reviewRating: toNumericString(review.reviewRating),
        reviewTitle: review.reviewTitle,
        reviewText: review.reviewText,
        reviewerDisplayName: review.reviewerDisplayName,
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: `${key}:review:${index}`,
        loadedAt: now,
      });
    }

    for (const [index, complaint] of profile.complaints.entries()) {
      complaintRows.push({
        businessReputationProfileId,
        complaintDate: toDateOnly(complaint.complaintDate),
        complaintClosedDate: toDateOnly(complaint.complaintClosedDate),
        complaintType: complaint.complaintType,
        complaintCategory: complaint.complaintCategory ?? null,
        complaintStatus: complaint.complaintStatus,
        complaintSummary: complaint.complaintSummary,
        complaintText: complaint.complaintText ?? null,
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: `${key}:complaint:${index}`,
        loadedAt: now,
      });
    }

    if (companyId !== null && profile.qualityScore !== null) {
      scoreRows.push({
        companyId,
        businessReputationProfileId,
        scoringModel: "oracle_bbb_quality_score",
        score: toNumericString(profile.qualityScore),
        scoreBand: profile.scoreBand,
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: `${key}:score`,
        loadedAt: now,
      });
    }
  }

  if (reviewRows.length > 0) {
    await db
      .insert(businessReputationReviews)
      .values(reviewRows)
      .onConflictDoNothing({
        target: [businessReputationReviews.sourceSystem, businessReputationReviews.sourceRecordKey],
      });
  }
  if (complaintRows.length > 0) {
    await db
      .insert(businessReputationComplaints)
      .values(complaintRows)
      .onConflictDoNothing({
        target: [businessReputationComplaints.sourceSystem, businessReputationComplaints.sourceRecordKey],
      });
  }
  if (scoreRows.length > 0) {
    await db
      .insert(contractorQualityScores)
      .values(scoreRows)
      .onConflictDoNothing({
        target: [contractorQualityScores.sourceSystem, contractorQualityScores.sourceRecordKey],
      });
  }

  await db
    .insert(publicRecords)
    .values(
      keys.map((key) => ({
        documentType: "bbb_profile" as const,
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: key,
        loadedAt: now,
      })),
    )
    .onConflictDoNothing({ target: [publicRecords.sourceSystem, publicRecords.sourceRecordKey] });
}
