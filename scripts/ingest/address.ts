// Parses Oracle's raw combined street string (e.g. "4815 SHORE LANE") into the
// granular components the adopted `addresses` schema has columns for, and
// computes a normalized key/hash for reliable address matching later (e.g.
// the Tenant-derivation Sunbiz-to-property address join in Phase 3).
//
// Oracle itself never gives granular street components (confirmed directly
// against both the Parquet backbone and the full consolidated JSON — both
// only carry a single combined string), so this parsing is genuinely our own
// work, not something enrichment will fill in for us.
import { createHash } from "node:crypto";
import { parseLocation } from "parse-address";

export type ParsedAddress = {
  streetNumber: string | null;
  streetPreDirectionalText: string | null;
  streetName: string | null;
  streetSuffixType: string | null;
  streetPostDirectionalText: string | null;
  unitIdentifier: string | null;
  normalizedAddressKey: string | null;
  normalizedAddressHash: string | null;
};

const EMPTY: ParsedAddress = {
  streetNumber: null,
  streetPreDirectionalText: null,
  streetName: null,
  streetSuffixType: null,
  streetPostDirectionalText: null,
  unitIdentifier: null,
  normalizedAddressKey: null,
  normalizedAddressHash: null,
};

function buildUnitIdentifier(
  secUnitType?: string,
  secUnitNum?: string,
): string | null {
  const parts = [secUnitType, secUnitNum].filter((part): part is string =>
    Boolean(part),
  );
  return parts.length === 0 ? null : parts.join(" ");
}

function buildNormalizedKey(
  parsed: Pick<
    ParsedAddress,
    | "streetNumber"
    | "streetPreDirectionalText"
    | "streetName"
    | "streetSuffixType"
    | "streetPostDirectionalText"
    | "unitIdentifier"
  >,
  cityName: string | null,
  stateCode: string | null,
  postalCode: string | null,
): string {
  return [
    parsed.streetNumber,
    parsed.streetPreDirectionalText,
    parsed.streetName,
    parsed.streetSuffixType,
    parsed.streetPostDirectionalText,
    parsed.unitIdentifier,
    cityName,
    stateCode,
    postalCode,
  ]
    .map((part) => (part ?? "").trim().toUpperCase())
    .join("|")
    .replace(/\s+/g, " ");
}

/**
 * Parse a raw combined street string plus known city/state/zip into granular
 * address components and a normalized matching key. Returns all-null fields
 * (but not an exception) when `rawStreet` is empty or unparseable — a
 * best-effort heuristic parse, not a guarantee.
 */
export function parseAndNormalizeAddress(
  rawStreet: string | null,
  cityName: string | null,
  stateCode: string | null,
  postalCode: string | null,
): ParsedAddress {
  if (rawStreet === null || rawStreet.trim().length === 0) {
    return EMPTY;
  }

  const parsed = parseLocation(rawStreet);
  if (parsed === undefined || parsed === null) {
    return EMPTY;
  }

  const result: ParsedAddress = {
    streetNumber: parsed.number ?? null,
    streetPreDirectionalText: parsed.prefix ?? null,
    streetName: parsed.street ?? null,
    streetSuffixType: parsed.type ?? null,
    streetPostDirectionalText: parsed.suffix ?? null,
    unitIdentifier: buildUnitIdentifier(
      parsed.sec_unit_type,
      parsed.sec_unit_num,
    ),
    normalizedAddressKey: null,
    normalizedAddressHash: null,
  };

  const normalizedAddressKey = buildNormalizedKey(
    result,
    cityName,
    stateCode,
    postalCode,
  );
  const normalizedAddressHash = createHash("sha256")
    .update(normalizedAddressKey)
    .digest("hex");

  return { ...result, normalizedAddressKey, normalizedAddressHash };
}
