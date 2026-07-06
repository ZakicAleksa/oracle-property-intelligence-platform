import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db";
import { publicProcedure, router } from "../trpc";

const { tenants, companies, properties, addresses, propertyImprovements, projects } = schema;

export const tenantsRouter = router({
  list: publicProcedure.input(z.object({ limit: z.number().min(1).max(200).default(50) })).query(async ({ input }) => {
    return db
      .select({
        tenantId: tenants.tenantId,
        propertyId: tenants.propertyId,
        businessName: companies.name,
        occupancyStatus: tenants.occupancyStatus,
        unnormalizedAddress: addresses.unnormalizedAddress,
        cityName: addresses.cityName,
      })
      .from(tenants)
      .innerJoin(companies, eq(companies.companyId, tenants.businessCompanyId))
      .innerJoin(properties, eq(properties.propertyId, tenants.propertyId))
      .leftJoin(addresses, eq(addresses.addressId, properties.addressId))
      .limit(input.limit);
  }),

  detail: publicProcedure.input(z.object({ tenantId: z.string().uuid() })).query(async ({ input }) => {
    const [tenant] = await db
      .select({
        tenantId: tenants.tenantId,
        propertyId: tenants.propertyId,
        businessCompanyId: tenants.businessCompanyId,
        businessName: companies.name,
        occupancyStatus: tenants.occupancyStatus,
        occupancyStartDate: tenants.occupancyStartDate,
        occupancyEndDate: tenants.occupancyEndDate,
        unnormalizedAddress: addresses.unnormalizedAddress,
      })
      .from(tenants)
      .innerJoin(companies, eq(companies.companyId, tenants.businessCompanyId))
      .innerJoin(properties, eq(properties.propertyId, tenants.propertyId))
      .leftJoin(addresses, eq(addresses.addressId, properties.addressId))
      .where(eq(tenants.tenantId, input.tenantId))
      .limit(1);

    if (tenant === undefined) return { tenant: undefined, permits: [], projects: [] };

    const permits = await db
      .select({
        permitNumber: propertyImprovements.permitNumber,
        improvementType: propertyImprovements.improvementType,
        improvementStatus: propertyImprovements.improvementStatus,
      })
      .from(propertyImprovements)
      .where(eq(propertyImprovements.propertyId, tenant.propertyId));

    const projectList = await db
      .select({ projectId: projects.projectId, projectType: projects.projectType })
      .from(projects)
      .where(eq(projects.propertyId, tenant.propertyId));

    return { tenant, permits, projects: projectList };
  }),
});
