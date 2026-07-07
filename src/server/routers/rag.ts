import { embed, generateText, stepCountIs, tool } from "ai";
import { cosineDistance, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db";
import { publicProcedure, router } from "../trpc";

const {
  entityEmbeddings,
  properties,
  addresses,
  propertyImprovements,
  companies,
  businessReputationProfiles,
  projects,
  tenants,
} = schema;

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const CHAT_MODEL = "openai/gpt-4o-mini";
const NEGATIVE_BBB_RATINGS = ["F", "D-", "D", "D+", "C-"];

const STOPWORDS = new Set([
  "The",
  "What",
  "Which",
  "Show",
  "Tell",
  "About",
  "With",
  "Have",
  "Their",
  "This",
  "That",
  "There",
  "Boulevard",
  "Street",
  "Avenue",
]);

/**
 * Pure vector similarity under-ranks exact entity mentions when many
 * candidates share similar templated phrasing (confirmed live: a question
 * naming a specific property by address ranked that property's own
 * embedding outside the top 10, behind semantically-similar-but-different
 * properties). Extracts likely proper nouns/numbers (street numbers,
 * capitalized names) from the question and keyword-matches them against
 * content directly, so an exact address/name mention is found regardless
 * of how it ranks by cosine similarity.
 */
function extractKeywordTerms(question: string): string[] {
  const numbers = question.match(/\b\d{3,6}\b/g) ?? [];
  const properNouns = question.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
  const terms = [...numbers, ...properNouns.filter((word) => !STOPWORDS.has(word))];
  return [...new Set(terms)];
}

// Vector similarity matches similar *phrasing*, not entities satisfying a
// numeric condition -- confirmed live that "which properties have multiple
// open permits" returned a confidently wrong "none do" answer even though
// several properties clearly qualify. These tools give the model a real
// structured-query path for count/filter-style questions, reusing the same
// logic the Property/Contractor views already use.
const tools = {
  findPropertiesWithMultipleOpenPermits: tool({
    description:
      "Finds real properties that currently have MORE THAN ONE open permit, of ANY type. Only use this when the question is about a count of open permits in general (e.g. \"multiple open permits\", \"several open permits\"). Do NOT use this for questions about a specific permit type/category like roofing, electrical, or plumbing -- use findPropertiesWithOpenPermitsByType for those instead, even if the word \"multiple\" doesn't appear.",
    inputSchema: z.object({ limit: z.number().min(1).max(20).default(10) }),
    execute: async ({ limit }) => {
      const openPermitCounts = db
        .select({
          propertyId: propertyImprovements.propertyId,
          openCount: sql<number>`count(*) filter (where ${propertyImprovements.improvementStatus} = 'open')`.as(
            "open_count",
          ),
        })
        .from(propertyImprovements)
        .groupBy(propertyImprovements.propertyId)
        .as("open_counts");

      const rows = await db
        .select({
          propertyId: properties.propertyId,
          unnormalizedAddress: addresses.unnormalizedAddress,
          cityName: addresses.cityName,
          openPermitCount: openPermitCounts.openCount,
        })
        .from(properties)
        .innerJoin(openPermitCounts, eq(openPermitCounts.propertyId, properties.propertyId))
        .leftJoin(addresses, eq(properties.addressId, addresses.addressId))
        .where(gt(openPermitCounts.openCount, 1))
        .orderBy(desc(openPermitCounts.openCount))
        .limit(limit);

      return rows;
    },
  }),
  findPropertiesWithOpenPermitsByType: tool({
    description:
      "Finds real properties with at least one CURRENTLY OPEN permit matching a specific type/category, such as roofing, electrical, plumbing, HVAC, or concrete. Use this whenever the question names a specific permit type/category, e.g. \"open roofing permits\", \"open electrical permits\" -- do NOT use findPropertiesWithMultipleOpenPermits for these, since that tool ignores permit type entirely and would silently return the wrong (mislabeled) properties.",
    inputSchema: z.object({
      permitType: z
        .string()
        .describe('The permit type/category to filter by, e.g. "roof", "electrical", "plumbing", "concrete", "hvac".'),
      limit: z.number().min(1).max(20).default(10),
    }),
    execute: async ({ permitType, limit }) => {
      const likePattern = `%${permitType}%`;
      const openPermitTypes = db
        .select({
          propertyId: propertyImprovements.propertyId,
          // Count of open permits matching the requested type specifically,
          // not the property's overall open-permit count -- otherwise the
          // reported number silently answers a different question than the
          // one asked ("how many are open" vs "how many roofing ones are
          // open").
          matchingOpenCount: sql<number>`count(*) filter (where ${propertyImprovements.improvementStatus} = 'open' and ${propertyImprovements.improvementType} ilike ${likePattern})`.as(
            "matching_open_count",
          ),
        })
        .from(propertyImprovements)
        .groupBy(propertyImprovements.propertyId)
        .as("open_permit_types");

      const rows = await db
        .select({
          propertyId: properties.propertyId,
          unnormalizedAddress: addresses.unnormalizedAddress,
          cityName: addresses.cityName,
          matchingOpenPermitCount: openPermitTypes.matchingOpenCount,
        })
        .from(properties)
        .innerJoin(openPermitTypes, eq(openPermitTypes.propertyId, properties.propertyId))
        .leftJoin(addresses, eq(properties.addressId, addresses.addressId))
        .where(gt(openPermitTypes.matchingOpenCount, 0))
        .orderBy(desc(openPermitTypes.matchingOpenCount))
        .limit(limit);

      return rows;
    },
  }),
  findContractorsWithNegativeBbbRating: tool({
    description:
      "Finds real contractors with a negative BBB rating (F, D-, D, D+, or C-). Use this for questions about contractors with poor/negative BBB ratings, not vector search, since that requires filtering by an exact rating value.",
    inputSchema: z.object({ limit: z.number().min(1).max(20).default(10) }),
    execute: async ({ limit }) => {
      const rows = await db
        .select({
          companyId: companies.companyId,
          name: companies.name,
          bbbRating: businessReputationProfiles.bbbRating,
          reviewCount: businessReputationProfiles.reviewCount,
        })
        .from(businessReputationProfiles)
        .innerJoin(companies, eq(companies.companyId, businessReputationProfiles.companyId))
        .where(inArray(businessReputationProfiles.bbbRating, NEGATIVE_BBB_RATINGS))
        .limit(limit);

      return rows;
    },
  }),
  findMostActiveContractorsByProjectCount: tool({
    description:
      "Finds the real contractors with the most derived renovation projects (a project groups related permits on the same property+contractor). Use this for \"most active contractors\" / \"by project count\" questions, not vector search, since that requires a real count across all contractors.",
    inputSchema: z.object({ limit: z.number().min(1).max(20).default(10) }),
    execute: async ({ limit }) => {
      const rows = await db
        .select({
          companyId: companies.companyId,
          name: companies.name,
          projectCount: sql<number>`count(*)`,
        })
        .from(projects)
        .innerJoin(companies, eq(companies.companyId, projects.contractorCompanyId))
        .groupBy(companies.companyId, companies.name)
        .orderBy(desc(sql`count(*)`))
        .limit(limit);

      return rows;
    },
  }),
  findBusinessesAcrossMultipleProperties: tool({
    description:
      "Finds real businesses/tenants that occupy more than one property. Use this for questions about businesses or tenants operating across multiple properties/locations, not vector search, since that requires counting distinct properties per business.",
    inputSchema: z.object({ limit: z.number().min(1).max(20).default(10) }),
    execute: async ({ limit }) => {
      const rows = await db
        .select({
          companyId: companies.companyId,
          name: companies.name,
          propertyCount: sql<number>`count(distinct ${tenants.propertyId})`,
        })
        .from(tenants)
        .innerJoin(companies, eq(companies.companyId, tenants.businessCompanyId))
        .groupBy(companies.companyId, companies.name)
        .having(sql`count(distinct ${tenants.propertyId}) > 1`)
        .orderBy(desc(sql`count(distinct ${tenants.propertyId})`))
        .limit(limit);

      return rows;
    },
  }),
  findOwnersWithMultipleProperties: tool({
    description:
      "Finds real property owners (by name) who are recorded as owning more than one property. Use this for questions about owners associated with multiple properties, not vector search, since that requires counting distinct properties per owner name.",
    inputSchema: z.object({ limit: z.number().min(1).max(20).default(10) }),
    execute: async ({ limit }) => {
      const { ownerships } = schema;
      const rows = await db
        .select({
          ownedBy: ownerships.ownedBy,
          propertyCount: sql<number>`count(distinct ${ownerships.propertyId})`,
          samplePropertyId: sql<string>`min(${ownerships.propertyId}::text)`,
        })
        .from(ownerships)
        .where(sql`${ownerships.ownedBy} IS NOT NULL`)
        .groupBy(ownerships.ownedBy)
        .having(sql`count(distinct ${ownerships.propertyId}) > 1`)
        .orderBy(desc(sql`count(distinct ${ownerships.propertyId})`))
        .limit(limit);

      return rows;
    },
  }),
  findContractorsByWorkType: tool({
    description:
      "Finds real contractors who have performed a specific type/category of work (e.g. roofing, electrical, plumbing), based on their permit history. Use this for questions like \"contractors performing roofing work\" -- do NOT use this for questions about properties, only for questions asking which contractors do a kind of work.",
    inputSchema: z.object({
      workType: z.string().describe('The type of work to filter by, e.g. "roof", "electrical", "plumbing".'),
      limit: z.number().min(1).max(20).default(10),
    }),
    execute: async ({ workType, limit }) => {
      const likePattern = `%${workType}%`;
      const rows = await db
        .select({
          companyId: companies.companyId,
          name: companies.name,
          matchingPermitCount: sql<number>`count(*)`,
        })
        .from(propertyImprovements)
        .innerJoin(companies, eq(companies.companyId, propertyImprovements.contractorCompanyId))
        .where(sql`${propertyImprovements.improvementType} ilike ${likePattern}`)
        .groupBy(companies.companyId, companies.name)
        .orderBy(desc(sql`count(*)`))
        .limit(limit);

      return rows;
    },
  }),
  findPropertiesWithCompletedWorkByType: tool({
    description:
      "Finds real properties with COMPLETED/CLOSED permit work matching a specific type/category (e.g. roof, electrical, plumbing, concrete), ordered by estimated job value (largest first). Use this for questions about finished, historical, or \"major\" renovation work of a specific type -- e.g. \"major roof replacements\", \"large completed electrical projects\" -- as opposed to findPropertiesWithOpenPermitsByType, which is only for permits that are CURRENTLY OPEN.",
    inputSchema: z.object({
      workType: z
        .string()
        .describe('The type of work to filter by, e.g. "roof", "electrical", "plumbing", "concrete".'),
      limit: z.number().min(1).max(20).default(10),
    }),
    execute: async ({ workType, limit }) => {
      const likePattern = `%${workType}%`;
      // The structured estimated_job_value column is populated on only ~3%
      // of permits -- the actual dollar figure almost always lives as
      // scraped free text ("Job Value: 25000") inside improvement_type
      // instead (same messy-source-text quirk documented in PLAN.md).
      // Falling back to a text-extracted value is the difference between
      // this tool ranking by "major" and every row tying at null.
      const effectiveJobValue = sql<number | null>`coalesce(
        (substring(${propertyImprovements.improvementType} from 'Job Value: ([0-9]+)'))::numeric,
        ${propertyImprovements.estimatedJobValue}
      )`;
      // Some properties (mobile home parks, multi-unit sites) have dozens of
      // distinct permits of the same type -- without grouping, a single
      // property can occupy several slots in a top-N ranked list, which
      // reads as duplicate rows. Group by property and surface only its
      // single largest matching job.
      const maxJobValue = sql<number | null>`max(${effectiveJobValue})`;
      const rows = await db
        .select({
          propertyId: properties.propertyId,
          unnormalizedAddress: addresses.unnormalizedAddress,
          cityName: addresses.cityName,
          estimatedJobValue: maxJobValue,
        })
        .from(propertyImprovements)
        .innerJoin(properties, eq(properties.propertyId, propertyImprovements.propertyId))
        .leftJoin(addresses, eq(properties.addressId, addresses.addressId))
        .where(
          sql`${propertyImprovements.improvementStatus} = 'closed' and ${propertyImprovements.improvementType} ilike ${likePattern}`,
        )
        .groupBy(properties.propertyId, addresses.unnormalizedAddress, addresses.cityName)
        .orderBy(sql`${maxJobValue} desc nulls last`)
        .limit(limit);

      return rows;
    },
  }),
  findProjectsByNegativeBbbContractors: tool({
    description:
      "Finds real renovation projects completed by contractors who have a negative BBB rating or complaint history. Use this for questions correlating contractor BBB standing with completed project/renovation work, not vector search, since that requires joining BBB ratings to the projects table.",
    inputSchema: z.object({ limit: z.number().min(1).max(20).default(10) }),
    execute: async ({ limit }) => {
      const rows = await db
        .select({
          companyId: companies.companyId,
          contractorName: companies.name,
          bbbRating: businessReputationProfiles.bbbRating,
          propertyId: projects.propertyId,
          projectType: projects.projectType,
        })
        .from(projects)
        .innerJoin(companies, eq(companies.companyId, projects.contractorCompanyId))
        .innerJoin(businessReputationProfiles, eq(businessReputationProfiles.companyId, companies.companyId))
        .where(inArray(businessReputationProfiles.bbbRating, NEGATIVE_BBB_RATINGS))
        .limit(limit);

      return rows;
    },
  }),
};

export const ragRouter = router({
  search: publicProcedure
    .input(z.object({ question: z.string().min(1) }))
    .query(async ({ input }) => {
      const { embedding } = await embed({
        model: EMBEDDING_MODEL,
        value: input.question,
      });

      const similarity = sql<number>`1 - (${cosineDistance(entityEmbeddings.embedding, embedding)})`;
      const vectorMatches = await db
        .select({ entityId: entityEmbeddings.entityId, entityType: entityEmbeddings.entityType })
        .from(entityEmbeddings)
        .orderBy(sql`${similarity} desc`)
        .limit(8);

      const keywordTerms = extractKeywordTerms(input.question);
      const keywordMatches =
        keywordTerms.length > 0
          ? await db
              .select({ entityId: entityEmbeddings.entityId, entityType: entityEmbeddings.entityType })
              .from(entityEmbeddings)
              .where(or(...keywordTerms.map((term) => sql`${entityEmbeddings.content} ILIKE ${"%" + term + "%"}`)))
              .limit(8)
          : [];

      const uniqueIds = [
        ...new Map(
          [...vectorMatches, ...keywordMatches].map((m) => [`${m.entityType}:${m.entityId}`, m]),
        ).values(),
      ];

      const matches =
        uniqueIds.length > 0
          ? await db
              .select({
                entityType: entityEmbeddings.entityType,
                entityId: entityEmbeddings.entityId,
                content: entityEmbeddings.content,
                sourceSystem: entityEmbeddings.sourceSystem,
                sourceRecordKey: entityEmbeddings.sourceRecordKey,
                similarity,
              })
              .from(entityEmbeddings)
              .where(
                inArray(
                  entityEmbeddings.entityId,
                  uniqueIds.map((m) => m.entityId),
                ),
              )
              .orderBy(sql`${similarity} desc`)
          : [];

      const context =
        matches.length > 0
          ? matches
              .map(
                (m, i) =>
                  `[${i + 1}] (${m.entityType}, source: ${m.sourceSystem}:${m.sourceRecordKey}) ${m.content}`,
              )
              .join("\n")
          : "(no semantically similar records found)";

      const result = await generateText({
        model: CHAT_MODEL,
        tools,
        stopWhen: stepCountIs(3),
        system:
          "You answer questions about Lee County property, permit, contractor, and business data. For questions asking to count, rank, or filter entities by a condition (e.g. \"properties with multiple open permits\", \"open roofing permits\", \"contractors with negative BBB ratings\", \"most active contractors\", \"owners with multiple properties\", \"businesses across multiple properties\", \"projects by contractors with negative BBB ratings\", \"major roof replacements\", \"large completed electrical projects\"), use the available tools to get real, accurate results rather than the numbered context below, which only reflects semantic similarity, not exact counts, types, or rankings. Read each tool's description carefully and pick the one that actually matches the condition asked about -- a question naming a specific permit type/category or work type must use the type-specific tool, never the generic one, even if it doesn't literally say \"multiple\"; a question about COMPLETED/historical/\"major\" work of a type must use findPropertiesWithCompletedWorkByType, never findPropertiesWithOpenPermitsByType, which only covers currently-open permits. Never relabel one tool's results as answering a different condition than what it actually filtered on. For all other questions, answer using ONLY the numbered context provided. Cite sources inline using their bracket number, e.g. [1]. If neither the context nor a tool answers the question, say so plainly.",
        prompt: `Context:\n${context}\n\nQuestion: ${input.question}`,
      });

      const TOOL_ENTITY_TYPES: Record<string, "property" | "contractor"> = {
        findPropertiesWithMultipleOpenPermits: "property",
        findPropertiesWithOpenPermitsByType: "property",
        findContractorsWithNegativeBbbRating: "contractor",
        findMostActiveContractorsByProjectCount: "contractor",
        findBusinessesAcrossMultipleProperties: "contractor",
        findOwnersWithMultipleProperties: "property",
        findContractorsByWorkType: "contractor",
        findProjectsByNegativeBbbContractors: "contractor",
        findPropertiesWithCompletedWorkByType: "property",
      };
      // A tool call means the answer was built from real structured-query
      // rows, not the vector-similarity context (the system prompt tells the
      // model to prefer tools "rather than the numbered context below" for
      // exactly these questions) -- citing both muddies source attribution,
      // e.g. an unrelated semantically-similar entity showing up alongside
      // the real ranked list. Cite only whichever path actually produced the
      // answer.
      const usedTools = result.toolResults.length > 0;
      let nextCitationIndex = 1;
      const toolCitations = result.toolResults.flatMap((toolResult) => {
        const rows = Array.isArray(toolResult.output) ? toolResult.output : [];
        return rows.map(
          (row: { propertyId?: string; companyId?: string; samplePropertyId?: string; ownedBy?: string }) => ({
            index: nextCitationIndex++,
            entityType: TOOL_ENTITY_TYPES[toolResult.toolName] ?? "property",
            entityId: row.propertyId ?? row.companyId ?? row.samplePropertyId ?? row.ownedBy ?? "unknown",
            sourceSystem: "structured_query",
            sourceRecordKey: toolResult.toolName,
            similarity: null,
          }),
        );
      });

      return {
        answer: result.text,
        citations: usedTools
          ? toolCitations
          : matches.map((m, i) => ({
              index: i + 1,
              entityType: m.entityType,
              entityId: m.entityId,
              sourceSystem: m.sourceSystem,
              sourceRecordKey: m.sourceRecordKey,
              similarity: m.similarity as number | null,
            })),
      };
    }),
});
