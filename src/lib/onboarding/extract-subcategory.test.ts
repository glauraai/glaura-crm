import { describe, expect, it } from "vitest";
import { stripPlaceholderSubcategories } from "./extract";

describe("stripPlaceholderSubcategories", () => {
  it("maps our (uncategorized) placeholder heading back to an empty subcategory", () => {
    const out = stripPlaceholderSubcategories({
      services: [
        { service_name: "FLASH CLASSIC", subcategory_name: "(uncategorized)" },
        { service_name: "Balayage", subcategory_name: "COLORATION" },
      ],
    });
    expect(out.services.map((s) => s.subcategory_name)).toEqual(["", "COLORATION"]);
  });
});
