import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canonicalizePhone } from "@/lib/phone";
import { parseAlloWebhook, verifyAlloSignature } from "@/lib/agents/allo";

/**
 * Signed webhook receiver for Allo (withallo.com): `call.completed` & `sms.received`.
 * Returns 200 OK immediately after persisting TranscriptRecord; ECHO processes asynchronously in agents-worker.
 */
export async function POST(req: Request) {
  const secret = process.env.ALLO_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "ALLO_WEBHOOK_SECRET not configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  const verified = verifyAlloSignature({
    rawBody,
    signature: req.headers.get("webhook-signature"),
    timestamp: req.headers.get("webhook-timestamp"),
    webhookId: req.headers.get("webhook-id"),
    secret,
  });

  if (!verified) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = parseAlloWebhook(body);
  if (!event) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (!["call.completed", "sms.received"].includes(event.topic)) {
    return NextResponse.json({ ok: true, ignoredTopic: event.topic });
  }

  // Auto-match by canonicalized phone on Contact first, then Salon.phone
  const normalizedPhone = event.prospectPhone ? canonicalizePhone(event.prospectPhone) : null;
  let matchedSalonId: string | null = null;
  let matchedContactId: string | null = null;
  let matchedOpportunityId: string | null = null;

  if (normalizedPhone) {
    const contact = await prisma.contact.findFirst({
      where: { phoneNormalized: normalizedPhone },
      select: { id: true, salonId: true },
    });
    if (contact) {
      matchedContactId = contact.id;
      matchedSalonId = contact.salonId;
    } else {
      const salons = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Salon"
        WHERE "archivedAt" IS NULL
          AND phone IS NOT NULL
          AND salon_phone_canonical(phone) = ${normalizedPhone}
        LIMIT 1
      `;
      if (salons[0]) matchedSalonId = salons[0].id;
    }
  }

  if (matchedSalonId) {
    const opp = await prisma.opportunity.findFirst({
      where: { salonId: matchedSalonId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    matchedOpportunityId = opp?.id ?? null;
  }

  await prisma.transcriptRecord.upsert({
    where: { externalId: event.externalId },
    create: {
      source: "ALLO",
      externalId: event.externalId,
      salonId: matchedSalonId,
      opportunityId: matchedOpportunityId,
      contactId: matchedContactId,
      callerPhone: event.prospectPhone,
      callDirection: event.callDirection,
      callResult: event.callResult,
      recordingUrl: event.recordingUrl,
      durationSec: event.durationSec,
      occurredAt: event.occurredAt,
      rawTranscript: event.rawTranscript,
      summary: event.summary,
      matchStatus: matchedSalonId ? "MATCHED" : "UNMATCHED",
    },
    update: {
      summary: event.summary ?? undefined,
      rawTranscript: event.rawTranscript ?? undefined,
      recordingUrl: event.recordingUrl ?? undefined,
      durationSec: event.durationSec ?? undefined,
    },
  });

  return NextResponse.json({ ok: true, matched: Boolean(matchedSalonId) });
}
