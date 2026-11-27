import { prisma } from "@/lib/db";
import { monthKeyForDate } from "@/lib/commissions/engine";
import { businessDiscoveryWithMedia, igGraphConfig, IgGraphAuthError, IgGraphRateLimitError, type IgRichProfile } from "@/lib/prospection/ig-graph";
import { tierForProspect } from "@/lib/prospection/tier";
import { parseLeadNotes } from "./notes-parser";
import { enrichCompanyFrance, type CompanyEnrichmentResult } from "./company-enrichment";
import { analyzeInstagramSignals } from "./ig-signals";
import { computeThreeMonthAudienceGrowth, scoreAccountGtm1Bis } from "./scoring";

export function computeRevenueBonus(input: {
  revenueEur?: number | null;
  revenueStatus?: string | null;
}): number {
  const rev = input.revenueEur ?? null;
  if (rev != null && rev >= 300_000) return 15;
  if (rev != null && rev >= 150_000) return 10;
  if (rev != null && rev >= 70_000) return 5;
  if (rev != null && rev > 0) return 2;
  if (input.revenueStatus === "CONFIDENTIAL") return 2;
  return 0;
}

export function computeCompositeRankScore(input: {
  gtmScore: number | null;
  revenueEur?: number | null;
  revenueStatus?: string | null;
}): number | null {
  if (input.gtmScore == null) return null;
  return Math.min(100, input.gtmScore + computeRevenueBonus(input));
}

export function normalizeIgHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^@+/, "").toLowerCase();
  return cleaned || null;
}

/**
 * Flags Instagram handles shared across 2+ distinct leads (typically a brand/supplier
 * or franchise handle pasted into a CSV) so they don't distort audience/video scoring.
 */
export function findSharedInstagramHandles(
  items: ReadonlyArray<{ dedupKey: string; handle: string | null | undefined }>,
): Set<string> {
  const seenByHandle = new Map<string, Set<string>>();
  for (const item of items) {
    const h = normalizeIgHandle(item.handle);
    if (!h) continue;
    const set = seenByHandle.get(h) ?? new Set<string>();
    set.add(item.dedupKey);
    seenByHandle.set(h, set);
  }
  const shared = new Set<string>();
  for (const [handle, keys] of seenByHandle.entries()) {
    if (keys.size > 1) shared.add(handle);
  }
  return shared;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export type EnrichmentPipelineOptions = {
  scope?: "assigned" | "all";
  ownerEmails?: string[];
  limit?: number;
  igBudget?: number; // max Meta Business Discovery calls per run (stay safely < 200/hr)
  checkBodacc?: boolean;
  onlyUnenriched?: boolean;
  dryRun?: boolean;
  log?: (msg: string) => void;
};

export type EnrichmentPipelineStats = {
  salonsProcessed: number;
  prospectsProcessed: number;
  sireneMatched: number;
  revenuePublished: number;
  revenueConfidential: number;
  igEnriched: number;
  igRateLimited: boolean;
  snapshotsUpserted: number;
  chainsDetected: number;
  priorityCounts: Record<string, number>;
};

export async function runEnrichmentAndRankingPipeline(
  options: EnrichmentPipelineOptions = {},
): Promise<EnrichmentPipelineStats> {
  const scope = options.scope ?? "assigned";
  const limit = options.limit ?? 300;
  const igBudget = options.igBudget ?? 120;
  const checkBodacc = options.checkBodacc ?? true;
  const onlyUnenriched = options.onlyUnenriched ?? false;
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? (() => {});
  const now = new Date();
  const monthKey = monthKeyForDate(now);
  const igCfg = igGraphConfig();

  let ownerIds: string[] | undefined;
  if (options.ownerEmails && options.ownerEmails.length > 0) {
    const users = await prisma.user.findMany({
      where: { email: { in: options.ownerEmails.map((e) => e.toLowerCase()) } },
      select: { id: true },
    });
    ownerIds = users.map((u) => u.id);
  }

  // 1. Load Salons (assigned first!)
  const salons = await prisma.salon.findMany({
    where: {
      archivedAt: null,
      ...(ownerIds
        ? { assignedToId: { in: ownerIds } }
        : scope === "assigned"
          ? { assignedToId: { not: null } }
          : {}),
      ...(onlyUnenriched ? { gtmScoredAt: null } : {}),
    },
    orderBy: [{ assignedToId: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
    take: limit,
    include: {
      prospect: true,
      socialSnapshots: { orderBy: { monthKey: "asc" }, take: 6 },
    },
  });

  // 2. Load unconverted Prospects (assigned NOUVEAU first!)
  const remainingLimit = Math.max(0, limit - salons.length);
  const prospects =
    remainingLimit > 0
      ? await prisma.prospect.findMany({
          where: {
            status: { in: ["NOUVEAU", "EN_TOURNEE"] },
            ...(ownerIds
              ? { assignedToId: { in: ownerIds } }
              : scope === "assigned"
                ? { assignedToId: { not: null } }
                : {}),
            ...(onlyUnenriched ? { OR: [{ gtmScoredAt: null }, { companyMatchStatus: null }] } : {}),
          },
          orderBy: [{ assignedToId: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
          take: remainingLimit,
          include: {
            socialSnapshots: { orderBy: { monthKey: "asc" }, take: 6 },
          },
        })
      : [];

  // Shared IG handle detection across the batch (dedupKey uses normalized name+postalCode)
  const sharedIgHandles = findSharedInstagramHandles([
    ...salons.map((s) => ({
      dedupKey: `${s.name.toLowerCase().trim()}|${s.prospect?.postalCode ?? ""}`,
      handle: s.instagram || s.prospect?.instagram,
    })),
    ...prospects.map((p) => ({
      dedupKey: `${p.name.toLowerCase().trim()}|${p.postalCode ?? ""}`,
      handle: p.instagram,
    })),
  ]);

  const companyCache = new Map<string, CompanyEnrichmentResult>();
  const igCache = new Map<string, IgRichProfile | null>();
  let igCalls = 0;
  let igRateLimited = false;

  const stats: EnrichmentPipelineStats = {
    salonsProcessed: 0,
    prospectsProcessed: 0,
    sireneMatched: 0,
    revenuePublished: 0,
    revenueConfidential: 0,
    igEnriched: 0,
    igRateLimited: false,
    snapshotsUpserted: 0,
    chainsDetected: 0,
    priorityCounts: {},
  };

  async function lookupCompany(input: {
    name: string;
    postalCode?: string | null;
    address?: string | null;
    siret?: string | null;
  }): Promise<CompanyEnrichmentResult> {
    const key = `${input.name.toLowerCase().trim()}|${input.postalCode ?? ""}`;
    const cached = companyCache.get(key);
    if (cached) return cached;
    const res = await enrichCompanyFrance(input, { checkBodacc, now });
    companyCache.set(key, res);
    await sleep(160);
    return res;
  }

  async function lookupIg(handle: string | null): Promise<IgRichProfile | null> {
    if (!handle || !igCfg || igRateLimited || igCalls >= igBudget) return null;
    if (igCache.has(handle)) return igCache.get(handle) ?? null;
    igCalls++;
    try {
      const profile = await businessDiscoveryWithMedia(handle, igCfg);
      igCache.set(handle, profile);
      if (profile) stats.igEnriched++;
      await sleep(140);
      return profile;
    } catch (err) {
      if (err instanceof IgGraphRateLimitError || err instanceof IgGraphAuthError) {
        igRateLimited = true;
        stats.igRateLimited = true;
        log(`[GTM pipeline] IG Graph paused: ${err.message}`);
        return null;
      }
      igCache.set(handle, null);
      return null;
    }
  }

  // Process Salons
  for (const s of salons) {
    const combinedNotes = `${s.notes ?? ""}\n${s.prospect?.notes ?? ""}`;
    const parsedNotes = parseLeadNotes(combinedNotes);
    const postalCode = s.prospect?.postalCode ?? s.address?.match(/\b(\d{5})\b/)?.[1] ?? null;

    const company = await lookupCompany({
      name: s.name,
      postalCode,
      address: s.address,
      siret: s.siret ?? s.prospect?.siret ?? null,
    });
    if (company.companyMatchStatus !== "UNRESOLVED") stats.sireneMatched++;
    if (company.revenueStatus === "PUBLISHED") stats.revenuePublished++;
    if (company.revenueStatus === "CONFIDENTIAL") stats.revenueConfidential++;
    if (company.isChainOrFranchise) stats.chainsDetected++;

    const cleanHandle = normalizeIgHandle(s.instagram || s.prospect?.instagram);
    const isSharedHandle = Boolean(cleanHandle && sharedIgHandles.has(cleanHandle));
    const rawIg = !isSharedHandle && cleanHandle ? await lookupIg(cleanHandle) : null;
    const igSignals = rawIg
      ? analyzeInstagramSignals(
          {
            handle: rawIg.username,
            followers: rawIg.followers ?? s.prospect?.instagramFollowers,
            mediaCount: rawIg.mediaCount,
            biography: rawIg.biography,
            website: rawIg.bioLinks[0] ?? null,
            recentMedia: rawIg.recentMedia,
          },
          now,
        )
      : null;

    const followers = isSharedHandle ? null : (igSignals?.followers ?? s.prospect?.instagramFollowers ?? null);
    const growth = computeThreeMonthAudienceGrowth(s.socialSnapshots);
    const hasPlanity =
      s.bookingTool === "PLANITY" ||
      Boolean(s.prospect?.planityUrl) ||
      parsedNotes.hasPlanityHint ||
      Boolean(igSignals?.detectedPlanity);
    const hasTreatwell =
      s.bookingTool === "TREATWELL" ||
      Boolean(s.prospect?.treatwellUrl) ||
      parsedNotes.hasTreatwellHint ||
      Boolean(igSignals?.detectedTreatwell);
    const hasOtherTool =
      ["BOOKSY", "FRESHA", "ACUITY"].includes(s.bookingTool) ||
      parsedNotes.hasOtherToolHint ||
      Boolean(igSignals?.detectedOtherTool);

    const staffCount = parsedNotes.staffCount ?? company.staffEstimate;
    const rating = s.rating ?? s.prospect?.googleRating ?? s.prospect?.rating ?? parsedNotes.ratingHint;
    const reviewCount = s.prospect?.googleReviewCount ?? s.prospect?.reviewCount ?? parsedNotes.reviewCountHint ?? 0;

    const gtm = scoreAccountGtm1Bis({
      alreadyClient: s.status === "SIGNE" || Boolean(s.providerId && s.activatedAt),
      isChainOrFranchise: company.isChainOrFranchise || s.prospect?.aiOwnership === "chain_or_franchise",
      instagramHandle: isSharedHandle ? null : cleanHandle,
      igStatus: rawIg ? "CONFIRME" : s.prospect?.igStatus ?? (cleanHandle ? "A_VALIDER" : "A_FAIRE"),
      hasPlanity,
      hasTreatwell,
      hasOtherBookingTool: hasOtherTool,
      videosPerWeek: igSignals?.videosPerWeek ?? null,
      postsVideos: igSignals?.postsVideos ?? Boolean(parsedNotes.tiktokHandle),
      instagramFollowers: followers,
      bookingFriction: igSignals?.bookingFriction ?? false,
      staffCount,
      hasTimingSignal: company.isRecentOpening || Boolean(igSignals?.hiringSignal),
      threeMonthGrowthPct: growth.growthPct,
      googleRating: rating,
      googleReviewCount: reviewCount,
      sellsProducts: Boolean(igSignals?.sellsProducts) || parsedNotes.sellsProductsHint,
      postalCode,
      zone: s.prospect?.zone ?? null,
      address: s.address,
      isInboundLead: Boolean(s.priorityLabel?.includes("Lead entrant")),
    });

    const compositeScore = computeCompositeRankScore({
      gtmScore: gtm.score,
      revenueEur: company.revenueEur,
      revenueStatus: company.revenueStatus,
    });

    stats.priorityCounts[gtm.priority] = (stats.priorityCounts[gtm.priority] ?? 0) + 1;
    stats.salonsProcessed++;

    if (!dryRun) {
      const breakdownPayload = {
        igUnverified: gtm.igUnverified,
        sharedIgHandle: isSharedHandle,
        filterReason: gtm.filterReason,
        growthPct: growth.growthPct,
        igFollowers: followers,
        videosPerWeek: igSignals?.videosPerWeek ?? null,
        staffCount,
        revenueEur: company.revenueEur,
        netResultEur: company.netResultEur,
        revenueYear: company.revenueYear,
        revenueStatus: company.revenueStatus,
        legalEntity: company.legalEntity,
        siren: company.siren,
        filingUrl: company.filingUrl,
        compositeScore,
        criteria: gtm.breakdown,
      } as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue;

      await prisma.salon.update({
        where: { id: s.id },
        data: {
          siret: s.siret ?? company.siret ?? undefined,
          gtmScore: gtm.score,
          gtmPriority: gtm.priority,
          gtmAngle: gtm.angle,
          gtmScoreBreakdown: breakdownPayload,
          gtmScoredAt: now,
        },
      });

      if (s.prospect?.id) {
        await prisma.prospect.update({
          where: { id: s.prospect.id },
          data: {
            legalEntity: company.legalEntity ?? s.prospect.legalEntity,
            siren: company.siren ?? s.prospect.siren,
            siret: company.siret ?? s.prospect.siret,
            activeSites: company.activeSites ?? s.prospect.activeSites,
            companyMatchStatus: company.companyMatchStatus,
            revenueEur: company.revenueEur ?? s.prospect.revenueEur,
            revenueYear: company.revenueYear ?? s.prospect.revenueYear,
            revenueStatus: company.revenueStatus,
            filingUrl: company.filingUrl ?? s.prospect.filingUrl,
            aiOwnership: company.isChainOrFranchise ? "chain_or_franchise" : "independent_indicated",
            aiScore: compositeScore ?? s.prospect.aiScore,
            aiScoredAt: compositeScore != null ? now : s.prospect.aiScoredAt,
            ...(rawIg
              ? {
                  instagramFollowers: rawIg.followers ?? s.prospect.instagramFollowers,
                  igStatus: "CONFIRME",
                  igCheckedAt: now,
                  tier: tierForProspect({ instagramFollowers: rawIg.followers }),
                }
              : {}),
            gtmScore: gtm.score,
            gtmPriority: gtm.priority,
            gtmAngle: gtm.angle,
            gtmScoreBreakdown: breakdownPayload,
            gtmScoredAt: now,
          },
        });
      }

      if (followers != null || rating != null) {
        await prisma.socialSnapshot.upsert({
          where: { salonId_monthKey: { salonId: s.id, monthKey } },
          create: {
            salonId: s.id,
            monthKey,
            igFollowers: followers,
            igPosts: igSignals?.mediaCount ?? null,
            googleReviews: reviewCount > 0 ? reviewCount : null,
            googleRating: rating,
          },
          update: {
            igFollowers: followers ?? undefined,
            igPosts: igSignals?.mediaCount ?? undefined,
            googleReviews: reviewCount > 0 ? reviewCount : undefined,
            googleRating: rating ?? undefined,
          },
        });
        stats.snapshotsUpserted++;
      }
    }
  }

  // Process unconverted Prospects
  for (const p of prospects) {
    const parsedNotes = parseLeadNotes(p.notes);
    const company = await lookupCompany({
      name: p.name,
      postalCode: p.postalCode,
      address: p.address,
      siret: p.siret,
    });
    if (company.companyMatchStatus !== "UNRESOLVED") stats.sireneMatched++;
    if (company.revenueStatus === "PUBLISHED") stats.revenuePublished++;
    if (company.revenueStatus === "CONFIDENTIAL") stats.revenueConfidential++;
    if (company.isChainOrFranchise) stats.chainsDetected++;

    const cleanHandle = normalizeIgHandle(p.instagram);
    const isSharedHandle = Boolean(cleanHandle && sharedIgHandles.has(cleanHandle));
    const rawIg = !isSharedHandle && cleanHandle ? await lookupIg(cleanHandle) : null;
    const igSignals = rawIg
      ? analyzeInstagramSignals(
          {
            handle: rawIg.username,
            followers: rawIg.followers ?? p.instagramFollowers,
            mediaCount: rawIg.mediaCount,
            biography: rawIg.biography,
            website: rawIg.bioLinks[0] ?? null,
            recentMedia: rawIg.recentMedia,
          },
          now,
        )
      : null;

    const followers = isSharedHandle ? null : (igSignals?.followers ?? p.instagramFollowers ?? null);
    const growth = computeThreeMonthAudienceGrowth(p.socialSnapshots);
    const hasPlanity =
      Boolean(p.planityUrl) ||
      p.source === "PLANITY" ||
      parsedNotes.hasPlanityHint ||
      Boolean(igSignals?.detectedPlanity);
    const hasTreatwell =
      Boolean(p.treatwellUrl) ||
      p.source === "TREATWELL" ||
      parsedNotes.hasTreatwellHint ||
      Boolean(igSignals?.detectedTreatwell);
    const hasOtherTool =
      p.source === "BOOKSY" ||
      p.source === "FRESHA" ||
      parsedNotes.hasOtherToolHint ||
      Boolean(igSignals?.detectedOtherTool);

    const staffCount = parsedNotes.staffCount ?? company.staffEstimate;
    const rating = p.googleRating ?? p.rating ?? parsedNotes.ratingHint;
    const reviewCount = p.googleReviewCount ?? (p.reviewCount > 0 ? p.reviewCount : parsedNotes.reviewCountHint ?? 0);

    const gtm = scoreAccountGtm1Bis({
      alreadyClient: p.status === "DEJA_CRM",
      isChainOrFranchise: company.isChainOrFranchise || p.aiOwnership === "chain_or_franchise",
      instagramHandle: isSharedHandle ? null : cleanHandle,
      igStatus: rawIg ? "CONFIRME" : p.igStatus,
      hasPlanity,
      hasTreatwell,
      hasOtherBookingTool: hasOtherTool,
      videosPerWeek: igSignals?.videosPerWeek ?? null,
      postsVideos: igSignals?.postsVideos ?? Boolean(parsedNotes.tiktokHandle),
      instagramFollowers: followers,
      bookingFriction: igSignals?.bookingFriction ?? false,
      staffCount,
      hasTimingSignal: company.isRecentOpening || Boolean(igSignals?.hiringSignal),
      threeMonthGrowthPct: growth.growthPct,
      googleRating: rating,
      googleReviewCount: reviewCount,
      sellsProducts: Boolean(igSignals?.sellsProducts) || parsedNotes.sellsProductsHint,
      postalCode: p.postalCode,
      zone: p.zone,
      address: p.address,
    });

    const compositeScore = computeCompositeRankScore({
      gtmScore: gtm.score,
      revenueEur: company.revenueEur,
      revenueStatus: company.revenueStatus,
    });

    stats.priorityCounts[gtm.priority] = (stats.priorityCounts[gtm.priority] ?? 0) + 1;
    stats.prospectsProcessed++;

    if (!dryRun) {
      const breakdownPayload = {
        igUnverified: gtm.igUnverified,
        sharedIgHandle: isSharedHandle,
        filterReason: gtm.filterReason,
        growthPct: growth.growthPct,
        igFollowers: followers,
        videosPerWeek: igSignals?.videosPerWeek ?? null,
        staffCount,
        revenueEur: company.revenueEur,
        netResultEur: company.netResultEur,
        revenueYear: company.revenueYear,
        revenueStatus: company.revenueStatus,
        legalEntity: company.legalEntity,
        siren: company.siren,
        filingUrl: company.filingUrl,
        compositeScore,
        criteria: gtm.breakdown,
      } as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue;

      await prisma.prospect.update({
        where: { id: p.id },
        data: {
          legalEntity: company.legalEntity ?? p.legalEntity,
          siren: company.siren ?? p.siren,
          siret: company.siret ?? p.siret,
          activeSites: company.activeSites ?? p.activeSites,
          companyMatchStatus: company.companyMatchStatus,
          revenueEur: company.revenueEur ?? p.revenueEur,
          revenueYear: company.revenueYear ?? p.revenueYear,
          revenueStatus: company.revenueStatus,
          filingUrl: company.filingUrl ?? p.filingUrl,
          aiOwnership: company.isChainOrFranchise ? "chain_or_franchise" : "independent_indicated",
          aiScore: compositeScore ?? p.aiScore,
          aiScoredAt: compositeScore != null ? now : p.aiScoredAt,
          ...(rawIg
            ? {
                instagramFollowers: rawIg.followers ?? p.instagramFollowers,
                igStatus: "CONFIRME",
                igCheckedAt: now,
                tier: tierForProspect({ instagramFollowers: rawIg.followers }),
              }
            : {}),
          gtmScore: gtm.score,
          gtmPriority: gtm.priority,
          gtmAngle: gtm.angle,
          gtmScoreBreakdown: breakdownPayload,
          gtmScoredAt: now,
        },
      });

      if (followers != null || reviewCount > 0) {
        await prisma.socialSnapshot.upsert({
          where: { prospectId_monthKey: { prospectId: p.id, monthKey } },
          create: {
            prospectId: p.id,
            monthKey,
            igFollowers: followers,
            igPosts: igSignals?.mediaCount ?? null,
            googleReviews: reviewCount,
            googleRating: rating,
          },
          update: {
            igFollowers: followers ?? undefined,
            igPosts: igSignals?.mediaCount ?? undefined,
            googleReviews: reviewCount,
            googleRating: rating ?? undefined,
          },
        });
        stats.snapshotsUpserted++;
      }
    }
  }

  return stats;
}
