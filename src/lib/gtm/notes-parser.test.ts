import { describe, expect, it } from "vitest";
import { parseLeadNotes } from "./notes-parser";

describe("parseLeadNotes", () => {
  it("extracts staff, TikTok, booking tool, manager, rating and reviews from CSV notes", () => {
    const notes = `Enrichissement web : note/avis Treatwell (4,7/5, 2529 avis).
Pôle : Esthétique
Gérant : Alain Viot
TikTok : https://www.tiktok.com/@barber.350
Logiciel de réservation : Treatwell
Effectif : 3
Statut client : Ancien client`;

    const parsed = parseLeadNotes(notes);
    expect(parsed.staffCount).toBe(3);
    expect(parsed.tiktokHandle).toBe("barber.350");
    expect(parsed.hasTreatwellHint).toBe(true);
    expect(parsed.hasPlanityHint).toBe(false);
    expect(parsed.decisionMakerName).toBe("Alain Viot");
    expect(parsed.isFormerClient).toBe(true);
    expect(parsed.specialtyHint).toBe("Esthétique");
    expect(parsed.ratingHint).toBe(4.7);
    expect(parsed.reviewCountHint).toBe(2529);
  });
});
