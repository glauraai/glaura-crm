import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("REDIRECT_LOGIN"); } }));
import { canAccessInstagram, prospectScope, requireAdmin, requireInstagramAdmin, requireManager, requireMember } from "./access";

beforeEach(() => { vi.unstubAllEnvs(); mocks.auth.mockReset(); });
describe("CRM access boundaries (ADMIN / MANAGER / COMMERCIAL)", () => {
  it("rejects anonymous requests", async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(requireMember()).rejects.toThrow("REDIRECT_LOGIN");
  });
  it("rejects sales accounts for administration, management, and the inbox", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "sales", role: "COMMERCIAL", email: "sales@glaura.fr" } });
    await expect(requireAdmin()).rejects.toThrow("administration");
    await expect(requireManager()).rejects.toThrow("management");
    await expect(requireInstagramAdmin()).rejects.toThrow("management");
  });
  it("grants MANAGER sales-ops & inbox access while keeping administration ADMIN-only", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "fode", role: "MANAGER", email: "fode.sylla@glaura.fr" } });
    await expect(requireManager()).resolves.toMatchObject({ id: "fode", role: "MANAGER" });
    await expect(requireInstagramAdmin()).resolves.toMatchObject({ id: "fode", role: "MANAGER" });
    await expect(requireAdmin()).rejects.toThrow("administration");
    expect(canAccessInstagram({ role: "MANAGER", email: "fode.sylla@glaura.fr" })).toBe(true);
    expect(canAccessInstagram({ role: "ADMIN", email: "admin@glaura.fr" })).toBe(true);
    expect(canAccessInstagram({ role: "COMMERCIAL", email: "simone@glaura.fr" })).toBe(false);
  });
  it("scopes sales to direct assignments and legacy rounds while giving MANAGER and ADMIN team-wide scope", () => {
    expect(prospectScope({ id: "rep", role: "COMMERCIAL" })).toEqual({ OR: [{ assignedToId: "rep" }, { assignedToId: null, tournee: { assignedToId: "rep" } }] });
    expect(prospectScope({ id: "mgr", role: "MANAGER" })).toEqual({});
    expect(prospectScope({ id: "admin", role: "ADMIN" })).toEqual({});
  });
});
