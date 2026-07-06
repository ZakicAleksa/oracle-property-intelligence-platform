// Oracle's raw permit contact strings embed phone/license/address in one
// unparsed blob, e.g. "K. Galloway Galloway Roofing, LLC 7253 Gasparilla Rd.
// Unit# 1 Port Charlotte, FL, 33981 Primary Phone: 9416973737 ... CCC1328485"
// — even though the adopted schema has dedicated phone/email/licenseNumber
// columns, Oracle's own scrape leaves them null. This is a best-effort v1
// extractor (regex-based), not a full NLP name parser.
//
// Matching uses a sorted-token fingerprint rather than the literal cleaned
// string, because the same real contractor's "Applicant" and "Licensed
// Professional" contacts often list person-name and company-name in
// different order (confirmed live: "ROBERT S MILLER GRANDE AIRE SERVICES
// INC" vs "GRANDE AIRE SERVICES INC ROBERT S MILLER" — same words, different
// order). Sorting the words makes both produce the same key.
//
// Known limitation, not solved here: abbreviated name variants ("K.
// Galloway" vs "KENNETH D GALLOWAY") still won't merge — that needs real
// fuzzy/NLP name matching, out of scope for this pass. Revisit if
// fragmentation turns out to hurt the Contractor View.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db, schema } from "./db.js";

const { companies } = schema;

const PHONE_PATTERN = /(?:Phone|Cell Phone|Alternate Phone|Fax):\s*(\d{10})/i;
const LICENSE_PATTERN = /\b([A-Z]{2,3}\d{6,9})\b/;
const EMAIL_PATTERN = /[\w.-]+@[\w.-]+\.\w+/;
// Marks where the street-address portion begins: a leading street number
// ("7253 Gasparilla Rd"), or a PO Box. Cut here — everything from this point
// on is address/phone/license noise, not part of the name.
const ADDRESS_START_PATTERN = /\b(?:\d{1,6}\s+\S|P\.?\s?O\.?\s*BOX\s*\d+)/i;

export type ParsedContact = {
  cleanedName: string | null;
  phone: string | null;
  email: string | null;
  licenseNumber: string | null;
};

export function parseContactRawName(rawName: string | null): ParsedContact {
  if (rawName === null || rawName.trim().length === 0) {
    return { cleanedName: null, phone: null, email: null, licenseNumber: null };
  }

  const phone = rawName.match(PHONE_PATTERN)?.[1] ?? null;
  const license = rawName.match(LICENSE_PATTERN)?.[1] ?? null;
  const email = rawName.match(EMAIL_PATTERN)?.[0] ?? null;

  const addressStart = rawName.search(ADDRESS_START_PATTERN);
  let cleaned = addressStart === -1 ? rawName : rawName.slice(0, addressStart);
  if (email !== null) cleaned = cleaned.replace(email, "");
  if (license !== null) cleaned = cleaned.replace(license, "");
  cleaned = cleaned
    .replace(/(?:Primary |Cell |Alternate )?Phone:\s*\d{10}/gi, "")
    .replace(/,\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    cleanedName: cleaned.length === 0 ? null : cleaned,
    phone,
    email,
    licenseNumber: license,
  };
}

/** Order-independent matching key: sorted uppercase word tokens. */
function computeMatchKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,'#-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .sort()
    .join(" ");
}

const companyIdCache = new Map<string, string>();

/**
 * Find-or-create a `companies` row by a sorted-token match key (see module
 * comment). `companies.companyId` is the durable contractor/business
 * identity per ENTITY-MODEL.md — this is the load-time step that resolves a
 * parsed name to an existing hub row.
 */
export async function resolveCompanyId(
  cleanedName: string,
  sourceSystem: string,
  now: Date,
): Promise<string> {
  const matchKey = computeMatchKey(cleanedName);
  const cached = companyIdCache.get(matchKey);
  if (cached !== undefined) return cached;

  const existing = await db
    .select({ companyId: companies.companyId })
    .from(companies)
    .where(eq(companies.normalizedName, matchKey))
    .limit(1);

  if (existing[0] !== undefined) {
    companyIdCache.set(matchKey, existing[0].companyId);
    return existing[0].companyId;
  }

  const companyId = randomUUID();
  await db
    .insert(companies)
    .values({
      companyId,
      name: cleanedName,
      normalizedName: matchKey,
      sourceSystem,
      sourceRecordKey: matchKey,
      loadedAt: now,
    })
    .onConflictDoNothing({
      target: [companies.sourceSystem, companies.sourceRecordKey],
    });

  // Re-select in case a concurrent insert (or onConflictDoNothing) won the race.
  const resolved = await db
    .select({ companyId: companies.companyId })
    .from(companies)
    .where(eq(companies.normalizedName, matchKey))
    .limit(1);

  const finalId = resolved[0]?.companyId ?? companyId;
  companyIdCache.set(matchKey, finalId);
  return finalId;
}
