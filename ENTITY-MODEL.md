# Canonical Entity Model

Extends the Elephant Lexicon with the entities this milestone requires. Grounded in two things checked live against the actual system, not assumed: (1) the Lexicon's own schema, queried via the `elephant` MCP's `listClassesByDataGroup`/`listPropertiesByClassName` tools, and (2) a real consolidated property record, fetched via `getOracleProperty`, showing what Oracle has actually already collected.

## Method: reuse vs. extend

Every entity below is marked either **Reuse** (an existing schema already covers it, use as-is) or **New** (no existing schema covers it; this milestone defines it). The **New** entities are the actual deliverable of "extend the Oracle data model using the Elephant Lexicon" — they are not incidental to loading the data, they're the design work the acceptance criteria asks for.

**Two different things are both called "the schema" and must not be conflated:** the **Elephant Lexicon** (the public schema vocabulary, queryable via the MCP's `listClassesByDataGroup`/`listPropertiesByClassName` tools — thin, e.g. `property_improvement` is 17 flat fields) and **`elephant-query-db`** (the company's actual Postgres implementation, public on GitHub at `elephant-xyz/elephant-query-db`, confirmed by reading `src/schema/*.ts` directly). The second is considerably more complete than the first. Entities below reclassified from an earlier draft once this was checked directly rather than assumed.

## Entities

### Property — Reuse (`property` Lexicon class)
Core parcel-level record: `propertyType`, `usageType`, `structureForm`, `buildStatus`, `builtYear`, `effectiveBuiltYear`, `livableArea`, `totalArea`, `zoning`, `legalDescription`, plus related `structure`, `layout`, `lot`, `utility` classes (also reused as-is).

### Parcel — Reuse (`parcel`)
`parcelIdentifier`, `countyName`, `stateCode`. This is the durable key tying every other entity back to a physical property.

### Address / Geometry — Reuse (`address`, `geometry`)
Street/city/state/postal + lat/lng. Used for cross-source matching (e.g. is a Sunbiz business registered at this property's address?).

### Owner — Reuse (`person` / `company`) + ownership relationship (New)
An owner is a `person` or `company` (Lexicon classes). The **ownership relationship** itself — `ownedBy`, `ownershipPercentage`, `ownerOccupied`, `dateAcquired`, `dateSold` — comes straight from Oracle's raw `ownerships[]` array and gives real ownership history for free. `sales_history` and `deed` (both Reuse) provide the underlying transaction trail.

### Tax — Reuse (`tax`, `tax_authority`, `tax_exemption`, `tax_jurisdiction`)
No changes needed.

### Permit — **Reuse (from `elephant-query-db`, not the public Lexicon)**
The public Lexicon's only related class, `property_improvement`, is a 17-field summary shell (`permit_number`, dates, `improvement_type`, `contractor_type`, `fee`, a few booleans) — but `elephant-query-db` already implements the full thing as real tables, confirmed by reading `src/schema/permits.ts`:

| Field group | Real table (`elephant-query-db`) | Contents |
|---|---|---|
| Summary fields | `propertyImprovements` | permit number, improvement status, parcel/property link |
| Contractor identity | `permitContacts` | `contactRole`, `personId`/`companyId` (already structured, not a raw string) — **this is where contractor identity lives** |
| Status history | `permitEvents` | event type + date, mirrors the raw `events[]` we saw |
| Fees | `permitFees` | fee code, assessed vs. paid amounts |
| Inspections | `inspections` | inspection number, permit number, completed date |
| Source links | `permitLinks` | portal/document URLs (provenance) |
| Jurisdiction extras | `permitCustomFields` | field name/value pairs |

Nothing to invent here — adopt these tables as-is. What we still have to do is the *load* work: map Oracle's raw scraped strings (e.g. the unparsed `rawName` contact string) into these already-structured columns.

### Contractor — needs definition, but the identity problem is already solved
No single "Contractor" table exists, but not because the schema is thin — `elephant-query-db` already solves the hard part (durable identity across sources) via shared hub tables: `companies` and `people` (just `{name}`-level identity records) are joined by `companyId`/`personId` from `permitContacts` (contractor on a permit), `businessReputationProfiles` (BBB profile owner), `businessRegistrationParties` (Sunbiz officer/registrant), and `contractorQualityScores` (derived score). A "Contractor" is a `companies` row that has at least one of these joins pointing at it — a view/query over the hub, not a new table.

Oracle's raw scrape still gives us one unparsed string per permit contact that has to be parsed into these already-structured columns, e.g.:

```
"ROY L BENTON III BENTON AND SONS CONSTRUCTION CO INC 1500 COLONIAL BLVD FT MYERS, FL, 33907 Primary Phone: 2392659592 General Contractor CGC1512015"
```

— split into `companies.name`, `permitContacts.personId` (contact person), license number, phone. That parsing is real load-time work; the destination schema for it already exists.

**Durable identity:** the `companies.companyId` hub already *is* the durable ID — no need to invent a licenseNumber-based scheme. Normalized-name matching is only needed at *load time* to decide whether a parsed contractor name resolves to an existing `companies` row or needs a new one.

### Project — **New (confirmed, not assumed)**
Checked directly against both the public Lexicon and the real `elephant-query-db` schema — no grouping concept above individual permits exists in either. Genuine new design work. A derived grouping concept. Definition: one or more Permits on the same Property, same Contractor, clustered in time (same renovation effort spanning e.g. separate electrical/plumbing/structural permits). Implemented in `src/server/schema/extensions.ts` as a `projects` table (`propertyId`, `contractorCompanyId`, inferred `projectType` — roofing/electrical/concrete/structural/plumbing/hvac/other, `startDate`/`endDate` = min/max of constituent permit dates, `totalEstimatedValue` = sum of constituent `estimatedJobValue`) plus a separate `project_permits` join table linking to `propertyImprovements` — deliberately a join table rather than a column added to the adopted `propertyImprovements`, to keep the vendored schema untouched.

This entity is what acceptance criteria like "classify major renovation activity" and "calculate property improvement indicators based on permit history **and project activity**" actually operate on — permit-by-permit isn't the right grain for renovation classification.

### Business — **Reuse (from `elephant-query-db`)**
Not in the public Lexicon, but real in `elephant-query-db`: `businessRegistrations` (document number, entity name, FEI number) + `businessRegistrationAddresses`, `businessRegistrationParties` (officers/registrants, linked to `people`/`companies`), `businessRegistrationAnnualReports`, `businessRegistrationEvents` — confirmed by reading `src/schema/sunbiz.ts`. This is exactly Oracle's raw `sunbizTenants[]` data, already structured. Load work: match Sunbiz registrations to property addresses (populated where a match exists; empty on many properties).

### Tenant — **New (confirmed, not assumed)**
Checked directly against both the public Lexicon (via `listClassesByDataGroup` across all 14 groups) and the real `elephant-query-db` schema (`src/schema/*.ts`) — no occupancy/tenancy concept exists in either. This is genuine new design work, not something we missed. A derived relationship: "this Business currently occupies this Property." The raw data doesn't state this directly; infer it by comparing the occupying Business's name against `ownerships[].ownedBy` — a match means owner-occupied, a mismatch means tenant. Implemented in `src/server/schema/extensions.ts` as a `tenants` table: `propertyId`, `businessCompanyId` (references `companies.companyId`), inferred `occupancyStatus`, `occupancyStartDate`/`occupancyEndDate` where derivable.

### Review, Complaint — **Reuse (from `elephant-query-db`)**
Not in the public Lexicon, but already first-class tables in `elephant-query-db` — confirmed by reading `src/schema/bbb.ts`: `businessReputationProfiles` (the BBB profile itself: `companyId`, `addressId`, `bbbRating`, `ratingScore`) with 13 related sub-tables, notably `businessReputationReviews`, `businessReputationComplaints` + `businessReputationComplaintEvents`, `businessReputationLicenses`, `businessReputationCategories`, `businessReputationRatingReasons`, `businessReputationContacts`, `businessReputationServiceAreas`, `businessReputationLocations`, `businessReputationAlternateNames`, `businessReputationMedia`, `businessReputationExternalLinks`. This maps directly onto Oracle's raw `bbbProfiles[].reviews[]`/`.complaints[]` (e.g. the real complaint we pulled: `complaintType: "Service or Repair Issues"`, `complaintStatus: "Unanswered"`) — nothing to invent, just load into the existing tables.

`contractorQualityScores` (`companyId`, `businessReputationProfileId`, derived score) is also already a real table — the "contractor performance rollup" acceptance criteria has a home already.

### Public Record — **New: a dedicated `public_records` table**
`README.md` names "Public Records" as its own canonical entity, in the same sentence as Permits, Reviews, and the rest — so it gets a real table with its own identity, not just repeated columns. Implemented in `src/server/schema/extensions.ts` as `public_records`: `publicRecordId` (PK), `documentType` (`appraisal_record` | `permit_filing` | `deed` | `sunbiz_registration` | `bbb_profile` | `derived_inference`), `collectedAt` (Oracle's own per-record collection timestamp, a first-class typed column — confirmed live in raw property JSON, e.g. `"collectedAt": "2026-06-25T05:49:06.721Z"`, that had no typed home anywhere else), plus the same `sourceMetadataColumns()` every other table uses (`sourceSystem`, `sourceRecordKey`, `sourceRecordHash`, `sourceArtifactUri`, `loadedAt`).

**No foreign-key column added to any adopted or extension table.** Every table already carries `(sourceSystem, sourceRecordKey)` via `sourceMetadataColumns()`, each already uniquely indexed on that pair — so `public_records` gets one row per distinct pair encountered during ingestion, and citation code (Phase 4) joins back to whichever domain row matches on that same pair at query time. This keeps the vendored `elephant-query-db` schema untouched, same principle as `project_permits` (join table instead of a new column on `propertyImprovements`). Our own derived rows (`projects`, `tenants`) get a `public_records` row too, with `documentType: "derived_inference"`, so they're citable exactly like ingested facts — no special-casing needed at the RAG layer.

## Relationships

```
Property 1──* Ownership *──1 Owner (people | companies)          [dateAcquired/dateSold = ownership history]
Property 1──* Permit (propertyImprovements)                        [via parcelIdentifier]
Permit   1──* permitContacts *──1 companies/people (Contractor)    [contactRole, companyId/personId]
Permit   *──* Project (via project_permits join table)             [derived grouping — New]
Property 1──* Tenant *──1 Business (businessRegistrations)         [derived: New — via address match]
companies (Contractor/Business hub) 1──1 businessReputationProfiles 1──* businessReputationReviews
                                                                    1──* businessReputationComplaints
contractorQualityScores *──1 companies, *──1 businessReputationProfiles
Every table carries (sourceSystem, sourceRecordKey) — joins to public_records on that pair    [citable — New table, see Public Record above]
```

## Durable identifiers

- **Property**: `parcelIdentifier` (already stable per-county).
- **Owner / Contractor / Business**: `companies.companyId` / `people.personId` — the real schema's shared hub tables already are the durable ID. Normalized-name matching is a load-time step to resolve a parsed name to an existing hub row (or create one), not a permanent identity scheme we invent.
- **Permit**: `permitNumber` on `propertyImprovements` (already stable per jurisdiction).
- **Tenant, Project**: synthetic IDs generated at derivation time (no upstream equivalent — confirmed absent from both the Lexicon and `elephant-query-db`).
- **Public Record**: `publicRecordId` — synthetic, but resolvable from any domain row via its `(sourceSystem, sourceRecordKey)` pair.

## Provenance requirements (applies to every entity)

Every table (adopted and our own extensions) carries `sourceSystem`, `sourceRecordKey`, `sourceRecordHash`, `sourceArtifactUri`, `loadedAt` via `elephant-query-db`'s `sourceMetadataColumns()` helper (`schema/shared.ts`) — confirmed real, not proposed. `public_records` (New — see above) is the literal, citable Public Record entity: one row per distinct `(sourceSystem, sourceRecordKey)` pair, carrying `documentType` and Oracle's own `collectedAt` timestamp as first-class columns. This is what makes RAG answers citation-backed rather than opaque. Our new tables (`projects`, `tenants`) use the same `sourceMetadataColumns()` helper — for these derived entities, `sourceSystem` is set to a `derived:*` label (e.g. `derived:project-grouping`) and `sourceRecordKey` to a stable key computed from the constituent rows — and each gets a matching `public_records` row (`documentType: "derived_inference"`) so inferred facts are citable the same way ingested ones are.
