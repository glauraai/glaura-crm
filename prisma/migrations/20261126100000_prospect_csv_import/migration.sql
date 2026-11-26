-- AlterEnum
ALTER TYPE "ProspectSource" ADD VALUE 'IMPORT';

-- AlterTable
ALTER TABLE "Prospect"
ADD COLUMN "phone" TEXT,
ADD COLUMN "email" TEXT,
ADD COLUMN "website" TEXT,
ADD COLUMN "contactName" TEXT,
ADD COLUMN "notes" TEXT;
