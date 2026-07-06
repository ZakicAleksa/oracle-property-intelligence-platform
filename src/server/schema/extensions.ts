// Genuine schema extensions this milestone defines — Tenant and Project have no
// equivalent in the Elephant Lexicon or in `elephant-query-db` (see ENTITY-MODEL.md).
// Everything else lives in ../elephant-query-db/schema, adopted as-is.
import {
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companies } from "../elephant-query-db/schema/core";
import { properties } from "../elephant-query-db/schema/appraisal";
import { propertyImprovements } from "../elephant-query-db/schema/permits";
import {
  createdAtColumn,
  sourceMetadataColumns,
  updatedAtColumn,
} from "../elephant-query-db/schema/shared";

export const projectTypeValues = [
  "roofing",
  "electrical",
  "concrete",
  "structural",
  "plumbing",
  "hvac",
  "other",
] as const;
export type ProjectType = (typeof projectTypeValues)[number];

export const occupancyStatusValues = [
  "owner_occupied",
  "tenant",
  "unknown",
] as const;
export type OccupancyStatus = (typeof occupancyStatusValues)[number];

/**
 * A derived grouping of Permits on the same Property and Contractor, clustered in
 * time — the grain "classify major renovation activity" actually operates on.
 * Constituent permits are linked via `projectPermits`, not a column on
 * `property_improvements`, so the adopted permits schema stays untouched.
 */
export const projects = pgTable(
  "projects",
  {
    projectId: uuid("project_id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.propertyId, { onDelete: "cascade" }),
    contractorCompanyId: uuid("contractor_company_id").references(
      () => companies.companyId,
      {
        onDelete: "set null",
      },
    ),
    projectType: text("project_type").$type<ProjectType>().notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
    totalEstimatedValue: numeric("total_estimated_value", {
      precision: 18,
      scale: 2,
    }),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("projects_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("projects_property_idx").on(table.propertyId),
    index("projects_contractor_idx").on(table.contractorCompanyId),
  ],
);

/** Join table linking a Project to its constituent Permits (many-to-one in practice). */
export const projectPermits = pgTable(
  "project_permits",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.projectId, { onDelete: "cascade" }),
    propertyImprovementId: uuid("property_improvement_id")
      .notNull()
      .references(() => propertyImprovements.propertyImprovementId, {
        onDelete: "cascade",
      }),
  },
  (table) => [
    uniqueIndex("project_permits_pk").on(
      table.projectId,
      table.propertyImprovementId,
    ),
    index("project_permits_permit_idx").on(table.propertyImprovementId),
  ],
);

/**
 * A derived occupancy relationship — "this Business currently occupies this
 * Property." Inferred by comparing the occupying company's name against
 * `ownerships.ownedBy`; not stated directly by any upstream source.
 */
export const tenants = pgTable(
  "tenants",
  {
    tenantId: uuid("tenant_id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.propertyId, { onDelete: "cascade" }),
    businessCompanyId: uuid("business_company_id")
      .notNull()
      .references(() => companies.companyId, { onDelete: "cascade" }),
    occupancyStatus: text("occupancy_status")
      .$type<OccupancyStatus>()
      .notNull(),
    occupancyStartDate: date("occupancy_start_date"),
    occupancyEndDate: date("occupancy_end_date"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("tenants_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("tenants_property_idx").on(table.propertyId),
    index("tenants_business_idx").on(table.businessCompanyId),
  ],
);

export const documentTypeValues = [
  "appraisal_record",
  "permit_filing",
  "deed",
  "sunbiz_registration",
  "bbb_profile",
  "derived_inference",
] as const;
export type DocumentType = (typeof documentTypeValues)[number];

/**
 * The literal "Public Records" entity README.md names alongside Permits/Reviews/etc —
 * one row per distinct source document (sourceSystem + sourceRecordKey pair)
 * encountered during ingestion, citable by its own id. No FK column is added to any
 * adopted or extension table: every table already carries the same
 * (sourceSystem, sourceRecordKey) pair via sourceMetadataColumns(), so citation code
 * joins back to the domain row on that pair at query time instead of requiring a new
 * column on vendored tables. Our own derived rows (projects, tenants) get one of
 * these too, with documentType "derived_inference", so they're citable the same way.
 */
export const publicRecords = pgTable(
  "public_records",
  {
    publicRecordId: uuid("public_record_id").primaryKey().defaultRandom(),
    documentType: text("document_type").$type<DocumentType>().notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("public_records_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
  ],
);
