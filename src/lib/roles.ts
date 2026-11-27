export type AppRole = "ADMIN" | "MANAGER" | "COMMERCIAL";

export const ROLE_OPTIONS: readonly AppRole[] = ["COMMERCIAL", "MANAGER", "ADMIN"] as const;

export const ROLE_LABELS: Record<AppRole, string> = {
  ADMIN: "Administrateur",
  MANAGER: "Manager",
  COMMERCIAL: "Commercial",
};

export const ROLE_WORKSPACE_LABELS: Record<AppRole, string> = {
  ADMIN: "Administration",
  MANAGER: "Direction commerciale",
  COMMERCIAL: "Espace commercial",
};

export function isAdmin(user?: { role?: string | null } | null): boolean {
  return user?.role === "ADMIN";
}

export function isManager(user?: { role?: string | null } | null): boolean {
  return user?.role === "MANAGER";
}

/** True for ADMIN and MANAGER (sales leadership — full team scope). */
export function isManagerOrAdmin(user?: { role?: string | null } | null): boolean {
  return user?.role === "ADMIN" || user?.role === "MANAGER";
}

export function roleLabel(role?: string | null): string {
  return (role && ROLE_LABELS[role as AppRole]) || ROLE_LABELS.COMMERCIAL;
}

export function roleWorkspaceLabel(role?: string | null): string {
  return (role && ROLE_WORKSPACE_LABELS[role as AppRole]) || ROLE_WORKSPACE_LABELS.COMMERCIAL;
}
