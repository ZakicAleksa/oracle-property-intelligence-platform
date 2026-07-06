// Selects a stratified backbone subset instead of "first N rows" (which turns
// out to be geographically skewed — the Parquet is clustered by parcel
// identifier, not shuffled). Guarantees every city gets representation
// (proportional to its share, with a floor so small cities aren't zeroed
// out), and within each city's allocation, prioritizes properties with
// has_permits/has_sunbiz_tenant/has_bbb_contractor signal — since the later
// enrichment pass draws its candidates from whatever's in the backbone.
//
// Usage:
//   npx tsx scripts/ingest/select-subset.ts --file=<parquet-path> --target=100000 --out=<json-path>
import { writeFile } from "node:fs/promises";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";

type SelectionRow = {
  property_id: string;
  address_city: string | null;
  has_permits: boolean | null;
  has_sunbiz_tenant: boolean | null;
  has_bbb_contractor: boolean | null;
};

function parseArgs(): { file: string; target: number; out: string } {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, value] = arg.replace(/^--/, "").split("=");
      return [key, value];
    }),
  );

  if (args.file === undefined || args.out === undefined) {
    throw new Error(
      "Usage: npx tsx scripts/ingest/select-subset.ts --file=<path> --target=N --out=<path>",
    );
  }

  return {
    file: args.file,
    target: Number(args.target ?? 100000),
    out: args.out,
  };
}

function hasSignal(row: SelectionRow): boolean {
  return (
    Boolean(row.has_permits) ||
    Boolean(row.has_sunbiz_tenant) ||
    Boolean(row.has_bbb_contractor)
  );
}

async function main(): Promise<void> {
  const { file, target, out } = parseArgs();

  console.log(`Reading Parquet file: ${file}`);
  const buffer = await asyncBufferFromFile(file);
  const rows = (await parquetReadObjects({
    file: buffer,
    columns: [
      "property_id",
      "address_city",
      "has_permits",
      "has_sunbiz_tenant",
      "has_bbb_contractor",
    ],
  })) as SelectionRow[];
  console.log(`Loaded ${rows.length} rows.`);

  const byCity = new Map<string, SelectionRow[]>();
  for (const row of rows) {
    const city = row.address_city ?? "UNKNOWN";
    const bucket = byCity.get(city);
    if (bucket === undefined) {
      byCity.set(city, [row]);
    } else {
      bucket.push(row);
    }
  }

  const cityCount = byCity.size;
  const floorPerCity = Math.max(50, Math.floor(target * 0.1) / cityCount);
  const selected: string[] = [];
  let signalCount = 0;

  for (const [, cityRows] of byCity) {
    const proportionalShare = Math.round(
      (cityRows.length / rows.length) * target,
    );
    const takeCount = Math.min(
      cityRows.length,
      Math.max(floorPerCity, proportionalShare),
    );

    // Signal-bearing rows first, so they're prioritized within this city's allocation.
    const sorted = [...cityRows].sort(
      (a, b) => Number(hasSignal(b)) - Number(hasSignal(a)),
    );
    const take = sorted.slice(0, takeCount);

    for (const row of take) {
      selected.push(row.property_id);
      if (hasSignal(row)) signalCount++;
    }
  }

  console.log(
    `Selected ${selected.length} properties across ${cityCount} cities ` +
      `(${signalCount} with permit/Sunbiz/BBB signal, ${((signalCount / selected.length) * 100).toFixed(1)}%).`,
  );

  await writeFile(out, JSON.stringify(selected));
  console.log(`Wrote selection to ${out}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
