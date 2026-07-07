import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db, schema } from "./db.js";
import { parseContactRawName, resolveCompanyIds } from "./contractor.js";

const TEST_SOURCE_SYSTEM = "contractor_test";

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

  it("cuts the name at a street-number address with a unit-letter suffix", () => {
    // Confirmed live: plain \d{1,6} missed "2212A" and "16911-B" because a
    // letter (optionally hyphenated) directly follows the digits with no
    // space, so real company names were leaking the full street address.
    expect(
      parseContactRawName(
        "LEWIS MORRIS LEWIS MORRIS AIR CONDITIONING INC 2212A ANDREA LANE FORT MYERS, FL",
      ).cleanedName,
    ).toBe("LEWIS MORRIS LEWIS MORRIS AIR CONDITIONING INC");
    expect(
      parseContactRawName(
        "WILLIAM CRANE RICE WINDOWS AND DOORS 16911-B GATOR RD FORT MYERS, FL",
      ).cleanedName,
    ).toBe("WILLIAM CRANE RICE WINDOWS AND DOORS");
  });

  it("strips an embedded long digit-run record ID that isn't an address or a license number", () => {
    // Confirmed live: some raw strings embed an unlabeled ~18-digit
    // tracking ID mid-string, e.g. between the applicant's name and the
    // company name, which no other pattern catches.
    expect(
      parseContactRawName(
        "JEFFREY HOOKER SR 201506291544599790 HOOKER MARINE CONSTRUCTION PLLC",
      ).cleanedName,
    ).toBe("JEFFREY HOOKER SR HOOKER MARINE CONSTRUCTION PLLC");
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

describe("resolveCompanyIds", () => {
  afterAll(async () => {
    await db
      .delete(schema.companies)
      .where(inArray(schema.companies.sourceSystem, [TEST_SOURCE_SYSTEM]));
  });

  it("returns an empty map for an empty input", async () => {
    const result = await resolveCompanyIds([], TEST_SOURCE_SYSTEM, new Date());
    expect(result.size).toBe(0);
  });

  it("resolves distinct names to distinct company ids", async () => {
    const now = new Date();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const nameA = `Test Batch Alpha Roofing ${suffix}`;
    const nameB = `Test Batch Bravo Electric ${suffix}`;

    const result = await resolveCompanyIds([nameA, nameB], TEST_SOURCE_SYSTEM, now);

    expect(result.get(nameA)).toBeDefined();
    expect(result.get(nameB)).toBeDefined();
    expect(result.get(nameA)).not.toBe(result.get(nameB));
  });

  it("resolves the same name to the same company id whether passed once or repeatedly", async () => {
    const now = new Date();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const name = `Test Batch Repeat Plumbing ${suffix}`;

    const first = await resolveCompanyIds([name, name, name], TEST_SOURCE_SYSTEM, now);
    const second = await resolveCompanyIds([name], TEST_SOURCE_SYSTEM, now);

    expect(first.get(name)).toBeDefined();
    expect(first.get(name)).toBe(second.get(name));
  });

  it("resolves name variants with the same sorted-token key to the same company id", async () => {
    const now = new Date();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const variantA = `Grande Aire Services ${suffix}`;
    const variantB = `Services Grande Aire ${suffix}`;

    const result = await resolveCompanyIds([variantA, variantB], TEST_SOURCE_SYSTEM, now);

    expect(result.get(variantA)).toBeDefined();
    expect(result.get(variantA)).toBe(result.get(variantB));
  });
});
