// Phase 3 backbone load: reads the full Lee County property Parquet export and
// loads every property skeletally (parcel/address/property/current-owner/last-sale)
// plus one public_records row per property. Full enrichment (permits, Sunbiz,
// BBB, tenants, projects) is a separate pass over a bounded subset — see
// PLAN.md Phase 3.
//
// Usage:
//   npx tsx scripts/ingest/backbone.ts --file=<path-to-parquet> [--limit=1000]
import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";

import { parseAndNormalizeAddress } from "./address.js";
import { db, schema } from "./db.js";

const {
  addresses,
  parcels,
  properties,
  ownerships,
  salesHistories,
  publicRecords,
} = schema;

const SOURCE_SYSTEM = "lee_appraiser";
const BATCH_SIZE = 1000;

type ParquetRow = {
  property_id: string;
  property_cid: string;
  parcel_identifier: string;
  state_code: string | null;
  address_street: string | null;
  address_city: string | null;
  address_zip: string | null;
  latitude: number | null;
  longitude: number | null;
  property_type: string | null;
  property_usage_type: string | null;
  built_year: bigint | null;
  livable_floor_area: number | null;
  total_area: number | null;
  owner_name: string | null;
  last_sale_date: unknown;
  last_sale_price: number | null;
  subdivision: string | null;
};

function excluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

function parseArgs(): {
  file: string;
  limit: number | undefined;
  idsFile: string | undefined;
} {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, value] = arg.replace(/^--/, "").split("=");
      return [key, value];
    }),
  );

  if (args.file === undefined) {
    throw new Error(
      "Usage: npx tsx scripts/ingest/backbone.ts --file=<path> [--limit=N] [--ids-file=<path>]",
    );
  }

  return {
    file: args.file,
    limit: args.limit === undefined ? undefined : Number(args.limit),
    idsFile: args["ids-file"],
  };
}

function toDateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function toNumericString(value: number | null): string | null {
  return value === null || value === undefined ? null : String(value);
}

async function lookupAddressIds(
  propertyIds: string[],
): Promise<Map<string, string>> {
  const rows = await db
    .select({ key: addresses.sourceRecordKey, id: addresses.addressId })
    .from(addresses)
    .where(inArray(addresses.sourceRecordKey, propertyIds));
  return new Map(rows.map((row) => [row.key, row.id]));
}

async function lookupParcelIds(
  parcelIdentifiers: string[],
): Promise<Map<string, string>> {
  const rows = await db
    .select({ key: parcels.sourceRecordKey, id: parcels.parcelId })
    .from(parcels)
    .where(inArray(parcels.sourceRecordKey, parcelIdentifiers));
  return new Map(rows.map((row) => [row.key, row.id]));
}

async function loadBatch(batch: ParquetRow[], now: Date): Promise<void> {
  await db
    .insert(addresses)
    .values(
      batch.map((row) => {
        const parsed = parseAndNormalizeAddress(
          row.address_street,
          row.address_city,
          row.state_code,
          row.address_zip,
        );
        return {
          addressId: randomUUID(),
          cityName: row.address_city,
          stateCode: row.state_code,
          postalCode: row.address_zip,
          latitude: toNumericString(row.latitude),
          longitude: toNumericString(row.longitude),
          unnormalizedAddress: row.address_street,
          streetNumber: parsed.streetNumber,
          streetPreDirectionalText: parsed.streetPreDirectionalText,
          streetName: parsed.streetName,
          streetSuffixType: parsed.streetSuffixType,
          streetPostDirectionalText: parsed.streetPostDirectionalText,
          unitIdentifier: parsed.unitIdentifier,
          normalizedAddressKey: parsed.normalizedAddressKey,
          normalizedAddressHash: parsed.normalizedAddressHash,
          sourceSystem: SOURCE_SYSTEM,
          sourceRecordKey: row.property_id,
          loadedAt: now,
        };
      }),
    )
    .onConflictDoUpdate({
      target: [addresses.sourceSystem, addresses.sourceRecordKey],
      set: {
        cityName: excluded("city_name"),
        stateCode: excluded("state_code"),
        postalCode: excluded("postal_code"),
        latitude: excluded("latitude"),
        longitude: excluded("longitude"),
        unnormalizedAddress: excluded("unnormalized_address"),
        streetNumber: excluded("street_number"),
        streetPreDirectionalText: excluded("street_pre_directional_text"),
        streetName: excluded("street_name"),
        streetSuffixType: excluded("street_suffix_type"),
        streetPostDirectionalText: excluded("street_post_directional_text"),
        unitIdentifier: excluded("unit_identifier"),
        normalizedAddressKey: excluded("normalized_address_key"),
        normalizedAddressHash: excluded("normalized_address_hash"),
        loadedAt: excluded("loaded_at"),
        updatedAt: now,
      },
    });

  // Multiple properties can share one parcel (e.g. multiple units/buildings on
  // the same parcel), so dedupe by parcel_identifier before inserting — a
  // single INSERT ... ON CONFLICT can't target the same row twice.
  const uniqueParcelRows = [
    ...new Map(batch.map((row) => [row.parcel_identifier, row])).values(),
  ];

  await db
    .insert(parcels)
    .values(
      uniqueParcelRows.map((row) => ({
        parcelId: randomUUID(),
        parcelIdentifier: row.parcel_identifier,
        countyName: "Lee",
        stateCode: row.state_code,
        jurisdictionKey: SOURCE_SYSTEM,
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: row.parcel_identifier,
        loadedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [parcels.sourceSystem, parcels.sourceRecordKey],
      set: {
        countyName: excluded("county_name"),
        stateCode: excluded("state_code"),
        jurisdictionKey: excluded("jurisdiction_key"),
        loadedAt: excluded("loaded_at"),
        updatedAt: now,
      },
    });

  // Re-read the ids we just wrote (rather than trusting the UUIDs generated
  // above), since a re-run hits onConflictDoUpdate and keeps each row's
  // *original* id from the first run, not the one generated this time.
  const addressIdByPropertyId = await lookupAddressIds(
    batch.map((row) => row.property_id),
  );
  const parcelIdByParcelIdentifier = await lookupParcelIds(
    batch.map((row) => row.parcel_identifier),
  );

  await db
    .insert(properties)
    .values(
      batch.map((row) => ({
        propertyId: row.property_id,
        parcelId: parcelIdByParcelIdentifier.get(row.parcel_identifier) ?? null,
        addressId: addressIdByPropertyId.get(row.property_id) ?? null,
        parcelIdentifier: row.parcel_identifier,
        propertyType: row.property_type,
        propertyUsageType: row.property_usage_type,
        propertyStructureBuiltYear:
          row.built_year === null ? null : Number(row.built_year),
        livableFloorArea: toNumericString(row.livable_floor_area),
        totalArea: toNumericString(row.total_area),
        subdivision: row.subdivision,
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: row.property_id,
        loadedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [properties.propertyId],
      set: {
        parcelId: excluded("parcel_id"),
        addressId: excluded("address_id"),
        propertyType: excluded("property_type"),
        propertyUsageType: excluded("property_usage_type"),
        propertyStructureBuiltYear: excluded("property_structure_built_year"),
        livableFloorArea: excluded("livable_floor_area"),
        totalArea: excluded("total_area"),
        subdivision: excluded("subdivision"),
        loadedAt: excluded("loaded_at"),
        updatedAt: now,
      },
    });

  const ownershipRows = batch
    .filter((row) => row.owner_name !== null)
    .map((row) => ({
      propertyId: row.property_id,
      ownedBy: row.owner_name,
      sourceSystem: SOURCE_SYSTEM,
      sourceRecordKey: row.property_id,
      loadedAt: now,
    }));

  if (ownershipRows.length > 0) {
    await db
      .insert(ownerships)
      .values(ownershipRows)
      .onConflictDoUpdate({
        target: [ownerships.sourceSystem, ownerships.sourceRecordKey],
        set: {
          ownedBy: excluded("owned_by"),
          loadedAt: excluded("loaded_at"),
          updatedAt: now,
        },
      });
  }

  const saleRows = batch
    .map((row) => ({
      propertyId: row.property_id,
      ownershipTransferDate: toDateOnly(row.last_sale_date),
      purchasePriceAmount: toNumericString(row.last_sale_price),
      sourceSystem: SOURCE_SYSTEM,
      sourceRecordKey: row.property_id,
      loadedAt: now,
    }))
    .filter((row) => row.ownershipTransferDate !== null);

  if (saleRows.length > 0) {
    await db
      .insert(salesHistories)
      .values(saleRows)
      .onConflictDoUpdate({
        target: [salesHistories.sourceSystem, salesHistories.sourceRecordKey],
        set: {
          ownershipTransferDate: excluded("ownership_transfer_date"),
          purchasePriceAmount: excluded("purchase_price_amount"),
          loadedAt: excluded("loaded_at"),
          updatedAt: now,
        },
      });
  }

  await db
    .insert(publicRecords)
    .values(
      batch.map((row) => ({
        documentType: "appraisal_record" as const,
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: row.property_id,
        sourceArtifactUri: `ipfs://${row.property_cid}`,
        loadedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [publicRecords.sourceSystem, publicRecords.sourceRecordKey],
      set: {
        sourceArtifactUri: excluded("source_artifact_uri"),
        loadedAt: excluded("loaded_at"),
      },
    });
}

async function main(): Promise<void> {
  const { file, limit, idsFile } = parseArgs();

  console.log(`Reading Parquet file: ${file}`);
  const buffer = await asyncBufferFromFile(file);
  const rows = (await parquetReadObjects({ file: buffer })) as ParquetRow[];

  let selected = rows;
  if (idsFile !== undefined) {
    const { readFile } = await import("node:fs/promises");
    const ids = new Set<string>(
      JSON.parse(await readFile(idsFile, "utf8")) as string[],
    );
    selected = rows.filter((row) => ids.has(row.property_id));
  }
  if (limit !== undefined) {
    selected = selected.slice(0, limit);
  }
  console.log(
    `Loaded ${rows.length} rows from Parquet, processing ${selected.length}.`,
  );

  const now = new Date();

  for (let start = 0; start < selected.length; start += BATCH_SIZE) {
    const batch = selected.slice(start, start + BATCH_SIZE);
    await loadBatch(batch, now);
    console.log(
      `Processed ${Math.min(start + BATCH_SIZE, selected.length)} / ${selected.length} properties`,
    );
  }

  console.log("Backbone load complete.");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
