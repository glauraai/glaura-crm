import { describe, expect, it } from "vitest";
import { prepareAccountBlocker } from "./onboarding-access";

const rep = { id: "rep", role: "COMMERCIAL" };
const admin = { id: "admin", role: "ADMIN" };

describe("prepareAccountBlocker", () => {
  it("lets the assigned rep prepare the account before the visit", () => {
    for (const status of ["A_VISITER", "VISITE_FAITE", "INTERESSE", "A_RELANCER", "SIGNE"] as const) {
      expect(prepareAccountBlocker(rep, { assignedToId: "rep", status })).toBeNull();
    }
  });
  it("keeps other reps' salons and lost salons off limits for reps", () => {
    expect(prepareAccountBlocker(rep, { assignedToId: "other", status: "A_VISITER" })).toBe("Réservé au commercial assigné ou à un admin");
    expect(prepareAccountBlocker(rep, { assignedToId: "rep", status: "PAS_INTERESSE" })).toBe("Indisponible pour un salon Pas intéressé");
  });
  it("lets admins prepare any salon", () => {
    expect(prepareAccountBlocker(admin, { assignedToId: "other", status: "PAS_INTERESSE" })).toBeNull();
  });
});
