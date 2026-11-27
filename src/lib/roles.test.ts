import { describe, expect, it } from "vitest";
import {
  isAdmin,
  isManager,
  isManagerOrAdmin,
  roleLabel,
  roleWorkspaceLabel,
} from "./roles";
import { prepareAccountBlocker } from "./onboarding-access";

describe("3-role RBAC helpers (ADMIN / MANAGER / COMMERCIAL)", () => {
  it("distinguishes ADMIN, MANAGER, and COMMERCIAL cleanly", () => {
    const admin = { id: "u-admin", role: "ADMIN" };
    const manager = { id: "u-mgr", role: "MANAGER" };
    const rep = { id: "u-rep", role: "COMMERCIAL" };

    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(manager)).toBe(false);
    expect(isAdmin(rep)).toBe(false);

    expect(isManager(manager)).toBe(true);
    expect(isManager(admin)).toBe(false);
    expect(isManager(rep)).toBe(false);

    expect(isManagerOrAdmin(admin)).toBe(true);
    expect(isManagerOrAdmin(manager)).toBe(true);
    expect(isManagerOrAdmin(rep)).toBe(false);
    expect(isManagerOrAdmin(null)).toBe(false);
  });

  it("formats French display and workspace labels for every role", () => {
    expect(roleLabel("ADMIN")).toBe("Administrateur");
    expect(roleLabel("MANAGER")).toBe("Manager");
    expect(roleLabel("COMMERCIAL")).toBe("Commercial");
    expect(roleLabel(undefined)).toBe("Commercial");

    expect(roleWorkspaceLabel("ADMIN")).toBe("Administration");
    expect(roleWorkspaceLabel("MANAGER")).toBe("Direction commerciale");
    expect(roleWorkspaceLabel("COMMERCIAL")).toBe("Espace commercial");
  });

  it("lets MANAGER and ADMIN prepare onboarding on any salon while scoping COMMERCIAL to own salons", () => {
    const salon = { assignedToId: "u-other", status: "INTERESSE" as const };
    expect(prepareAccountBlocker({ id: "u-admin", role: "ADMIN" }, salon)).toBeNull();
    expect(prepareAccountBlocker({ id: "u-mgr", role: "MANAGER" }, salon)).toBeNull();
    expect(prepareAccountBlocker({ id: "u-rep", role: "COMMERCIAL" }, salon)).not.toBeNull();
    expect(prepareAccountBlocker({ id: "u-other", role: "COMMERCIAL" }, salon)).toBeNull();
  });
});
