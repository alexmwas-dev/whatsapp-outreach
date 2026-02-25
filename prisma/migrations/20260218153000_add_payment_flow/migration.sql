-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'pesapal',
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "planCode" TEXT NOT NULL,
  "messageLimit" INTEGER NOT NULL,
  "periodDays" INTEGER NOT NULL DEFAULT 30,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'KES',
  "merchantReference" TEXT NOT NULL,
  "orderTrackingId" TEXT,
  "providerReference" TEXT,
  "paymentMethod" TEXT,
  "paymentAccount" TEXT,
  "paidAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_merchantReference_key" ON "Payment"("merchantReference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orderTrackingId_key" ON "Payment"("orderTrackingId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_createdAt_idx" ON "Payment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- AddForeignKey
ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
