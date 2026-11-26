import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("REDIRECT_LOGIN"); } }));
import { canAccessInstagram, prospectScope, requireAdmin, requireInstagramAdmin, requireMember } from "./access";

beforeEach(() => { vi.unstubAllEnvs(); mocks.auth.mockReset(); });
describe("CRM access boundaries", () => {
  it("rejects anonymous requests", async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(requireMember()).rejects.toThrow("REDIRECT_LOGIN");
  });
  it("rejects sales accounts for both administration and the inbox", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "sales", role: "COMMERCIAL", email: "sales@glaura.fr" } });
    await expect(requireAdmin()).rejects.toThrow("administration");
    await expect(requireInstagramAdmin()).rejects.toThrow("administration");
  });
  it("grants full Instagram inbox access to every administrator and denies commercials", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "fode", role: "ADMIN", email: "fode.sylla@glaura.fr" } });
    await expect(requireInstagramAdmin()).resolves.toMatchObject({ id: "fode", role: "ADMIN" });
    expect(canAccessInstagram({ role: "ADMIN", email: "fode.sylla@glaura.fr" })).toBe(true);
    expect(canAccessInstagram({ role: "COMMERCIAL", email: "simone@glaura.fr" })).toBe(false);
  });
  it("scopes sales to direct assignments and legacy rounds without overriding a new owner", () => {
    expect(prospectScope({ id: "rep", role: "COMMERCIAL" })).toEqual({ OR: [{ assignedToId: "rep" }, { assignedToId: null, tournee: { assignedToId: "rep" } }] });
    expect(prospectScope({ id: "admin", role: "ADMIN" })).toEqual({});
  });
});
