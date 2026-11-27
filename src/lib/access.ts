import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { isAdmin, isManagerOrAdmin } from "@/lib/roles";

export { isAdmin, isManager, isManagerOrAdmin, roleLabel, roleWorkspaceLabel } from "@/lib/roles";

export async function requireMember() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user;
}

/** Strictly ADMIN (team access, role changes, onboarding ops, destructive deletes, commission payouts). */
export async function requireAdmin() {
  const user = await requireMember();
  if (!isAdmin(user)) throw new Error("Accès réservé à l’administration.");
  return user;
}

/** MANAGER (Head of Sales) or ADMIN — full team sales-ops scope. */
export async function requireManager() {
  const user = await requireMember();
  if (!isManagerOrAdmin(user)) throw new Error("Accès réservé au management commercial.");
  return user;
}

// Managers (Fodé) and Administrators can access the full Instagram inbox & automations.
export function canAccessInstagram(user: { role?: string | null; email?: string | null }) {
  return isManagerOrAdmin(user);
}

// Commercials can view and reply to Instagram conversations strictly on Salons assigned to them.
export function canAccessSalonInstagram(
  user: { id: string; role?: string | null },
  salon: { assignedToId?: string | null },
) {
  return isManagerOrAdmin(user) || (Boolean(salon.assignedToId) && salon.assignedToId === user.id);
}

export async function requireInstagramAdmin() {
  return requireManager();
}

export function prospectScope(user: { id: string; role?: string | null }) {
  return isManagerOrAdmin(user) ? {} : {
    OR: [
      { assignedToId: user.id },
      { assignedToId: null, tournee: { assignedToId: user.id } },
    ],
  };
}
