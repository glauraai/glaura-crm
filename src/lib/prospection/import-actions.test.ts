import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: { id: "rep", role: "COMMERCIAL" }, createMany: vi.fn(), findMany: vi.fn(), userFind: vi.fn() }));
vi.mock("@/lib/access", () => ({ requireMember: async () => state.user }));
vi.mock("@/lib/db", () => ({ prisma: { prospect: { createMany: state.createMany, findMany: state.findMany }, user: { findFirst: state.userFind } } }));
vi.mock("@/lib/prospection/upsert", () => ({ loadCrmIndex: async () => ({ byBookingUrl: new Map(), byNamePostal: new Map([["salonlila|75011", "salon-1"]]) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { importLeadBatch } from "./import-actions";

const lead = (overrides: Record<string, unknown> = {}) => ({ name: "Nail Bar", address: null, postalCode: "75012", city: "Paris", phone: "0611223344", email: null, instagram: null, website: null, planityUrl: null, treatwellUrl: null, contactName: null, metiers: ["ONGLES"], rating: null, reviewCount: 0, notes: null, ...overrides });
const rows = () => state.createMany.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: "rep", role: "COMMERCIAL" };
  state.findMany.mockResolvedValue([]);
  state.createMany.mockImplementation(async ({ data }) => ({ count: data.length }));
});

describe("importLeadBatch", () => {
  it("assigns a rep's leads to the rep, whatever owner the client sends", async () => {
    const result = await importLeadBatch({ leads: [lead()], ownerId: "someone-else" });
    expect(result).toEqual({ ok: true, created: 1, skipped: 0, alreadyInCrm: 0 });
    expect(rows()[0]).toMatchObject({ assignedToId: "rep", source: "IMPORT", status: "NOUVEAU", zone: "paris-12" });
    expect(rows()[0].sourceUrl).toMatch(/^import:[0-9a-f]{40}$/);
    expect(state.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });
  it("gives the same key to the same lead so re-imports are skipped", async () => {
    await importLeadBatch({ leads: [lead(), lead({ name: "NAIL  bar" })], ownerId: null });
    expect(rows()[0].sourceUrl).toBe(rows()[1].sourceUrl);
  });
  it("drops only malformed rows, never the batch", async () => {
    const result = await importLeadBatch({ leads: [lead(), { name: "" }, "junk", lead({ name: "B", rating: 42, email: 5 })], ownerId: null });
    expect(result).toMatchObject({ ok: true, created: 2, skipped: 2 });
    expect(rows()[1]).toMatchObject({ rating: null, email: null });
  });
  it("skips Instagram accounts already in the pool and flags CRM salons", async () => {
    state.findMany.mockResolvedValue([{ instagram: "taken" }]);
    const result = await importLeadBatch({ leads: [lead({ instagram: "taken" }), lead({ name: "Salon Lila", postalCode: "75011" })], ownerId: null });
    expect(result).toMatchObject({ ok: true, created: 1, alreadyInCrm: 1 });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ status: "DEJA_CRM", matchedSalonId: "salon-1" });
  });
  it("lets an admin import unassigned or for an active member only", async () => {
    state.user = { id: "boss", role: "ADMIN" };
    await importLeadBatch({ leads: [lead()], ownerId: "" });
    expect(rows()[0].assignedToId).toBeNull();
    state.userFind.mockResolvedValue(null);
    expect(await importLeadBatch({ leads: [lead()], ownerId: "ghost" })).toMatchObject({ ok: false });
  });
  it("returns a readable error instead of throwing when the database fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.createMany.mockRejectedValue(new Error("connection reset"));
    const result = await importLeadBatch({ leads: [lead()], ownerId: null });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("connection reset");
  });
});
