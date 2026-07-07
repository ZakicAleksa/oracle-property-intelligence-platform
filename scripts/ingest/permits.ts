import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";

import { parseContactRawName, resolveCompanyId } from "./contractor.js";
import { db, schema } from "./db.js";
import type { Permit } from "./fetch-property.js";

const {
  propertyImprovements,
  permitContacts,
  permitEvents,
  permitFees,
  permitLinks,
  permitCustomFields,
  publicRecords,
} = schema;

const SOURCE_SYSTEM = "lee_permits";

// Some properties (heavily-scraped permits with dozens of custom fields per
// sub-permit) produce thousands of child rows. Inserting them in one
// unchunked multi-row VALUES blows past Postgres's bind-parameter limit /
// Neon's HTTP driver request-size limit and fails the whole property's load.
// Chunking keeps every insert well under either limit.
const INSERT_CHUNK_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function excluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

function toDateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function toTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNumericString(value: string | number | null): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** Derive a semantic open/closed status from Oracle's raw recordStatus text. */
function deriveImprovementStatus(recordStatus: string | null): string | null {
  if (recordStatus === null) return null;
  const normalized = recordStatus.toLowerCase();
  if (
    normalized.includes("closed") ||
    normalized.includes("finaled") ||
    normalized.includes("void")
  ) {
    return "closed";
  }
  if (
    normalized.includes("open") ||
    normalized.includes("issued") ||
    normalized.includes("active")
  ) {
    return "open";
  }
  return "unknown";
}

/**
 * Loads one property's permits[] array (and all nested sub-tables) into the
 * adopted schema, resolving contractor identity via the companies hub.
 *
 * Batched per property (not per-row): the first version issued one sequential
 * DB round trip per contact/event/fee/link/custom-field, which measured at
 * ~1.5s/permit — impractical at scale (200 properties took 5+ minutes and
 * hadn't finished). Batching every child table into one multi-row INSERT per
 * property cuts round trips from dozens-to-hundreds down to about 8,
 * regardless of how many permits or sub-rows a property has.
 */
export async function loadPermitsForProperty(
  propertyId: string,
  permits: Permit[],
  now: Date,
): Promise<void> {
  if (permits.length === 0) return;

  const permitSourceKeys = permits.map(
    (permit, index) => `${propertyId}:${permit.permitNumber ?? `idx${index}`}`,
  );

  const improvementSet = (permit: Permit) => ({
    improvementType: permit.improvementType,
    improvementStatus: deriveImprovementStatus(permit.recordStatus),
    recordStatus: permit.recordStatus,
    projectDescription: permit.projectDescription,
    completionDate: toDateOnly(permit.completionDate),
    estimatedJobValue: toNumericString(permit.estimatedJobValue),
    estimatedSqFt: toNumericString(permit.estimatedSqFt),
  });

  const improvementRows = permits.map((permit, index) => ({
    propertyImprovementId: randomUUID(),
    propertyId,
    permitNumber: permit.permitNumber,
    sourcePayload: permit as unknown as Record<string, unknown>,
    sourceSystem: SOURCE_SYSTEM,
    sourceRecordKey: permitSourceKeys[index]!,
    loadedAt: now,
    ...improvementSet(permit),
  }));

  for (const rows of chunk(improvementRows, INSERT_CHUNK_SIZE)) {
    await db
      .insert(propertyImprovements)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          propertyImprovements.sourceSystem,
          propertyImprovements.sourceRecordKey,
        ],
        set: {
          improvementType: excluded("improvement_type"),
          improvementStatus: excluded("improvement_status"),
          recordStatus: excluded("record_status"),
          projectDescription: excluded("project_description"),
          completionDate: excluded("completion_date"),
          estimatedJobValue: excluded("estimated_job_value"),
          estimatedSqFt: excluded("estimated_sq_ft"),
          loadedAt: excluded("loaded_at"),
          updatedAt: now,
        },
      });
  }

  const idRows = await db
    .select({
      key: propertyImprovements.sourceRecordKey,
      id: propertyImprovements.propertyImprovementId,
    })
    .from(propertyImprovements)
    .where(inArray(propertyImprovements.sourceRecordKey, permitSourceKeys));
  const propertyImprovementIdByKey = new Map(
    idRows.map((row) => [row.key, row.id]),
  );

  const contactRows: (typeof permitContacts.$inferInsert)[] = [];
  const eventRows: (typeof permitEvents.$inferInsert)[] = [];
  const feeRows: (typeof permitFees.$inferInsert)[] = [];
  const linkRows: (typeof permitLinks.$inferInsert)[] = [];
  const fieldRows: (typeof permitCustomFields.$inferInsert)[] = [];
  const contractorUpdates: {
    propertyImprovementId: string;
    companyId: string;
  }[] = [];

  for (const [index, permit] of permits.entries()) {
    const permitSourceKey = permitSourceKeys[index]!;
    const propertyImprovementId =
      propertyImprovementIdByKey.get(permitSourceKey);
    if (propertyImprovementId === undefined) continue;

    let primaryContractorCompanyId: string | null = null;

    for (const [contactIndex, contact] of permit.contacts.entries()) {
      const parsed = parseContactRawName(contact.rawName);
      let companyId: string | null = null;
      if (parsed.cleanedName !== null) {
        companyId = await resolveCompanyId(
          parsed.cleanedName,
          SOURCE_SYSTEM,
          now,
        );
        if (primaryContractorCompanyId === null)
          primaryContractorCompanyId = companyId;
      }

      contactRows.push({
        propertyImprovementId,
        contactRole: contact.contactRole,
        companyId,
        rawName: contact.rawName,
        phone: contact.phone ?? parsed.phone,
        email: contact.email ?? parsed.email,
        licenseNumber: contact.licenseNumber ?? parsed.licenseNumber,
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: `${permitSourceKey}:contact:${contactIndex}`,
        loadedAt: now,
      });
    }

    if (primaryContractorCompanyId !== null) {
      contractorUpdates.push({
        propertyImprovementId,
        companyId: primaryContractorCompanyId,
      });
    }

    for (const [eventIndex, event] of permit.events.entries()) {
      eventRows.push({
        propertyImprovementId,
        eventType: event.eventType,
        eventStatus: event.eventStatus,
        eventDate: toTimestamp(event.eventDate),
        actorName: event.actorName,
        commentText: event.commentText,
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: `${permitSourceKey}:event:${eventIndex}`,
        loadedAt: now,
      });
    }

    for (const [feeIndex, fee] of permit.fees.entries()) {
      feeRows.push({
        propertyImprovementId,
        feeCode: fee.feeCode,
        feeDescription: fee.feeDescription,
        feeStatus: fee.feeStatus,
        assessedAmount: toNumericString(fee.assessedAmount),
        paidAmount: toNumericString(fee.paidAmount),
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: `${permitSourceKey}:fee:${feeIndex}`,
        loadedAt: now,
      });
    }

    for (const link of permit.links) {
      linkRows.push({
        propertyImprovementId,
        linkKind: link.linkKind,
        text: link.text,
        url: link.url,
        title: link.title,
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: `${permitSourceKey}:link:${link.linkKind}:${link.url}`,
        loadedAt: now,
      });
    }

    for (const field of permit.customFields) {
      fieldRows.push({
        propertyImprovementId,
        fieldGroup: field.fieldGroup,
        fieldName: field.fieldName,
        fieldValue: field.fieldValue,
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: `${permitSourceKey}:field:${field.fieldGroup}:${field.fieldName}`,
        loadedAt: now,
      });
    }
  }

  for (const rows of chunk(contactRows, INSERT_CHUNK_SIZE)) {
    await db
      .insert(permitContacts)
      .values(rows)
      .onConflictDoNothing({
        target: [permitContacts.sourceSystem, permitContacts.sourceRecordKey],
      });
  }
  for (const rows of chunk(eventRows, INSERT_CHUNK_SIZE)) {
    await db
      .insert(permitEvents)
      .values(rows)
      .onConflictDoNothing({
        target: [permitEvents.sourceSystem, permitEvents.sourceRecordKey],
      });
  }
  for (const rows of chunk(feeRows, INSERT_CHUNK_SIZE)) {
    await db
      .insert(permitFees)
      .values(rows)
      .onConflictDoNothing({
        target: [permitFees.sourceSystem, permitFees.sourceRecordKey],
      });
  }
  for (const rows of chunk(linkRows, INSERT_CHUNK_SIZE)) {
    await db
      .insert(permitLinks)
      .values(rows)
      .onConflictDoNothing({
        target: [permitLinks.sourceSystem, permitLinks.sourceRecordKey],
      });
  }
  for (const rows of chunk(fieldRows, INSERT_CHUNK_SIZE)) {
    await db
      .insert(permitCustomFields)
      .values(rows)
      .onConflictDoNothing({
        target: [
          permitCustomFields.sourceSystem,
          permitCustomFields.sourceRecordKey,
        ],
      });
  }

  for (const update of contractorUpdates) {
    await db
      .update(propertyImprovements)
      .set({ contractorCompanyId: update.companyId })
      .where(
        eq(
          propertyImprovements.propertyImprovementId,
          update.propertyImprovementId,
        ),
      );
  }

  const publicRecordRows = permitSourceKeys.map((key) => ({
    documentType: "permit_filing" as const,
    sourceSystem: SOURCE_SYSTEM,
    sourceRecordKey: key,
    loadedAt: now,
  }));

  for (const rows of chunk(publicRecordRows, INSERT_CHUNK_SIZE)) {
    await db
      .insert(publicRecords)
      .values(rows)
      .onConflictDoNothing({
        target: [publicRecords.sourceSystem, publicRecords.sourceRecordKey],
      });
  }
}
