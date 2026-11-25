import { readFileSync } from "node:fs";
import { PrismaClient } from "@/generated/prisma/client";
import { parseProspectEnrichmentRow, type ProspectEnrichmentPayload } from "@/lib/prospection/ai-score";

function parseArgs(argv: string[]) {
  let file = "";
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file" && argv[i + 1]) {
      file = argv[++i];
    } else if (argv[i] === "--apply") {
      apply = true;
    }
  }
  if (!file) {
    console.error("Usage: tsx scripts/import-prospect-scores.ts --file <path.jsonl> [--apply]");
    process.exit(1);
  }
  return { file, apply };
}

async function main() {
  const { file, apply } = parseArgs(process.argv.slice(2));
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: ProspectEnrichmentPayload[] = [];
  let invalid = 0;

  for (const line of lines) {
    try {
      const parsed = parseProspectEnrichmentRow(JSON.parse(line));
      if (parsed) rows.push(parsed);
      else invalid++;
    } catch {
      invalid++;
    }
  }

  console.log(`Loaded ${rows.length} valid rows (${invalid} invalid/skipped) from ${file}`);
  if (!apply) {
    const withScore = rows.filter((r) => r.aiScore != null).length;
    const verified = rows.filter((r) => r.companyMatchStatus === "VERIFIED").length;
    const published = rows.filter((r) => r.revenueStatus === "PUBLISHED").length;
    console.log(`[DRY RUN] Would update up to ${rows.length} prospects (scored=${withScore}, verified=${verified}, publishedRevenue=${published}). Re-run with --apply to write.`);
    return;
  }

  const prisma = new PrismaClient();
  const now = new Date();
  let updated = 0;
  let missing = 0;

  try {
    const chunkSize = 50;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const results = await prisma.$transaction(
        chunk.map((row) =>
          prisma.prospect.updateMany({
            where: { id: row.id },
            data: {
              aiScore: row.aiScore,
              aiSpecialty: row.aiSpecialty,
              aiOwnership: row.aiOwnership,
              aiSummary: row.aiSummary,
              aiScoredAt: row.aiScore != null ? now : null,
              legalEntity: row.legalEntity,
              siren: row.siren,
              siret: row.siret,
              activeSites: row.activeSites,
              companyMatchStatus: row.companyMatchStatus,
              revenueEur: row.revenueEur,
              revenueYear: row.revenueYear,
              revenueStatus: row.revenueStatus,
              filingUrl: row.filingUrl,
            },
          }),
        ),
      );
      for (const res of results) {
        if (res.count > 0) updated += res.count;
        else missing++;
      }
      if ((i + chunk.length) % 500 === 0 || i + chunk.length === rows.length) {
        console.log(`Progress: ${i + chunk.length}/${rows.length} (updated=${updated}, missing=${missing})`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(`Done. Updated ${updated} prospects (${missing} ids not found).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
