"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireMember } from "@/lib/access";
import { canonicalizePhone } from "@/lib/phone";
import { matchCrmSalon, normalizeName } from "@/lib/prospection/match";
import { loadCrmIndex } from "@/lib/prospection/upsert";
import { zoneForPostalCode } from "@/lib/prospection/zones";
import { tierForProspect } from "@/lib/prospection/tier";
import { METIER_ORDER } from "@/lib/labels";
import { IMPORT_BATCH_SIZE, matchOwner, type OwnerCandidate } from "@/lib/prospection/csv-import";

// Persists one batch of CSV leads (the browser parses and maps the file, then
// sends ≤500 leads per call so no file size can hit the request cap). Leads
// belong to the importer. An admin may pick a default owner (or none) and map a
// "Commercial" column: each row goes to the member it names, unknown names fall
// back to the default and stay readable in the notes. Reps can't assign others.
// Re-importing is safe: a lead already in the pool — same name+postal/phone/
// email key, same Planity/Treatwell page or same Instagram — is skipped, never
// overwritten, so one rep can't take over another's prospect.

const text = (max: number) => z.string().trim().max(max).nullable().catch(null);
const leadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: text(300), postalCode: text(10), city: text(120), phone: text(50), email: text(200),
  instagram: text(60), website: text(500), planityUrl: text(500), treatwellUrl: text(500),
  contactName: text(200), notes: text(10_000), owner: text(200),
  metiers: z.array(z.enum(METIER_ORDER as [string, ...string[]])).max(6).catch([]),
  rating: z.number().min(0).max(5).nullable().catch(null),
  reviewCount: z.number().int().min(0).catch(0),
});

export type ImportBatchResult = { ok: true; created: number; skipped: number; alreadyInCrm: number; unmatchedOwners: string[] } | { ok: false; error: string };

function importKey(lead: z.infer<typeof leadSchema>): string {
  const parts = [normalizeName(lead.name), lead.postalCode ?? lead.city ?? "", canonicalizePhone(lead.phone ?? ""), lead.email ?? ""];
  return `import:${createHash("sha1").update(parts.join("|")).digest("hex")}`;
}

const INACTIVE_OWNER = "Choisissez un membre actif de l’équipe.";

/** undefined when the admin picked someone who can't own prospects. */
async function resolveOwner(user: { id: string; role?: string }, ownerId: string | null): Promise<string | null | undefined> {
  if (user.role !== "ADMIN" || ownerId === "me") return user.id;
  if (!ownerId) return null; // admin importing into the shared pool
  const member = await prisma.user.findFirst({ where: { id: ownerId, active: true }, select: { id: true } });
  return member?.id;
}

export async function importLeadBatch(input: { leads: unknown[]; ownerId: string | null }): Promise<ImportBatchResult> {
  const user = await requireMember();
  try {
    // Validate lead by lead: one malformed row is dropped, never the batch.
    const leads = (Array.isArray(input?.leads) ? input.leads.slice(0, IMPORT_BATCH_SIZE) : [])
      .map(l => leadSchema.safeParse(l)).flatMap(r => r.success ? [r.data] : []);
    const ownerId = z.string().max(100).nullable().catch(null).parse(input?.ownerId ?? null);
    const assignedToId = await resolveOwner(user, ownerId);
    if (assignedToId === undefined) return { ok: false, error: INACTIVE_OWNER };
    if (!leads.length) return { ok: true, created: 0, skipped: input?.leads?.length ?? 0, alreadyInCrm: 0, unmatchedOwners: [] };

    const members: OwnerCandidate[] = user.role === "ADMIN" && leads.some(l => l.owner)
      ? await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true } })
      : [];
    const unmatchedOwners = new Set<string>();

    const handles = leads.flatMap(l => l.instagram ? [l.instagram] : []);
    const takenHandles = new Set(handles.length
      ? (await prisma.prospect.findMany({ where: { instagram: { in: handles } }, select: { instagram: true } })).map(p => p.instagram)
      : []);
    const index = await loadCrmIndex();
    const now = new Date();
    let alreadyInCrm = 0;
    const rows = leads.filter(l => !l.instagram || !takenHandles.has(l.instagram)).map(lead => {
      const sourceUrl = importKey(lead);
      const matchedSalonId = matchCrmSalon({ name: lead.name, sourceUrl: lead.planityUrl ?? lead.treatwellUrl ?? lead.website ?? sourceUrl, postalCode: lead.postalCode }, index);
      if (matchedSalonId) alreadyInCrm++;
      const { owner, ...fields } = lead;
      const rowOwner = matchOwner(owner, members);
      if (owner && !rowOwner && user.role === "ADMIN") unmatchedOwners.add(owner);
      return {
        ...fields,
        notes: owner && !rowOwner ? [fields.notes, `Commercial : ${owner}`].filter(Boolean).join("\n") : fields.notes,
        metiers: lead.metiers as (typeof METIER_ORDER)[number][],
        source: "IMPORT" as const,
        sourceUrl,
        zone: zoneForPostalCode(lead.postalCode)?.slug ?? null,
        tier: tierForProspect({}),
        status: matchedSalonId ? "DEJA_CRM" as const : "NOUVEAU" as const,
        matchedSalonId,
        assignedToId: rowOwner ?? assignedToId,
        firstSeenAt: now,
        lastSeenAt: now,
      };
    });
    const { count } = rows.length ? await prisma.prospect.createMany({ data: rows, skipDuplicates: true }) : { count: 0 };
    revalidatePath("/prospection");
    return { ok: true, created: count, skipped: input.leads.length - count, alreadyInCrm, unmatchedOwners: [...unmatchedOwners].slice(0, 50) };
  } catch (e) {
    console.error("[prospection] CSV import batch failed", { userId: user.id, error: e });
    return { ok: false, error: "Ce lot n’a pas pu être importé. Réessayez ; les lignes déjà importées ne seront pas dupliquées." };
  }
}
