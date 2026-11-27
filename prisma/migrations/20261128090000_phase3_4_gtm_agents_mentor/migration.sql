-- Phase 3 & 4: Portfolio inactivity warning, GTM 1 bis 100-pt scoring, SCOUT prep brief,
-- SENTINEL risk tracking, SocialSnapshot, MENTOR CallEvaluation, ObjectionRecord & CrmAutomationConfig

ALTER TABLE "Salon"
  ADD COLUMN IF NOT EXISTS "inactivityWarnedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "gtmScore" INTEGER,
  ADD COLUMN IF NOT EXISTS "gtmPriority" TEXT,
  ADD COLUMN IF NOT EXISTS "gtmAngle" TEXT,
  ADD COLUMN IF NOT EXISTS "gtmScoreBreakdown" JSONB,
  ADD COLUMN IF NOT EXISTS "gtmScoredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "prepBriefJson" JSONB,
  ADD COLUMN IF NOT EXISTS "prepBriefUpdatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Salon_gtmPriority_gtmScore_idx" ON "Salon"("gtmPriority", "gtmScore");

ALTER TABLE "Prospect"
  ADD COLUMN IF NOT EXISTS "gtmScore" INTEGER,
  ADD COLUMN IF NOT EXISTS "gtmPriority" TEXT,
  ADD COLUMN IF NOT EXISTS "gtmAngle" TEXT,
  ADD COLUMN IF NOT EXISTS "gtmScoreBreakdown" JSONB,
  ADD COLUMN IF NOT EXISTS "gtmScoredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nurtureStep" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nurtureNextAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nurtureStoppedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Prospect_gtmPriority_gtmScore_idx" ON "Prospect"("gtmPriority", "gtmScore");

ALTER TABLE "Opportunity"
  ADD COLUMN IF NOT EXISTS "riskFlaggedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "riskHandledStatus" TEXT;

CREATE INDEX IF NOT EXISTS "Opportunity_atRisk_stage_idx" ON "Opportunity"("atRisk", "stage");

ALTER TABLE "TranscriptRecord"
  ADD COLUMN IF NOT EXISTS "mentorProcessedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "TranscriptRecord_mentorProcessedAt_matchStatus_idx" ON "TranscriptRecord"("mentorProcessedAt", "matchStatus");

CREATE TABLE IF NOT EXISTS "SocialSnapshot" (
  "id" TEXT NOT NULL,
  "salonId" TEXT,
  "prospectId" TEXT,
  "monthKey" TEXT NOT NULL,
  "igFollowers" INTEGER,
  "igPosts" INTEGER,
  "igAvgReelViews" INTEGER,
  "tiktokFollowers" INTEGER,
  "googleReviews" INTEGER,
  "googleRating" DOUBLE PRECISION,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SocialSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SocialSnapshot_salonId_monthKey_key" ON "SocialSnapshot"("salonId", "monthKey");
CREATE UNIQUE INDEX IF NOT EXISTS "SocialSnapshot_prospectId_monthKey_key" ON "SocialSnapshot"("prospectId", "monthKey");
CREATE INDEX IF NOT EXISTS "SocialSnapshot_monthKey_idx" ON "SocialSnapshot"("monthKey");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SocialSnapshot_salonId_fkey') THEN
    ALTER TABLE "SocialSnapshot" ADD CONSTRAINT "SocialSnapshot_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SocialSnapshot_prospectId_fkey') THEN
    ALTER TABLE "SocialSnapshot" ADD CONSTRAINT "SocialSnapshot_prospectId_fkey"
      FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CallEvaluation" (
  "id" TEXT NOT NULL,
  "transcriptId" TEXT NOT NULL,
  "salonId" TEXT,
  "opportunityId" TEXT,
  "userId" TEXT,
  "overallScore" INTEGER NOT NULL,
  "stepScoresJson" JSONB NOT NULL,
  "strengths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "improvements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "closingLevers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "salesAngleUsed" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CallEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CallEvaluation_transcriptId_key" ON "CallEvaluation"("transcriptId");
CREATE INDEX IF NOT EXISTS "CallEvaluation_salonId_createdAt_idx" ON "CallEvaluation"("salonId", "createdAt");
CREATE INDEX IF NOT EXISTS "CallEvaluation_userId_createdAt_idx" ON "CallEvaluation"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "CallEvaluation_opportunityId_idx" ON "CallEvaluation"("opportunityId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CallEvaluation_transcriptId_fkey') THEN
    ALTER TABLE "CallEvaluation" ADD CONSTRAINT "CallEvaluation_transcriptId_fkey"
      FOREIGN KEY ("transcriptId") REFERENCES "TranscriptRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CallEvaluation_salonId_fkey') THEN
    ALTER TABLE "CallEvaluation" ADD CONSTRAINT "CallEvaluation_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CallEvaluation_opportunityId_fkey') THEN
    ALTER TABLE "CallEvaluation" ADD CONSTRAINT "CallEvaluation_opportunityId_fkey"
      FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CallEvaluation_userId_fkey') THEN
    ALTER TABLE "CallEvaluation" ADD CONSTRAINT "CallEvaluation_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ObjectionRecord" (
  "id" TEXT NOT NULL,
  "transcriptId" TEXT,
  "salonId" TEXT,
  "opportunityId" TEXT,
  "userId" TEXT,
  "category" TEXT NOT NULL,
  "verbatim" TEXT NOT NULL,
  "responseGiven" TEXT,
  "succeeded" BOOLEAN,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ObjectionRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ObjectionRecord_category_createdAt_idx" ON "ObjectionRecord"("category", "createdAt");
CREATE INDEX IF NOT EXISTS "ObjectionRecord_salonId_createdAt_idx" ON "ObjectionRecord"("salonId", "createdAt");
CREATE INDEX IF NOT EXISTS "ObjectionRecord_opportunityId_idx" ON "ObjectionRecord"("opportunityId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ObjectionRecord_transcriptId_fkey') THEN
    ALTER TABLE "ObjectionRecord" ADD CONSTRAINT "ObjectionRecord_transcriptId_fkey"
      FOREIGN KEY ("transcriptId") REFERENCES "TranscriptRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ObjectionRecord_salonId_fkey') THEN
    ALTER TABLE "ObjectionRecord" ADD CONSTRAINT "ObjectionRecord_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ObjectionRecord_opportunityId_fkey') THEN
    ALTER TABLE "ObjectionRecord" ADD CONSTRAINT "ObjectionRecord_opportunityId_fkey"
      FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ObjectionRecord_userId_fkey') THEN
    ALTER TABLE "ObjectionRecord" ADD CONSTRAINT "ObjectionRecord_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CrmAutomationConfig" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "cTierNurtureEnabled" BOOLEAN NOT NULL DEFAULT false,
  "decemberPauseEnabled" BOOLEAN NOT NULL DEFAULT true,
  "inactivityWarningDays" INTEGER NOT NULL DEFAULT 75,
  "inactivityReleaseDays" INTEGER NOT NULL DEFAULT 90,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CrmAutomationConfig_pkey" PRIMARY KEY ("id")
);
