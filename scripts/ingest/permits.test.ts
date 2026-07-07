import { describe, expect, it } from "vitest";

import { chunk, deriveImprovementStatus } from "./permits.js";

describe("chunk", () => {
  it("returns an empty array for an empty input", () => {
    expect(chunk([], 500)).toEqual([]);
  });

  it("returns a single chunk when items fit within the size", () => {
    expect(chunk([1, 2, 3], 500)).toEqual([[1, 2, 3]]);
  });

  it("splits items into multiple chunks of the given size", () => {
    const items = Array.from({ length: 1200 }, (_, i) => i);
    const chunks = chunk(items, 500);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(500);
    expect(chunks[1]).toHaveLength(500);
    expect(chunks[2]).toHaveLength(200);
  });

  it("preserves item order and never drops or duplicates items", () => {
    const items = Array.from({ length: 1543 }, (_, i) => i);
    const chunks = chunk(items, 500);
    expect(chunks.flat()).toEqual(items);
  });
});

describe("deriveImprovementStatus", () => {
  it("returns null for a null recordStatus", () => {
    expect(deriveImprovementStatus(null)).toBeNull();
  });

  it.each(["Closed", "CLOSED - Finaled", "Void", "closed/finaled"])(
    "classifies %s as closed",
    (status) => {
      expect(deriveImprovementStatus(status)).toBe("closed");
    },
  );

  it.each(["Open", "Issued", "Active", "OPEN - Under Review"])(
    "classifies %s as open",
    (status) => {
      expect(deriveImprovementStatus(status)).toBe("open");
    },
  );

  it("classifies unrecognized status text as unknown", () => {
    expect(deriveImprovementStatus("Pending Review")).toBe("unknown");
  });
});
