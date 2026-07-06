import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";

import { resolveCompanyId } from "./contractor.js";
import { db, schema } from "./db.js";
import type { SunbizTenant } from "./fetch-property.js";

const {
  businessRegistrations,
  businessRegistrationAddresses,
  businessRegistrationParties,
  businessRegistrationAnnualReports,
  publicRecords,
  ownerships,
  tenants,
} = schema;

function normalizeOwnerName(text: string | null): string {
  return (text ?? "")
    .toUpperCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const SOURCE_SYSTEM = "sunbiz";

function excluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

function toDateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * Loads one property's sunbizTenants[] array into the adopted schema, plus
 * derives a `tenants` occupancy row for each — the property/business link is
 * already known at fetch time (this data came from *this* property's own
 * consolidated JSON), so there's no need to guess it later via address
 * matching. Occupancy status compares the registrant's name against the
 * property's ownership records.
 */
export async function loadSunbizForProperty(
  propertyId: string,
  sunbizTenants: SunbizTenant[],
  now: Date,
): Promise<void> {
  if (sunbizTenants.length === 0) return;

  // documentNumber is Sunbiz's own natural key — dedupe defensively in case
  // the same registration appears twice in the raw array (seen live earlier).
  const uniqueTenants = [
    ...new Map(
      sunbizTenants
        .filter((t) => t.documentNumber !== null)
        .map((t) => [t.documentNumber, t]),
    ).values(),
  ];
  if (uniqueTenants.length === 0) return;

  const documentNumbers = uniqueTenants.map((t) => t.documentNumber!);

  await db
    .insert(businessRegistrations)
    .values(
      uniqueTenants.map((tenant) => ({
        businessRegistrationId: randomUUID(),
        requestIdentifier: tenant.documentNumber!,
        documentNumber: tenant.documentNumber!,
        entityName: tenant.entityName,
        status: tenant.status,
        filingType: tenant.filingType,
        filedDate: toDateOnly(tenant.filedDate),
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: tenant.documentNumber!,
        loadedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [
        businessRegistrations.sourceSystem,
        businessRegistrations.sourceRecordKey,
      ],
      set: {
        entityName: excluded("entity_name"),
        status: excluded("status"),
        filingType: excluded("filing_type"),
        filedDate: excluded("filed_date"),
        loadedAt: excluded("loaded_at"),
        updatedAt: now,
      },
    });

  const idRows = await db
    .select({
      key: businessRegistrations.sourceRecordKey,
      id: businessRegistrations.businessRegistrationId,
    })
    .from(businessRegistrations)
    .where(inArray(businessRegistrations.sourceRecordKey, documentNumbers));
  const registrationIdByDocNumber = new Map(
    idRows.map((row) => [row.key, row.id]),
  );

  const addressRows: (typeof businessRegistrationAddresses.$inferInsert)[] = [];
  const partyRows: (typeof businessRegistrationParties.$inferInsert)[] = [];
  const reportRows: (typeof businessRegistrationAnnualReports.$inferInsert)[] =
    [];
  const tenantRows: (typeof tenants.$inferInsert)[] = [];

  const ownerRows = await db
    .select({ ownedBy: ownerships.ownedBy })
    .from(ownerships)
    .where(eq(ownerships.propertyId, propertyId));

  for (const tenant of uniqueTenants) {
    const documentNumber = tenant.documentNumber!;
    const businessRegistrationId =
      registrationIdByDocNumber.get(documentNumber);
    if (businessRegistrationId === undefined) continue;

    if (tenant.entityName !== null) {
      const companyId = await resolveCompanyId(
        tenant.entityName,
        SOURCE_SYSTEM,
        now,
      );
      // Same bug class as the BBB profile fix: resolving a companyId isn't
      // enough on its own -- the businessRegistrations row itself needs it
      // written back, or businesses.detail's relatedProperties lookup (which
      // checks registration.companyId) always finds nothing even when the
      // real tenant/occupancy link exists.
      await db
        .update(businessRegistrations)
        .set({ companyId })
        .where(eq(businessRegistrations.businessRegistrationId, businessRegistrationId));
      const isOwnerOccupied = ownerRows.some(
        (o) =>
          o.ownedBy !== null &&
          normalizeOwnerName(o.ownedBy) ===
            normalizeOwnerName(tenant.entityName),
      );
      tenantRows.push({
        tenantId: randomUUID(),
        propertyId,
        businessCompanyId: companyId,
        occupancyStatus: isOwnerOccupied ? "owner_occupied" : "tenant",
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: `${propertyId}:${documentNumber}`,
        loadedAt: now,
      });
    }

    for (const [index, address] of tenant.addresses.entries()) {
      addressRows.push({
        businessRegistrationId,
        requestIdentifier: documentNumber,
        documentNumber,
        addressRole: address.addressRole ?? `address_${index}`,
        line1: address.line1,
        city: address.city,
        state: address.state,
        zip: address.zip,
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: `${documentNumber}:address:${address.addressRole ?? index}`,
        loadedAt: now,
      });
    }

    for (const [index, party] of tenant.parties.entries()) {
      partyRows.push({
        businessRegistrationId,
        requestIdentifier: documentNumber,
        documentNumber,
        partyRole: party.partyRole ?? `party_${index}`,
        name: party.name ?? `Unknown Party ${index}`,
        title: party.title,
        addressSingleLine: party.addressSingleLine,
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: `${documentNumber}:party:${index}`,
        loadedAt: now,
      });
    }

    for (const [index, report] of tenant.annualReports.entries()) {
      reportRows.push({
        businessRegistrationId,
        documentNumber,
        reportOrdinal: index,
        reportYear: report.reportYear,
        reportDate: toDateOnly(report.reportDate),
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: `${documentNumber}:report:${index}`,
        loadedAt: now,
      });
    }
  }

  if (addressRows.length > 0) {
    await db
      .insert(businessRegistrationAddresses)
      .values(addressRows)
      .onConflictDoNothing({
        target: [
          businessRegistrationAddresses.sourceSystem,
          businessRegistrationAddresses.sourceRecordKey,
        ],
      });
  }
  if (partyRows.length > 0) {
    await db
      .insert(businessRegistrationParties)
      .values(partyRows)
      .onConflictDoNothing({
        target: [
          businessRegistrationParties.sourceSystem,
          businessRegistrationParties.sourceRecordKey,
        ],
      });
  }
  if (reportRows.length > 0) {
    await db
      .insert(businessRegistrationAnnualReports)
      .values(reportRows)
      .onConflictDoNothing({
        target: [
          businessRegistrationAnnualReports.sourceSystem,
          businessRegistrationAnnualReports.sourceRecordKey,
        ],
      });
  }
  if (tenantRows.length > 0) {
    await db
      .insert(tenants)
      .values(tenantRows)
      .onConflictDoNothing({
        target: [tenants.sourceSystem, tenants.sourceRecordKey],
      });
  }

  await db
    .insert(publicRecords)
    .values(
      documentNumbers.map((documentNumber) => ({
        documentType: "sunbiz_registration" as const,
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: documentNumber,
        loadedAt: now,
      })),
    )
    .onConflictDoNothing({
      target: [publicRecords.sourceSystem, publicRecords.sourceRecordKey],
    });
}
