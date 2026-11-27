import { describe, expect, it } from "vitest";
import {
  MONTHLY_CLAIM_CAP,
  OPPORTUNITY_STAGE_ORDER,
  isValidStageTransitionInput,
  mapSalonStatusToStage,
  nextRoundRobinUserId,
  remainingMonthlyClaims,
} from "./stages";

describe("pipeline stages & portfolio rules", () => {
  it("defines all 13 Fodé pipeline stages in order", () => {
    expect(OPPORTUNITY_STAGE_ORDER).toHaveLength(13);
    expect(OPPORTUNITY_STAGE_ORDER[0]).toBe("A_CONTACTER");
    expect(OPPORTUNITY_STAGE_ORDER[OPPORTUNITY_STAGE_ORDER.length - 1]).toBe("PERDU");
  });

  it("requires a non-empty loss reason when moving to PERDU", () => {
    expect(isValidStageTransitionInput("PERDU", "")).toEqual({ ok: false, error: "Un motif de perte est obligatoire." });
    expect(isValidStageTransitionInput("PERDU", "   ")).toEqual({ ok: false, error: "Un motif de perte est obligatoire." });
    expect(isValidStageTransitionInput("PERDU", "Trop cher")).toEqual({ ok: true });
    expect(isValidStageTransitionInput("SIGNE", null)).toEqual({ ok: true });
  });

  it("maps legacy SalonStatus values cleanly", () => {
    expect(mapSalonStatusToStage("A_VISITER")).toBe("A_CONTACTER");
    expect(mapSalonStatusToStage("SIGNE")).toBe("SIGNE");
    expect(mapSalonStatusToStage("PAS_INTERESSE")).toBe("PERDU");
  });

  it("enforces the 120 monthly portfolio claim cap", () => {
    expect(MONTHLY_CLAIM_CAP).toBe(120);
    expect(remainingMonthlyClaims(0)).toBe(120);
    expect(remainingMonthlyClaims(119)).toBe(1);
    expect(remainingMonthlyClaims(120)).toBe(0);
    expect(remainingMonthlyClaims(145)).toBe(0);
  });

  it("rotates inbound round-robin fairly across active reps", () => {
    const reps = ["rep_a", "rep_b", "rep_c"];
    expect(nextRoundRobinUserId(reps, null)).toBe("rep_a");
    expect(nextRoundRobinUserId(reps, "rep_a")).toBe("rep_b");
    expect(nextRoundRobinUserId(reps, "rep_b")).toBe("rep_c");
    expect(nextRoundRobinUserId(reps, "rep_c")).toBe("rep_a");
    expect(nextRoundRobinUserId(reps, "removed_rep")).toBe("rep_a");
    expect(nextRoundRobinUserId([], "rep_a")).toBeNull();
  });
});
