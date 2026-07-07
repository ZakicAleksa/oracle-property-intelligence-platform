// Derives `projects`: groups permits on the same property + contractor into
// one project, classifying renovation type by keyword match against
// improvementType/projectDescription text (see projectTypeValues).
//
// Usage: npx tsx scripts/ingest/derive-projects.ts
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "./db.js";

const { propertyImprovements, projects, projectPermits } = schema;

const SOURCE_SYSTEM = "derived_projects";
const CHUNK_SIZE = 500;

type ProjectType =
  | "roofing"
  | "electrical"
  | "concrete"
  | "structural"
  | "plumbing"
  | "hvac"
  | "other";

const KEYWORD_TO_TYPE: [RegExp, ProjectType][] = [
  [/roof/i, "roofing"],
  [/electric/i, "electrical"],
  [/concrete|slab|foundation/i, "concrete"],
  [/structural|frame|framing/i, "structural"],
  [/plumb/i, "plumbing"],
  [/hvac|air condition|a\/c\b/i, "hvac"],
];

function classify(text: string | null): ProjectType {
  if (text === null) return "other";
  for (const [pattern, type] of KEYWORD_TO_TYPE) {
    if (pattern.test(text)) return type;
  }
  return "other";
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function main(): Promise<void> {
  const rows = await db
    .select({
      propertyImprovementId: propertyImprovements.propertyImprovementId,
      propertyId: propertyImprovements.propertyId,
      contractorCompanyId: propertyImprovements.contractorCompanyId,
      improvementType: propertyImprovements.improvementType,
      projectDescription: propertyImprovements.projectDescription,
      completionDate: propertyImprovements.completionDate,
      estimatedJobValue: propertyImprovements.estimatedJobValue,
    })
    .from(propertyImprovements);

  console.log(`${rows.length} permits to group into projects.`);

  const groups = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) {
    if (row.propertyId === null) continue;
    const key = `${row.propertyId}:${row.contractorCompanyId ?? "none"}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [row]);
    else bucket.push(row);
  }

  console.log(`${groups.size} property+contractor groups.`);

  const now = new Date();

  // Build one project row per group up front. This group's real DB id isn't
  // known yet for groups that already have a project from an earlier run --
  // resolved via a bulk re-select below, the same find-or-create pattern
  // resolveCompanyIds uses, rather than trusting a freshly generated UUID
  // that onConflictDoNothing may have silently skipped inserting (that
  // mismatch was the cause of a real foreign-key violation in
  // project_permits before this fix).
  const projectRows: (typeof projects.$inferInsert)[] = [];
  for (const [key, permitRows] of groups) {
    const first = permitRows[0]!;
    const projectType = classify(
      first.projectDescription ?? first.improvementType,
    );
    const dates = permitRows
      .map((r) => r.completionDate)
      .filter((d): d is string => d !== null);
    const totalValue = permitRows.reduce(
      (sum, r) => sum + Number(r.estimatedJobValue ?? 0),
      0,
    );
    const sortedDates = [...dates].sort();
    const startDate: string | undefined = sortedDates[0];
    const endDate: string | undefined =
      sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : undefined;

    projectRows.push({
      projectId: randomUUID(),
      propertyId: first.propertyId!,
      contractorCompanyId: first.contractorCompanyId ?? undefined,
      projectType,
      startDate,
      endDate,
      totalEstimatedValue: totalValue > 0 ? String(totalValue) : undefined,
      sourceSystem: SOURCE_SYSTEM,
      sourceRecordKey: key,
      loadedAt: now,
    });
  }

  for (const batch of chunk(projectRows, CHUNK_SIZE)) {
    await db
      .insert(projects)
      .values(batch)
      .onConflictDoNothing({
        target: [projects.sourceSystem, projects.sourceRecordKey],
      });
  }

  // Re-select every group's real project_id -- covers both freshly inserted
  // groups and groups that already existed from an earlier run.
  const allKeys = [...groups.keys()];
  const idByKey = new Map<string, string>();
  for (const keyBatch of chunk(allKeys, CHUNK_SIZE)) {
    const resolved = await db
      .select({
        projectId: projects.projectId,
        sourceRecordKey: projects.sourceRecordKey,
      })
      .from(projects)
      .where(
        and(
          eq(projects.sourceSystem, SOURCE_SYSTEM),
          inArray(projects.sourceRecordKey, keyBatch),
        ),
      );
    for (const row of resolved) {
      if (row.sourceRecordKey !== null) {
        idByKey.set(row.sourceRecordKey, row.projectId);
      }
    }
  }

  const created = projectRows.filter(
    (r) => idByKey.get(r.sourceRecordKey!) === r.projectId,
  ).length;

  const permitLinkRows: (typeof projectPermits.$inferInsert)[] = [];
  for (const [key, permitRows] of groups) {
    const projectId = idByKey.get(key);
    if (projectId === undefined) continue;
    for (const r of permitRows) {
      permitLinkRows.push({
        projectId,
        propertyImprovementId: r.propertyImprovementId,
      });
    }
  }

  for (const batch of chunk(permitLinkRows, CHUNK_SIZE)) {
    await db.insert(projectPermits).values(batch).onConflictDoNothing();
  }

  console.log(
    `Created ${created} projects (${groups.size - created} already existed). Linked ${permitLinkRows.length} permit rows.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
