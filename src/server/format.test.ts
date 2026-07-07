import { describe, expect, it } from "vitest";

import { cleanImprovementTypeLabel } from "./format";

describe("cleanImprovementTypeLabel", () => {
  it("returns null for null input", () => {
    expect(cleanImprovementTypeLabel(null)).toBeNull();
  });

  it("leaves an already-short, clean label unchanged", () => {
    expect(cleanImprovementTypeLabel("Electrical")).toBe("Electrical");
    expect(cleanImprovementTypeLabel("Demolition")).toBe("Demolition");
  });

  it("strips the leading garbled 'of <Field>:' prefix and cuts at the next label boundary", () => {
    expect(
      cleanImprovementTypeLabel(
        "of Permit: Fence Construction Value: 900 Directions: PINE ISLAND RD LT BETSY LN LT ON PINE ISLAND RD NW 239-283-7166 Parcel Information",
      ),
    ).toBe("Fence Construction Value");
  });

  it("handles the 'of Use:' variant", () => {
    expect(
      cleanImprovementTypeLabel(
        "of Use: COMMERCIAL Current Use: RESTAURANT Proposed Use: RESTAURANT Estimated Building SQFT: 4000",
      ),
    ).toBe("COMMERCIAL Current Use");
  });

  it("never returns a value longer than the length cap", () => {
    const result = cleanImprovementTypeLabel(
      "of Use: COMMERCIAL Estimated Building SQFT: 20655 Est Const. Value: 850508 DO #: 6-20-92 Directions: a very long directions field that goes on and on",
    );
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(61); // 60 chars + possible ellipsis
  });

  it("falls back to 'Other' if stripping the prefix leaves nothing usable", () => {
    expect(cleanImprovementTypeLabel("of Permit: : ")).toBe("Other");
  });
});
