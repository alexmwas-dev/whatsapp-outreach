-- CreateEnum
CREATE TYPE "PromotionDiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateTable
CREATE TABLE "Promotion" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "discountType" "PromotionDiscountType" NOT NULL DEFAULT 'PERCENTAGE',
  "discountValue" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "maxUses" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Payment"
  ADD COLUMN "promotionId" TEXT,
  ADD COLUMN "originalAmount" INTEGER,
  ADD COLUMN "discountAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "promotionCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_code_key" ON "Promotion"("code");

-- CreateIndex
CREATE INDEX "Payment_promotionId_idx" ON "Payment"("promotionId");

-- CreateIndex
CREATE INDEX "Payment_promotionCode_idx" ON "Payment"("promotionCode");

-- AddForeignKey
ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_promotionId_fkey"
FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
