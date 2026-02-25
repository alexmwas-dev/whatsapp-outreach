-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "messagesDelivered" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "messagesFailed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "messagesRead" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "messagesSent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "templateId" TEXT;
