// Oracle's permit `improvement_type` field mixes clean short category
// labels ("Electrical", "Demolition") with, for many permit types, a
// scraped dump of an entire "Type of X: ..." form section -- hundreds of
// characters of concatenated label/value pairs (confirmed live: this raw
// noise was leaking into user-facing views and RAG citations). Filtering
// and job-value extraction still need the raw text (matched substrings and
// embedded numbers can sit anywhere in the blob), so this is a
// presentation-layer cleanup applied only when a value is returned to a
// client -- never at ingest time, and never before filtering.
//
// Best-effort v1, not a full parser (same tradeoff as parseContactRawName
// in scripts/ingest/contractor.ts): the raw text has no reliable boundary
// between "the real value" and "the next field's label," so this only
// guarantees a short, bounded label -- not perfect categorization.
const LEADING_LABEL_PREFIX = /^of\s+\S+:\s*/i;
const MAX_LABEL_LENGTH = 60;

export function cleanImprovementTypeLabel(rawType: string | null): string | null {
  if (rawType === null) return null;
  const trimmed = rawType.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= MAX_LABEL_LENGTH && !trimmed.includes(":")) return trimmed;

  const withoutPrefix = trimmed.replace(LEADING_LABEL_PREFIX, "");
  const nextColonIndex = withoutPrefix.indexOf(":");
  const snippet =
    nextColonIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, nextColonIndex);
  const cleaned = snippet.trim();

  if (cleaned.length === 0) return "Other";
  if (cleaned.length <= MAX_LABEL_LENGTH) return cleaned;
  return cleaned.slice(0, MAX_LABEL_LENGTH).replace(/\s+\S*$/, "") + "…";
}
