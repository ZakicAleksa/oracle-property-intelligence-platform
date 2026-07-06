// Phase 3 enrichment: for a bounded subset of the already-loaded backbone
// properties, fetch the full consolidated JSON (by CID, direct IPFS — no MCP
// dependency) and load permits/contractors. Sunbiz and BBB enrichment follow
// the same pattern in separate passes — see PLAN.md Phase 3.
//
// Usage:
//   npx tsx scripts/ingest/enrich.ts --file=<parquet-path> --ids-file=<backbone-subset.json> [--limit=N]
import { readFile } from "node:fs/promises";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";

import { fetchConsolidatedProperty } from "./fetch-property.js";
import { loadPermitsForProperty } from "./permits.js";

type ParquetRow = {
  property_id: string;
  property_cid: string;
  has_permits: boolean | null;
};

function parseArgs(): {
  file: string;
  idsFile: string;
  limit: number | undefined;
} {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, value] = arg.replace(/^--/, "").split("=");
      return [key, value];
    }),
  );

  if (args.file === undefined || args["ids-file"] === undefined) {
    throw new Error(
      "Usage: npx tsx scripts/ingest/enrich.ts --file=<path> --ids-file=<path> [--limit=N]",
    );
  }

  return {
    file: args.file,
    idsFile: args["ids-file"],
    limit: args.limit === undefined ? undefined : Number(args.limit),
  };
}

async function main(): Promise<void> {
  const { file, idsFile, limit } = parseArgs();

  const backboneIds = new Set<string>(
    JSON.parse(await readFile(idsFile, "utf8")) as string[],
  );

  console.log(`Reading Parquet file: ${file}`);
  const buffer = await asyncBufferFromFile(file);
  const rows = (await parquetReadObjects({
    file: buffer,
    columns: ["property_id", "property_cid", "has_permits"],
  })) as ParquetRow[];

  const candidates = rows.filter(
    (row) => backboneIds.has(row.property_id) && Boolean(row.has_permits),
  );
  const selected =
    limit === undefined ? candidates : candidates.slice(0, limit);
  console.log(
    `${candidates.length} backbone properties have permit signal; enriching ${selected.length}.`,
  );

  const now = new Date();
  let succeeded = 0;
  let failed = 0;

  for (const [index, row] of selected.entries()) {
    try {
      const property = await fetchConsolidatedProperty(row.property_cid);
      await loadPermitsForProperty(row.property_id, property.permits, now);
      succeeded++;
    } catch (error) {
      failed++;
      console.error(
        `Failed to enrich ${row.property_id} (cid ${row.property_cid}):`,
        error,
      );
    }

    if ((index + 1) % 50 === 0 || index + 1 === selected.length) {
      console.log(
        `Processed ${index + 1} / ${selected.length} (${succeeded} ok, ${failed} failed)`,
      );
    }
  }

  console.log(
    `Permit enrichment complete: ${succeeded} succeeded, ${failed} failed.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
