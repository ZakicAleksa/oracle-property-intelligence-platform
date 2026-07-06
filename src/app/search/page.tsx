"use client";

import { useState } from "react";

import { trpc } from "@/lib/trpc";

export default function SearchPage() {
  const [question, setQuestion] = useState("");
  const [submitted, setSubmitted] = useState("");

  const { data, isLoading, isError, error } = trpc.rag.search.useQuery(
    { question: submitted },
    { enabled: submitted.length > 0 },
  );

  return (
    <div className="p-6 text-sm">
      <h1 className="mb-4 text-xl font-semibold">Semantic Search</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(question);
        }}
        className="mb-4 flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Which contractors have negative BBB ratings?"
          className="flex-1 rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button type="submit" className="rounded bg-black px-4 py-2 text-white dark:bg-white dark:text-black">
          Ask
        </button>
      </form>

      {isLoading && <p>Thinking...</p>}
      {isError && <p className="text-red-600">Error: {error.message}</p>}
      {data !== undefined && (
        <div className="space-y-4">
          <p className="whitespace-pre-wrap">{data.answer}</p>
          {data.citations.length > 0 && (
            <div>
              <h2 className="mb-2 font-semibold">Citations</h2>
              <ul className="space-y-1 text-zinc-600 dark:text-zinc-400">
                {data.citations.map((c) => (
                  <li key={c.index}>
                    [{c.index}] {c.entityType} — source: {c.sourceSystem}:{c.sourceRecordKey} (similarity{" "}
                    {c.similarity.toFixed(3)})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
