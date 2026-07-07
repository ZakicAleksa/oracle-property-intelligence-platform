import { and, eq, ilike, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db";
import { cleanImprovementTypeLabel } from "../format";
import { publicProcedure, router } from "../trpc";

const {
  companies,
  propertyImprovements,
  properties,
  addresses,
  businessReputationProfiles,
  businessReputationReviews,
  businessReputationComplaints,
  projects,
} = schema;

const NEGATIVE_BBB_RATINGS = ["F", "D-", "D", "D+", "C-"];

export const contractorsRouter = router({
  list: publicProcedure
    .input(
      z.object({
        name: z.string().optional(),
        projectType: z.string().optional(),
        onlyNegativeBbb: z.boolean().optional(),
        limit: z.number().min(1).max(200).default(50),
      }),
    )
    .query(async ({ input }) => {
      const projectTypeLikePattern =
        input.projectType !== undefined ? `%${input.projectType}%` : undefined;

      const permitCountsQuery = db
        .select({
          companyId: propertyImprovements.contractorCompanyId,
          permitCount: sql<number>`count(*)`.as("permit_count"),
          types: sql<
            string[]
          >`array_agg(distinct ${propertyImprovements.improvementType})`.as(
            "types",
          ),
        })
        .from(propertyImprovements)
        .where(sql`${propertyImprovements.contractorCompanyId} IS NOT NULL`)
        .groupBy(propertyImprovements.contractorCompanyId);
      // Filtering by permit type has to happen in the DB (via HAVING on the
      // aggregated types array) rather than after fetching every row into
      // Node -- with the full county now enriched, "every matching
      // contractor" can be tens of thousands of rows just to then throw
      // most of them away in JS.
      const permitCounts = (
        projectTypeLikePattern !== undefined
          ? permitCountsQuery.having(
              sql`bool_or(${propertyImprovements.improvementType} ilike ${projectTypeLikePattern})`,
            )
          : permitCountsQuery
      ).as("permit_counts");

      // Oracle's own businessReputationProfiles.complaintCount summary field
      // is frequently null even when real complaint records were scraped --
      // count the actual rows we loaded instead of trusting that field.
      const complaintCounts = db
        .select({
          businessReputationProfileId:
            businessReputationComplaints.businessReputationProfileId,
          realComplaintCount: sql<number>`count(*)`.as("real_complaint_count"),
        })
        .from(businessReputationComplaints)
        .groupBy(businessReputationComplaints.businessReputationProfileId)
        .as("complaint_counts");

      const rows = await db
        .select({
          companyId: companies.companyId,
          name: companies.name,
          permitCount: permitCounts.permitCount,
          permitTypes: permitCounts.types,
          bbbRating: businessReputationProfiles.bbbRating,
          complaintCount: complaintCounts.realComplaintCount,
          reviewCount: businessReputationProfiles.reviewCount,
        })
        .from(companies)
        .leftJoin(permitCounts, eq(permitCounts.companyId, companies.companyId))
        .leftJoin(
          businessReputationProfiles,
          eq(businessReputationProfiles.companyId, companies.companyId),
        )
        .leftJoin(
          complaintCounts,
          eq(
            complaintCounts.businessReputationProfileId,
            businessReputationProfiles.businessReputationProfileId,
          ),
        )
        .where(
          and(
            input.name !== undefined && input.name.length > 0
              ? ilike(companies.name, `%${input.name}%`)
              : undefined,
            // A contractor is only relevant here if it has permit history or
            // a BBB profile -- excludes bare Sunbiz-only company rows that
            // never resolved to either signal. When projectType is set, only
            // permits can satisfy it (permitCounts is already HAVING-filtered
            // above), so a BBB-only company can't qualify on that condition
            // alone -- matches the original in-JS filter's behavior.
            projectTypeLikePattern !== undefined
              ? sql`${permitCounts.companyId} IS NOT NULL`
              : sql`(${permitCounts.companyId} IS NOT NULL OR ${businessReputationProfiles.companyId} IS NOT NULL)`,
            input.onlyNegativeBbb === true
              ? inArray(businessReputationProfiles.bbbRating, NEGATIVE_BBB_RATINGS)
              : undefined,
          ),
        )
        // BBB-linked contractors first (they're almost all permit-count NULL
        // or low, since BBB and permit identity resolution don't always land
        // on the same company row) -- otherwise every one of them sorts
        // below the ~2,500 permit-only contractors and never appears in an
        // unfiltered browse of the Contractor View, even though "Display
        // contractor BBB ratings" is an unconditional Acceptance Criterion,
        // not something gated behind the negative-rating filter.
        .orderBy(
          sql`(CASE WHEN ${businessReputationProfiles.companyId} IS NOT NULL THEN 0 ELSE 1 END), ${permitCounts.permitCount} DESC NULLS LAST`,
        )
        .limit(input.limit);

      return rows.map((row) => ({
        ...row,
        permitTypes: (row.permitTypes ?? []).map(cleanImprovementTypeLabel),
      }));
    }),

  detail: publicProcedure
    .input(z.object({ companyId: z.string().uuid() }))
    .query(async ({ input }) => {
      const [company] = await db
        .select({ companyId: companies.companyId, name: companies.name })
        .from(companies)
        .where(eq(companies.companyId, input.companyId))
        .limit(1);

      const permits = await db
        .select({
          propertyImprovementId: propertyImprovements.propertyImprovementId,
          propertyId: propertyImprovements.propertyId,
          permitNumber: propertyImprovements.permitNumber,
          improvementType: propertyImprovements.improvementType,
          projectDescription: propertyImprovements.projectDescription,
          improvementStatus: propertyImprovements.improvementStatus,
          completionDate: propertyImprovements.completionDate,
          unnormalizedAddress: addresses.unnormalizedAddress,
        })
        .from(propertyImprovements)
        .leftJoin(
          properties,
          eq(properties.propertyId, propertyImprovements.propertyId),
        )
        .leftJoin(addresses, eq(addresses.addressId, properties.addressId))
        .where(eq(propertyImprovements.contractorCompanyId, input.companyId));
      const cleanedPermits = permits.map((permit) => ({
        ...permit,
        improvementType: cleanImprovementTypeLabel(permit.improvementType),
      }));

      const [bbbProfile] = await db
        .select({
          businessReputationProfileId:
            businessReputationProfiles.businessReputationProfileId,
          bbbRating: businessReputationProfiles.bbbRating,
          isAccredited: businessReputationProfiles.isAccredited,
          reviewCount: businessReputationProfiles.reviewCount,
          complaintCount: businessReputationProfiles.complaintCount,
        })
        .from(businessReputationProfiles)
        .where(eq(businessReputationProfiles.companyId, input.companyId))
        .limit(1);

      const reviews = bbbProfile
        ? await db
            .select({
              reviewDate: businessReputationReviews.reviewDate,
              reviewRating: businessReputationReviews.reviewRating,
              reviewText: businessReputationReviews.reviewText,
            })
            .from(businessReputationReviews)
            .where(
              eq(
                businessReputationReviews.businessReputationProfileId,
                bbbProfile.businessReputationProfileId,
              ),
            )
        : [];

      const complaintRows = bbbProfile
        ? await db
            .select({
              complaintDate: businessReputationComplaints.complaintDate,
              complaintType: businessReputationComplaints.complaintType,
              complaintStatus: businessReputationComplaints.complaintStatus,
              complaintSummary: businessReputationComplaints.complaintSummary,
            })
            .from(businessReputationComplaints)
            .where(
              eq(
                businessReputationComplaints.businessReputationProfileId,
                bbbProfile.businessReputationProfileId,
              ),
            )
        : [];

      const projectList = await db
        .select({
          projectId: projects.projectId,
          propertyId: projects.propertyId,
          projectType: projects.projectType,
          startDate: projects.startDate,
          endDate: projects.endDate,
        })
        .from(projects)
        .where(eq(projects.contractorCompanyId, input.companyId));

      // Oracle's own complaintCount summary field is frequently null even when
      // real complaint records were scraped -- report the actual row count
      // from the complaints we loaded instead.
      const bbbProfileWithRealCounts =
        bbbProfile !== undefined
          ? { ...bbbProfile, complaintCount: complaintRows.length }
          : bbbProfile;

      return {
        company,
        permits: cleanedPermits,
        bbbProfile: bbbProfileWithRealCounts,
        reviews,
        complaints: complaintRows,
        projects: projectList,
      };
    }),
});
