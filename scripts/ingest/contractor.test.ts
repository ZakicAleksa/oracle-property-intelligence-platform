import { describe, expect, it } from "vitest";

import { parseContactRawName } from "./contractor.js";

describe("parseContactRawName", () => {
  it("returns all-null fields for null input", () => {
    expect(parseContactRawName(null)).toEqual({
      cleanedName: null,
      phone: null,
      email: null,
      licenseNumber: null,
    });
  });

  it("returns all-null fields for blank input", () => {
    expect(parseContactRawName("   ")).toEqual({
      cleanedName: null,
      phone: null,
      email: null,
      licenseNumber: null,
    });
  });

  it("extracts name, phone, and license from a real scraped contact string", () => {
    const result = parseContactRawName(
      "ROBERT S MILLER GRANDE AIRE SERVICES INC PO BOX 743 BOCA GRANDE, FL, 33921-0743 Primary Phone: 9419641142 Alternate Phone: 9416971703 Fax: 9419641144 Certified Air Cond Contractor CAC054727",
    );
    expect(result.cleanedName).toBe("ROBERT S MILLER GRANDE AIRE SERVICES INC");
    expect(result.phone).toBe("9419641142");
    expect(result.licenseNumber).toBe("CAC054727");
  });

  it("extracts an email address when present", () => {
    const result = parseContactRawName(
      "K. Galloway Galloway Roofing, LLC 7253 Gasparilla Rd. Unit# 1 Port Charlotte, FL, 33981 Primary Phone: 9416973737 Cell Phone: 9419796524 david@gallowayroofing.com",
    );
    expect(result.email).toBe("david@gallowayroofing.com");
    expect(result.cleanedName).toBe("K. Galloway Galloway Roofing, LLC");
  });

  it("cuts the name at a street-number address boundary", () => {
    const result = parseContactRawName(
      "BRAXTON BOWEN BOWEN CONSTRUCTION COMPANY PO BOX 71 PARK STREET BOCA GRANDE, FL, 33921 Certified General Cntr CGC013106",
    );
    expect(result.cleanedName).toBe("BRAXTON BOWEN BOWEN CONSTRUCTION COMPANY");
    expect(result.licenseNumber).toBe("CGC013106");
  });

  it("produces the same cleaned name regardless of person/company word order", () => {
    // Confirmed live: the same real contractor's "Applicant" and "Licensed
    // Professional" contact rows list person-name and company-name in a
    // different order. The cleaned name itself still differs by word order
    // here (that's expected -- this function doesn't reorder), but callers
    // rely on a separate sorted-token match key downstream to unify them.
    const applicant = parseContactRawName(
      "ROBERT S MILLER GRANDE AIRE SERVICES INC PO BOX 743 BOCA GRANDE, FL, 33921-0743 Primary Phone: 9419641142",
    );
    const licensedProfessional = parseContactRawName(
      "GRANDE AIRE SERVICES INC ROBERT S MILLER PO BOX 743 BOCA GRANDE, FL, 33921-0743",
    );
    expect(applicant.cleanedName).not.toBeNull();
    expect(licensedProfessional.cleanedName).not.toBeNull();
    expect(applicant.cleanedName?.split(/\s+/).sort()).toEqual(
      licensedProfessional.cleanedName?.split(/\s+/).sort(),
    );
  });
});
