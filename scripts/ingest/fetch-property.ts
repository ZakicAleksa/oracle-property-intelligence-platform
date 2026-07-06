// Fetches the full consolidated property JSON directly from IPFS by CID —
// the same content getOracleProperty (MCP) returns, confirmed byte-identical
// earlier (see PLAN.md Phase 3). No MCP dependency for enrichment.
export type PermitContact = {
  contactRole: string;
  rawName: string | null;
  phone: string | null;
  email: string | null;
  licenseNumber: string | null;
};

export type PermitCustomField = {
  fieldGroup: string | null;
  fieldName: string;
  fieldValue: string | null;
};

export type PermitEvent = {
  eventType: string;
  eventStatus: string | null;
  eventDate: unknown;
  actorName: string | null;
  commentText: string | null;
};

export type PermitFee = {
  feeCode: string | null;
  feeDescription: string | null;
  feeStatus: string | null;
  assessedAmount: string | number | null;
  paidAmount: string | number | null;
};

export type PermitLink = {
  linkKind: string;
  text: string | null;
  url: string;
  title: string | null;
};

export type PermitInspection = {
  inspectionNumber: string | null;
  completedDate: unknown;
  [key: string]: unknown;
};

export type Permit = {
  permitNumber: string | null;
  improvementType: string | null;
  projectDescription: string | null;
  completionDate: unknown;
  recordStatus: string | null;
  estimatedJobValue: string | number | null;
  estimatedSqFt: string | number | null;
  contacts: PermitContact[];
  customFields: PermitCustomField[];
  events: PermitEvent[];
  fees: PermitFee[];
  links: PermitLink[];
  inspections: PermitInspection[];
};

export type SunbizAddress = {
  addressRole: string | null;
  line1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export type SunbizParty = {
  partyRole: string | null;
  name: string | null;
  title: string | null;
  addressSingleLine: string | null;
};

export type SunbizAnnualReport = {
  reportYear: string | null;
  reportDate: unknown;
};

export type SunbizTenant = {
  documentNumber: string | null;
  entityName: string | null;
  status: string | null;
  filingType: string | null;
  filedDate: unknown;
  addresses: SunbizAddress[];
  parties: SunbizParty[];
  annualReports: SunbizAnnualReport[];
};

export type BbbReview = {
  reviewDate: unknown;
  reviewRating: string | number | null;
  reviewTitle: string | null;
  reviewText: string | null;
  reviewerDisplayName: string | null;
};

export type BbbComplaint = {
  complaintDate: unknown;
  complaintClosedDate?: unknown;
  complaintType: string | null;
  complaintCategory?: string | null;
  complaintStatus: string | null;
  complaintSummary: string | null;
  complaintText?: string | null;
};

export type BbbProfile = {
  name: string | null;
  profileUrl: string | null;
  bbbRating: string | null;
  isAccredited: boolean | null;
  reviewCount: number | null;
  complaintCount: number | null;
  qualityScore: string | number | null;
  scoreBand: string | null;
  reviews: BbbReview[];
  complaints: BbbComplaint[];
  [key: string]: unknown;
};

export type ConsolidatedProperty = {
  parcelId: string;
  county: string;
  sourceSystem: string;
  ownerships: Array<{ ownedBy: string | null }>;
  permits: Permit[];
  sunbizTenants: SunbizTenant[];
  bbbProfiles: BbbProfile[];
  collectedAt: unknown;
};

export async function fetchConsolidatedProperty(
  cid: string,
): Promise<ConsolidatedProperty> {
  const response = await fetch(`https://ipfs.filebase.io/ipfs/${cid}`);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch property CID ${cid}: HTTP ${response.status}`,
    );
  }
  return (await response.json()) as ConsolidatedProperty;
}
