-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "accessToken" TEXT,
ADD COLUMN     "accessTokenExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WhatsAppTemplate" ADD COLUMN     "content" TEXT,
ADD COLUMN     "metaTemplateId" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "status" "TemplateStatus" NOT NULL DEFAULT 'PENDING';

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WhatsAppTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
