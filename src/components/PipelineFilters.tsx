import Link from "next/link";
import { METIER_LABEL, METIER_ORDER, STATUS_LABEL, STATUS_ORDER } from "@/lib/labels";
import { GTM_FILTER_LABELS, isWebsiteOrigin, ORIGIN_LABELS, type SalonOriginKey } from "@/lib/salons-filter";
import { cn } from "@/lib/utils";
import type { Metier, SalonStatus } from "@/generated/prisma/enums";

type Params = Record<string, string | undefined>;

const FILTER_KEYS = ["origin", "source", "status", "gtm", "metier", "owner", "type", "q", "prio", "arr"] as const;

function buildHref(params: Params, updates: Record<string, string | undefined>): string {
  const next = new URLSearchParams();
  const merged: Params = { ...params, ...updates, page: undefined };
  for (const [k, v] of Object.entries(merged)) {
    if (v) next.set(k, v);
  }
  const qs = next.toString();
  return qs ? `/salons?${qs}` : "/salons";
}

function toggleHref(params: Params, key: string, value: string): string {
  return buildHref(params, { [key]: params[key] === value ? undefined : value });
}

function Chip({
  active,
  href,
  tone = "default",
  children,
}: {
  active: boolean;
  href: string;
  tone?: "default" | "website";
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-medium transition",
        active
          ? tone === "website"
            ? "bg-violet-600 text-white shadow-xs"
            : "bg-rose-500 text-white shadow-xs"
          : tone === "website"
            ? "bg-violet-50 text-violet-800 ring-1 ring-violet-200 hover:bg-violet-100"
            : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
      )}
    >
      {children}
    </Link>
  );
}

function FilterRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <div className="w-32 shrink-0 pt-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
      </div>
      <div className="flex flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

export function PipelineFilters({
  params,
  owners,
}: {
  params: Params;
  owners: Array<{ id: string; name: string | null; email: string | null }>;
}) {
  const TYPES = ["A", "B", "C", "D"] as const;
  const activeOrigin = params.origin ?? (params.source === "SCRAPE" ? "scrape" : undefined);
  const websiteActive = isWebsiteOrigin(activeOrigin);

  // Build plain-French active filter tags so users always see WHY they get N results (AND logic)
  const activeBadges: Array<{ key: string; label: string; clearHref: string }> = [];
  if (activeOrigin && activeOrigin in ORIGIN_LABELS) {
    activeBadges.push({
      key: "origin",
      label: `Provenance : ${ORIGIN_LABELS[activeOrigin as SalonOriginKey]}`,
      clearHref: buildHref(params, { origin: undefined, source: undefined }),
    });
  }
  if (params.status && params.status in STATUS_LABEL) {
    activeBadges.push({
      key: "status",
      label: `Statut : ${STATUS_LABEL[params.status as SalonStatus]}`,
      clearHref: buildHref(params, { status: undefined }),
    });
  }
  if (params.gtm && params.gtm in GTM_FILTER_LABELS) {
    activeBadges.push({
      key: "gtm",
      label: `Priorité GTM : ${GTM_FILTER_LABELS[params.gtm]}`,
      clearHref: buildHref(params, { gtm: undefined }),
    });
  }
  if (params.metier && params.metier in METIER_LABEL) {
    activeBadges.push({
      key: "metier",
      label: `Métier : ${METIER_LABEL[params.metier as Metier]}`,
      clearHref: buildHref(params, { metier: undefined }),
    });
  }
  if (params.owner) {
    const ownerName =
      params.owner === "none"
        ? "Non attribué"
        : owners.find((o) => o.id === params.owner)?.name ??
          owners.find((o) => o.id === params.owner)?.email ??
          "Commercial";
    activeBadges.push({
      key: "owner",
      label: `Responsable : ${ownerName}`,
      clearHref: buildHref(params, { owner: undefined }),
    });
  }
  if (params.type) {
    activeBadges.push({
      key: "type",
      label: `Ancien type Airtable : ${params.type}`,
      clearHref: buildHref(params, { type: undefined }),
    });
  }
  if (params.q?.trim()) {
    activeBadges.push({
      key: "q",
      label: `Recherche : « ${params.q.trim()} »`,
      clearHref: buildHref(params, { q: undefined }),
    });
  }

  const resetAllHref = buildHref(
    params,
    Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])),
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
      {/* Active filters bar — makes AND combination immediately transparent */}
      {activeBadges.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-100 bg-rose-50/60 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-rose-900">
              Filtres actifs ({activeBadges.length}, cumulés en ET) :
            </span>
            {activeBadges.map((b) => (
              <Link
                key={b.key}
                href={b.clearHref}
                title="Retirer ce filtre"
                className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-rose-800 ring-1 ring-rose-200 hover:bg-rose-100"
              >
                {b.label} <span aria-hidden="true">×</span>
              </Link>
            ))}
          </div>
          <Link
            href={resetAllHref}
            className="text-xs font-semibold text-rose-700 hover:text-rose-900 hover:underline"
          >
            Tout réinitialiser
          </Link>
        </div>
      )}

      {/* 1. Provenance (Website leads: /pro, /laura, callbacks) */}
      <FilterRow label="Provenance" hint="D’où vient le lead">
        <Chip active={!activeOrigin} href={buildHref(params, { origin: undefined, source: undefined })}>
          Toutes
        </Chip>
        <Chip
          active={websiteActive}
          tone="website"
          href={buildHref(params, { origin: websiteActive ? undefined : "website", source: undefined })}
        >
          Site web (/pro, /laura, rappel)
        </Chip>
        <Chip
          active={activeOrigin === "scrape"}
          href={buildHref(params, { origin: activeOrigin === "scrape" ? undefined : "scrape", source: undefined })}
        >
          Prospection
        </Chip>
        <Chip
          active={activeOrigin === "import"}
          href={buildHref(params, { origin: activeOrigin === "import" ? undefined : "import", source: undefined })}
        >
          Import CSV
        </Chip>
        <Chip
          active={activeOrigin === "airtable"}
          href={buildHref(params, { origin: activeOrigin === "airtable" ? undefined : "airtable", source: undefined })}
        >
          Airtable
        </Chip>
      </FilterRow>

      {/* Sub-filter when Site web is active so user can drill into /pro, /laura, or callback */}
      {websiteActive && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-violet-50/70 px-3 py-2 sm:ml-35">
          <span className="text-[11px] font-semibold text-violet-900">Affiner site web :</span>
          {(
            [
              ["website", "Tous entrants site web"],
              ["website_pro", "/pro (inscription & aperçu)"],
              ["website_laura", "/laura (essai & rappel)"],
              ["website_callback", "Demande de rappel"],
            ] as const
          ).map(([key, label]) => (
            <Chip
              key={key}
              active={activeOrigin === key}
              tone="website"
              href={buildHref(params, { origin: key, source: undefined })}
            >
              {label}
            </Chip>
          ))}
        </div>
      )}

      {/* 2. Statut pipeline */}
      <FilterRow label="Statut">
        <Chip active={!params.status} href={buildHref(params, { status: undefined })}>
          Tous
        </Chip>
        {STATUS_ORDER.map((s) => (
          <Chip key={s} active={params.status === s} href={toggleHref(params, "status", s)}>
            {STATUS_LABEL[s]}
          </Chip>
        ))}
      </FilterRow>

      {/* 3. Priorité GTM 1 bis */}
      <FilterRow label="Priorité GTM" hint="Score auto /100">
        <Chip active={!params.gtm} href={buildHref(params, { gtm: undefined })}>
          Toutes
        </Chip>
        {(["A", "B", "C", "CHAINE"] as const).map((g) => (
          <Chip key={g} active={params.gtm === g} href={toggleHref(params, "gtm", g)}>
            {GTM_FILTER_LABELS[g]}
          </Chip>
        ))}
      </FilterRow>

      {/* 4. Métier */}
      <FilterRow label="Métier">
        <Chip active={!params.metier} href={buildHref(params, { metier: undefined })}>
          Tous
        </Chip>
        {METIER_ORDER.filter((m) => m !== "AUTRE").map((m) => (
          <Chip key={m} active={params.metier === m} href={toggleHref(params, "metier", m)}>
            {METIER_LABEL[m]}
          </Chip>
        ))}
      </FilterRow>

      {/* 5. Responsable */}
      {owners.length > 0 && (
        <FilterRow label="Responsable">
          <Chip active={!params.owner} href={buildHref(params, { owner: undefined })}>
            Toute l’équipe
          </Chip>
          <Chip active={params.owner === "none"} href={toggleHref(params, "owner", "none")}>
            Non attribué
          </Chip>
          {owners.map((owner) => (
            <Chip key={owner.id} active={params.owner === owner.id} href={toggleHref(params, "owner", owner.id)}>
              {owner.name ?? owner.email}
            </Chip>
          ))}
        </FilterRow>
      )}

      {/* Legacy Airtable Type (A/B/C/D) tucked cleanly into a collapsible row so it isn't confused with GTM A/B/C */}
      <details open={Boolean(params.type)} className="border-t border-slate-100 pt-2">
        <summary className="cursor-pointer text-[11px] font-medium text-slate-400 hover:text-slate-600">
          Filtre avancé · Ancien type Airtable (A / B / C / D)
        </summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip active={!params.type} href={buildHref(params, { type: undefined })}>
            Tous
          </Chip>
          {TYPES.map((t) => (
            <Chip key={t} active={params.type === t} href={toggleHref(params, "type", t)}>
              Ancien type {t}
            </Chip>
          ))}
        </div>
      </details>
    </div>
  );
}
