import type { Prisma } from "@/generated/prisma/client";
import type { BookingTool, ProspectSource } from "@/generated/prisma/enums";
import { uniqueSalonSlug } from "@/lib/slugs";

// Prospect → Salon lead. Shared by the "Ajouter aux salons" button and the CSV
// import "add straight to my salons" mode, so both produce identical salons.
// Not a "use server" module on purpose: these helpers must never be callable
// from the browser — callers check access first.

const SOURCE_TO_BOOKING_TOOL: Record<ProspectSource, BookingTool> = { PLANITY: "PLANITY", TREATWELL: "TREATWELL", BOOKSY: "BOOKSY", FRESHA: "FRESHA", GOOGLE: "NONE", INSTAGRAM: "NONE", IMPORT: "NONE" };

type ConvertibleProspect = Prisma.ProspectGetPayload<{ include: { tournee: true } }>;

export async function salonDataFromProspect(prospect: ConvertibleProspect, fallbackOwnerId: string): Promise<Prisma.SalonUncheckedCreateInput> {
  const imported = prospect.source === "IMPORT";
  return {
    name: prospect.name, slug: await uniqueSalonSlug(prospect.name), metier: prospect.metiers,
    arrondissement: prospect.postalCode, address: prospect.address, instagram: prospect.instagram,
    bookingTool: imported ? (prospect.planityUrl ? "PLANITY" : prospect.treatwellUrl ? "TREATWELL" : "NONE") : SOURCE_TO_BOOKING_TOOL[prospect.source],
    bookingUrl: imported ? prospect.planityUrl ?? prospect.treatwellUrl : ["GOOGLE", "INSTAGRAM"].includes(prospect.source) ? null : prospect.sourceUrl,
    phone: prospect.phone, contactName: prospect.contactName, contactEmail: prospect.email, rating: prospect.rating,
    source: imported ? "IMPORT" : "SCRAPE",
    sourceLabel: imported ? "Import CSV" : prospect.dualPlatformCheckedAt ? "Prospection Treatwell + Planity" : `Prospection ${prospect.source.toLowerCase()}`,
    notes: [prospect.notes, prospect.website ? `Site : ${prospect.website}` : null, prospect.treatwellUrl ? `Fiche Treatwell : ${prospect.treatwellUrl}` : null, prospect.planityUrl ? `Fiche Planity : ${prospect.planityUrl}` : null].filter(Boolean).join("\n") || null,
    assignedToId: prospect.assignedToId ?? prospect.tournee?.assignedToId ?? fallbackOwnerId,
  };
}

/**
 * Claims the prospect, creates its salon and moves its tasks, inside `tx`.
 * Returns the salon id, or null when someone else changed the prospect first.
 */
export async function convertProspectInTx(tx: Prisma.TransactionClient, prospect: ConvertibleProspect, fallbackOwnerId: string): Promise<string | null> {
  const claimed = await tx.prospect.updateMany({ where: { id: prospect.id, status: prospect.status, salonId: null }, data: { status: "CONVERTI" } });
  if (!claimed.count) return null;
  const salon = await tx.salon.create({ data: await salonDataFromProspect(prospect, fallbackOwnerId) });
  await tx.prospect.update({ where: { id: prospect.id }, data: { salonId: salon.id } });
  await tx.salesTask.updateMany({ where: { prospectId: prospect.id }, data: { salonId: salon.id } });
  return salon.id;
}
