/*
  Warnings:

  - A unique constraint covering the columns `[phoneNumberId]` on the table `WhatsAppNumber` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppNumber_phoneNumberId_key" ON "WhatsAppNumber"("phoneNumberId");
