import { prisma } from "@/lib/db";
import { runEnrichmentAndRankingPipeline } from "@/lib/gtm/pipeline";

function parseArgs(argv: string[]) {
  let scope: "assigned" | "all" = "assigned";
  let ownerEmails: string[] | undefined;
  let limit = 300;
  let igBudget = 120;
  let onlyUnenriched = false;
  let apply = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scope" && argv[i + 1]) {
      scope = argv[++i] === "all" ? "all" : "assigned";
    } else if (arg === "--owners" && argv[i + 1]) {
      ownerEmails = argv[++i]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg === "--limit" && argv[i + 1]) {
      limit = Math.max(1, Number(argv[++i]) || 300);
    } else if (arg === "--ig-budget" && argv[i + 1]) {
      igBudget = Math.max(0, Number(argv[++i]) || 0);
    } else if (arg === "--only-unenriched") {
      onlyUnenriched = true;
    } else if (arg === "--apply") {
      apply = true;
    }
  }
  return { scope, ownerEmails, limit, igBudget, onlyUnenriched, apply };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log("[enrich-and-rank] starting:", args);
  const stats = await runEnrichmentAndRankingPipeline({
    scope: args.scope,
    ownerEmails: args.ownerEmails,
    limit: args.limit,
    igBudget: args.igBudget,
    onlyUnenriched: args.onlyUnenriched,
    dryRun: !args.apply,
    log: (m) => console.log(m),
  });
  console.log("[enrich-and-rank] result:", JSON.stringify(stats, null, 2));
}

main()
  .catch((err) => {
    console.error("[enrich-and-rank] fatal:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
