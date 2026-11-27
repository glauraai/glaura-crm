import { describe, expect, it } from "vitest";
import { buildGtmRoutingPlan, C_TIER_NURTURE_SEQUENCE } from "./routing";

describe("GTM A/B/C routing & Dec 20-31 pause", () => {
  it("pauses all task/campaign creation during Dec 20–31", () => {
    const plan = buildGtmRoutingPlan({
      priority: "A",
      salonName: "Salon Étoile",
      now: new Date("2026-12-24T10:00:00Z"),
      decemberPauseEnabled: true,
    });
    expect(plan.kind).toBe("PAUSED_DECEMBER");
  });

  it("creates 48h call task for Priority A and 3-step 10-day sequence for Priority B", () => {
    const a = buildGtmRoutingPlan({
      priority: "A",
      salonName: "Salon Étoile",
      now: new Date("2026-11-28T10:00:00Z"),
    });
    expect(a.kind).toBe("PRIORITY_A_ALERT");
    if (a.kind === "PRIORITY_A_ALERT") {
      expect(a.tasks[0].dueInDays).toBe(2);
    }

    const b = buildGtmRoutingPlan({
      priority: "B",
      salonName: "Studio Lumière",
      now: new Date("2026-11-28T10:00:00Z"),
    });
    expect(b.kind).toBe("PRIORITY_B_SEQUENCE");
    if (b.kind === "PRIORITY_B_SEQUENCE") {
      expect(b.tasks).toHaveLength(3);
      expect(b.tasks[2].dueInDays).toBe(10);
    }
  });

  it("keeps Priority C nurture gated by admin toggle and ships 4 compliant B2B steps", () => {
    const cOff = buildGtmRoutingPlan({
      priority: "C",
      salonName: "Beauté Zen",
      now: new Date("2026-11-28T10:00:00Z"),
      cTierNurtureEnabled: false,
    });
    expect(cOff).toEqual({ kind: "PRIORITY_C_NURTURE", enabled: false, step: 0 });
    expect(C_TIER_NURTURE_SEQUENCE).toHaveLength(4);
    for (const step of C_TIER_NURTURE_SEQUENCE) {
      expect(step.body.toLowerCase()).toContain("désinscription");
    }
  });
});
