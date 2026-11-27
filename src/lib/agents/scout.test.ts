import { describe, expect, it } from "vitest";
import { buildFallbackScoutBrief } from "./scout";

describe("SCOUT prep brief generator", () => {
  it("reminds rep to prepare demo account when not ready and includes 3-month growth talking point", () => {
    const brief = buildFallbackScoutBrief({
      salonName: "Maison Coiffure",
      bookingTool: "PLANITY",
      hasPlanity: true,
      hasTreatwell: true,
      instagram: "maisoncoiffure",
      instagramFollowers: 5400,
      recommendedAngle: "Synchronisation d'agenda",
      demoAccountReady: false,
      growthPct: 22.5,
      recentNotes: ["Intéressée par la synchro Planity + Treatwell"],
    });

    expect(brief.demoAccountReady).toBe(false);
    expect(brief.demoReminder).toContain("Préparer le compte");
    expect(brief.growthTalkingPoint).toContain("+22.5%");
    expect(brief.discoveryQuestions.length).toBeGreaterThanOrEqual(3);
  });
});
