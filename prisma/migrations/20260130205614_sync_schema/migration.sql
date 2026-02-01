-- CreateEnum
CREATE TYPE "WhatsappSetupStep" AS ENUM ('WABA_CONNECTED', 'WEBHOOK_CONFIGURED', 'PHONE_NUMBER_ADDED', 'PHONE_NUMBER_VERIFIED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "whatsappStepsCompleted" "WhatsappSetupStep"[];
