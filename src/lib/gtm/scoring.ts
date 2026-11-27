export type GtmPriority = "A" | "B" | "C" | "CHAINE" | "HORS_CIBLE" | "EXCLU";

export const SALES_ANGLES = [
  "Acquisition et conversion",
  "Fidélisation et marketing",
  "Messages et appels hors horaires (Laura IA)",
  "Synchronisation d'agenda",
  "Réservation depuis les vidéos",
  "Gestion et pilotage",
] as const;

export type SalesAngle = (typeof SALES_ANGLES)[number];

export type GtmScoreInput = {
  // Pre-filters
  alreadyClient?: boolean;
  isChainOrFranchise?: boolean;
  instagramHandle?: string | null;
  igStatus?: string | null; // A_FAIRE | CONFIRME | A_VALIDER | INTROUVABLE | ERREUR
  // 1. Booking tools (20 pts if Planity + Treatwell, 10 pts if 1 tool)
  hasPlanity?: boolean;
  hasTreatwell?: boolean;
  hasOtherBookingTool?: boolean;
  // 2. Video cadence (15 pts >= 1/wk, 7 pts occasional)
  videosPerWeek?: number | null;
  postsVideos?: boolean;
  // 3. Audience max(IG, TikTok) (0 / 5 / 10 / 5)
  instagramFollowers?: number | null;
  tiktokFollowers?: number | null;
  // 4. Booking friction (15 pts)
  bookingFriction?: boolean;
  // 5. Practitioner / calendar count (15 pts for 2..10, 5 pts for 1)
  staffCount?: number | null;
  // 6. Timing signal (10 pts)
  hasTimingSignal?: boolean;
  hasUnreachableReview?: boolean;
  threeMonthGrowthPct?: number | null;
  // 7. Google rating >= 4.5 & >= 100 reviews (5 pts)
  googleRating?: number | null;
  googleReviewCount?: number | null;
  // 8. Sells retail products (5 pts)
  sellsProducts?: boolean;
  // 9. Target IDF zone: Paris (75), 92, 93, 94, 91 (5 pts)
  postalCode?: string | null;
  zone?: string | null;
  address?: string | null;
  // Special rule (p. 10): inbound "Être appelé" always forces Priority A
  isInboundLead?: boolean;
};

export type GtmCriterionBreakdown = {
  key: string;
  label: string;
  points: number;
  maxPoints: number;
  detail: string;
};

export type GtmScoreResult = {
  score: number | null; // null for EXCLU / CHAINE / HORS_CIBLE
  priority: GtmPriority;
  angle: SalesAngle | null;
  igUnverified: boolean;
  filterReason: string | null;
  breakdown: GtmCriterionBreakdown[];
};

const TARGET_DEPTS = new Set(["75", "91", "92", "93", "94"]);

export function isTargetIdfZone(input: { postalCode?: string | null; zone?: string | null; address?: string | null }): boolean {
  const pc = input.postalCode?.trim() ?? "";
  if (/^\d{5}$/.test(pc) && TARGET_DEPTS.has(pc.slice(0, 2))) return true;
  const zone = input.zone?.toLowerCase() ?? "";
  if (zone.startsWith("paris") || /^(91|92|93|94)-/.test(zone) || zone.includes("hauts-de-seine") || zone.includes("seine-saint-denis") || zone.includes("val-de-marne") || zone.includes("essonne")) {
    return true;
  }
  const addr = input.address ?? "";
  const match = addr.match(/\b(75|91|92|93|94)\d{3}\b/);
  return Boolean(match);
}

/**
 * Computes 3-month audience growth percentage from monthly SocialSnapshot history.
 * Per brief p. 9:
 * - Requires at least 3 monthly readings.
 * - Ignores sudden unnatural spikes (> 150% single-month jump, e.g. giveaway / bought followers).
 * - Declining audiences stay neutral (returned as null/0 for scoring).
 */
export function computeThreeMonthAudienceGrowth(
  snapshots: ReadonlyArray<{ monthKey: string; igFollowers?: number | null; tiktokFollowers?: number | null }>,
): { growthPct: number | null; strongGrowth: boolean; spikeIgnored: boolean } {
  const ordered = [...snapshots]
    .map((s) => ({
      monthKey: s.monthKey,
      audience: Math.max(s.igFollowers ?? 0, s.tiktokFollowers ?? 0),
    }))
    .filter((s) => s.audience > 0)
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  if (ordered.length < 3) {
    return { growthPct: null, strongGrowth: false, spikeIgnored: false };
  }

  const recent = ordered.slice(-3);
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1].audience;
    const curr = recent[i].audience;
    if (prev > 0 && (curr - prev) / prev > 1.5) {
      return { growthPct: null, strongGrowth: false, spikeIgnored: true };
    }
  }

  const start = recent[0].audience;
  const end = recent[recent.length - 1].audience;
  const growthPct = Math.round(((end - start) / start) * 1000) / 10;
  return {
    growthPct,
    strongGrowth: growthPct >= 15,
    spikeIgnored: false,
  };
}

/**
 * Brief p. 10: From December 20 to December 31 inclusive (Europe/Paris),
 * the CRM does not create call/visit tasks and pauses C-tier email campaigns.
 */
export function isDecemberPause(date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const month = Number(parts.find((p) => p.type === "month")?.value ?? 0);
  const day = Number(parts.find((p) => p.type === "day")?.value ?? 0);
  return month === 12 && day >= 20 && day <= 31;
}

export function scoreAccountGtm1Bis(input: GtmScoreInput): GtmScoreResult {
  // Pre-filter 3: already a client
  if (input.alreadyClient) {
    return {
      score: null,
      priority: "EXCLU",
      angle: null,
      igUnverified: false,
      filterReason: "Déjà client Glaura (exclu du scoring).",
      breakdown: [],
    };
  }

  // Pre-filter 2: chain or franchise
  if (input.isChainOrFranchise) {
    return {
      score: null,
      priority: "CHAINE",
      angle: null,
      igUnverified: false,
      filterReason: "Chaîne ou franchise — à remonter aux cofondateurs.",
      breakdown: [],
    };
  }

  // Pre-filter 1: confirmed no active Instagram (preserve "IG non vérifié" vs confirmed "Hors cible")
  const hasIgHandle = Boolean(input.instagramHandle?.trim());
  const igConfirmedMissing = !hasIgHandle && input.igStatus === "INTROUVABLE";
  const igUnverified = !hasIgHandle && !igConfirmedMissing;

  if (igConfirmedMissing && !input.isInboundLead) {
    return {
      score: null,
      priority: "HORS_CIBLE",
      angle: null,
      igUnverified: false,
      filterReason: "Aucun Instagram actif confirmé (Hors cible).",
      breakdown: [],
    };
  }

  // 1. Booking tools (20 / 10 / 0)
  const bothTools = Boolean(input.hasPlanity && input.hasTreatwell);
  const oneTool = !bothTools && Boolean(input.hasPlanity || input.hasTreatwell || input.hasOtherBookingTool);
  const toolsPts = bothTools ? 20 : oneTool ? 10 : 0;

  // 2. Video cadence (15 / 7 / 0)
  const videoPts =
    (input.videosPerWeek ?? 0) >= 1 ? 15 : input.postsVideos || (input.videosPerWeek ?? 0) > 0 ? 7 : 0;

  // 3. Audience max(IG, TikTok) (0 / 5 / 10 / 5)
  const audience = Math.max(input.instagramFollowers ?? 0, input.tiktokFollowers ?? 0);
  const audiencePts =
    audience >= 2000 && audience <= 20000
      ? 10
      : audience >= 1000
        ? 5
        : 0;

  // 4. Booking friction (15 / 0)
  const frictionPts = input.bookingFriction ? 15 : 0;

  // 5. Staff / calendars (15 for 2..10, 5 for solo/1)
  const staff = input.staffCount ?? null;
  const staffPts = staff != null && staff >= 2 && staff <= 10 ? 15 : staff === 1 ? 5 : 0;

  // 6. Timing signal (10 / 0)
  const strongGrowth = (input.threeMonthGrowthPct ?? 0) >= 15;
  const timingPts = input.hasTimingSignal || input.hasUnreachableReview || strongGrowth ? 10 : 0;

  // 7. Google rating >= 4.5 & >= 100 reviews (5 / 0)
  const googlePts =
    (input.googleRating ?? 0) >= 4.5 && (input.googleReviewCount ?? 0) >= 100 ? 5 : 0;

  // 8. Sells products (5 / 0)
  const productsPts = input.sellsProducts ? 5 : 0;

  // 9. Covered IDF zone (5 / 0)
  const zonePts = isTargetIdfZone(input) ? 5 : 0;

  const breakdown: GtmCriterionBreakdown[] = [
    {
      key: "booking_tools",
      label: "Outil de réservation",
      points: toolsPts,
      maxPoints: 20,
      detail: bothTools ? "Planity + Treatwell" : oneTool ? "Un outil détecté" : "Aucun outil détecté",
    },
    {
      key: "videos",
      label: "Vidéos IG / TikTok",
      points: videoPts,
      maxPoints: 15,
      detail: videoPts === 15 ? "≥ 1 vidéo / semaine" : videoPts === 7 ? "Vidéos ponctuelles" : "Non détecté",
    },
    {
      key: "audience",
      label: "Audience réseaux",
      points: audiencePts,
      maxPoints: 10,
      detail: audience > 0 ? `${audience.toLocaleString("fr-FR")} abonnés` : igUnverified ? "IG non vérifié" : "< 1 000 abonnés",
    },
    {
      key: "booking_friction",
      label: "Réservation qui coince",
      points: frictionPts,
      maxPoints: 15,
      detail: frictionPts > 0 ? "Friction bio / DM / commentaires" : "Non détecté",
    },
    {
      key: "staff",
      label: "Nombre d’agendas",
      points: staffPts,
      maxPoints: 15,
      detail: staff != null ? `${staff} praticien(s)` : "Inconnu",
    },
    {
      key: "timing_signal",
      label: "Signal du moment",
      points: timingPts,
      maxPoints: 10,
      detail: input.hasUnreachableReview
        ? "Avis « impossible à joindre »"
        : strongGrowth
          ? `Croissance audience +${input.threeMonthGrowthPct}% (3 mois)`
          : input.hasTimingSignal
            ? "Signal actif détecté"
            : "Aucun signal",
    },
    {
      key: "google_reputation",
      label: "Note Google",
      points: googlePts,
      maxPoints: 5,
      detail:
        input.googleRating != null
          ? `${input.googleRating}/5 (${input.googleReviewCount ?? 0} avis)`
          : "Non renseigné",
    },
    {
      key: "products",
      label: "Vente de produits",
      points: productsPts,
      maxPoints: 5,
      detail: productsPts > 0 ? "Vend des produits" : "Non détecté",
    },
    {
      key: "zone",
      label: "Zone couverte (IDF)",
      points: zonePts,
      maxPoints: 5,
      detail: zonePts > 0 ? "Paris / 91 / 92 / 93 / 94" : "Hors zone IDF prioritaire",
    },
  ];

  const score = breakdown.reduce((sum, item) => sum + item.points, 0);
  const priority: GtmPriority = input.isInboundLead
    ? "A"
    : score >= 70
      ? "A"
      : score >= 45
        ? "B"
        : "C";

  // Recommended sales angle from highest-impact signals (brief pp. 9 & 17)
  let angle: SalesAngle = "Fidélisation et marketing";
  if (bothTools) {
    angle = "Synchronisation d'agenda";
  } else if (input.hasUnreachableReview) {
    angle = "Messages et appels hors horaires (Laura IA)";
  } else if (frictionPts > 0 || videoPts >= 15) {
    angle = "Réservation depuis les vidéos";
  } else if (audiencePts === 10) {
    angle = "Acquisition et conversion";
  } else if (staffPts === 15 && audiencePts === 0 && videoPts === 0) {
    angle = "Gestion et pilotage";
  }

  return {
    score,
    priority,
    angle,
    igUnverified,
    filterReason: null,
    breakdown,
  };
}

export function gtmPriorityBadgeStyle(priority: string | null | undefined): string {
  switch (priority) {
    case "A":
      return "bg-rose-100 text-rose-800";
    case "B":
      return "bg-amber-100 text-amber-800";
    case "C":
      return "bg-sky-100 text-sky-800";
    case "CHAINE":
      return "bg-violet-100 text-violet-800";
    case "HORS_CIBLE":
      return "bg-slate-200 text-slate-600";
    case "EXCLU":
      return "bg-emerald-100 text-emerald-800";
    default:
      return "bg-slate-100 text-slate-600";
  }
}
