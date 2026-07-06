import { embed, generateText } from "ai";
import { cosineDistance, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db";
import { publicProcedure, router } from "../trpc";

const { entityEmbeddings } = schema;

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const CHAT_MODEL = "openai/gpt-4o-mini";

export const ragRouter = router({
  search: publicProcedure
    .input(z.object({ question: z.string().min(1) }))
    .query(async ({ input }) => {
      const { embedding } = await embed({
        model: EMBEDDING_MODEL,
        value: input.question,
      });

      const similarity = sql<number>`1 - (${cosineDistance(entityEmbeddings.embedding, embedding)})`;
      const matches = await db
        .select({
          entityType: entityEmbeddings.entityType,
          entityId: entityEmbeddings.entityId,
          content: entityEmbeddings.content,
          sourceSystem: entityEmbeddings.sourceSystem,
          sourceRecordKey: entityEmbeddings.sourceRecordKey,
          similarity,
        })
        .from(entityEmbeddings)
        .orderBy(sql`${similarity} desc`)
        .limit(8);

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
