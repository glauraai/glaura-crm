import { prisma } from "@/lib/db";
import { activeDailyPriorityDateFilter } from "@/lib/dailyPriority";
import { phoneSearchTerm } from "@/lib/phone";
import { isManagerOrAdmin } from "@/lib/roles";
import { LeadSource, Metier, SalonStatus, SalonType } from "@/generated/prisma/enums";

export type ViewerScope = {
  id: string;
  role?: string | null;
};

export type SalonFilters = {
  status?: string;
  metier?: string;
  type?: string;
  gtm?: string; // A | B | C | CHAINE | HORS_CIBLE
  owner?: string;
  arr?: string;
  source?: string; // "SCRAPE" → salons converted from prospecting
  prio?: string; // "today" → active daily priorities, including carried-over pins
  scope?: string; // "all" → cross-rep read-only browse (Nov 27 brief pp. 7 & 12)
  sort?: string; // "rank" (default) | "recent"
  q?: string;
  page?: string;
};

export function canEditSalon(viewer: ViewerScope | null | undefined, salon: { assignedToId?: string | null }): boolean {
  if (!viewer) return false;
  return isManagerOrAdmin(viewer) || (Boolean(salon.assignedToId) && salon.assignedToId === viewer.id);
}

function scopedOwnerId(f: SalonFilters, viewer?: ViewerScope): string | undefined {
  if (!viewer) return f.owner;
  if (isManagerOrAdmin(viewer)) return f.owner;
  if (f.scope === "all") return f.owner;
  return viewer.id;
}

// Stored phone numbers are unnormalized, so an ILIKE on the raw column misses
// most of them. Both sides are reduced to the French national form and compared
// as a substring, which lets a partial number — the last six digits, say —
// still find its salon.
//
// salon_phone_canonical() is the database-side twin of canonicalizePhone(); it
// is defined, and indexed, in the 20260725120000_salon_search_trgm_indexes
// migration. Calling the shared function (rather than inlining the CASE here)
// is what lets the planner use that expression index.
async function salonIdsMatchingPhone(term: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Salon"
    WHERE phone IS NOT NULL
      AND salon_phone_canonical(phone) LIKE ${`%${term}%`}
  `;
  return rows.map((r) => r.id);
}

async function salonWhere(f: SalonFilters, viewer: ViewerScope): Promise<import("@/generated/prisma/client").Prisma.SalonWhereInput> {
  const q = f.q?.trim();
  const ownerId = scopedOwnerId(f, viewer);
  const phoneTerm = q ? phoneSearchTerm(q) : null;
  const phoneMatchIds = phoneTerm ? await salonIdsMatchingPhone(phoneTerm) : [];
  return {
      // Merged duplicates stay in the table but out of the pipeline.
      archivedAt: null,
      ...(f.status && Object.values(SalonStatus).includes(f.status as SalonStatus) ? { status: f.status as SalonStatus } : {}),
      ...(f.metier && Object.values(Metier).includes(f.metier as Metier) ? { metier: { has: f.metier as Metier } } : {}),
      ...(f.type && Object.values(SalonType).includes(f.type as SalonType) ? { type: f.type as SalonType } : {}),
      ...(f.gtm && ["A", "B", "C", "CHAINE", "HORS_CIBLE"].includes(f.gtm) ? { gtmPriority: f.gtm } : {}),
      ...(ownerId ? { assignedToId: ownerId } : {}),
      ...(f.arr ? { arrondissement: f.arr } : {}),
      ...(f.source && Object.values(LeadSource).includes(f.source as LeadSource) ? { source: f.source as LeadSource } : {}),
      ...(f.prio === "today" ? { priorityDate: activeDailyPriorityDateFilter() } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { contactName: { contains: q, mode: "insensitive" as const } },
              { contactEmail: { contains: q, mode: "insensitive" as const } },
              { instagram: { contains: q, mode: "insensitive" as const } },
              { address: { contains: q, mode: "insensitive" as const } },
              { notes: { contains: q, mode: "insensitive" as const } },
              ...(phoneMatchIds.length ? [{ id: { in: phoneMatchIds } }] : []),
            ],
          }
        : {}),
  };
}

export async function getSalons(f: SalonFilters, viewer: ViewerScope) {
  const where = await salonWhere(f, viewer);
  const page = Math.max(1, Math.min(100000, Number.parseInt(f.page ?? "", 10) || 1));
  const orderBy: import("@/generated/prisma/client").Prisma.SalonOrderByWithRelationInput[] =
    f.sort === "recent"
      ? [{ updatedAt: "desc" }, { id: "asc" }]
      : [{ gtmScore: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }, { id: "asc" }];
  return prisma.salon.findMany({ where, skip: (page - 1) * 50, take: 50,
    orderBy,
    include: {
      prospect: {
        select: {
          source: true,
          sourceUrl: true,
          instagramFollowers: true,
          revenueEur: true,
          revenueYear: true,
          revenueStatus: true,
          filingUrl: true,
          aiScore: true,
        },
      },
      assignedTo: { select: { id: true, name: true, email: true } },
      tasks: { where: { doneAt: null }, orderBy: { dueAt: "asc" }, take: 1, select: { title: true, dueAt: true } },
    },
  });
}
export async function getSalonCount(f: SalonFilters, viewer: ViewerScope) {
  return prisma.salon.count({ where: await salonWhere(f, viewer) });
}

export type SalonListItem = Awaited<ReturnType<typeof getSalons>>[number];

export async function getSalon(id: string, viewer?: ViewerScope) {
  // Nov 27 brief pp. 7 & 12: every signed-in rep can view peer salons in read-only mode
  // (including transcripts) to learn from peers; mutations remain strictly guarded.
  const canSeeArchived = viewer ? isManagerOrAdmin(viewer) : true;
  return prisma.salon.findFirst({
    where: {
      id,
      ...(canSeeArchived ? {} : { archivedAt: null }),
    },
    include: {
      prospect: { select: { source: true, sourceUrl: true, treatwellUrl: true, planityUrl: true, dualPlatformCheckedAt: true, instagramFollowers: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
      activities: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } },
      reminders: { orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { done: "asc" }, { dueAt: "asc" }] },
      onboardingJobs: { orderBy: { createdAt: "desc" } },
      emailJobs: { orderBy: { createdAt: "desc" }, take: 5 },
      contacts: {
        orderBy: [{ isDecisionMaker: "desc" }, { createdAt: "desc" }],
        include: {
          transcripts: {
            orderBy: { occurredAt: "desc" },
            take: 5,
            select: { id: true, source: true, occurredAt: true, durationSec: true, summary: true, isDecisionMakerCall: true },
          },
        },
      },
      transcripts: {
        orderBy: { occurredAt: "desc" },
        take: 15,
        include: {
          contact: { select: { id: true, name: true, role: true } },
          user: { select: { name: true } },
          callEvaluation: true,
        },
      },
      callEvaluations: {
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { user: { select: { name: true } } },
      },
      objectionRecords: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      socialSnapshots: {
        orderBy: { monthKey: "asc" },
        take: 6,
      },
      opportunities: {
        orderBy: { createdAt: "desc" },
        include: { owner: { select: { id: true, name: true, email: true } } },
      },
      subscriptions: { orderBy: { createdAt: "desc" }, take: 10 },
      suggestions: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 5 },
      instagramConversations: {
        orderBy: { lastMessageAt: "desc" },
        take: 3,
        include: {
          messages: {
            orderBy: { sentAt: "asc" },
            take: 30,
            include: { sentByUser: { select: { name: true, email: true } } },
          },
        },
      },
    },
  });
}

export type SalonDetail = NonNullable<Awaited<ReturnType<typeof getSalon>>>;

export async function getStatusCounts(viewer?: ViewerScope): Promise<Record<string, number>> {
  const rows = await prisma.salon.groupBy({
    by: ["status"],
    where: {
      archivedAt: null,
      ...(viewer && !isManagerOrAdmin(viewer) ? { assignedToId: viewer.id } : {}),
    },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

export async function getSalonOwners() {
  return prisma.user.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
}

// Everyone a salon can be (re)assigned to — used by the assignee pickers.
// Excludes deactivated accounts (ex-employees, dev/test) so they no longer
// appear as options; their historical salon assignments are untouched.
export async function getAssignableUsers() {
  return prisma.user.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
}
