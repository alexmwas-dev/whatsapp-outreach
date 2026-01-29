-- CreateEnum
CREATE TYPE "WhatsappStatus" AS ENUM ('VERIFIED', 'PENDING', 'REJECTED');

-- CreateEnum
CREATE TYPE "MessagingTier" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "messagingTier" "MessagingTier",
ADD COLUMN     "webhookVerifyToken" TEXT,
ADD COLUMN     "whatsappBusinessAccountId" TEXT,
ADD COLUMN     "whatsappStatus" "WhatsappStatus";

-- AlterTable
ALTER TABLE "WhatsAppNumber" ADD COLUMN     "accessTokenExpiresAt" TIMESTAMP(3);
