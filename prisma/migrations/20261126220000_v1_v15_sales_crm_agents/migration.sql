-- V1 & V1.5 Sales CRM, Agents (ECHO/Allo), Pricing & Commissions migration

-- CreateEnums
CREATE TYPE "OpportunityStage" AS ENUM ('A_CONTACTER', 'CONTACTE', 'R1_PROGRAMME', 'R1_EFFECTUE', 'NO_SHOW', 'A_RELANCER', 'ANNULE', 'DEVIS_ENVOYE', 'ABONNE', 'COMPTE_ACTIVE', 'SIGNE', 'ENCAISSE', 'PERDU');
CREATE TYPE "AgentName" AS ENUM ('ECHO', 'SCOUT', 'CRAFT', 'SENTINEL', 'MENTOR', 'GTM');
CREATE TYPE "SuggestionKind" AS ENUM ('QUALIFICATION_UPDATE', 'STAGE_CHANGE', 'TASK_CREATE', 'QUOTE_DRAFT', 'EMAIL_DRAFT', 'RELANCE', 'PREP_BRIEF', 'PLAYBOOK_UPDATE');
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'MODIFIED', 'REJECTED');
CREATE TYPE "TranscriptSource" AS ENUM ('ALLO', 'WISPR_FLOW', 'UPLOAD');
CREATE TYPE "TranscriptMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'IGNORED');
CREATE TYPE "BillingCadence" AS ENUM ('MONTHLY', 'ANNUAL_3X', 'ANNUAL_1X');
CREATE TYPE "CommissionStatus" AS ENUM ('PREVUE', 'EN_VALIDATION', 'ACQUISE', 'VERSEE', 'PERDUE', 'ARRETEE');
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED_UPHELD', 'RESOLVED_ADJUSTED', 'REJECTED');

-- AlterTable Salon
ALTER TABLE "Salon"
ADD COLUMN "providerId" TEXT,
ADD COLUMN "siret" TEXT,
ADD COLUMN "portfolioClaimedAt" TIMESTAMP(3),
ADD COLUMN "portfolioClaimedById" TEXT;
CREATE UNIQUE INDEX "Salon_providerId_key" ON "Salon"("providerId");

-- AlterTable Prospect
ALTER TABLE "Prospect" ADD COLUMN "claimedAt" TIMESTAMP(3);

-- AlterTable Activity
ALTER TABLE "Activity"
ADD COLUMN "opportunityId" TEXT,
ADD COLUMN "contactId" TEXT,
ADD COLUMN "source" TEXT,
ADD COLUMN "durationSec" INTEGER,
ADD COLUMN "isDecisionMakerCall" BOOLEAN,
ADD COLUMN "transcriptId" TEXT;

-- AlterTable InstagramMessage
ALTER TABLE "InstagramMessage" ADD COLUMN "sentByUserId" TEXT;

-- CreateTable Contact
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "isDecisionMaker" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "phoneNormalized" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable Opportunity
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Abonnement Glaura',
    "stage" "OpportunityStage" NOT NULL DEFAULT 'A_CONTACTER',
    "monthlyAmountEur" DOUBLE PRECISION,
    "nextStep" TEXT,
    "nextStepAt" TIMESTAMP(3),
    "lossReason" TEXT,
    "atRisk" BOOLEAN NOT NULL DEFAULT false,
    "riskReason" TEXT,
    "ownerId" TEXT,
    "ownerLockedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "qualificationJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable StageTransition
CREATE TABLE "StageTransition" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "fromStage" "OpportunityStage",
    "toStage" "OpportunityStage" NOT NULL,
    "changedById" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StageTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable OwnershipAuditLog
CREATE TABLE "OwnershipAuditLog" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "changedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OwnershipAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable AgentSuggestion
CREATE TABLE "AgentSuggestion" (
    "id" TEXT NOT NULL,
    "agent" "AgentName" NOT NULL,
    "kind" "SuggestionKind" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "salonId" TEXT,
    "opportunityId" TEXT,
    "assignedToId" TEXT,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "proposedPayload" JSONB NOT NULL,
    "appliedPayload" JSONB,
    "generationReport" JSONB NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable TranscriptRecord
CREATE TABLE "TranscriptRecord" (
    "id" TEXT NOT NULL,
    "source" "TranscriptSource" NOT NULL,
    "externalId" TEXT NOT NULL,
    "salonId" TEXT,
    "opportunityId" TEXT,
    "contactId" TEXT,
    "userId" TEXT,
    "callerPhone" TEXT,
    "participantEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "callDirection" TEXT,
    "callResult" TEXT,
    "recordingUrl" TEXT,
    "durationSec" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawTranscript" TEXT,
    "summary" TEXT,
    "isDecisionMakerCall" BOOLEAN,
    "matchStatus" "TranscriptMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "echoProcessedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TranscriptRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable SubscriptionLine
CREATE TABLE "SubscriptionLine" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT,
    "salonId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "cadence" "BillingCadence" NOT NULL DEFAULT 'MONTHLY',
    "listMonthlyCents" INTEGER NOT NULL,
    "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netMonthlyCents" INTEGER NOT NULL,
    "freeMonths" INTEGER NOT NULL DEFAULT 0,
    "lauraChannels" TEXT,
    "lauraCents" INTEGER NOT NULL DEFAULT 0,
    "syncIncluded" BOOLEAN NOT NULL DEFAULT false,
    "syncCents" INTEGER NOT NULL DEFAULT 0,
    "checkoutUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable CommissionPlanVersion
CREATE TABLE "CommissionPlanVersion" (
    "id" TEXT NOT NULL,
    "quarterKey" TEXT NOT NULL,
    "baseRate" DOUBLE PRECISION NOT NULL DEFAULT 0.7716,
    "m1TargetEur" DOUBLE PRECISION NOT NULL DEFAULT 810,
    "standardTargetEur" DOUBLE PRECISION NOT NULL DEFAULT 1620,
    "accel2Threshold" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "accel2Multiplier" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "accel3Threshold" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "accel3Multiplier" DOUBLE PRECISION NOT NULL DEFAULT 3.0,
    "guaranteeEur" DOUBLE PRECISION NOT NULL DEFAULT 1250,
    "guaranteeMinDmCalls" INTEGER NOT NULL DEFAULT 120,
    "guaranteeMinMeetings" INTEGER NOT NULL DEFAULT 40,
    "minDecisionMakerCallSec" INTEGER NOT NULL DEFAULT 90,
    "excludeCancelledBeforeTwoInvoices" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommissionPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable SyncedInvoice
CREATE TABLE "SyncedInvoice" (
    "id" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "salonId" TEXT,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "amountPaidCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "refunded" BOOLEAN NOT NULL DEFAULT false,
    "disputed" BOOLEAN NOT NULL DEFAULT false,
    "billingReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SyncedInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable Commission
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "signedMonth" TEXT NOT NULL,
    "cadence" "BillingCadence" NOT NULL DEFAULT 'MONTHLY',
    "mrrSignedEur" DOUBLE PRECISION NOT NULL,
    "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "effectiveRate" DOUBLE PRECISION NOT NULL,
    "baseAmountEur" DOUBLE PRECISION NOT NULL,
    "finalAmountEur" DOUBLE PRECISION NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PREVUE',
    "paidInvoicesCount" INTEGER NOT NULL DEFAULT 0,
    "acquiredAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "paidOutAt" TIMESTAMP(3),
    "lossReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable CommissionDispute
CREATE TABLE "CommissionDispute" (
    "id" TEXT NOT NULL,
    "commissionId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommissionDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable SalesGoal
CREATE TABLE "SalesGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "targetMrrEur" DOUBLE PRECISION NOT NULL DEFAULT 1620,
    "targetMeetings" INTEGER NOT NULL DEFAULT 40,
    "targetDmCalls" INTEGER NOT NULL DEFAULT 120,
    "isRampMonth" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable RoundRobinState
CREATE TABLE "RoundRobinState" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "lastAssignedId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RoundRobinState_pkey" PRIMARY KEY ("id")
);

-- Indexes & Uniques
CREATE INDEX "Activity_opportunityId_createdAt_idx" ON "Activity"("opportunityId", "createdAt");
CREATE INDEX "Activity_userId_createdAt_idx" ON "Activity"("userId", "createdAt");
CREATE INDEX "Contact_salonId_idx" ON "Contact"("salonId");
CREATE INDEX "Contact_phoneNormalized_idx" ON "Contact"("phoneNormalized");
CREATE INDEX "Contact_email_idx" ON "Contact"("email");
CREATE INDEX "Opportunity_salonId_idx" ON "Opportunity"("salonId");
CREATE INDEX "Opportunity_ownerId_stage_idx" ON "Opportunity"("ownerId", "stage");
CREATE INDEX "Opportunity_stage_updatedAt_idx" ON "Opportunity"("stage", "updatedAt");
CREATE INDEX "StageTransition_opportunityId_createdAt_idx" ON "StageTransition"("opportunityId", "createdAt");
CREATE INDEX "OwnershipAuditLog_opportunityId_createdAt_idx" ON "OwnershipAuditLog"("opportunityId", "createdAt");
CREATE INDEX "AgentSuggestion_status_assignedToId_createdAt_idx" ON "AgentSuggestion"("status", "assignedToId", "createdAt");
CREATE INDEX "AgentSuggestion_salonId_status_idx" ON "AgentSuggestion"("salonId", "status");
CREATE INDEX "AgentSuggestion_agent_status_idx" ON "AgentSuggestion"("agent", "status");
CREATE UNIQUE INDEX "TranscriptRecord_externalId_key" ON "TranscriptRecord"("externalId");
CREATE INDEX "TranscriptRecord_matchStatus_createdAt_idx" ON "TranscriptRecord"("matchStatus", "createdAt");
CREATE INDEX "TranscriptRecord_salonId_occurredAt_idx" ON "TranscriptRecord"("salonId", "occurredAt");
CREATE INDEX "TranscriptRecord_echoProcessedAt_matchStatus_idx" ON "TranscriptRecord"("echoProcessedAt", "matchStatus");
CREATE INDEX "SubscriptionLine_salonId_createdAt_idx" ON "SubscriptionLine"("salonId", "createdAt");
CREATE INDEX "SubscriptionLine_opportunityId_idx" ON "SubscriptionLine"("opportunityId");
CREATE UNIQUE INDEX "CommissionPlanVersion_quarterKey_key" ON "CommissionPlanVersion"("quarterKey");
CREATE UNIQUE INDEX "SyncedInvoice_stripeInvoiceId_key" ON "SyncedInvoice"("stripeInvoiceId");
CREATE INDEX "SyncedInvoice_providerId_paidAt_idx" ON "SyncedInvoice"("providerId", "paidAt");
CREATE INDEX "SyncedInvoice_salonId_paidAt_idx" ON "SyncedInvoice"("salonId", "paidAt");
CREATE UNIQUE INDEX "Commission_opportunityId_key" ON "Commission"("opportunityId");
CREATE INDEX "Commission_ownerId_signedMonth_idx" ON "Commission"("ownerId", "signedMonth");
CREATE INDEX "Commission_status_signedMonth_idx" ON "Commission"("status", "signedMonth");
CREATE INDEX "CommissionDispute_commissionId_idx" ON "CommissionDispute"("commissionId");
CREATE INDEX "CommissionDispute_status_createdAt_idx" ON "CommissionDispute"("status", "createdAt");
CREATE UNIQUE INDEX "SalesGoal_userId_periodKey_key" ON "SalesGoal"("userId", "periodKey");

-- Foreign Keys
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InstagramMessage" ADD CONSTRAINT "InstagramMessage_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StageTransition" ADD CONSTRAINT "StageTransition_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StageTransition" ADD CONSTRAINT "StageTransition_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OwnershipAuditLog" ADD CONSTRAINT "OwnershipAuditLog_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentSuggestion" ADD CONSTRAINT "AgentSuggestion_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentSuggestion" ADD CONSTRAINT "AgentSuggestion_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentSuggestion" ADD CONSTRAINT "AgentSuggestion_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentSuggestion" ADD CONSTRAINT "AgentSuggestion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TranscriptRecord" ADD CONSTRAINT "TranscriptRecord_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TranscriptRecord" ADD CONSTRAINT "TranscriptRecord_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TranscriptRecord" ADD CONSTRAINT "TranscriptRecord_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TranscriptRecord" ADD CONSTRAINT "TranscriptRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubscriptionLine" ADD CONSTRAINT "SubscriptionLine_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubscriptionLine" ADD CONSTRAINT "SubscriptionLine_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncedInvoice" ADD CONSTRAINT "SyncedInvoice_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "CommissionPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesGoal" ADD CONSTRAINT "SalesGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: seed default 2026-Q4 commission plan version (idempotent)
INSERT INTO "CommissionPlanVersion" (
    "id", "quarterKey", "baseRate", "m1TargetEur", "standardTargetEur",
    "accel2Threshold", "accel2Multiplier", "accel3Threshold", "accel3Multiplier",
    "guaranteeEur", "guaranteeMinDmCalls", "guaranteeMinMeetings",
    "minDecisionMakerCallSec", "excludeCancelledBeforeTwoInvoices",
    "effectiveFrom", "effectiveTo"
) VALUES (
    'plan_2026_q4', '2026-Q4', 0.7716, 810, 1620,
    1.0, 2.0, 1.5, 3.0,
    1250, 120, 40,
    90, true,
    '2026-10-01T00:00:00Z', '2026-12-31T23:59:59Z'
) ON CONFLICT ("quarterKey") DO NOTHING;

-- Backfill: link Salon.providerId from completed OnboardingJobs where missing
UPDATE "Salon" s
SET "providerId" = sub."accountUid"
FROM (
    SELECT DISTINCT ON ("salonId") "salonId", "accountUid"
    FROM "OnboardingJob"
    WHERE "accountUid" IS NOT NULL
    ORDER BY "salonId", "createdAt" DESC
) sub
WHERE s."id" = sub."salonId" AND s."providerId" IS NULL;

-- Backfill: create one default Opportunity per active (non-archived) Salon that has none yet
INSERT INTO "Opportunity" (
    "id", "salonId", "title", "stage", "ownerId", "ownerLockedAt", "signedAt", "createdAt", "updatedAt"
)
SELECT
    'opp_' || s."id",
    s."id",
    'Abonnement Glaura',
    CASE s."status"
        WHEN 'A_VISITER' THEN 'A_CONTACTER'::"OpportunityStage"
        WHEN 'VISITE_FAITE' THEN 'R1_EFFECTUE'::"OpportunityStage"
        WHEN 'INTERESSE' THEN 'R1_EFFECTUE'::"OpportunityStage"
        WHEN 'A_RELANCER' THEN 'A_RELANCER'::"OpportunityStage"
        WHEN 'PAS_INTERESSE' THEN 'PERDU'::"OpportunityStage"
        WHEN 'SIGNE' THEN 'SIGNE'::"OpportunityStage"
        ELSE 'A_CONTACTER'::"OpportunityStage"
    END,
    s."assignedToId",
    CASE WHEN s."status" = 'SIGNE' THEN COALESCE(s."signedAt", s."updatedAt") ELSE NULL END,
    s."signedAt",
    s."createdAt",
    s."updatedAt"
FROM "Salon" s
WHERE s."archivedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Opportunity" o WHERE o."salonId" = s."id");
