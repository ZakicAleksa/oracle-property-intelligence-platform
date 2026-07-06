// Derives `tenants`: matches Sunbiz business registration addresses against
// our loaded property addresses (same zip + street number/name appearing in
// the registration's address line), then compares the business name against
// the property's ownership to classify occupancy status.
//
// Usage: npx tsx scripts/ingest/derive-tenants.ts
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { db, schema } from "./db.js";

const {
  businessRegistrationAddresses,
  businessRegistrations,
  addresses,
  properties,
  ownerships,
  tenants,
} = schema;

const SOURCE_SYSTEM = "derived_tenants";

function normalize(text: string | null): string {
  return (text ?? "")
    .toUpperCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main(): Promise<void> {
  const registrationAddresses = await db
    .select({
      businessRegistrationId:
        businessRegistrationAddresses.businessRegistrationId,
      zip: businessRegistrationAddresses.zip,
      city: businessRegistrationAddresses.city,
      line1: businessRegistrationAddresses.line1,
      entityName: businessRegistrations.entityName,
      companyId: businessRegistrations.companyId,
    })
    .from(businessRegistrationAddresses)
    .innerJoin(
      businessRegistrations,
      eq(
        businessRegistrations.businessRegistrationId,
        businessRegistrationAddresses.businessRegistrationId,
      ),
    );

  console.log(
    `${registrationAddresses.length} business registration addresses to match.`,
  );

  const now = new Date();
  let created = 0;
  let matched = 0;

  for (const reg of registrationAddresses) {
    if (reg.zip === null || reg.line1 === null || reg.companyId === null)
      continue;
    const zipPrefix = reg.zip.slice(0, 5);

    const candidates = await db
      .select({
        propertyId: properties.propertyId,
        streetNumber: addresses.streetNumber,
        streetName: addresses.streetName,
        unnormalizedAddress: addresses.unnormalizedAddress,
      })
      .from(properties)
      .innerJoin(addresses, eq(properties.addressId, addresses.addressId))
      .where(sql`${addresses.postalCode} LIKE ${zipPrefix + "%"}`)
      .limit(2000);

    const normalizedLine1 = normalize(reg.line1);
    const match = candidates.find(
      (c) =>
        c.streetNumber !== null &&
        c.streetName !== null &&
        normalizedLine1.includes(normalize(c.streetNumber)) &&
        normalizedLine1.includes(normalize(c.streetName).split(" ")[0]!),
    );

    if (match === undefined) continue;
    matched++;

    const ownerRows = await db
      .select({ ownedBy: ownerships.ownedBy })
      .from(ownerships)
      .where(eq(ownerships.propertyId, match.propertyId))
      .limit(5);
    const isOwnerOccupied = ownerRows.some(
      (o) =>
        o.ownedBy !== null &&
        normalize(o.ownedBy) === normalize(reg.entityName),
    );

    const inserted = await db
      .insert(tenants)
      .values({
        tenantId: randomUUID(),
        propertyId: match.propertyId,
        businessCompanyId: reg.companyId,
        occupancyStatus: isOwnerOccupied ? "owner_occupied" : "tenant",
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: `${reg.businessRegistrationId}:${match.propertyId}`,
        loadedAt: now,
      })
      .onConflictDoNothing({
        target: [tenants.sourceSystem, tenants.sourceRecordKey],
      })
      .returning({ tenantId: tenants.tenantId });

    if (inserted[0] !== undefined) created++;
  }

  console.log(
    `${matched} address matches found, ${created} tenant rows created.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
