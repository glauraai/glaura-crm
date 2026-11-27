-- Add scheduling and 2-way Google Calendar fields to Activity.
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "durationMin" INTEGER;
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "calendarEventId" TEXT;
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "calendarEventUrl" TEXT;
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "meetUrl" TEXT;

CREATE INDEX IF NOT EXISTS "Activity_userId_scheduledAt_idx" ON "Activity"("userId", "scheduledAt");
