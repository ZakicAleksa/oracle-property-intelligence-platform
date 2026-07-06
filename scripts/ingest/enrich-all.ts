// Combined enrichment: fetches each property's consolidated JSON ONCE and
// loads permits + Sunbiz + BBB from that single fetch (rather than three
// separate full passes re-fetching the same documents). Runs a bounded pool
// of properties concurrently — the first (serial) version measured ~1.9s per
// property, almost entirely spent idle-waiting on network round trips, so
// processing many properties at once cuts wall-clock time roughly in
// proportion to the pool size instead of doing less work per property.
//
// Usage:
//   npx tsx scripts/ingest/enrich-all.ts --file=<parquet-path> --ids-file=<backbone-subset.json> [--limit=N] [--concurrency=15]
import { readFile } from "node:fs/promises";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";

import { loadBbbForProperty } from "./bbb.js";
import { fetchConsolidatedProperty } from "./fetch-property.js";
import { loadPermitsForProperty } from "./permits.js";
import { loadSunbizForProperty } from "./sunbiz.js";

type ParquetRow = {
  property_id: string;
  property_cid: string;
  has_permits: boolean | null;
  has_sunbiz_tenant: boolean | null;
  has_bbb_contractor: boolean | null;
};

function parseArgs(): {
  file: string;
  idsFile: string;
  limit: number | undefined;
  concurrency: number;
} {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, value] = arg.replace(/^--/, "").split("=");
      return [key, value];
    }),
  );

  if (args.file === undefined || args["ids-file"] === undefined) {
    throw new Error(
      "Usage: npx tsx scripts/ingest/enrich-all.ts --file=<path> --ids-file=<path> [--limit=N] [--concurrency=N]",
    );
  }

  return {
    file: args.file,
    idsFile: args["ids-file"],
    limit: args.limit === undefined ? undefined : Number(args.limit),
    concurrency: args.concurrency === undefined ? 15 : Number(args.concurrency),
  };
}

async function processProperty(row: ParquetRow, now: Date): Promise<void> {
  const property = await fetchConsolidatedProperty(row.property_cid);
  await loadPermitsForProperty(row.property_id, property.permits, now);
  await loadSunbizForProperty(row.property_id, property.sunbizTenants, now);
  await loadBbbForProperty(property.bbbProfiles, now);
}

/** Runs `worker` over `items` with at most `concurrency` in flight at once. */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  onDone: (completed: number, total: number) => void,
): Promise<{ succeeded: number; failed: number }> {
  let nextIndex = 0;
  let completed = 0;
  let succeeded = 0;
  let failed = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        await worker(items[index]!, index);
        succeeded++;
      } catch (error) {
        failed++;
        console.error(`Failed on item ${index}:`, error);
      }
      completed++;
      onDone(completed, items.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return { succeeded, failed };
}

async function main(): Promise<void> {
  const { file, idsFile, limit, concurrency } = parseArgs();

  const backboneIds = new Set<string>(JSON.parse(await readFile(idsFile, "utf8")) as string[]);

  console.log(`Reading Parquet file: ${file}`);
  const buffer = await asyncBufferFromFile(file);
  const rows = (await parquetReadObjects({
    file: buffer,
    columns: ["property_id", "property_cid", "has_permits", "has_sunbiz_tenant", "has_bbb_contractor"],
  })) as ParquetRow[];

  const candidates = rows.filter(
    (row) =>
      backboneIds.has(row.property_id) &&
      (Boolean(row.has_permits) || Boolean(row.has_sunbiz_tenant) || Boolean(row.has_bbb_contractor)),
  );
  const selected = limit === undefined ? candidates : candidates.slice(0, limit);
  console.log(
    `${candidates.length} backbone properties have any signal; enriching ${selected.length} with concurrency=${concurrency}.`,
  );

  const now = new Date();
  const start = Date.now();

  const { succeeded, failed } = await runPool(
    selected,
    concurrency,
    (row) => processProperty(row, now),
    (completed, total) => {
      if (completed % 50 === 0 || completed === total) {
        const elapsedSec = (Date.now() - start) / 1000;
        console.log(
          `Processed ${completed} / ${total} (${elapsedSec.toFixed(0)}s elapsed, ${(elapsedSec / completed).toFixed(2)}s/property avg)`,
        );
      }
    },
  );

  console.log(`Enrichment complete: ${succeeded} succeeded, ${failed} failed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
