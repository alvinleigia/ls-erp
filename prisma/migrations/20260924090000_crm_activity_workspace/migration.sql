BEGIN;

-- Only this migration transaction may see all tenant follow-ups for backfill.
SELECT set_config('app.rls_bypass', 'on', true);

-- CreateEnum
CREATE TYPE "CrmWorkType" AS ENUM ('TASK', 'CALL', 'MEETING', 'EMAIL');

-- CreateEnum
CREATE TYPE "CrmWorkStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "CrmTask" DROP CONSTRAINT "CrmTask_tenantId_enquiryId_fkey";

-- AlterTable
ALTER TABLE "CrmTask" ADD COLUMN     "assignedUserId" TEXT,
ADD COLUMN     "callDirection" TEXT,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "completedByUserId" TEXT,
ADD COLUMN     "contactId" TEXT,
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "durationMinutes" INTEGER,
ADD COLUMN     "endsAt" TIMESTAMPTZ(3),
ADD COLUMN     "followParentAssignment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "followUpOfId" TEXT,
ADD COLUMN     "occurredAt" TIMESTAMPTZ(3),
ADD COLUMN     "opportunityId" TEXT,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "reminderAt" TIMESTAMPTZ(3),
ADD COLUMN     "reminderDismissedAt" TIMESTAMPTZ(3),
ADD COLUMN     "snoozedUntil" TIMESTAMPTZ(3),
ADD COLUMN     "startsAt" TIMESTAMPTZ(3),
ADD COLUMN     "status" "CrmWorkStatus" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "type" "CrmWorkType" NOT NULL DEFAULT 'TASK',
ADD COLUMN     "updatedAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "enquiryId" DROP NOT NULL;

-- Preserve existing IDs, dates and completion history. Unknown authors remain null.
UPDATE "CrmTask" t SET
  "contactId" = e."contactId", "assignedUserId" = e."assignedUserId",
  "followParentAssignment" = true,
  "status" = CASE WHEN t."completedAt" IS NULL THEN 'OPEN'::"CrmWorkStatus" ELSE 'COMPLETED'::"CrmWorkStatus" END,
  "updatedAt" = COALESCE(t."completedAt", t."createdAt")
FROM "CrmEnquiry" e WHERE e."tenantId" = t."tenantId" AND e."id" = t."enquiryId";
ALTER TABLE "CrmTask" ALTER COLUMN "contactId" SET NOT NULL,
  ALTER COLUMN "assignedUserId" SET NOT NULL, ALTER COLUMN "updatedAt" SET NOT NULL;

-- CreateTable
CREATE TABLE "CrmTaskEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmTaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmTaskEvent_tenantId_taskId_createdAt_idx" ON "CrmTaskEvent"("tenantId", "taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmOpportunity_tenantId_id_contactId_key" ON "CrmOpportunity"("tenantId", "id", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmEnquiry_tenantId_id_contactId_key" ON "CrmEnquiry"("tenantId", "id", "contactId");

-- CreateIndex
CREATE INDEX "CrmTask_tenantId_opportunityId_status_dueOn_idx" ON "CrmTask"("tenantId", "opportunityId", "status", "dueOn");

-- CreateIndex
CREATE INDEX "CrmTask_tenantId_assignedUserId_status_dueOn_idx" ON "CrmTask"("tenantId", "assignedUserId", "status", "dueOn");

-- CreateIndex
CREATE INDEX "CrmTask_tenantId_contactId_occurredAt_idx" ON "CrmTask"("tenantId", "contactId", "occurredAt");

-- CreateIndex
CREATE INDEX "CrmTask_tenantId_assignedUserId_reminderAt_idx" ON "CrmTask"("tenantId", "assignedUserId", "reminderAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmTask_tenantId_id_key" ON "CrmTask"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CrmTask_tenantId_followUpOfId_key" ON "CrmTask"("tenantId", "followUpOfId");

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_tenantId_enquiryId_contactId_fkey" FOREIGN KEY ("tenantId", "enquiryId", "contactId") REFERENCES "CrmEnquiry"("tenantId", "id", "contactId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_tenantId_opportunityId_contactId_fkey" FOREIGN KEY ("tenantId", "opportunityId", "contactId") REFERENCES "CrmOpportunity"("tenantId", "id", "contactId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_tenantId_contactId_fkey" FOREIGN KEY ("tenantId", "contactId") REFERENCES "CrmContact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_tenantId_assignedUserId_fkey" FOREIGN KEY ("tenantId", "assignedUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_tenantId_createdByUserId_fkey" FOREIGN KEY ("tenantId", "createdByUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_tenantId_completedByUserId_fkey" FOREIGN KEY ("tenantId", "completedByUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_tenantId_followUpOfId_fkey" FOREIGN KEY ("tenantId", "followUpOfId") REFERENCES "CrmTask"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTaskEvent" ADD CONSTRAINT "CrmTaskEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTaskEvent" ADD CONSTRAINT "CrmTaskEvent_tenantId_taskId_fkey" FOREIGN KEY ("tenantId", "taskId") REFERENCES "CrmTask"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTaskEvent" ADD CONSTRAINT "CrmTaskEvent_tenantId_actorUserId_fkey" FOREIGN KEY ("tenantId", "actorUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Match the existing tenant RLS contract.
ALTER TABLE "CrmTaskEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmTaskEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CrmTaskEvent" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_one_parent_check" CHECK ("enquiryId" IS NULL OR "opportunityId" IS NULL);
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_schedule_check" CHECK (("startsAt" IS NULL AND "endsAt" IS NULL) OR ("startsAt" IS NOT NULL AND "endsAt" IS NOT NULL AND "endsAt" > "startsAt" AND "endsAt" <= "startsAt" + INTERVAL '24 hours'));
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_priority_check" CHECK (priority BETWEEN 1 AND 3);
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_completion_check" CHECK ((status = 'COMPLETED') = ("completedAt" IS NOT NULL));
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_duration_check" CHECK ("durationMinutes" IS NULL OR "durationMinutes" BETWEEN 0 AND 1440);

-- Keep the previous application's follow-up writes valid during a rolling upgrade.
CREATE OR REPLACE FUNCTION app.crm_task_legacy_bridge() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_contact TEXT; source_assignee TEXT;
BEGIN
  IF NEW."enquiryId" IS NOT NULL AND NEW."opportunityId" IS NULL AND (NEW."contactId" IS NULL OR NEW."assignedUserId" IS NULL) THEN
    SELECT e."contactId", e."assignedUserId" INTO source_contact, source_assignee
      FROM public."CrmEnquiry" e WHERE e."tenantId" = NEW."tenantId" AND e.id = NEW."enquiryId";
    NEW."contactId" := COALESCE(NEW."contactId", source_contact);
    NEW."assignedUserId" := COALESCE(NEW."assignedUserId", source_assignee);
    NEW."followParentAssignment" := true;
  END IF;
  IF NEW."followParentAssignment" AND NEW."completedAt" IS NOT NULL AND NEW.status = 'OPEN' THEN
    NEW.status := 'COMPLETED';
    IF TG_OP = 'UPDATE' AND NEW.version = OLD.version THEN NEW.version := OLD.version + 1; END IF;
  END IF;
  IF NEW."updatedAt" IS NULL THEN NEW."updatedAt" := COALESCE(NEW."createdAt", CURRENT_TIMESTAMP AT TIME ZONE 'UTC'); END IF;
  IF TG_OP = 'UPDATE' AND NEW."updatedAt" = OLD."updatedAt" THEN NEW."updatedAt" := CURRENT_TIMESTAMP AT TIME ZONE 'UTC'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_task_legacy_bridge BEFORE INSERT OR UPDATE ON "CrmTask" FOR EACH ROW EXECUTE FUNCTION app.crm_task_legacy_bridge();

CREATE OR REPLACE FUNCTION app.crm_inherit_enquiry_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."assignedUserId" IS DISTINCT FROM NEW."assignedUserId" THEN
    UPDATE public."CrmTask" SET "assignedUserId" = NEW."assignedUserId", version = version + 1,
      "snoozedUntil" = NULL, "reminderDismissedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
      WHERE "tenantId" = NEW."tenantId" AND "enquiryId" = NEW.id AND "followParentAssignment"
        AND status IN ('OPEN', 'IN_PROGRESS') AND "assignedUserId" IS DISTINCT FROM NEW."assignedUserId";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_inherit_enquiry_assignment AFTER UPDATE OF "assignedUserId" ON "CrmEnquiry" FOR EACH ROW EXECUTE FUNCTION app.crm_inherit_enquiry_assignment();

COMMIT;
