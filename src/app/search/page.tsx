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
    <div className="mx-auto max-w-3xl px-6 py-10 text-sm">
      <p className="eyebrow mb-2">Semantic Search</p>
      <h1 className="mb-6 text-2xl font-semibold">Ask the record</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(question);
        }}
        className="mb-8 flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Which contractors have negative BBB ratings?"
          className="flex-1 border border-line bg-paper-raised px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-stamp-closed"
        />
        <button
          type="submit"
          className="border border-ink bg-ink px-4 py-2 text-paper hover:opacity-90"
        >
          Ask
        </button>
      </form>

      {isLoading && <p className="text-ink-muted">Searching the record...</p>}
      {isError && <p className="text-stamp-open">{error.message}</p>}

      {data !== undefined && (
        <div className="fade-in space-y-6">
          <div className="border border-line bg-paper-raised p-5">
            <p className="eyebrow mb-2">Answer</p>
            <p className="whitespace-pre-wrap">{data.answer}</p>
          </div>

          {data.citations.length > 0 && (
            <div>
              <p className="eyebrow mb-3 border-b border-line pb-2">
                Citations
              </p>
              <ul className="space-y-2">
                {data.citations.map((c) => (
                  <li key={c.index} className="flex items-center gap-3">
                    <span className="stamp stamp-neutral">
                      [{c.index}] {c.sourceSystem}:
                      {c.sourceRecordKey.slice(0, 16)}
                      {c.sourceRecordKey.length > 16 && "…"}
                    </span>
                    <span className="eyebrow">
                      {c.similarity !== null ? `similarity ${c.similarity.toFixed(3)}` : "structured query"}
                    </span>
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
