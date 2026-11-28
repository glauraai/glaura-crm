import { describe, expect, it } from "vitest";
import { buildOriginWhere, isWebsiteOrigin } from "./salons-filter";

describe("salons-filter website & provenance clauses", () => {
  it("recognizes all website origin filter keys", () => {
    expect(isWebsiteOrigin("website")).toBe(true);
    expect(isWebsiteOrigin("website_pro")).toBe(true);
    expect(isWebsiteOrigin("website_laura")).toBe(true);
    expect(isWebsiteOrigin("website_callback")).toBe(true);
    expect(isWebsiteOrigin("scrape")).toBe(false);
    expect(isWebsiteOrigin(undefined)).toBe(false);
  });

  it("builds comprehensive OR filter for all website leads (/pro, /laura, callback)", () => {
    const where = buildOriginWhere("website");
    expect(where).toBeTruthy();
    const orClauses = (where as { OR: unknown[] }).OR;
    expect(orClauses.length).toBeGreaterThanOrEqual(7);
    expect(JSON.stringify(orClauses)).toContain("self_serve:");
    expect(JSON.stringify(orClauses)).toContain("laura_lead:");
    expect(JSON.stringify(orClauses)).toContain("laura_essai");
    expect(JSON.stringify(orClauses)).toContain("Rappel ");
    expect(JSON.stringify(orClauses)).toContain("Lead entrant");
  });

  it("returns null for unknown origin keys", () => {
    expect(buildOriginWhere("unknown")).toBeNull();
    expect(buildOriginWhere(undefined)).toBeNull();
  });
});
