import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/slugs", () => ({ uniqueSalonSlug: async (name: string) => name.toLowerCase().replace(/\W+/g, "-") }));
import { convertProspectInTx, salonDataFromProspect } from "./convert";

const base = {
  id: "p1", name: "Le Monde de Sam", metiers: ["COIFFURE"], postalCode: "75011", address: "1 rue A", instagram: null,
  planityUrl: "https://www.planity.com/sam", treatwellUrl: null, website: "https://sam.fr", phone: "0611223344",
  contactName: "Sam", email: "sam@sam.fr", rating: null, notes: "Type B", source: "IMPORT", sourceUrl: "import:abc",
  dualPlatformCheckedAt: null, assignedToId: "tiago", status: "NOUVEAU", tournee: null,
} as unknown as Parameters<typeof salonDataFromProspect>[0];

describe("salonDataFromProspect", () => {
  it("maps an imported lead with its contact details and booking link", async () => {
    expect(await salonDataFromProspect(base, "fallback")).toMatchObject({
      name: "Le Monde de Sam", slug: "le-monde-de-sam", bookingTool: "PLANITY", bookingUrl: "https://www.planity.com/sam",
      phone: "0611223344", contactName: "Sam", contactEmail: "sam@sam.fr", source: "IMPORT", sourceLabel: "Import CSV",
      notes: "Type B\nSite : https://sam.fr\nFiche Planity : https://www.planity.com/sam", assignedToId: "tiago",
    });
  });
  it("keeps the directory URL as booking link for crawled prospects", async () => {
    const data = await salonDataFromProspect({ ...base, source: "TREATWELL", sourceUrl: "https://treatwell.fr/x", planityUrl: null, assignedToId: null } as typeof base, "fallback");
    expect(data).toMatchObject({ bookingTool: "TREATWELL", bookingUrl: "https://treatwell.fr/x", source: "SCRAPE", assignedToId: "fallback" });
  });
});

describe("convertProspectInTx", () => {
  it("returns null without creating a salon when the prospect was claimed first", async () => {
    const tx = { prospect: { updateMany: vi.fn(async () => ({ count: 0 })) }, salon: { create: vi.fn() } };
    expect(await convertProspectInTx(tx as never, base, "me")).toBeNull();
    expect(tx.salon.create).not.toHaveBeenCalled();
  });
  it("creates the salon, links the prospect and moves its tasks", async () => {
    const tx = { prospect: { updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn() }, salon: { create: vi.fn(async () => ({ id: "s1" })) }, salesTask: { updateMany: vi.fn() } };
    expect(await convertProspectInTx(tx as never, base, "me")).toBe("s1");
    expect(tx.prospect.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { salonId: "s1" } });
    expect(tx.salesTask.updateMany).toHaveBeenCalledWith({ where: { prospectId: "p1" }, data: { salonId: "s1" } });
  });
});
