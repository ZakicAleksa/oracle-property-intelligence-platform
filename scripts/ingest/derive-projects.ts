// Derives `projects`: groups permits on the same property + contractor into
// one project, classifying renovation type by keyword match against
// improvementType/projectDescription text (see projectTypeValues).
//
// Usage: npx tsx scripts/ingest/derive-projects.ts
import { randomUUID } from "node:crypto";

import { db, schema } from "./db.js";

const { propertyImprovements, projects, projectPermits } = schema;

const SOURCE_SYSTEM = "derived_projects";

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
  let created = 0;

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

    const projectId = randomUUID();
    const inserted = await db
      .insert(projects)
      .values({
        projectId,
        propertyId: first.propertyId!,
        contractorCompanyId: first.contractorCompanyId ?? undefined,
        projectType,
        startDate,
        endDate,
        totalEstimatedValue: totalValue > 0 ? String(totalValue) : undefined,
        sourceSystem: SOURCE_SYSTEM,
        sourceRecordKey: key,
        loadedAt: now,
      })
      .onConflictDoNothing({
        target: [projects.sourceSystem, projects.sourceRecordKey],
      })
      .returning({ projectId: projects.projectId });

    const finalProjectId = inserted[0]?.projectId ?? projectId;
    if (inserted[0] !== undefined) created++;

    await db
      .insert(projectPermits)
      .values(
        permitRows.map((r) => ({
          projectId: finalProjectId,
          propertyImprovementId: r.propertyImprovementId,
        })),
      )
      .onConflictDoNothing();
  }

  console.log(
    `Created ${created} projects (${groups.size - created} already existed).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
