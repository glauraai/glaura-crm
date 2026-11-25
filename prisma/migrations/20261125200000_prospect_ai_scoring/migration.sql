-- AlterTable
ALTER TABLE "Prospect"
ADD COLUMN "aiScore" DOUBLE PRECISION,
ADD COLUMN "aiSpecialty" TEXT,
ADD COLUMN "aiOwnership" TEXT,
ADD COLUMN "aiSummary" TEXT,
ADD COLUMN "aiScoredAt" TIMESTAMP(3),
ADD COLUMN "legalEntity" TEXT,
ADD COLUMN "siren" TEXT,
ADD COLUMN "siret" TEXT,
ADD COLUMN "activeSites" INTEGER,
ADD COLUMN "companyMatchStatus" TEXT,
ADD COLUMN "revenueEur" INTEGER,
ADD COLUMN "revenueYear" INTEGER,
ADD COLUMN "revenueStatus" TEXT,
ADD COLUMN "filingUrl" TEXT;

-- CreateIndex
CREATE INDEX "Prospect_aiScore_idx" ON "Prospect"("aiScore");

-- CreateIndex
CREATE INDEX "Prospect_aiSpecialty_idx" ON "Prospect"("aiSpecialty");

-- CreateIndex
CREATE INDEX "Prospect_siren_idx" ON "Prospect"("siren");
