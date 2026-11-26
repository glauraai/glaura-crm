import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: { id: "rep", role: "COMMERCIAL" }, createMany: vi.fn(), findMany: vi.fn(), userFind: vi.fn(), userFindMany: vi.fn(), salonPhones: vi.fn(), convert: vi.fn() }));
vi.mock("@/lib/access", () => ({ requireMember: async () => state.user }));
vi.mock("@/lib/db", () => ({ prisma: { prospect: { createManyAndReturn: state.createMany, findMany: state.findMany }, user: { findFirst: state.userFind, findMany: state.userFindMany }, salon: { findMany: state.salonPhones }, $transaction: (fn: (tx: unknown) => unknown) => fn("tx") } }));
vi.mock("@/lib/prospection/convert", () => ({ convertProspectInTx: state.convert }));
vi.mock("@/lib/prospection/upsert", () => ({ loadCrmIndex: async () => ({ byBookingUrl: new Map(), byNamePostal: new Map([["salonlila|75011", "salon-1"]]) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { importLeadBatch } from "./import-actions";

const lead = (overrides: Record<string, unknown> = {}) => ({ name: "Nail Bar", address: null, postalCode: "75012", city: "Paris", phone: "0611223344", email: null, instagram: null, website: null, planityUrl: null, treatwellUrl: null, contactName: null, metiers: ["ONGLES"], rating: null, reviewCount: 0, notes: null, ...overrides });
const rows = () => state.createMany.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: "rep", role: "COMMERCIAL" };
  state.findMany.mockResolvedValue([]);
  state.createMany.mockImplementation(async ({ data }) => data.map((row: object, i: number) => ({ id: `p${i}`, ...row })));
  state.salonPhones.mockResolvedValue([{ id: "salon-phone", phone: "+33 7 00 00 00 01" }]);
  state.convert.mockImplementation(async (_tx, p) => `salon-of-${p.id}`);
});

describe("importLeadBatch", () => {
  it("assigns a rep's leads to the rep, whatever owner the client sends", async () => {
    const result = await importLeadBatch({ leads: [lead()], ownerId: "someone-else" });
    expect(result).toEqual({ ok: true, created: 1, skipped: 0, alreadyInCrm: 0, unmatchedOwners: [], salons: 0 });
    expect(state.convert).not.toHaveBeenCalled();
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
  it("lets an admin dispatch rows by the Commercial column, falling back to the default owner", async () => {
    state.user = { id: "boss", role: "ADMIN" };
    state.userFind.mockResolvedValue({ id: "max" });
    state.userFindMany.mockResolvedValue([{ id: "lea", name: "Léa Martin", email: "lea@glaura.ai" }, { id: "max", name: "Max", email: "max@glaura.ai" }]);
    const result = await importLeadBatch({ leads: [lead({ owner: "lea@glaura.ai" }), lead({ name: "B", owner: "Paul" }), lead({ name: "C" })], ownerId: "max" });
    expect(rows().map((r: { assignedToId: string }) => r.assignedToId)).toEqual(["lea", "max", "max"]);
    expect(rows()[1].notes).toBe("Commercial : Paul");
    expect(rows()[0]).not.toHaveProperty("owner");
    expect(result).toMatchObject({ ok: true, unmatchedOwners: ["Paul"] });
  });
  it("ignores the Commercial column for a rep", async () => {
    await importLeadBatch({ leads: [lead({ owner: "lea@glaura.ai" })], ownerId: null });
    expect(rows()[0].assignedToId).toBe("rep");
    expect(rows()[0].notes).toBe("Commercial : lea@glaura.ai");
    expect(state.userFindMany).not.toHaveBeenCalled();
  });
  it("converts new leads into salons when asked, except CRM matches", async () => {
    const result = await importLeadBatch({ leads: [lead(), lead({ name: "Dup", phone: "07 00 00 00 01" })], ownerId: null, destination: "salons" });
    expect(rows()[1]).toMatchObject({ status: "DEJA_CRM", matchedSalonId: "salon-phone" });
    expect(state.convert).toHaveBeenCalledTimes(1);
    expect(state.convert.mock.calls[0][1]).toMatchObject({ id: "p0", tournee: null, assignedToId: "rep" });
    expect(state.convert.mock.calls[0][2]).toBe("rep");
    expect(result).toMatchObject({ ok: true, created: 2, salons: 1, alreadyInCrm: 1 });
  });
  it("keeps a lead as prospect when its conversion fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.convert.mockRejectedValue(new Error("slug clash"));
    const result = await importLeadBatch({ leads: [lead()], ownerId: null, destination: "salons" });
    expect(result).toMatchObject({ ok: true, created: 1, salons: 0 });
  });
  it("returns a readable error instead of throwing when the database fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.createMany.mockRejectedValue(new Error("connection reset"));
    const result = await importLeadBatch({ leads: [lead()], ownerId: null });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("connection reset");
  });
});
