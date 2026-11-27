import { prisma } from "@/lib/db";
import { processTranscriptWithEcho, purgeExpiredRawTranscripts } from "@/lib/agents/actions";
import { syncBillingAndCommissions } from "@/lib/commissions/stripe-sync";
import { ensureMondaySentinelDigest, runSentinelSweep } from "@/lib/agents/sentinel";
import { runScoutUpcomingSweep } from "@/lib/agents/scout";
import { evaluateTranscriptWithMentor, runWeeklyPlaybookLearning } from "@/lib/agents/mentor";
import { runPortfolioInactivitySweep } from "@/lib/agents/inactivity";
import { runGtmRescoreAndSnapshots } from "@/lib/gtm/routing";

const LOOP = process.argv.includes("--loop");
const POLL_MS = 20_000;
const SCOUT_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes
const HOURLY_INTERVAL_MS = 60 * 60 * 1000; // hourly (billing sync + SENTINEL)
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily (RGPD purge, inactivity, snapshots/GTM, weekly MENTOR)

let lastScout = 0;
let lastHourly = 0;
let lastDaily = 0;

async function runOnce() {
  // 1. Process matched transcripts waiting for ECHO
  const pendingEcho = await prisma.transcriptRecord.findMany({
    where: { matchStatus: "MATCHED", echoProcessedAt: null },
    orderBy: { createdAt: "asc" },
    take: 10,
    select: { id: true, externalId: true },
  });

  for (const item of pendingEcho) {
    try {
      const res = await processTranscriptWithEcho(item.id);
      console.log(`[agents-worker] ECHO ${item.externalId}:`, res);
    } catch (err) {
      console.error(`[agents-worker] ECHO failed for ${item.externalId}:`, err);
    }
  }

  // 2. Process ECHO-completed transcripts waiting for MENTOR 8-step coaching evaluation
  const pendingMentor = await prisma.transcriptRecord.findMany({
    where: { matchStatus: "MATCHED", echoProcessedAt: { not: null }, mentorProcessedAt: null },
    orderBy: { createdAt: "asc" },
    take: 10,
    select: { id: true, externalId: true },
  });

  for (const item of pendingMentor) {
    try {
      const res = await evaluateTranscriptWithMentor(item.id);
      console.log(`[agents-worker] MENTOR ${item.externalId}:`, res);
    } catch (err) {
      console.error(`[agents-worker] MENTOR failed for ${item.externalId}:`, err);
    }
  }

  const now = Date.now();

  // 3. Every 30m: SCOUT J-1 / H-1 prep briefs for upcoming meetings
  if (now - lastScout >= SCOUT_INTERVAL_MS) {
    lastScout = now;
    try {
      const res = await runScoutUpcomingSweep();
      if (res.generated > 0) console.log("[agents-worker] SCOUT sweep:", res);
    } catch (err) {
      console.error("[agents-worker] SCOUT sweep error:", err);
    }
  }

  // 4. Hourly: Stripe/Firestore billing sync + SENTINEL deal risk sweep + Monday digest
  if (now - lastHourly >= HOURLY_INTERVAL_MS) {
    lastHourly = now;
    try {
      const res = await syncBillingAndCommissions();
      console.log("[agents-worker] billing sync:", res);
    } catch (err) {
      console.error("[agents-worker] billing sync error:", err);
    }

    try {
      const res = await runSentinelSweep();
      console.log("[agents-worker] SENTINEL sweep:", res);
      await ensureMondaySentinelDigest();
    } catch (err) {
      console.error("[agents-worker] SENTINEL error:", err);
    }
  }

  // 5. Daily: RGPD 12m purge, 3-month portfolio inactivity sweep, GTM 1 bis rescore + monthly SocialSnapshot, weekly MENTOR learning
  if (now - lastDaily >= DAILY_INTERVAL_MS) {
    lastDaily = now;
    try {
      const purged = await purgeExpiredRawTranscripts();
      if (purged > 0) console.log(`[agents-worker] RGPD purged ${purged} raw transcripts.`);
    } catch (err) {
      console.error("[agents-worker] RGPD purge error:", err);
    }

    try {
      const inactivity = await runPortfolioInactivitySweep();
      console.log("[agents-worker] portfolio inactivity sweep:", inactivity);
    } catch (err) {
      console.error("[agents-worker] portfolio inactivity error:", err);
    }

    try {
      const gtm = await runGtmRescoreAndSnapshots();
      console.log("[agents-worker] GTM 1 bis rescore & snapshots:", gtm);
    } catch (err) {
      console.error("[agents-worker] GTM rescore error:", err);
    }

    try {
      const learning = await runWeeklyPlaybookLearning();
      console.log("[agents-worker] MENTOR weekly learning:", learning);
    } catch (err) {
      console.error("[agents-worker] MENTOR weekly learning error:", err);
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
