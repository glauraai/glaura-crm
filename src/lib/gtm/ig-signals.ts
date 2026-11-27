export type IgMediaSummary = {
  media_type?: string;
  timestamp?: string;
  caption?: string;
};

export type IgEnrichedSignals = {
  handle: string;
  followers: number | null;
  mediaCount: number | null;
  videosPerWeek: number | null;
  postsVideos: boolean;
  bookingFriction: boolean;
  detectedPlanity: boolean;
  detectedTreatwell: boolean;
  detectedOtherTool: boolean;
  sellsProducts: boolean;
  hiringSignal: boolean;
};

export function analyzeInstagramSignals(
  input: {
    handle: string;
    followers?: number | null;
    mediaCount?: number | null;
    biography?: string | null;
    website?: string | null;
    recentMedia?: IgMediaSummary[];
  },
  now = new Date(),
): IgEnrichedSignals {
  const bio = input.biography ?? "";
  const website = input.website ?? "";
  const captions = (input.recentMedia ?? []).map((m) => m.caption ?? "").join("\n");
  const combined = `${bio}\n${website}\n${captions}`.toLowerCase();

  const detectedPlanity = /\bplanity\b/.test(combined);
  const detectedTreatwell = /\btreatwell\b/.test(combined);
  const detectedOtherTool = /\b(booksy|fresha|acuity|kiute|kalendes|flexy|wavy)\b/.test(combined);

  const dmToBook =
    /(?:dm|mp|message priv[ée]|whatsapp)\s*(?:pour|to)?\s*(?:r[ée]serv|rdv|book|tarif|prix)/i.test(bio) ||
    /r[ée]servation\s*(?:en|par|via)\s*(?:dm|mp|whatsapp|t[ée]l)/i.test(bio);
  const aggregatorLink = /(linktr\.ee|linktree|beacons\.ai|taplink|campsite\.bio|bit\.ly)/i.test(`${bio} ${website}`);
  const bookingFriction = dmToBook || aggregatorLink || detectedPlanity || detectedTreatwell || detectedOtherTool;

  const sellsProducts = /\b(e-?shop|boutique|shop|produits|cosm[ée]tiques|vente en ligne)\b/i.test(`${bio} ${website}`);
  const hiringSignal = /\b(on recrute|nous recrutons|recrutement|embauche|rejoins notre [ée]quipe)\b/i.test(combined);

  let videosPerWeek: number | null = null;
  let postsVideos = false;
  const media = input.recentMedia ?? [];
  if (media.length > 0) {
    const videos = media.filter((m) => m.media_type === "VIDEO" || m.media_type === "REELS");
    postsVideos = videos.length > 0;
    const windowDays = 60;
    const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
    const recentVideos = videos.filter((m) => m.timestamp && Date.parse(m.timestamp) >= cutoff);
    if (recentVideos.length > 0) {
      videosPerWeek = Math.round((recentVideos.length / (windowDays / 7)) * 10) / 10;
    } else if (postsVideos) {
      videosPerWeek = 0.2;
    } else {
      videosPerWeek = 0;
    }
  }

  return {
    handle: input.handle,
    followers: input.followers ?? null,
    mediaCount: input.mediaCount ?? null,
    videosPerWeek,
    postsVideos,
    bookingFriction,
    detectedPlanity,
    detectedTreatwell,
    detectedOtherTool,
    sellsProducts,
    hiringSignal,
  };
}
