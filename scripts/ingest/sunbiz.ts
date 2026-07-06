import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";

import { resolveCompanyId } from "./contractor.js";
import { db, schema } from "./db.js";
import type { SunbizTenant } from "./fetch-property.js";

const {
  businessRegistrations,
  businessRegistrationAddresses,
  businessRegistrationParties,
  businessRegistrationAnnualReports,
  publicRecords,
} = schema;

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
 * Loads one property's sunbizTenants[] array into the adopted schema.
 * Batched per property, same principle as permits.ts: one multi-row INSERT
 * per child table rather than per-row sequential awaits.
 */
export async function loadSunbizForProperty(tenants: SunbizTenant[], now: Date): Promise<void> {
  if (tenants.length === 0) return;

  // documentNumber is Sunbiz's own natural key — dedupe defensively in case
  // the same registration appears twice in the raw array (seen live earlier).
  const uniqueTenants = [
    ...new Map(
      tenants.filter((t) => t.documentNumber !== null).map((t) => [t.documentNumber, t]),
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
      target: [businessRegistrations.sourceSystem, businessRegistrations.sourceRecordKey],
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
  const registrationIdByDocNumber = new Map(idRows.map((row) => [row.key, row.id]));

  const addressRows: (typeof businessRegistrationAddresses.$inferInsert)[] = [];
  const partyRows: (typeof businessRegistrationParties.$inferInsert)[] = [];
  const reportRows: (typeof businessRegistrationAnnualReports.$inferInsert)[] = [];

  for (const tenant of uniqueTenants) {
    const documentNumber = tenant.documentNumber!;
    const businessRegistrationId = registrationIdByDocNumber.get(documentNumber);
    if (businessRegistrationId === undefined) continue;

    if (tenant.entityName !== null) {
      await resolveCompanyId(tenant.entityName, SOURCE_SYSTEM, now);
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
        target: [businessRegistrationAddresses.sourceSystem, businessRegistrationAddresses.sourceRecordKey],
      });
  }
  if (partyRows.length > 0) {
    await db
      .insert(businessRegistrationParties)
      .values(partyRows)
      .onConflictDoNothing({
        target: [businessRegistrationParties.sourceSystem, businessRegistrationParties.sourceRecordKey],
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
    .onConflictDoNothing({ target: [publicRecords.sourceSystem, publicRecords.sourceRecordKey] });
}
