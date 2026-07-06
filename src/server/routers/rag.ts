import { embed, generateText } from "ai";
import { cosineDistance, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db";
import { publicProcedure, router } from "../trpc";

const { entityEmbeddings } = schema;

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const CHAT_MODEL = "openai/gpt-4o-mini";

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

      if (matches.length === 0) {
        return {
          answer: "No indexed records were found to answer this question yet.",
          citations: [],
        };
      }

      const context = matches
        .map(
          (m, i) =>
            `[${i + 1}] (${m.entityType}, source: ${m.sourceSystem}:${m.sourceRecordKey}) ${m.content}`,
        )
        .join("\n");

      const { text } = await generateText({
        model: CHAT_MODEL,
        system:
          "You answer questions about Lee County property, permit, contractor, and business data using ONLY the numbered context provided. Cite sources inline using their bracket number, e.g. [1]. If the context doesn't answer the question, say so plainly.",
        prompt: `Context:\n${context}\n\nQuestion: ${input.question}`,
      });

      return {
        answer: text,
        citations: matches.map((m, i) => ({
          index: i + 1,
          entityType: m.entityType,
          entityId: m.entityId,
          sourceSystem: m.sourceSystem,
          sourceRecordKey: m.sourceRecordKey,
          similarity: m.similarity,
        })),
      };
    }),
});
