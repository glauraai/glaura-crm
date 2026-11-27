"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canAccessSalonInstagram, requireMember } from "@/lib/access";
import { prisma } from "@/lib/db";
import { inboxConfig, metaRequest } from "./client";
import { instagramReplyAllowed } from "./security";
import { storeInstagramMessage } from "./store";

export async function replySalonInstagram(fd: FormData) {
  const user = await requireMember();
  const salonId = z.string().min(1).parse(fd.get("salonId"));
  const conversationId = z.string().min(1).parse(fd.get("conversationId"));
  const text = z.string().trim().min(1).max(1000).parse(fd.get("text"));

  let error: string | null = null;
  try {
    const salon = await prisma.salon.findFirst({
      where: { id: salonId, archivedAt: null },
      select: { id: true, assignedToId: true },
    });
    if (!salon || !canAccessSalonInstagram(user, salon)) {
      throw new Error("Accès refusé à cette conversation Instagram.");
    }

    const conversation = await prisma.instagramConversation.findFirst({
      where: { id: conversationId, salonId: salon.id },
    });
    if (!conversation) throw new Error("Conversation Instagram non liée à ce salon.");
    if (!instagramReplyAllowed(conversation.lastInboundAt)) {
      throw new Error("La fenêtre de réponse Meta de 24 heures est fermée.");
    }

    const config = await inboxConfig();
    if (!config) throw new Error("Connexion Instagram non configurée sur le serveur.");

    const sent = await metaRequest<{ message_id: string }>(
      `${config.accountId}/messages`,
      { method: "POST", body: { recipient: { id: conversation.participantId }, message: { text } } },
      config,
    );

    await storeInstagramMessage(config.accountId, {
      id: sent.message_id,
      participantId: conversation.participantId,
      incoming: false,
      text,
      sentAt: new Date(),
    });
    await prisma.instagramMessage.updateMany({
      where: { id: sent.message_id },
      data: { sentByUserId: user.id },
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Envoi Instagram impossible.";
  }

  revalidatePath(`/salons/${salonId}`);
  revalidatePath("/instagram");
  if (error) redirect(`/salons/${salonId}?igError=${encodeURIComponent(error)}`);
  redirect(`/salons/${salonId}`);
}
