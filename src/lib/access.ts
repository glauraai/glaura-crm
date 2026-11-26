import { auth } from "@/auth";
import { redirect } from "next/navigation";

export async function requireMember() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user;
}

export async function requireAdmin() {
  const user = await requireMember();
  if (user.role !== "ADMIN") throw new Error("Accès réservé à l’administration.");
  return user;
}

// Every administrator (Fodé, cofounders, CRM admin) can access the full Instagram inbox.
export function canAccessInstagram(user: { role?: string; email?: string | null }) {
  return user.role === "ADMIN";
}

// Commercials can view and reply to Instagram conversations strictly on Salons assigned to them.
export function canAccessSalonInstagram(
  user: { id: string; role?: string | null },
  salon: { assignedToId?: string | null },
) {
  return user.role === "ADMIN" || (Boolean(salon.assignedToId) && salon.assignedToId === user.id);
}

export async function requireInstagramAdmin() {
  return requireAdmin();
}

export function prospectScope(user: { id: string; role?: string }) {
  return user.role === "ADMIN" ? {} : {
    OR: [
      { assignedToId: user.id },
      { assignedToId: null, tournee: { assignedToId: user.id } },
    ],
  };
}
