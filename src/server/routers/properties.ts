import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db";
import { cleanImprovementTypeLabel } from "../format";
import { publicProcedure, router } from "../trpc";

const {
  properties,
  addresses,
  ownerships,
  propertyImprovements,
  companies,
  tenants,
  projects,
} = schema;

export const propertiesRouter = router({
  list: publicProcedure
    .input(
      z.object({
        city: z.string().optional(),
        permitType: z.string().optional(),
        onlyMultipleOpenPermits: z.boolean().optional(),
        limit: z.number().min(1).max(200).default(50),
      }),
    )
    .query(async ({ input }) => {
      const conditions = [];
      if (input.city !== undefined && input.city.length > 0) {
        conditions.push(ilike(addresses.cityName, `%${input.city}%`));
      }

      const openPermitCounts = db
        .select({
          propertyId: propertyImprovements.propertyId,
          openCount:
            sql<number>`count(*) filter (where ${propertyImprovements.improvementStatus} = 'open')`.as(
              "open_count",
            ),
          permitTypes: sql<
            string[]
          >`array_agg(distinct ${propertyImprovements.improvementType})`.as(
            "permit_types",
          ),
          openPermitTypes: sql<
            string[]
          >`array_agg(distinct ${propertyImprovements.improvementType}) filter (where ${propertyImprovements.improvementStatus} = 'open')`.as(
            "open_permit_types",
          ),
        })
        .from(propertyImprovements)
        .groupBy(propertyImprovements.propertyId)
        .as("open_permit_counts");

      const rows = await db
        .select({
          propertyId: properties.propertyId,
          propertyType: properties.propertyType,
          cityName: addresses.cityName,
          unnormalizedAddress: addresses.unnormalizedAddress,
          openPermitCount: openPermitCounts.openCount,
          permitTypes: openPermitCounts.permitTypes,
        })
        .from(properties)
        .leftJoin(addresses, eq(properties.addressId, addresses.addressId))
        .innerJoin(
          openPermitCounts,
          eq(openPermitCounts.propertyId, properties.propertyId),
        )
        .where(
          and(
            ...conditions,
            input.permitType !== undefined
              ? sql`EXISTS (SELECT 1 FROM unnest(${openPermitCounts.openPermitTypes}) AS t WHERE t ILIKE ${"%" + input.permitType + "%"})`
              : undefined,
            input.onlyMultipleOpenPermits === true
              ? sql`${openPermitCounts.openCount} > 1`
              : undefined,
          ),
        )
        .orderBy(desc(openPermitCounts.openCount))
        .limit(input.limit);

      return rows.map((row) => ({
        ...row,
        permitTypes: (row.permitTypes ?? []).map(cleanImprovementTypeLabel),
      }));
    }),

  detail: publicProcedure
    .input(z.object({ propertyId: z.string().uuid() }))
    .query(async ({ input }) => {
      const [property] = await db
        .select({
          propertyId: properties.propertyId,
          propertyType: properties.propertyType,
          propertyUsageType: properties.propertyUsageType,
          cityName: addresses.cityName,
          unnormalizedAddress: addresses.unnormalizedAddress,
        })
        .from(properties)
        .leftJoin(addresses, eq(properties.addressId, addresses.addressId))
        .where(eq(properties.propertyId, input.propertyId))
        .limit(1);

      const ownershipHistory = await db
        .select({
          ownershipId: ownerships.ownershipId,
          ownedBy: ownerships.ownedBy,
          dateAcquired: ownerships.dateAcquired,
          dateSold: ownerships.dateSold,
          ownerOccupiedIndicator: ownerships.ownerOccupiedIndicator,
        })
        .from(ownerships)
        .where(eq(ownerships.propertyId, input.propertyId));

      const permits = await db
        .select({
          propertyImprovementId: propertyImprovements.propertyImprovementId,
          permitNumber: propertyImprovements.permitNumber,
          improvementType: propertyImprovements.improvementType,
          improvementStatus: propertyImprovements.improvementStatus,
          projectDescription: propertyImprovements.projectDescription,
          completionDate: propertyImprovements.completionDate,
          estimatedJobValue: propertyImprovements.estimatedJobValue,
          contractorCompanyId: propertyImprovements.contractorCompanyId,
          contractorName: companies.name,
        })
        .from(propertyImprovements)
        .leftJoin(
          companies,
          eq(companies.companyId, propertyImprovements.contractorCompanyId),
        )
        .where(eq(propertyImprovements.propertyId, input.propertyId));
      const cleanedPermits = permits.map((permit) => ({
        ...permit,
        improvementType: cleanImprovementTypeLabel(permit.improvementType),
      }));

      const occupancy = await db
        .select({
          tenantId: tenants.tenantId,
          businessName: companies.name,
          occupancyStatus: tenants.occupancyStatus,
        })
        .from(tenants)
        .innerJoin(
          companies,
          eq(companies.companyId, tenants.businessCompanyId),
        )
        .where(eq(tenants.propertyId, input.propertyId));

      const projectList = await db
        .select({
          projectId: projects.projectId,
          projectType: projects.projectType,
          startDate: projects.startDate,
          endDate: projects.endDate,
          totalEstimatedValue: projects.totalEstimatedValue,
          contractorName: companies.name,
        })
        .from(projects)
        .leftJoin(
          companies,
          eq(companies.companyId, projects.contractorCompanyId),
        )
        .where(eq(projects.propertyId, input.propertyId));

      return {
        property,
        ownershipHistory,
        permits: cleanedPermits,
        occupancy,
        projects: projectList,
      };
    }),
});
