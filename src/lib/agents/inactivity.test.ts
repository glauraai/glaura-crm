import { describe, expect, it } from "vitest";
import { classifyPortfolioInactivity } from "./inactivity";

describe("classifyPortfolioInactivity", () => {
  const now = new Date("2026-11-28T10:00:00Z");

  it("keeps accounts active below 75 days", () => {
    const last = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    expect(classifyPortfolioInactivity(last, now)).toEqual({ status: "ACTIVE", inactiveDays: 40 });
  });

  it("warns between 75 and 89 days", () => {
    const last = new Date(now.getTime() - 80 * 24 * 60 * 60 * 1000);
    expect(classifyPortfolioInactivity(last, now)).toEqual({ status: "WARN", inactiveDays: 80 });
  });

  it("releases accounts at 90 days (3 months) or more", () => {
    const last = new Date(now.getTime() - 92 * 24 * 60 * 60 * 1000);
    expect(classifyPortfolioInactivity(last, now)).toEqual({ status: "RELEASE", inactiveDays: 92 });
  });
});
