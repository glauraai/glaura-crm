import { prisma } from "@/lib/db";
import { processTranscriptWithEcho, purgeExpiredRawTranscripts } from "@/lib/agents/actions";
import { syncBillingAndCommissions } from "@/lib/commissions/stripe-sync";

const LOOP = process.argv.includes("--loop");
const POLL_MS = 20_000;
const BILLING_SYNC_INTERVAL_MS = 60 * 60 * 1000; // hourly
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

let lastBillingSync = 0;
let lastPurge = 0;

async function runOnce() {
  // 1. Process matched transcripts waiting for ECHO
  const pending = await prisma.transcriptRecord.findMany({
    where: { matchStatus: "MATCHED", echoProcessedAt: null },
    orderBy: { createdAt: "asc" },
    take: 10,
    select: { id: true, externalId: true },
  });

  for (const item of pending) {
    try {
      const res = await processTranscriptWithEcho(item.id);
      console.log(`[agents-worker] ECHO ${item.externalId}:`, res);
    } catch (err) {
      console.error(`[agents-worker] ECHO failed for ${item.externalId}:`, err);
    }
  }

  const now = Date.now();
  // 2. Hourly Stripe + Firestore prod-eu billing & commission sync
  if (now - lastBillingSync >= BILLING_SYNC_INTERVAL_MS) {
    lastBillingSync = now;
    try {
      const res = await syncBillingAndCommissions();
      console.log("[agents-worker] billing sync:", res);
    } catch (err) {
      console.error("[agents-worker] billing sync error:", err);
    }
  }

  // 3. Daily 12-month raw transcript RGPD purge
  if (now - lastPurge >= PURGE_INTERVAL_MS) {
    lastPurge = now;
    try {
      const purged = await purgeExpiredRawTranscripts();
      if (purged > 0) console.log(`[agents-worker] RGPD purged ${purged} raw transcripts older than 12 months.`);
    } catch (err) {
      console.error("[agents-worker] RGPD purge error:", err);
    }
  }
}

async function main() {
  console.log(`[agents-worker] starting (loop=${LOOP})`);
  do {
    await runOnce();
    if (LOOP) await new Promise((r) => setTimeout(r, POLL_MS));
  } while (LOOP);
}

main()
  .catch((err) => {
    console.error("[agents-worker] fatal:", err);
    process.exit(1);
  })
  .finally(async () => {
    if (!LOOP) await prisma.$disconnect();
  });
