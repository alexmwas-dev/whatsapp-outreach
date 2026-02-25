-- AlterTable
ALTER TABLE "Campaign"
ADD COLUMN "state" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "sendLimit" INTEGER,
ADD COLUMN "sendDelayMs" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN "queueRequestedAt" TIMESTAMP(3),
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "pausedAt" TIMESTAMP(3),
ADD COLUMN "canceledAt" TIMESTAMP(3),
ADD COLUMN "lastProgressAt" TIMESTAMP(3),
ADD COLUMN "lastError" TEXT,
ADD COLUMN "workerLockId" TEXT,
ADD COLUMN "workerLockedAt" TIMESTAMP(3);

-- Backfill state from existing enum status
UPDATE "Campaign" SET "state" = "status"::text;

-- AlterTable
ALTER TABLE "CampaignContact"
ADD COLUMN "sendStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN "sendAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN "sentAt" TIMESTAMP(3),
ADD COLUMN "deliveredAt" TIMESTAMP(3),
ADD COLUMN "readAt" TIMESTAMP(3),
ADD COLUMN "lastError" TEXT,
ADD COLUMN "outboundMessageId" TEXT;

-- CreateIndex
CREATE INDEX "CampaignContact_campaignId_sendStatus_idx"
ON "CampaignContact"("campaignId", "sendStatus");

-- CreateIndex
CREATE INDEX "CampaignContact_outboundMessageId_idx"
ON "CampaignContact"("outboundMessageId");
