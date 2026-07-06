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
      "Finds real properties that currently have more than one open (active) permit. Use this for questions about properties with multiple/several open permits, not vector search, since that requires counting.",
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
          "You answer questions about Lee County property, permit, contractor, and business data. For questions asking to count or filter entities by a condition (e.g. \"properties with multiple open permits\", \"contractors with negative BBB ratings\"), use the available tools to get real, accurate results rather than the numbered context below, which only reflects semantic similarity, not exact counts. For all other questions, answer using ONLY the numbered context provided. Cite sources inline using their bracket number, e.g. [1]. If neither the context nor a tool answers the question, say so plainly.",
        prompt: `Context:\n${context}\n\nQuestion: ${input.question}`,
      });

      const toolCitations = result.toolResults.flatMap((toolResult, stepIndex) => {
        const rows = Array.isArray(toolResult.output) ? toolResult.output : [];
        return rows.map((row: { propertyId?: string; companyId?: string }, rowIndex: number) => ({
          index: matches.length + stepIndex * 100 + rowIndex + 1,
          entityType: toolResult.toolName === "findPropertiesWithMultipleOpenPermits" ? "property" : "contractor",
          entityId: row.propertyId ?? row.companyId ?? "unknown",
          sourceSystem: "structured_query",
          sourceRecordKey: toolResult.toolName,
          similarity: null,
        }));
      });

      return {
        answer: result.text,
        citations: [
          ...matches.map((m, i) => ({
            index: i + 1,
            entityType: m.entityType,
            entityId: m.entityId,
            sourceSystem: m.sourceSystem,
            sourceRecordKey: m.sourceRecordKey,
            similarity: m.similarity as number | null,
          })),
          ...toolCitations,
        ],
      };
    }),
});
