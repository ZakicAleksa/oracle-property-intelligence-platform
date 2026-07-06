import { eq, ilike } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db";
import { publicProcedure, router } from "../trpc";

const {
  businessRegistrations,
  businessRegistrationAddresses,
  businessRegistrationParties,
  tenants,
  properties,
  addresses,
} = schema;

export const businessesRouter = router({
  list: publicProcedure
    .input(
      z.object({
        name: z.string().optional(),
        limit: z.number().min(1).max(200).default(50),
      }),
    )
    .query(async ({ input }) => {
      return db
        .select({
          businessRegistrationId: businessRegistrations.businessRegistrationId,
          entityName: businessRegistrations.entityName,
          status: businessRegistrations.status,
          filingType: businessRegistrations.filingType,
          companyId: businessRegistrations.companyId,
        })
        .from(businessRegistrations)
        .where(
          input.name !== undefined && input.name.length > 0
            ? ilike(businessRegistrations.entityName, `%${input.name}%`)
            : undefined,
        )
        .limit(input.limit);
    }),

  detail: publicProcedure
    .input(z.object({ businessRegistrationId: z.string().uuid() }))
    .query(async ({ input }) => {
      const [registration] = await db
        .select()
        .from(businessRegistrations)
        .where(
          eq(
            businessRegistrations.businessRegistrationId,
            input.businessRegistrationId,
          ),
        )
        .limit(1);

      const addressRows = await db
        .select({
          addressRole: businessRegistrationAddresses.addressRole,
          line1: businessRegistrationAddresses.line1,
          city: businessRegistrationAddresses.city,
          state: businessRegistrationAddresses.state,
          zip: businessRegistrationAddresses.zip,
        })
        .from(businessRegistrationAddresses)
        .where(
          eq(
            businessRegistrationAddresses.businessRegistrationId,
            input.businessRegistrationId,
          ),
        );

      const parties = await db
        .select({
          partyRole: businessRegistrationParties.partyRole,
          name: businessRegistrationParties.name,
          title: businessRegistrationParties.title,
        })
        .from(businessRegistrationParties)
        .where(
          eq(
            businessRegistrationParties.businessRegistrationId,
            input.businessRegistrationId,
          ),
        );

      const relatedProperties =
        registration?.companyId !== null &&
        registration?.companyId !== undefined
          ? await db
              .select({
                propertyId: properties.propertyId,
                unnormalizedAddress: addresses.unnormalizedAddress,
                occupancyStatus: tenants.occupancyStatus,
              })
              .from(tenants)
              .innerJoin(
                properties,
                eq(properties.propertyId, tenants.propertyId),
              )
              .leftJoin(
                addresses,
                eq(addresses.addressId, properties.addressId),
              )
              .where(eq(tenants.businessCompanyId, registration.companyId))
          : [];

      return {
        registration,
        addresses: addressRows,
        parties,
        relatedProperties,
      };
    }),
});
