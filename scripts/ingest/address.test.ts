import { describe, expect, it } from "vitest";

import { parseAndNormalizeAddress } from "./address.js";

describe("parseAndNormalizeAddress", () => {
  it("returns all-null fields for a null street", () => {
    const result = parseAndNormalizeAddress(null, "FORT MYERS", "FL", "33901");
    expect(result.streetNumber).toBeNull();
    expect(result.normalizedAddressKey).toBeNull();
    expect(result.normalizedAddressHash).toBeNull();
  });

  it("returns all-null fields for a blank street", () => {
    const result = parseAndNormalizeAddress("   ", "FORT MYERS", "FL", "33901");
    expect(result.normalizedAddressKey).toBeNull();
  });

  it("parses a standard street address into granular components", () => {
    const result = parseAndNormalizeAddress(
      "2301 SHORE LANE",
      "BOCA GRANDE",
      "FL",
      "33921",
    );
    expect(result.streetNumber).toBe("2301");
    expect(result.streetName).toBe("SHORE");
    expect(result.normalizedAddressKey).not.toBeNull();
    expect(result.normalizedAddressHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("captures a unit identifier when an explicit designator is present", () => {
    const result = parseAndNormalizeAddress(
      "16230 KELLY COVE DRIVE UNIT 219",
      "FORT MYERS",
      "FL",
      "33908",
    );
    expect(result.unitIdentifier).toBe("UNIT 219");
  });

  it("produces an identical normalized key and hash for case-only differences", () => {
    const upper = parseAndNormalizeAddress(
      "4815 SHORE LANE",
      "BOCA GRANDE",
      "FL",
      "33921",
    );
    const lower = parseAndNormalizeAddress(
      "4815 shore lane",
      "boca grande",
      "fl",
      "33921",
    );
    expect(upper.normalizedAddressKey).toBe(lower.normalizedAddressKey);
    expect(upper.normalizedAddressHash).toBe(lower.normalizedAddressHash);
  });

  it("produces different keys for different addresses", () => {
    const a = parseAndNormalizeAddress("2301 SHORE LANE", "BOCA GRANDE", "FL", "33921");
    const b = parseAndNormalizeAddress("2925 SHORE LANE", "BOCA GRANDE", "FL", "33921");
    expect(a.normalizedAddressHash).not.toBe(b.normalizedAddressHash);
  });
});
